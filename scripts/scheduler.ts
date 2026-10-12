import cron from 'node-cron';
import { prisma } from '../src/lib/prisma';
import { checkQueue, redisConnection } from '../src/lib/redis';

console.log('[Scheduler] Starting Beacon interval scheduler...');

let isProcessing = false;

const task = cron.schedule('* * * * *', async () => {
  if (isProcessing) {
    console.log('[Scheduler] Previous tick still processing, skipping overlap.');
    return;
  }
  isProcessing = true;

  const now = new Date();
  const currentSlot = Math.floor(now.getTime() / 60000) * 60000;

  try {
    // BUG-004: Persisted nextCheckAt comparison in UTC rather than wall-clock modulo
    const dueMonitors = await prisma.monitor.findMany({
      where: {
        status: { not: 'PAUSED' },
        nextCheckAt: { lte: now },
      },
    });

    if (dueMonitors.length === 0) {
      console.log(`[Scheduler] ${now.toISOString()}: No monitors due.`);
      isProcessing = false;
      return;
    }

    const jobs = dueMonitors.map((monitor) => ({
      name: 'scheduled-check',
      data: {
        monitorId: monitor.id,
        target: monitor.target,
        type: monitor.type,
        timeoutMs: monitor.timeoutMs,
        keyword: monitor.keyword || undefined,
      },
      opts: {
        // BUG-005: Deterministic jobId derived from monitor ID and slot timestamp for Redis deduplication
        jobId: `${monitor.id}-${currentSlot}`,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    }));

    await checkQueue.addBulk(jobs);

    // Advance nextCheckAt by interval minutes
    await Promise.all(
      dueMonitors.map((m) =>
        prisma.monitor.update({
          where: { id: m.id },
          data: {
            nextCheckAt: new Date(Date.now() + m.interval * 60 * 1000),
            lastCheckedAt: now,
          },
        })
      )
    );

    console.log(`[Scheduler] ${now.toISOString()}: Enqueued ${jobs.length} checks.`);
  } catch (error) {
    console.error('[Scheduler] Error querying database or enqueuing jobs:', error);
  } finally {
    isProcessing = false;
  }
});

// BUG-019: Graceful shutdown on SIGINT / SIGTERM
async function shutdown(signal: string) {
  console.log(`[Scheduler] Received ${signal}, shutting down gracefully...`);
  task.stop();
  try {
    await checkQueue.close();
    await redisConnection.quit();
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[Scheduler] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
