import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy(times) {
    if (times > 3) {
      return null; // Stop reconnecting when Redis is unavailable
    }
    return Math.min(times * 200, 2000);
  },
});

redisConnection.on('error', (err) => {
  // Prevent unhandled error events from crashing node process
  if (process.env.NODE_ENV !== 'production') {
    // Keep it quiet in dev when redis isn't running locally
  } else {
    console.warn('[Redis] Connection error on default client:', err.message);
  }
});

// Dedicated duplicate connection factory for blocking BullMQ workers
export function createWorkerConnection(): Redis {
  const conn = redisConnection.duplicate({
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  conn.on('error', (err) => {
    console.warn('[Redis] Connection error on worker client:', err.message);
  });

  return conn;
}

let _checkQueue: Queue | null = null;
let _alertQueue: Queue | null = null;

export function getCheckQueue(): Queue {
  if (!_checkQueue) {
    _checkQueue = new Queue('monitor-checks', { connection: redisConnection });
  }
  return _checkQueue;
}

export function getAlertQueue(): Queue {
  if (!_alertQueue) {
    _alertQueue = new Queue('alerts', { connection: redisConnection });
  }
  return _alertQueue;
}

// Lazy proxy preserves existing exports for worker and scheduler daemons
export const checkQueue = new Proxy({} as Queue, {
  get(_target, prop) {
    const queue = getCheckQueue();
    const val = Reflect.get(queue, prop);
    return typeof val === 'function' ? val.bind(queue) : val;
  },
});

export const alertQueue = new Proxy({} as Queue, {
  get(_target, prop) {
    const queue = getAlertQueue();
    const val = Reflect.get(queue, prop);
    return typeof val === 'function' ? val.bind(queue) : val;
  },
});
