import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';
import { validateTargetSecurity, createMonitorSchema } from '@/lib/validation';
import { validateCsrfOrigin } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rateLimit';

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const monitors = await prisma.monitor.findMany({
      where: { orgId: session.orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orgId: true,
        name: true,
        type: true,
        target: true,
        keyword: true,
        interval: true,
        timeoutMs: true,
        status: true,
        lastHeartbeatAt: true,
        lastCheckedAt: true,
        createdAt: true,
        updatedAt: true,
        pingResults: {
          take: 30,
          orderBy: { timestamp: 'desc' },
          select: {
            id: true,
            status: true,
            responseTimeMs: true,
            httpStatusCode: true,
            errorMessage: true,
            timestamp: true,
          },
        },
        incidents: {
          take: 1,
          where: { status: 'DOWN' },
          select: {
            id: true,
            status: true,
            errorCause: true,
            startedAt: true,
            resolvedAt: true,
          },
        },
      },
    });

    return NextResponse.json(monitors);
  } catch (error: unknown) {
    console.error('[API] GET /api/monitors failed:', error);
    return NextResponse.json({ error: 'Failed to fetch monitors' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: 'CSRF validation failed: invalid origin' }, { status: 403 });
  }

  // Rate limit monitor creation per user/IP
  const rateLimit = await checkRateLimit(`monitor-create:${session.userId}`, 20, 60);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: too many monitor creations. Please wait.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetSeconds) } }
    );
  }

  try {
    const body = await req.json();

    // 1. Zod schema validation (name, type, interval allowlist, timeoutMs range)
    const parsed = createMonitorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid monitor parameters' },
        { status: 400 }
      );
    }

    const { name, target, type, interval, timeoutMs } = parsed.data;

    // 2. KEYWORD validation (BUG-010)
    let keyword: string | null = null;
    if (type === 'KEYWORD') {
      const kw = parsed.data.keyword?.trim();
      if (!kw) {
        return NextResponse.json(
          { error: 'Keyword is required for KEYWORD monitor type' },
          { status: 400 }
        );
      }
      keyword = kw;
    }

    // 3. SSRF and target validation (SEC-003)
    const targetCheck = await validateTargetSecurity(target, type);
    if (!targetCheck.valid) {
      return NextResponse.json(
        { error: targetCheck.error || 'Invalid or forbidden target destination' },
        { status: 400 }
      );
    }

    const cleanTarget = targetCheck.cleanTarget || target;

    // 4. Create monitor scoped to session org (SEC-002, SEC-005, BUG-022)
    const monitor = await prisma.monitor.create({
      data: {
        orgId: session.orgId,
        name,
        type,
        target: cleanTarget,
        interval,
        timeoutMs,
        keyword,
        status: 'UP',
        nextCheckAt: new Date(), // Check immediately on creation
      },
    });

    return NextResponse.json(monitor, { status: 201 });
  } catch (error: unknown) {
    console.error('[API] POST /api/monitors failed:', error);
    return NextResponse.json({ error: 'Failed to create monitor' }, { status: 500 });
  }
}
