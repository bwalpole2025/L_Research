'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn, signUp } from '@/lib/authClient';
import { saveSession } from '@/lib/session';
import { Wordmark } from '@/components/Wordmark';
import { BrandIcon } from '@/components/BrandIcon';

/**
 * LOGIN / SIGN-UP — Better Auth email+password (self-hosted in our Postgres).
 * On success Better Auth sets an HttpOnly session cookie; we cache only the
 * non-secret display name locally for the UI chrome.
 */

const field =
  'w-full h-12 px-4 bg-[#0d1322] border border-[#243049] rounded-[11px] text-[#eef1f8] text-[15px] outline-none transition-colors focus:border-[#4e68f5]';
const label = 'block text-[11.5px] tracking-[0.1em] uppercase text-[#6b7693] font-semibold mb-2';

function LoginCard() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === 'signup'
          ? await signUp.email({ email: email.trim(), password, name: name.trim() || email.trim() })
          : await signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError(result.error.message ?? (mode === 'signup' ? 'Could not create account.' : 'Wrong email or password.'));
        return;
      }
      saveSession({ email: email.trim(), name: result.data?.user?.name ?? name.trim() });
      router.push(params.get('next') ?? '/studio');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="dark flex min-h-screen bg-[#0a0e18] font-['IBM_Plex_Sans',sans-serif] text-[#eef1f8]">
      {/* ── Brand panel ── */}
      <div
        className="relative hidden w-[46%] flex-none flex-col justify-between overflow-hidden p-14 pb-12 lg:flex"
        style={{ background: 'radial-gradient(120% 90% at 20% 10%, #16203c 0%, #0a101e 55%, #070b14 100%)' }}
      >
        <div
          aria-hidden
          className="absolute -top-20 right-[-120px] h-[420px] w-[420px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(91,118,247,0.10), transparent 70%)' }}
        />
        <Link href="/" className="z-10 flex items-center gap-2.5">
          <BrandIcon size={24} />
          <Wordmark />
        </Link>
        <div className="z-10">
          <div className="max-w-[440px] text-[40px] font-medium leading-[1.18] text-[#eef1f8]" style={{ fontFamily: 'var(--ls-serif)', letterSpacing: '.005em' }}>
            Typesetting, with the
            <br />
            <span className="italic text-[#8fa3ff]">composure</span> it deserves.
          </div>
          <p className="mt-[22px] max-w-[400px] text-[15px] leading-[1.65] text-[#8a93a8]">
            A LaTeX studio for researchers who care about how their work reads on the page — not just what it says.
          </p>
        </div>
        <div className="z-10 text-[12.5px] text-[#4d5670]">Your account · your data · self-hosted</div>
      </div>

      {/* ── Form panel ── */}
      <div className="flex flex-1 items-center justify-center p-10">
        <form onSubmit={submit} className="w-full max-w-[372px]">
          <div className="mb-8 lg:hidden">
            <Link href="/">
              <Wordmark />
            </Link>
          </div>
          <h1 className="mb-2 text-[32px] font-medium text-[#f2f4fa]" style={{ fontFamily: 'var(--ls-serif)' }}>
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mb-8 text-[14.5px] text-[#8a93a8]">
            {mode === 'signup' ? 'Sign up to start your projects.' : 'Sign in to continue to your projects.'}
          </p>

          {mode === 'signup' && (
            <div className="mb-[18px]">
              <label className={label}>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} data-testid="login-name" autoComplete="name" placeholder="Ada Lovelace" className={field} />
            </div>
          )}
          <div className="mb-[18px]">
            <label className={label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
              autoComplete="username"
              placeholder="you@example.com"
              className={field}
            />
          </div>
          <div className="mb-[14px]">
            <label className={label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder="••••••••"
              className={field}
            />
          </div>

          {error && (
            <p data-testid="login-error" className="mb-2 rounded-[11px] border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            data-testid="login-submit"
            className="mt-2.5 h-12 w-full rounded-[11px] bg-[#4e68f5] text-[15px] font-semibold text-[#ffffff] shadow-[0_8px_24px_rgba(78,104,245,0.30)] transition-colors hover:bg-[#5f78f8] disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>

          <div className="mt-[26px] border-t border-[#1c2335] pt-5 text-center text-[13.5px] text-[#8a93a8]">
            {mode === 'signup' ? 'Already have an account?' : 'New here?'}{' '}
            <button
              type="button"
              data-testid="login-toggle"
              onClick={() => {
                setMode(mode === 'signup' ? 'signin' : 'signup');
                setError(null);
              }}
              className="font-semibold text-[#8fa3ff] hover:text-[#aab9ff]"
            >
              {mode === 'signup' ? 'Sign in' : 'Create an account'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}
