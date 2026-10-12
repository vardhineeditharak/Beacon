import dns from 'dns/promises';
import { z } from 'zod';

export const ALLOWED_INTERVALS = [1, 5, 15, 30, 60] as const;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 60000;
export const DEFAULT_TIMEOUT_MS = 30000;

export const MONITOR_TYPES = ['HTTP', 'PING', 'TCP', 'KEYWORD', 'HEARTBEAT'] as const;
export type MonitorType = (typeof MONITOR_TYPES)[number];

export function isPrivateOrReservedIp(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1)
  const normalized = ip.toLowerCase().startsWith('::ffff:')
    ? ip.substring(7)
    : ip.toLowerCase();

  // IPv6 checks
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true; // Link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // Unique local address (fc00::/7)

  // IPv4 checks
  const parts = normalized.split('.').map((p) => parseInt(p, 10));
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
    if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 multicast
    if (a >= 240) return true; // 240.0.0.0/4 reserved & broadcast
  }

  return false;
}

export async function validateTargetSecurity(
  target: string,
  type: MonitorType
): Promise<{ valid: boolean; error?: string; cleanTarget?: string; port?: number }> {
  const trimmed = target.trim();
  if (!trimmed) {
    return { valid: false, error: 'Target is required' };
  }

  if (type === 'HEARTBEAT') {
    // For heartbeats, target can be an alphanumeric slug e.g. "cron-service-1"
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(trimmed)) {
      return {
        valid: false,
        error: 'Heartbeat target must be an alphanumeric identifier (2-64 chars, a-z, 0-9, -, _)',
      };
    }
    return { valid: true, cleanTarget: trimmed };
  }

  if (type === 'TCP') {
    // Expected format: host:port
    const parts = trimmed.split(':');
    if (parts.length !== 2) {
      return { valid: false, error: 'TCP target must be formatted as "hostname:port" or "ip:port"' };
    }

    const [host, portStr] = parts;
    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { valid: false, error: 'TCP port must be a valid integer between 1 and 65535' };
    }

    if (!host || host.includes('/') || host.includes(' ')) {
      return { valid: false, error: 'Invalid hostname for TCP target' };
    }

    if (host.toLowerCase() === 'localhost') {
      return { valid: false, error: 'Target resolves to private or loopback address (SSRF blocked)' };
    }

    // Resolve hostname/IP and check for private/loopback/cloud metadata
    try {
      const addresses = await dns.lookup(host, { all: true });
      for (const addr of addresses) {
        if (isPrivateOrReservedIp(addr.address)) {
          return {
            valid: false,
            error: `Target address (${addr.address}) is private, reserved or cloud metadata (SSRF blocked)`,
          };
        }
      }
    } catch (err: unknown) {
      return {
        valid: false,
        error: `Could not resolve target host "${host}": ${err instanceof Error ? err.message : 'DNS lookup failed'}`,
      };
    }

    return { valid: true, cleanTarget: `${host}:${port}`, port };
  }

  if (type === 'PING') {
    const host = trimmed.toLowerCase();
    if (host.includes('/') || host.includes(':') || host.includes(' ')) {
      return { valid: false, error: 'Ping target must be a valid hostname or IP address without protocol or path' };
    }
    if (host === 'localhost') {
      return { valid: false, error: 'Target resolves to private or loopback address (SSRF blocked)' };
    }

    try {
      const addresses = await dns.lookup(host, { all: true });
      for (const addr of addresses) {
        if (isPrivateOrReservedIp(addr.address)) {
          return {
            valid: false,
            error: `Target address (${addr.address}) is private, reserved or cloud metadata (SSRF blocked)`,
          };
        }
      }
    } catch (err: unknown) {
      return {
        valid: false,
        error: `Could not resolve ping target "${host}": ${err instanceof Error ? err.message : 'DNS lookup failed'}`,
      };
    }

    return { valid: true, cleanTarget: host };
  }

  // HTTP or KEYWORD
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Target must be a valid URL with http:// or https://' };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { valid: false, error: `Invalid protocol "${parsedUrl.protocol}". Only http:// and https:// are supported.` };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { valid: false, error: 'Target resolves to private or internal address (SSRF blocked)' };
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isPrivateOrReservedIp(addr.address)) {
        return {
          valid: false,
          error: `Target IP (${addr.address}) is private, reserved or cloud metadata (SSRF blocked)`,
        };
      }
    }
  } catch (err: unknown) {
    return {
      valid: false,
      error: `Could not resolve URL hostname "${hostname}": ${err instanceof Error ? err.message : 'DNS lookup failed'}`,
    };
  }

  return { valid: true, cleanTarget: parsedUrl.toString() };
}

export const createMonitorSchema = z.object({
  name: z.string().trim().min(1, { message: 'Name is required' }).max(100, { message: 'Name must be 100 characters or fewer' }),
  target: z.string().trim().min(1, { message: 'Target is required' }),
  type: z.enum(MONITOR_TYPES, { message: 'Invalid monitor type' }),
  interval: z
    .number({ message: 'Interval must be a number' })
    .int({ message: 'Interval must be an integer' })
    .refine((val) => (ALLOWED_INTERVALS as readonly number[]).includes(val as (typeof ALLOWED_INTERVALS)[number]), {
      message: `Interval must be one of: ${ALLOWED_INTERVALS.join(', ')} minutes`,
    }),
  timeoutMs: z
    .number({ message: 'Timeout must be a number' })
    .int({ message: 'Timeout must be an integer' })
    .min(MIN_TIMEOUT_MS, { message: `Timeout must be at least ${MIN_TIMEOUT_MS}ms` })
    .max(MAX_TIMEOUT_MS, { message: `Timeout cannot exceed ${MAX_TIMEOUT_MS}ms` })
    .default(DEFAULT_TIMEOUT_MS),
  keyword: z.string().trim().optional(),
});

export const updateMonitorSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  target: z.string().trim().min(1).optional(),
  status: z.enum(['UP', 'PAUSED'] as const, { message: 'Status can only be toggled between UP and PAUSED' }).optional(),
  interval: z
    .number()
    .int()
    .refine((val) => (ALLOWED_INTERVALS as readonly number[]).includes(val as (typeof ALLOWED_INTERVALS)[number]), {
      message: `Interval must be one of: ${ALLOWED_INTERVALS.join(', ')} minutes`,
    })
    .optional(),
  timeoutMs: z
    .number()
    .int()
    .min(MIN_TIMEOUT_MS)
    .max(MAX_TIMEOUT_MS)
    .optional(),
  keyword: z.string().trim().optional(),
});
