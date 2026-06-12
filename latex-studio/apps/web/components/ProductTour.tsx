'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, X } from 'lucide-react';
import { loadTourSeen, saveTourSeen } from '@/lib/persist';

/**
 * PRODUCT TOUR — a one-time, GIF-like onboarding popover (Wispr-style). It points
 * a tooltip with an arrow at the header Compile button (`[data-tour="compile"]`)
 * and plays a short looping, muted, inline video demoing the compile → preview
 * flow. Shown once per user (persisted), built from scratch on our stack:
 *
 *  - GIF-like video: autoplay + loop + muted + playsInline (+ poster, preload
 *    metadata). Honours `prefers-reduced-motion` (no autoplay, manual controls)
 *    and degrades to a tasteful placeholder when the clip isn't present yet.
 *  - Anchored popover: tracks the button's on-screen rect (resize/scroll/initial
 *    layout-settle), with an arrow + a highlight ring on the target.
 *  - Accessible: role="dialog", focus trap, autofocus "Got it", Esc to close,
 *    click-outside to dismiss.
 *
 * Force it open for QA with `?tour=1` (ignores the seen flag).
 */

const TOUR_ID = 'compile';
const ANCHOR_SELECTOR = '[data-tour="compile"]';
const CARD_W = 340;
const GAP = 12;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** GIF-like video; falls back to a branded placeholder when the clip is absent. */
function TourVideo() {
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);

  // If no source loads within a beat (file not added yet), show the placeholder.
  useEffect(() => {
    if (failed) return;
    const id = window.setTimeout(() => {
      const v = ref.current;
      if (v && v.readyState === 0) setFailed(true);
    }, 1500);
    return () => window.clearTimeout(id);
  }, [failed]);

  if (failed) {
    return (
      <div
        aria-hidden
        className="flex aspect-video w-full items-center justify-center rounded-lg bg-gradient-to-br from-[#4e68f5] to-[#3247b8]"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 backdrop-blur">
          <Play className="h-5 w-5 translate-x-[1px] text-white" />
        </span>
      </div>
    );
  }

  return (
    <video
      ref={ref}
      data-testid="tour-video"
      className="block aspect-video w-full rounded-lg bg-zinc-900 object-cover"
      // GIF-like behaviour:
      autoPlay={!reduced}
      loop
      muted
      playsInline
      preload="metadata"
      controls={reduced}
      poster="/tour/compile-poster.png"
      onError={() => setFailed(true)}
      onLoadedMetadata={(e) => {
        if (!reduced) void e.currentTarget.play().catch(() => undefined);
      }}
    >
      <source src="/tour/compile.webm" type="video/webm" />
      <source src="/tour/compile.mp4" type="video/mp4" />
    </video>
  );
}

export function ProductTour() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();

  // Decide whether to show (after a beat so the toolbar has laid out).
  useEffect(() => {
    const force = new URLSearchParams(window.location.search).get('tour') === '1';
    if (!force && loadTourSeen(TOUR_ID)) return;
    const t = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(t);
  }, []);

  // Track the anchor button's position while open.
  const measure = useCallback(() => {
    const el = document.querySelector(ANCHOR_SELECTOR);
    if (!el) {
      setAnchor(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setAnchor({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();
    const onMove = () => measure();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    // Re-measure for the first ~1.5s while layout settles (panels, fonts, etc.).
    const poll = window.setInterval(measure, 250);
    const stop = window.setTimeout(() => window.clearInterval(poll), 1500);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
  }, [open, measure]);

  const dismiss = useCallback(() => {
    saveTourSeen(TOUR_ID);
    setOpen(false);
  }, []);

  // Esc to close, focus trap, autofocus the primary button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key === 'Tab' && cardRef.current) {
        const items = cardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], video, [tabindex]:not([tabindex="-1"])',
        );
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const t = window.setTimeout(() => cardRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 60);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.clearTimeout(t);
    };
  }, [open, dismiss]);

  if (!open || typeof document === 'undefined') return null;

  // Place the card below the anchor; arrow points at the anchor's centre. Falls
  // back to the top-right corner if the button isn't found.
  const vw = window.innerWidth;
  let cardTop = 64;
  let cardLeft = vw - CARD_W - 16;
  let arrowX = CARD_W - 36;
  if (anchor) {
    cardTop = anchor.top + anchor.height + GAP;
    const centerX = anchor.left + anchor.width / 2;
    const right = Math.min(vw - 12, anchor.left + anchor.width + 8);
    cardLeft = Math.max(12, right - CARD_W);
    arrowX = Math.max(20, Math.min(CARD_W - 20, centerX - cardLeft));
  }

  return createPortal(
    <div className="fixed inset-0 z-[60]" data-testid="product-tour" role="presentation">
      {/* Faint click-catcher backdrop (dismiss on outside click; keeps the
          "tooltip" feel rather than a heavy modal dim). */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={dismiss}
        className="absolute inset-0 cursor-default bg-zinc-950/20"
      />

      {/* Highlight ring around the target button. */}
      {anchor && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[11px] ring-2 ring-[#7e93ff] transition-all"
          style={{ top: anchor.top - 3, left: anchor.left - 3, width: anchor.width + 6, height: anchor.height + 6 }}
        />
      )}

      {/* The popover card. */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="absolute rounded-2xl border border-zinc-200 bg-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] dark:border-[#243049] dark:bg-[#0d1322]"
        style={{ top: cardTop, left: cardLeft, width: CARD_W }}
      >
        {/* Arrow pointing up at the Compile button. */}
        <div
          aria-hidden
          className="absolute -top-1.5 h-3 w-3 rotate-45 border-l border-t border-zinc-200 bg-white dark:border-[#243049] dark:bg-[#0d1322]"
          style={{ left: arrowX }}
        />

        <div className="p-4">
          <TourVideo />
          <button
            type="button"
            aria-label="Dismiss"
            data-testid="tour-close"
            onClick={dismiss}
            className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-zinc-500 backdrop-blur transition-colors hover:bg-white hover:text-zinc-800 dark:bg-black/40 dark:text-zinc-300 dark:hover:bg-black/60"
          >
            <X className="h-4 w-4" />
          </button>

          <h3 id={headingId} className="mt-3.5 text-[15px] font-semibold text-zinc-900 dark:text-[#eef1f8]">
            Compile to see your PDF
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-[#98a2bb]">
            Hit <span className="font-medium text-zinc-700 dark:text-[#c6cde0]">Compile</span> (or{' '}
            <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800">⌘↵</kbd>)
            and your document renders live in the preview — every save can re-compile automatically.
          </p>

          <div className="mt-3.5 flex justify-end">
            <button
              type="button"
              data-autofocus
              data-testid="tour-dismiss"
              onClick={dismiss}
              className="rounded-lg bg-[#4e68f5] px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#5f78f8]"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
