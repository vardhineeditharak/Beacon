import { Worker, Job } from 'bullmq';
import axios from 'axios';
import ping from 'ping';
import net from 'net';
import { prisma } from '../src/lib/prisma';
import { redisConnection, alertQueue, checkQueue } from '../src/lib/redis';

interface CheckJobData {
  monitorId: string;
  target: string;
  type: 'HTTP' | 'PING' | 'TCP' | 'KEYWORD';
  timeoutMs: number;
  keyword?: string;
  isVerificationCheck?: boolean;
  failureCount?: number;
}

const worker = new Worker('monitor-checks', async (job: Job<CheckJobData>) => {
  const { monitorId, target, type, timeoutMs, keyword, isVerificationCheck, failureCount = 0 } = job.data;
  
  const startTime = Date.now();
  let isUp = false;
  let responseTimeMs = 0;
  let httpStatusCode: number | null = null;
  let errorMessage: string | null = null;

  try {
    if (type === 'HTTP' || type === 'KEYWORD') {
      const res = await axios.get(target, { timeout: timeoutMs, validateStatus: () => true });
      responseTimeMs = Date.now() - startTime;
      httpStatusCode = res.status;
      
      if (res.status >= 200 && res.status < 400) {
        if (type === 'KEYWORD' && keyword) {
          isUp = typeof res.data === 'string' && res.data.includes(keyword);
          if (!isUp) errorMessage = `Keyword "${keyword}" not found in body.`;
        } else {
          isUp = true;
        }
      } else {
        errorMessage = `HTTP Status ${res.status}`;
      }
    } else if (type === 'PING') {
      const res = await ping.promise.probe(target, { timeout: timeoutMs / 1000 });
      responseTimeMs = Date.now() - startTime;
      isUp = res.alive;
      if (!isUp) errorMessage = 'Ping timeout / Host unreachable';
    } else if (type === 'TCP') {
      const [host, port] = target.split(':');
      isUp = await checkTcp(host, parseInt(port, 10), timeoutMs);
      responseTimeMs = Date.now() - startTime;
      if (!isUp) errorMessage = 'TCP Connection Refused / Timeout';
    }
  } catch (error: unknown) {
    responseTimeMs = Date.now() - startTime;
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  await prisma.pingResult.create({
    data: {
      monitorId,
      status: isUp ? 'UP' : 'DOWN',
      responseTimeMs,
      httpStatusCode,
      errorMessage: errorMessage ? errorMessage.substring(0, 255) : null
    }
  });

  if (!isUp) {
    if (failureCount < 2) {
      console.log(`[Worker] Monitor ${monitorId} failed. Verification check ${failureCount + 1}/2.`);
      await checkQueue.add('verify-check', {
        ...job.data,
        isVerificationCheck: true,
        failureCount: failureCount + 1
      }, { priority: 1 });
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
}, { connection: redisConnection, concurrency: 100 });

// Consume the alert queue. Alerts are enqueued by confirmDown/handleUpState;
// without a worker they would pile up undelivered.
const alertWorker = new Worker('alerts', async (job: Job) => {
  const { incidentId, monitorId, type } = job.data as {
    incidentId: string;
    monitorId: string;
    type: 'DOWN' | 'UP';
  };
  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
  console.log(
    `[Alerts] ${type} alert for monitor "${monitor?.name ?? monitorId}" ` +
    `(incident ${incidentId}). Route to email/webhook/Slack here.`
  );
}, { connection: redisConnection, concurrency: 10 });

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err?.message ?? err);
});
worker.on('error', (err) => {
  console.error('[Worker] Worker error:', err);
});
alertWorker.on('failed', (job, err) => {
  console.error(`[Alerts] Job ${job?.id} failed:`, err?.message ?? err);
});

// Graceful shutdown so in-flight jobs finish and connections close cleanly.
async function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);
  await worker.close();
  await alertWorker.close();
  await alertQueue.close();
  await checkQueue.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

async function checkTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

async function confirmDown(monitorId: string, errorCause: string | null) {
  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
  if (monitor?.status !== 'DOWN') {
    await prisma.monitor.update({ where: { id: monitorId }, data: { status: 'DOWN' } });
    
    const incident = await prisma.incident.create({
      data: { 
        monitorId, 
        status: 'DOWN', 
        errorCause: errorCause ? errorCause.substring(0, 255) : null
      }
    });

    await alertQueue.add('send-alert', { incidentId: incident.id, monitorId, type: 'DOWN' });
  }
}

async function handleUpState(monitorId: string) {
  const monitor = await prisma.monitor.findUnique({ 
    where: { id: monitorId }, 
    include: { incidents: { where: { status: 'DOWN' } } } 
  });
  
  if (monitor?.status === 'DOWN' || monitor?.status === 'DEGRADED') {
    await prisma.monitor.update({ where: { id: monitorId }, data: { status: 'UP' } });
    
    const activeIncident = monitor.incidents[0];
    if (activeIncident) {
      await prisma.incident.update({
        where: { id: activeIncident.id },
        data: { status: 'RESOLVED', resolvedAt: new Date() }
      });
      await alertQueue.add('send-alert', { incidentId: activeIncident.id, monitorId, type: 'UP' });
    }
  }
}

console.log('[Worker] Poller worker started');
