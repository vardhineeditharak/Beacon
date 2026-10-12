import 'server-only';
import { cookies } from 'next/headers';
import { getIronSession, SessionOptions } from 'iron-session';

export interface SessionData {
  userId?: string;
  orgId?: string;
  email?: string;
}

const DEFAULT_DEV_SECRET = 'beacon-dev-super-secret-session-password-at-least-32-chars';
const sessionPassword = process.env.SESSION_PASSWORD || DEFAULT_DEV_SECRET;

if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_PASSWORD || process.env.SESSION_PASSWORD.length < 32)) {
  console.warn('[Session] WARNING: SESSION_PASSWORD is not set or shorter than 32 characters in production.');
}

export const sessionOptions: SessionOptions = {
  password: sessionPassword,
  cookieName: 'beacon_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  try {
    return await getIronSession<SessionData>(cookieStore, sessionOptions);
  } catch (err) {
    console.error('[Session] Failed to read or decrypt session cookie:', err);
    // Return an empty session object if the cookie is invalid/tampered
    return await getIronSession<SessionData>(cookieStore, {
      ...sessionOptions,
      password: sessionPassword,
    });
  }
}
