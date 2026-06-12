'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DEMO_ACCOUNTS, signIn } from '@/lib/session';
import { Wordmark } from '@/components/Wordmark';
import { BrandIcon } from '@/components/BrandIcon';

/**
 * LOGIN — built to the "LaTeX Studio – Login" design export: brand panel with
 * the set-in-real-time KdV equation on the left, the form on the right.
 * Construction scaffold: local demo accounts only, no real authentication.
 */

const field =
  'w-full h-12 px-4 bg-[#0d1322] border border-[#243049] rounded-[11px] text-[#eef1f8] text-[15px] outline-none transition-colors focus:border-[#4e68f5]';
const label = 'block text-[11.5px] tracking-[0.1em] uppercase text-[#6b7693] font-semibold mb-2';

function LoginCard() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const session = signIn(email, password);
    if (!session) {
      setError('Unknown email or wrong password — try a demo account below.');
      return;
    }
    router.push(params.get('next') ?? '/studio');
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
          <div className="mt-[34px] max-w-[420px] rounded-[14px] border border-[#1f2840] bg-[rgba(6,9,18,0.5)] px-6 py-[22px]" style={{ fontFamily: 'var(--ls-serif)' }}>
            <div className="mb-3 text-xs uppercase tracking-[0.16em] text-[#5d688a]" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
              Set in real time
            </div>
            <div className="text-center text-lg italic leading-normal text-[#d3daea]">
              η<sub>t</sub> + c η<sub>x</sub> + α η η<sub>x</sub> + β η<sub>xxx</sub> = 0
            </div>
          </div>
        </div>
        <div className="z-10 text-[12.5px] text-[#4d5670]">Runs entirely on your machine · construction build</div>
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
            Welcome back
          </h1>
          <p className="mb-8 text-[14.5px] text-[#8a93a8]">Sign in to continue to your projects.</p>

          <div className="mb-[18px]">
            <label className={label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
              autoComplete="username"
              placeholder="you@latexstudio.local"
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
              autoComplete="current-password"
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
            data-testid="login-submit"
            className="mt-2.5 h-12 w-full rounded-[11px] bg-[#4e68f5] text-[15px] font-semibold text-[#ffffff] shadow-[0_8px_24px_rgba(78,104,245,0.30)] transition-colors hover:bg-[#5f78f8]"
          >
            Sign in
          </button>

          <div className="my-[26px] flex items-center gap-3.5">
            <div className="h-px flex-1 bg-[#1c2335]" />
            <span className="text-xs text-[#5d688a]">or</span>
            <div className="h-px flex-1 bg-[#1c2335]" />
          </div>

          <button
            type="button"
            onClick={() => setError('ORCID sign-in is not wired up in the construction build — use a demo account below.')}
            className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[11px] border border-[#2a3247] text-[14.5px] font-medium text-[#c6cde0] transition-colors hover:border-[#3a4866] hover:bg-[#0d1322]"
          >
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#a6ce39] text-[9px] font-bold text-[#1a2a00]">iD</span>
            Continue with ORCID
          </button>

          <div className="mt-[30px] border-t border-[#1c2335] pt-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#5d688a]">Demo accounts · construction</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  data-testid={`demo-${a.hint}`}
                  onClick={() => {
                    setEmail(a.email);
                    setPassword(a.password);
                    setError(null);
                  }}
                  className="flex items-center justify-between rounded-[9px] border border-[#1c2335] px-3 py-2 text-left text-xs text-[#aab3c8] transition-colors hover:border-[#2a3247] hover:bg-[#0d1322]"
                >
                  <span className="font-mono">{a.email}</span>
                  <span className="text-[#5d688a]">
                    {a.hint} · pw: {a.password}
                  </span>
                </button>
              ))}
            </div>
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
