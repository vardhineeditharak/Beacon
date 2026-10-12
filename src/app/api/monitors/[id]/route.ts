import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';
import { updateMonitorSchema, validateTargetSecurity } from '@/lib/validation';
import { validateCsrfOrigin } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rateLimit';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: 'CSRF validation failed: invalid origin' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await req.json();

    const parsed = updateMonitorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid update parameters' },
        { status: 400 }
      );
    }

    const { name, target, status, interval, timeoutMs, keyword } = parsed.data;

    // Reject empty payloads (BUG-012)
    if (
      name === undefined &&
      target === undefined &&
      status === undefined &&
      interval === undefined &&
      timeoutMs === undefined &&
      keyword === undefined
    ) {
      return NextResponse.json({ error: 'No valid update fields provided' }, { status: 400 });
    }

    // Verify ownership and existence within session org (SEC-002)
    const existing = await prisma.monitor.findFirst({
      where: { id, orgId: session.orgId },
    });

    if (!existing) {
      // Return 404 to avoid leaking existence of cross-org monitors (SEC-002)
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 });
    }

    let cleanTarget = existing.target;
    if (target !== undefined) {
      const targetCheck = await validateTargetSecurity(target, existing.type);
      if (!targetCheck.valid) {
        return NextResponse.json(
          { error: targetCheck.error || 'Invalid target destination' },
          { status: 400 }
        );
      }
      cleanTarget = targetCheck.cleanTarget || target;
    }

    const updateData: {
      name?: string;
      target?: string;
      status?: 'UP' | 'PAUSED';
      interval?: number;
      timeoutMs?: number;
      keyword?: string | null;
      nextCheckAt?: Date;
    } = {};

    if (name !== undefined) updateData.name = name;
    if (target !== undefined) updateData.target = cleanTarget;
    if (interval !== undefined) updateData.interval = interval;
    if (timeoutMs !== undefined) updateData.timeoutMs = timeoutMs;
    if (keyword !== undefined) {
      updateData.keyword = existing.type === 'KEYWORD' ? keyword : null;
    }

    if (status !== undefined) {
      updateData.status = status;
      if (status === 'UP') {
        // Trigger immediate check when resumed from PAUSED
        updateData.nextCheckAt = new Date();
      }
    }

    const updated = await prisma.monitor.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error('[API] PUT /api/monitors/[id] failed:', error);
    return NextResponse.json({ error: 'Failed to update monitor' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: 'CSRF validation failed: invalid origin' }, { status: 403 });
  }

  // Rate limit deletions per user
  const rateLimit = await checkRateLimit(`monitor-delete:${session.userId}`, 20, 60);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: too many monitor deletions' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetSeconds) } }
    );
  }

  try {
    const { id } = await params;

    // Use deleteMany with compound { id, orgId } for atomic ownership verification (SEC-002, BUG-011, BUG-021)
    const result = await prisma.monitor.deleteMany({
      where: { id, orgId: session.orgId },
    });

    if (result.count === 0) {
      // 404 if missing or belongs to another org
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[API] DELETE /api/monitors/[id] failed:', error);
    return NextResponse.json({ error: 'Failed to delete monitor' }, { status: 500 });
  }
}
