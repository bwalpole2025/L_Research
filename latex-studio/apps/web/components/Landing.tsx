'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import katex from 'katex';
import { BrandIcon } from './BrandIcon';
import 'katex/dist/katex.min.css';

/**
 * LANDING — the public front door. Classy, dark, and mathematical: a travelling
 * KdV soliton (the depression solitary waves this studio was built to typeset)
 * sweeps under the hero while research equations drift behind the headline.
 * Pure CSS animation — no animation libraries, nothing heavy.
 */

const FLOATING_EQUATIONS = [
  { tex: '\\nabla^2 \\phi = 0', top: '12%', left: '6%', dur: '26s', delay: '0s', size: '1.5rem' },
  { tex: '\\frac{\\partial u}{\\partial t} + 6u\\,\\frac{\\partial u}{\\partial x} + \\frac{\\partial^3 u}{\\partial x^3} = 0', top: '20%', left: '64%', dur: '32s', delay: '-8s', size: '1.25rem' },
  { tex: 'p - p_0 = \\gamma\\,(\\nabla \\cdot \\hat{\\boldsymbol{n}})', top: '64%', left: '10%', dur: '29s', delay: '-14s', size: '1.3rem' },
  { tex: '\\frac{\\partial \\phi}{\\partial t} + \\tfrac{1}{2}\\lvert\\nabla\\phi\\rvert^2 + \\frac{p}{\\rho} = B(t)', top: '70%', left: '62%', dur: '35s', delay: '-20s', size: '1.2rem' },
  { tex: 'e^{i\\pi} + 1 = 0', top: '38%', left: '84%', dur: '24s', delay: '-4s', size: '1.6rem' },
];

const FEATURES = [
  { title: 'Real TeX compilation', body: 'One-click latexmk in a local TeX Live container, with SyncTeX jump between source and PDF.' },
  { title: 'Machine-verified maths', body: 'Every derivation step is checked by a computer algebra system — a ✓ means proved, never “the model thinks so”.' },
  { title: 'Grounded document review', body: 'Claims are checked against your own PDF library with local retrieval; no citation, no assertion.' },
  { title: 'Semi-compiled visual editor', body: 'Edit prose and equations in a rendered view — display maths and TikZ compile through the real TeX engine.' },
  { title: 'Adaptive autocomplete', body: 'Deterministic IDE completion that learns which commands you actually use. Local, instant, no model calls.' },
  { title: 'Local-first & private', body: 'Your manuscripts, your library, your habits — everything stays on this machine.' },
];

/** sech²(x) pulse train: KdV solitons centred every 150 units — translating by
 *  −150 loops seamlessly, so the wave travels forever. */
function solitonPath(amplitude: number, width: number): string {
  const sech2 = (x: number) => {
    const c = Math.cosh(x);
    return 1 / (c * c);
  };
  const pts: string[] = [];
  for (let x = -160; x <= 560; x += 4) {
    let y = 0;
    for (const c of [50, 200, 350, 500]) y += sech2(width * (x - c));
    pts.push(`${x},${(86 - amplitude * y).toFixed(2)}`);
  }
  return `M${pts.join(' L')}`;
}

