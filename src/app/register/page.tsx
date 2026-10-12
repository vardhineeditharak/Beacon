'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BeaconLogo } from '@/components/BeaconLogo';
import { Lock, Mail, Building, User, ArrowRight, ShieldCheck } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters long');
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading('Provisioning organization workspace...');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim(),
          orgName: orgName.trim(),
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Registration failed');
      }

      toast.success('Workspace established! Welcome to Beacon.', { id: toastId });
      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Registration failed', { id: toastId });
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-night-950 text-ink flex flex-col justify-center items-center p-6 selection:bg-brand-500 selection:text-white">
      <div className="mb-8">
        <Link href="/">
          <BeaconLogo size="lg" showBadge />
        </Link>
      </div>

      <div className="w-full max-w-md p-8 bg-night-850/95 border border-brand-500/25 rounded-2xl shadow-[0_0_60px_rgba(168,72,240,0.12)] backdrop-blur-xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black tracking-tight text-ink">Establish Workspace</h1>
          <p className="text-sm text-ink-muted mt-2">
            Create an isolated organization for uptime monitoring, alerting, and telemetry.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
              Your Full Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Vance"
                className="w-full bg-night-900 border border-night-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
              Organization / Company Name
            </label>
            <div className="relative">
              <Building className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Cloud Infrastructure"
                className="w-full bg-night-900 border border-night-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
              Work Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@acme.corp"
                className="w-full bg-night-900 border border-night-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
              Master Password (min 8 chars)
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-night-900 border border-night-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-3 flex items-center justify-center gap-2 bg-gradient-to-r from-brand-500 to-coral-500 hover:from-brand-600 hover:to-coral-600 text-white font-semibold py-3 px-4 rounded-xl shadow-[0_0_25px_rgba(168,72,240,0.35)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {submitting ? 'Initializing infrastructure...' : 'Create Organization Workspace'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-night-700/80 text-center">
          <p className="text-xs text-ink-muted">
            Already have an active workspace?{' '}
            <Link href="/login" className="text-brand-400 hover:text-brand-300 font-semibold transition-colors">
              Sign In
            </Link>
          </p>
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint">
          <ShieldCheck className="w-3.5 h-3.5 text-brand-400" />
          <span>Strict tenant isolation and multi-org security</span>
        </div>
      </div>
    </div>
  );
}
