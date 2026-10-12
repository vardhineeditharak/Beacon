import 'server-only';
import { getSession } from './session';
import { prisma } from './prisma';

export interface AuthenticatedSession {
  userId: string;
  orgId: string;
  email?: string;
}

export async function requireSession(): Promise<AuthenticatedSession | null> {
  const session = await getSession();
  if (!session.userId || !session.orgId) {
    return null;
  }
  return {
    userId: session.userId,
    orgId: session.orgId,
    email: session.email,
  };
}

export async function getCurrentUser() {
  const session = await requireSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      memberships: {
        include: {
          organization: true,
        },
      },
    },
  });

  if (!user) return null;

  const currentOrg = user.memberships.find((m) => m.orgId === session.orgId)?.organization ?? null;

  return {
    ...user,
    currentOrg,
  };
}

export async function requireOrgMember(orgId: string): Promise<boolean> {
  const session = await requireSession();
  if (!session) return false;

  const membership = await prisma.organizationMember.findUnique({
    where: {
      orgId_userId: {
        orgId,
        userId: session.userId,
      },
    },
  });

  return Boolean(membership);
}