export function Landing() {
  const equations = useMemo(
    () =>
      FLOATING_EQUATIONS.map((e) => ({
        ...e,
        html: katex.renderToString(e.tex, { throwOnError: false, displayMode: false }),
      })),
    [],
  );
  const mainWave = useMemo(() => solitonPath(52, 0.055), []);
  const slowWave = useMemo(() => solitonPath(30, 0.035), []);
  const kdv = useMemo(
    () => katex.renderToString('u(x,t) = \\tfrac{c}{2}\\,\\mathrm{sech}^2\\!\\left(\\tfrac{\\sqrt{c}}{2}(x - ct)\\right)', { throwOnError: false }),
    [],
  );

  return (
    <main className="landing min-h-screen bg-[#070b14] text-zinc-100">
      {/* ── Nav ── */}
      <header className="relative z-20 mx-auto flex max-w-6xl items-center gap-6 px-6 py-5">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandIcon size={22} />
          LaTeX Studio
        </span>
        <nav className="ml-auto flex items-center gap-5 text-sm text-zinc-400">
          <Link href="/files" className="transition-colors hover:text-zinc-100">Files</Link>
          <Link href="/references" className="transition-colors hover:text-zinc-100">References</Link>
          <Link href="/plugins" className="transition-colors hover:text-zinc-100">Plugins</Link>
          <Link
            href="/login"
            data-testid="landing-signin"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-900"
          >
            Sign in
          </Link>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section data-testid="landing-hero" className="relative overflow-hidden">
        {/* drifting research equations */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {equations.map((e, i) => (
            <span
              key={i}
              className="floating-eq absolute"
              data-testid="floating-eq"
              style={{ top: e.top, left: e.left, animationDuration: e.dur, animationDelay: e.delay, fontSize: e.size }}
              dangerouslySetInnerHTML={{ __html: e.html }}
            />
          ))}
        </div>

        <div className="relative z-10 mx-auto max-w-4xl px-6 pb-10 pt-24 text-center">
          <p className="hero-rise mb-4 font-mono text-xs uppercase tracking-[0.3em] text-blue-400">Write · Verify · Publish</p>
          <h1 className="hero-rise text-5xl font-semibold leading-tight tracking-tight md:text-6xl" style={{ animationDelay: '0.1s' }}>
            The LaTeX editor that
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-sky-300 to-emerald-300 bg-clip-text text-transparent">proves your maths</span>
          </h1>
          <p className="hero-rise mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-zinc-400" style={{ animationDelay: '0.2s' }}>
            A research-grade studio for fluid-dynamics manuscripts: real TeX compilation, computer-algebra verification of
            every derivation step, and document review grounded in your own literature — all running locally.
          </p>
          <div className="hero-rise mt-9 flex items-center justify-center gap-4" style={{ animationDelay: '0.3s' }}>
            <Link
              href="/studio"
              data-testid="cta-studio"
              className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white shadow-lg shadow-blue-900/40 transition-all hover:-translate-y-0.5 hover:bg-blue-500"
            >
              Open the Studio
            </Link>
            <Link
              href="/references"
              className="rounded-lg border border-zinc-700 px-6 py-3 font-medium text-zinc-200 transition-all hover:-translate-y-0.5 hover:border-zinc-500"
            >
              Browse references
            </Link>
          </div>
        </div>

        {/* the travelling soliton */}
        <div className="relative h-44 w-full overflow-hidden" data-testid="soliton">
          <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <line x1="0" y1="86" x2="400" y2="86" stroke="#1e293b" strokeWidth="1" />
            <g className="wave-slow">
              <path d={slowWave} fill="none" stroke="#155e75" strokeWidth="1.2" opacity="0.55" />
            </g>
            <g className="wave-main">
              <path d={mainWave} fill="none" stroke="url(#solitonGrad)" strokeWidth="2" />
            </g>
            <defs>
              <linearGradient id="solitonGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
            </defs>
          </svg>
          <div
            className="absolute bottom-3 right-6 text-xs text-zinc-500"
            dangerouslySetInnerHTML={{ __html: kdv }}
          />
        </div>
      </section>

      {/* ── Features ── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-sm font-medium uppercase tracking-[0.25em] text-zinc-500">Built for serious manuscripts</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="feature-card rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur transition-all hover:-translate-y-1 hover:border-zinc-600"
              style={{ animationDelay: `${0.08 * i}s` }}
            >
              <h3 className="font-medium text-zinc-100">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-zinc-900 py-8 text-center text-xs text-zinc-600">
        LaTeX Studio · runs entirely on your machine — manuscripts, library and habits never leave it.
      </footer>

      <style jsx global>{`
        .landing .katex { color: inherit; }
        .floating-eq {
          color: rgba(148, 163, 184, 0.35);
          filter: blur(0.4px);
          animation-name: eq-drift;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          white-space: nowrap;
        }
        @keyframes eq-drift {
          0% { transform: translate(0, 0); opacity: 0.25; }
          50% { transform: translate(-28px, -20px); opacity: 0.6; }
          100% { transform: translate(0, 0); opacity: 0.25; }
        }
        .hero-rise {
          opacity: 0;
          animation: hero-rise 0.7s ease-out forwards;
        }
        @keyframes hero-rise {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* Soliton pulses are centred every 150 viewBox units; translating by
           −150 returns the train to its start → a seamless infinite journey. */
        .wave-main { animation: wave-travel 7s linear infinite; }
        .wave-slow { animation: wave-travel 13s linear infinite; }
        @keyframes wave-travel {
          from { transform: translateX(0); }
          to { transform: translateX(-150px); }
        }
        .feature-card {
          opacity: 0;
          animation: hero-rise 0.6s ease-out forwards;
        }
      `}</style>
    </main>
  );
}
