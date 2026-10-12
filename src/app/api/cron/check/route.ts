import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { executeProbe, recordProbeAndTransition } from '@/lib/prober';

function verifyCronAuth(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // If CRON_SECRET is not set in development, allow local invocation
    return process.env.NODE_ENV !== 'production';
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const url = new URL(req.url);
  if (url.searchParams.get('secret') === cronSecret) {
    return true;
  }

  return false;
}

export async function GET(req: Request) {
  return handleCron(req);
}

export async function POST(req: Request) {
  return handleCron(req);
}

async function handleCron(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized cron request' }, { status: 401 });
  }

  const now = new Date();

  try {
    // 1. Fetch monitors due for execution (not paused, nextCheckAt <= now)
    const dueMonitors = await prisma.monitor.findMany({
      where: {
        status: { not: 'PAUSED' },
        nextCheckAt: { lte: now },
      },
      take: 50, // Batch limit per cron tick to stay within serverless execution limits
    });

    if (dueMonitors.length === 0) {
      return NextResponse.json({
        success: true,
        checked: 0,
        message: 'No monitors due for check at this time.',
      });
    }

    // 2. Execute due monitors concurrently
    const results = await Promise.allSettled(
      dueMonitors.map(async (monitor) => {
        const probeResult = await executeProbe(monitor);
        await recordProbeAndTransition(monitor, probeResult);

        // Schedule next check time aligned to interval
        const nextCheck = new Date(Date.now() + monitor.interval * 60 * 1000);
        await prisma.monitor.update({
          where: { id: monitor.id },
          data: {
            nextCheckAt: nextCheck,
            lastCheckedAt: new Date(),
          },
        });

        return {
          id: monitor.id,
          name: monitor.name,
          isUp: probeResult.isUp,
          responseTimeMs: probeResult.responseTimeMs,
        };
      })
    );

    // 3. Optional periodic retention pruning: delete raw PingResults older than 7 days
    // Runs opportunistically (5% chance per tick) to maintain fast DB queries
    if (Math.random() < 0.05) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await prisma.pingResult.deleteMany({
        where: { timestamp: { lt: sevenDaysAgo } },
      }).catch((err) => console.warn('[Cron] Retention cleanup warning:', err.message));
    }

    const successfulProbes = results.filter((r) => r.status === 'fulfilled');

    return NextResponse.json({
      success: true,
      due: dueMonitors.length,
      processed: successfulProbes.length,
      timestamp: now.toISOString(),
    });
  } catch (error: unknown) {
    console.error('[Cron] Check runner failed:', error);
    return NextResponse.json(
      { error: 'Internal cron execution failure' },
      { status: 500 }
    );
  }
}
