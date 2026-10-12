import { Worker, Job } from 'bullmq';
import axios from 'axios';
import ping from 'ping';
import net from 'net';
import { prisma } from '../src/lib/prisma';
import { createWorkerConnection, alertQueue, checkQueue } from '../src/lib/redis';
import { validateTargetSecurity } from '../src/lib/validation';

interface CheckJobData {
  monitorId: string;
  target: string;
  type: 'HTTP' | 'PING' | 'TCP' | 'KEYWORD' | 'HEARTBEAT';
  timeoutMs: number;
  keyword?: string;
  isVerificationCheck?: boolean;
  failureCount?: number;
}

// Dedicated connections per blocking worker (BUG-018)
const workerConnection = createWorkerConnection();
const alertWorkerConnection = createWorkerConnection();

const worker = new Worker(
  'monitor-checks',
  async (job: Job<CheckJobData>) => {
    const { monitorId, target, type, keyword, isVerificationCheck, failureCount = 0 } = job.data;
    const timeoutMs = Math.min(Math.max(job.data.timeoutMs || 30000, 1000), 60000); // BUG-023

    const startTime = Date.now();
    let isUp = false;
    let responseTimeMs = 0;
    let httpStatusCode: number | null = null;
    let errorMessage: string | null = null;

    // SSRF pre-check
    const securityCheck = await validateTargetSecurity(target, type);
    if (!securityCheck.valid) {
      isUp = false;
      errorMessage = securityCheck.error || 'Blocked by SSRF security policy';
    } else {
      try {
        if (type === 'HEARTBEAT') {
          // BUG-001: HEARTBEAT handling backed by lastHeartbeatAt column
          const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
          const lastPing = monitor?.lastHeartbeatAt ? new Date(monitor.lastHeartbeatAt).getTime() : 0;
          const allowedWindowMs = (monitor?.interval || 5) * 60 * 1000 * 2;
          isUp = lastPing > 0 && Date.now() - lastPing <= allowedWindowMs;
          responseTimeMs = Date.now() - startTime;
          httpStatusCode = isUp ? 200 : null;
          if (!isUp) errorMessage = 'Heartbeat missed: no signal received within expected window';
        } else if (type === 'HTTP' || type === 'KEYWORD') {
          const res = await axios.get(target, {
            timeout: timeoutMs,
            maxRedirects: 0,
            validateStatus: () => true,
          });
          responseTimeMs = Date.now() - startTime;
          httpStatusCode = res.status;

          if (res.status >= 200 && res.status < 400) {
            if (type === 'KEYWORD' && keyword) {
              const bodyStr = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
              isUp = bodyStr.includes(keyword);
              if (!isUp) errorMessage = `Keyword "${keyword}" not found in body.`;
            } else if (type === 'KEYWORD' && !keyword) {
              isUp = false;
              errorMessage = 'KEYWORD monitor requires a target keyword.';
            } else {
              isUp = true;
            }
          } else {
            errorMessage = `HTTP Status ${res.status}`;
          }
        } else if (type === 'PING') {
          const res = await ping.promise.probe(target, { timeout: Math.max(1, Math.round(timeoutMs / 1000)) });
          responseTimeMs = Date.now() - startTime;
          isUp = res.alive;
          if (!isUp) errorMessage = 'Ping timeout / Host unreachable';
        } else if (type === 'TCP') {
          const [host, portStr] = target.split(':');
          const port = parseInt(portStr, 10);
          isUp = await checkTcp(host, port, timeoutMs);
          responseTimeMs = Date.now() - startTime;
          if (!isUp) errorMessage = 'TCP Connection Refused / Timeout';
        }
      } catch (error: unknown) {
        responseTimeMs = Date.now() - startTime;
        errorMessage = error instanceof Error ? error.message : String(error);
      }
    }

    // Wrap DB writes so a transient pingResult error doesn't discard status updates (BUG-006)
    try {
      await prisma.pingResult.create({
        data: {
          monitorId,
          status: isUp ? 'UP' : 'DOWN',
          responseTimeMs,
          httpStatusCode,
          errorMessage: errorMessage ? errorMessage.substring(0, 255) : null,
        },
      });
    } catch (dbErr) {
      console.error(`[Worker] Failed to record PingResult for ${monitorId}:`, dbErr);
    }

    if (!isUp) {
      if (failureCount < 2) {
        console.log(`[Worker] Monitor ${monitorId} failed. Verification check ${failureCount + 1}/2.`);
        // BUG-002: Deterministic jobId, 20s delay, dedupe
        await checkQueue.add(
          'verify-check',
          {
            ...job.data,
            isVerificationCheck: true,
            failureCount: failureCount + 1,
          },
          {
            jobId: `${monitorId}-verify-${failureCount + 1}`,
            delay: 20000,
            priority: 1,
            removeOnComplete: true,
            removeOnFail: 100,
          }
        );
      } else {
        console.log(`[Worker] Monitor ${monitorId} confirmed DOWN.`);
        await confirmDown(monitorId, errorMessage);
      }
    } else {
      if (isVerificationCheck) {
        console.log(`[Worker] Monitor ${monitorId} recovered during verification.`);
      }
      await handleUpState(monitorId);
    }
  },
  {
    connection: workerConnection,
    concurrency: 50,
  }
);

