'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { BeaconLogo } from '@/components/BeaconLogo';
import { Lock, Mail, ArrowRight, ShieldCheck } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const toastId = toast.loading('Authenticating credentials...');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Authentication failed');
      }

      toast.success('Access granted. Welcome back!', { id: toastId });
      router.push(from);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Login failed', { id: toastId });
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-night-850/95 border border-brand-500/25 rounded-2xl shadow-[0_0_60px_rgba(168,72,240,0.12)] backdrop-blur-xl">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-black tracking-tight text-ink">Operator Sign In</h1>
        <p className="text-sm text-ink-muted mt-2">
          Authenticate to access your organization&apos;s telemetry streams and monitoring controls.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
            Work Email
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@company.com"
              className="w-full bg-night-900 border border-night-700 rounded-xl pl-10 pr-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
            Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-night-900 border border-night-700 rounded-xl pl-10 pr-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full mt-2 flex items-center justify-center gap-2 bg-gradient-to-r from-brand-500 to-coral-500 hover:from-brand-600 hover:to-coral-600 text-white font-semibold py-3 px-4 rounded-xl shadow-[0_0_25px_rgba(168,72,240,0.35)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {submitting ? 'Verifying session...' : 'Sign In to Console'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>

      <div className="mt-6 pt-6 border-t border-night-700/80 text-center">
        <p className="text-xs text-ink-muted">
          Need a new organization workspace?{' '}
          <Link href="/register" className="text-brand-400 hover:text-brand-300 font-semibold transition-colors">
            Create account
          </Link>
        </p>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint">
        <ShieldCheck className="w-3.5 h-3.5 text-brand-400" />
        <span>End-to-end encrypted cookie sessions</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-night-950 text-ink flex flex-col justify-center items-center p-6 selection:bg-brand-500 selection:text-white">
      <div className="mb-8">
        <Link href="/">
          <BeaconLogo size="lg" showBadge />
        </Link>
      </div>

      <Suspense
        fallback={
          <div className="w-full max-w-md p-8 bg-night-850/95 border border-night-700 rounded-2xl animate-pulse text-center text-ink-muted text-sm">
            Initializing secure login terminal...
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
