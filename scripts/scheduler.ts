import cron from 'node-cron';
import { prisma } from '../src/lib/prisma';
import { checkQueue } from '../src/lib/redis';

console.log('[Scheduler] Starting Node-Cron scheduler...');

cron.schedule('* * * * *', async () => {
  const currentMinute = new Date().getMinutes();
  
  try {
    const dueMonitors = await prisma.monitor.findMany({
      where: { status: { not: 'PAUSED' } }
    });

    const jobsToQueue = dueMonitors.filter(monitor => {
      return currentMinute % monitor.interval === 0;
    });

    if (jobsToQueue.length === 0) {
      console.log(`[Scheduler] Minute ${currentMinute}: No monitors due.`);
      return;
    }

    const jobs = jobsToQueue.map(monitor => ({
      name: 'scheduled-check',
      data: {
        monitorId: monitor.id,
        target: monitor.target,
        type: monitor.type,
        timeoutMs: monitor.timeoutMs,
        keyword: monitor.keyword
      },
      opts: {
        jobId: `${monitor.id}-${Date.now()}`, 
        removeOnComplete: true,
        removeOnFail: 100
      }
    }));

    await checkQueue.addBulk(jobs);
    console.log(`[Scheduler] Minute ${currentMinute}: Enqueued ${jobs.length} checks.`);
  } catch (error) {
    console.error('[Scheduler] Error querying database:', error);
  }
});