// Alert worker with delivery logging and AlertContact lookup (BUG-020)
const alertWorker = new Worker(
  'alerts',
  async (job: Job) => {
    const { incidentId, monitorId, type } = job.data as {
      incidentId: string;
      monitorId: string;
      type: 'DOWN' | 'UP';
    };

    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      include: {
        organization: {
          include: { alerts: { where: { active: true } } },
        },
      },
    });

    const contacts = monitor?.organization.alerts || [];
    console.log(
      `[Alerts] Delivering ${type} alert for monitor "${monitor?.name ?? monitorId}" (Incident ${incidentId}) to ${contacts.length} registered contacts.`
    );

    for (const contact of contacts) {
      console.log(`[Alerts] -> Dispatched to ${contact.type}: ${contact.destination}`);
    }
  },
  {
    connection: alertWorkerConnection,
    concurrency: 10,
  }
);

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err?.message ?? err);
});
worker.on('error', (err) => {
  console.error('[Worker] Worker connection error:', err);
});
alertWorker.on('failed', (job, err) => {
  console.error(`[Alerts] Job ${job?.id} failed:`, err?.message ?? err);
});
alertWorker.on('error', (err) => {
  console.error('[Alerts] Worker connection error:', err);
});

// BUG-007: TCP deadline guard with finite port verification
async function checkTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();

    const finish = (result: boolean) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        resolve(result);
      }
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));

    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

// BUG-003: Atomic transition to DOWN using updateMany count check
async function confirmDown(monitorId: string, errorCause: string | null) {
  const updated = await prisma.monitor.updateMany({
    where: { id: monitorId, status: { not: 'DOWN' } },
    data: { status: 'DOWN' },
  });

  if (updated.count === 1) {
    const incident = await prisma.incident.create({
      data: {
        monitorId,
        status: 'DOWN',
        errorCause: errorCause ? errorCause.substring(0, 255) : null,
      },
    });

    await alertQueue.add('send-alert', { incidentId: incident.id, monitorId, type: 'DOWN' });
  }
}

// BUG-003: Atomic transition to UP using updateMany count check
async function handleUpState(monitorId: string) {
  const updated = await prisma.monitor.updateMany({
    where: { id: monitorId, status: { not: 'UP' } },
    data: { status: 'UP' },
  });

  if (updated.count === 1) {
    const activeIncidents = await prisma.incident.findMany({
      where: { monitorId, status: 'DOWN' },
    });

    for (const inc of activeIncidents) {
      await prisma.incident.update({
        where: { id: inc.id },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
      await alertQueue.add('send-alert', { incidentId: inc.id, monitorId, type: 'UP' });
    }
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);
  const shutdownTimer = setTimeout(() => {
    console.error('[Worker] Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);

  try {
    await worker.close();
    await alertWorker.close();
    await workerConnection.quit();
    await alertWorkerConnection.quit();
    await prisma.$disconnect();
    clearTimeout(shutdownTimer);
    process.exit(0);
  } catch (err) {
    console.error('[Worker] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.log('[Worker] Beacon poller worker started');
