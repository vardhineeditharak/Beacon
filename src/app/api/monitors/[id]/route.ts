import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VALID_STATUSES = ['UP', 'DOWN', 'PAUSED', 'DEGRADED'] as const;
type MonitorStatus = (typeof VALID_STATUSES)[number];

function isMonitorStatus(value: unknown): value is MonitorStatus {
  return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = await req.json();

    // Only update the fields that were actually provided so callers can,
    // for example, toggle a monitor's status without resending name/target.
    const updateData: {
      name?: string;
      target?: string;
      status?: MonitorStatus;
      interval?: number;
    } = {};

    if (typeof data.name === 'string') updateData.name = data.name;
    if (typeof data.target === 'string') updateData.target = data.target;
    if (isMonitorStatus(data.status)) updateData.status = data.status;
    if (data.interval !== undefined) {
      const interval = parseInt(data.interval, 10);
      if (!Number.isNaN(interval)) updateData.interval = interval;
    }

    const monitor = await prisma.monitor.update({
      where: { id },
      data: updateData,
    });
    return NextResponse.json(monitor);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update monitor' },
      { status: 400 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Delete cascades manually or use prisma cascade on schema (if setup)
    await prisma.pingResult.deleteMany({ where: { monitorId: id } });
    await prisma.incident.deleteMany({ where: { monitorId: id } });
    
    await prisma.monitor.delete({ where: { id } });
    
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete monitor' },
      { status: 400 }
    );
  }
}
