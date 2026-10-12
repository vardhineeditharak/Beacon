import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleHeartbeat(await params);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleHeartbeat(await params);
}

export async function HEAD(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleHeartbeat(await params);
}

async function handleHeartbeat({ id }: { id: string }) {
  try {
    const monitor = await prisma.monitor.findFirst({
      where: {
        OR: [{ id }, { target: id }],
        type: 'HEARTBEAT',
      },
    });

    if (!monitor) {
      return NextResponse.json({ error: 'Heartbeat monitor not found' }, { status: 404 });
    }

    const now = new Date();

    // Record UP PingResult
    await prisma.pingResult.create({
      data: {
        monitorId: monitor.id,
        status: 'UP',
        responseTimeMs: 0,
        httpStatusCode: 200,
        errorMessage: null,
      },
    });

    // Update lastHeartbeatAt and transition to UP if previously DOWN
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: {
        lastHeartbeatAt: now,
        status: 'UP',
      },
    });

    // Resolve any active DOWN incidents
    await prisma.incident.updateMany({
      where: {
        monitorId: monitor.id,
        status: 'DOWN',
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: now,
      },
    });

    return NextResponse.json({
      success: true,
      monitorId: monitor.id,
      status: 'UP',
      lastHeartbeatAt: now.toISOString(),
    });
  } catch (err: unknown) {
    console.error('[API] Heartbeat ping failed:', err);
    return NextResponse.json({ error: 'Failed to record heartbeat' }, { status: 500 });
  }
}
