import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { validateCsrfOrigin } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rateLimit';

const loginSchema = z.object({
  email: z.string().trim().email('Valid email required'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(req: Request) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: 'CSRF validation failed: invalid origin' }, { status: 403 });
  }

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'anon';
  const rateLimit = await checkRateLimit(`login:${clientIp}`, 10, 60);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetSeconds) } }
    );
  }

  try {
    const json = await req.json();
    const parsed = loginSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid credentials' }, { status: 400 });
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!user) {
      // Mitigate timing attacks by performing a dummy hash comparison
      await bcrypt.compare(password, '$2a$12$e80y6f7ZgI8wS2k7yQJ0e.O4lI6pP3XfF1vP7xH4mN1tU0wZ0e.O4');
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Determine default organization
    let org = user.memberships[0]?.organization;
    if (!org) {
      // If user has no organization yet, create a default one
      const newOrg = await prisma.organization.create({
        data: {
          name: `${user.name}'s Workspace`,
          slug: `workspace-${Math.random().toString(36).substring(2, 7)}`,
          ownerId: user.id,
        },
      });
      await prisma.organizationMember.create({
        data: {
          orgId: newOrg.id,
          userId: user.id,
          role: 'OWNER',
        },
      });
      org = newOrg;
    }

    const session = await getSession();
    session.userId = user.id;
    session.orgId = org.id;
    session.email = user.email;
    await session.save();

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name },
      organization: { id: org.id, name: org.name, slug: org.slug },
    });
  } catch (error: unknown) {
    console.error('[API] Login failed:', error);
    return NextResponse.json({ error: 'Authentication failed due to a server error' }, { status: 500 });
  }
}
