import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { validateCsrfOrigin } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rateLimit';

const registerSchema = z.object({
  email: z.string().trim().email('Valid email address required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  orgName: z.string().trim().min(1, 'Organization name is required').max(100).optional(),
});

function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
  return `${base || 'org'}-${Math.random().toString(36).substring(2, 7)}`;
}

export async function POST(req: Request) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: 'CSRF validation failed: invalid origin' }, { status: 403 });
  }

  // Rate limit registration by client IP
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'anon';
  const rateLimit = await checkRateLimit(`register:${clientIp}`, 10, 60);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Too many registration requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetSeconds) } }
    );
  }

  try {
    const json = await req.json();
    const parsed = registerSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid input data' },
        { status: 400 }
      );
    }

    const { email, password, name = email.split('@')[0], orgName = `${name}'s Org` } = parsed.data;

    // Check existing email
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existingUser) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const slug = slugify(orgName);

    // Create user, organization, and organization membership in one transaction
    const { user, org } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          name,
        },
      });

      const createdOrg = await tx.organization.create({
        data: {
          name: orgName,
          slug,
          ownerId: createdUser.id,
        },
      });

      await tx.organizationMember.create({
        data: {
          orgId: createdOrg.id,
          userId: createdUser.id,
          role: 'OWNER',
        },
      });

      return { user: createdUser, org: createdOrg };
    });

    // Establish session
    const session = await getSession();
    session.userId = user.id;
    session.orgId = org.id;
    session.email = user.email;
    await session.save();

    return NextResponse.json(
      {
        user: { id: user.id, email: user.email, name: user.name },
        organization: { id: org.id, name: org.name, slug: org.slug },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('[API] Register failed:', error);
    return NextResponse.json({ error: 'Registration failed due to a server error' }, { status: 500 });
  }
}
