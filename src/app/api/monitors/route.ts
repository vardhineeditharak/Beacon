import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VALID_TYPES = ['HTTP', 'PING', 'TCP', 'KEYWORD', 'HEARTBEAT'] as const;

function isValidType(value: unknown): boolean {
  return typeof value === 'string' && (VALID_TYPES as readonly string[]).includes(value);
}

export async function GET() {
  try {
    const monitors = await prisma.monitor.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        pingResults: {
          take: 50,
          orderBy: { timestamp: 'desc' }
        },
        incidents: {
          take: 1,
          where: { status: 'DOWN' }
        }
      }
    });
    return NextResponse.json(monitors);
  } catch (error: unknown) {
    console.error('[API] GET /api/monitors failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch monitors' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();

    // Basic validation to avoid creating invalid monitors.
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const target = typeof data.target === 'string' ? data.target.trim() : '';
    const type = data.type;

    if (!name) {
      return NextResponse.json({ error: 'Monitor name is required.' }, { status: 400 });
    }
    if (!target) {
      return NextResponse.json({ error: 'Monitor target is required.' }, { status: 400 });
    }
    if (!isValidType(type)) {
      return NextResponse.json({ error: `Invalid monitor type: ${String(type)}` }, { status: 400 });
    }

    const parsedInterval = parseInt(data.interval, 10);
    const interval = Number.isNaN(parsedInterval) || parsedInterval < 1 ? 5 : parsedInterval;

    // In a real app, orgId comes from authenticated session context.
    // We are mocking a default organization for the prototype.
    let defaultOrg = await prisma.organization.findFirst();
    if (!defaultOrg) {
      const user = await prisma.user.create({
        data: { email: 'admin@beacon.dev', passwordHash: 'mock', name: 'Admin' }
      });
      defaultOrg = await prisma.organization.create({
        data: { name: 'Beacon Team', ownerId: user.id }
      });
    }

    const monitor = await prisma.monitor.create({
      data: {
        orgId: defaultOrg.id,
        name,
        type,
        target,
        interval,
        timeoutMs: data.timeoutMs ? parseInt(data.timeoutMs) : 30000,
        keyword: data.keyword || null
      }
    });

    return NextResponse.json(monitor, { status: 201 });
  } catch (error: unknown) {
    console.error('[API] POST /api/monitors failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create monitor' },
      { status: 400 }
    );
  }
}
