import axios from 'axios';
import ping from 'ping';
import net from 'net';
import { prisma } from './prisma';
import { validateTargetSecurity } from './validation';
import { Monitor, MonitorType } from '@prisma/client';

export interface ProbeResult {
  isUp: boolean;
  responseTimeMs: number;
  httpStatusCode: number | null;
  errorMessage: string | null;
}

export async function checkTcpConnection(host: string, port: number, timeoutMs: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return false;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const socket = new net.Socket();

    const cleanup = (result: boolean) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      cleanup(false);
    }, timeoutMs);

    socket.on('connect', () => cleanup(true));
    socket.on('timeout', () => cleanup(false));
    socket.on('error', () => cleanup(false));

    try {
      socket.connect(port, host);
    } catch {
      cleanup(false);
    }
  });
}

export async function executeProbe(monitor: {
  id: string;
  type: MonitorType;
  target: string;
  keyword: string | null;
  interval: number;
  timeoutMs: number;
  lastHeartbeatAt?: Date | null;
}): Promise<ProbeResult> {
  const startTime = Date.now();
  const clampedTimeout = Math.min(Math.max(monitor.timeoutMs || 30000, 1000), 60000);

  // SSRF and target guard
  const securityCheck = await validateTargetSecurity(monitor.target, monitor.type);
  if (!securityCheck.valid) {
    return {
      isUp: false,
      responseTimeMs: Date.now() - startTime,
      httpStatusCode: null,
      errorMessage: securityCheck.error || 'Security check failed',
    };
  }

  try {
    if (monitor.type === 'HEARTBEAT') {
      const responseTimeMs = Date.now() - startTime;
      const now = Date.now();
      const lastPing = monitor.lastHeartbeatAt ? new Date(monitor.lastHeartbeatAt).getTime() : 0;
      // Allow window: interval * 2 (e.g., 5 min interval => 10 min window)
      const allowedWindowMs = monitor.interval * 60 * 1000 * 2;
      const isUp = lastPing > 0 && now - lastPing <= allowedWindowMs;

      return {
        isUp,
        responseTimeMs,
        httpStatusCode: isUp ? 200 : null,
        errorMessage: isUp ? null : 'Heartbeat missed: no heartbeat signal received within expected window',
      };
    }

    if (monitor.type === 'HTTP' || monitor.type === 'KEYWORD') {
      const res = await axios.get(monitor.target, {
        timeout: clampedTimeout,
        maxRedirects: 0, // Prevent redirect-based SSRF bypass
        validateStatus: () => true,
      });

      const responseTimeMs = Date.now() - startTime;
      const httpStatusCode = res.status;

      if (res.status >= 200 && res.status < 400) {
        if (monitor.type === 'KEYWORD') {
          if (!monitor.keyword) {
            return {
              isUp: false,
              responseTimeMs,
              httpStatusCode,
              errorMessage: 'Keyword monitor configured without a target keyword',
            };
          }
          const bodyString = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          const hasKeyword = bodyString.includes(monitor.keyword);
          return {
            isUp: hasKeyword,
            responseTimeMs,
            httpStatusCode,
            errorMessage: hasKeyword ? null : `Keyword "${monitor.keyword}" not found in response body`,
          };
        }
        return {
          isUp: true,
          responseTimeMs,
          httpStatusCode,
          errorMessage: null,
        };
      } else {
        return {
          isUp: false,
          responseTimeMs,
          httpStatusCode,
          errorMessage: `HTTP Status ${res.status}`,
        };
      }
    }

    if (monitor.type === 'PING') {
      const timeoutSeconds = Math.max(1, Math.round(clampedTimeout / 1000));
      const res = await ping.promise.probe(monitor.target, { timeout: timeoutSeconds });
      const responseTimeMs = Date.now() - startTime;
      return {
        isUp: res.alive,
        responseTimeMs,
        httpStatusCode: null,
        errorMessage: res.alive ? null : 'Ping timeout / Host unreachable',
      };
    }

    if (monitor.type === 'TCP') {
      const [host, portStr] = monitor.target.split(':');
      const port = parseInt(portStr, 10);
      const isUp = await checkTcpConnection(host, port, clampedTimeout);
      const responseTimeMs = Date.now() - startTime;
      return {
        isUp,
        responseTimeMs,
        httpStatusCode: null,
        errorMessage: isUp ? null : 'TCP Connection Refused or Timed Out',
      };
    }

    return {
      isUp: false,
      responseTimeMs: Date.now() - startTime,
      httpStatusCode: null,
      errorMessage: `Unsupported monitor type: ${monitor.type}`,
    };
  } catch (err: unknown) {
    const responseTimeMs = Date.now() - startTime;
    return {
      isUp: false,
      responseTimeMs,
      httpStatusCode: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function recordProbeAndTransition(
  monitor: Monitor,
  result: ProbeResult
): Promise<void> {
  // 1. Record telemetry PingResult
  await prisma.pingResult.create({
    data: {
      monitorId: monitor.id,
      status: result.isUp ? 'UP' : 'DOWN',
      responseTimeMs: result.responseTimeMs,
      httpStatusCode: result.httpStatusCode,
      errorMessage: result.errorMessage ? result.errorMessage.substring(0, 255) : null,
    },
  });

  // 2. Atomic state transitions
  if (!result.isUp) {
    // Only transition if not already DOWN
    const updated = await prisma.monitor.updateMany({
      where: {
        id: monitor.id,
        status: { not: 'DOWN' },
      },
      data: { status: 'DOWN' },
    });

    if (updated.count === 1) {
      // Exactly one writer transitions to DOWN
      await prisma.incident.create({
        data: {
          monitorId: monitor.id,
          status: 'DOWN',
          errorCause: result.errorMessage ? result.errorMessage.substring(0, 255) : 'Service unreachable',
        },
      });
    }
  } else {
    // Transition to UP if previously DOWN or DEGRADED
    const updated = await prisma.monitor.updateMany({
      where: {
        id: monitor.id,
        status: { not: 'UP' },
      },
      data: { status: 'UP' },
    });

    if (updated.count === 1) {
      // Resolve active DOWN incidents
      await prisma.incident.updateMany({
        where: {
          monitorId: monitor.id,
          status: 'DOWN',
        },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
        },
      });
    }
  }
}
