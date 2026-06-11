import type {
  CoderiveIntent,
  CoderiveStatus,
  DerivationTransition,
  EquivalenceResult,
  MathCounterexample,
  VerificationCandidate,
} from '@latex-studio/shared';
import { checkDerivation, checkEquivalent } from './mathcheck.js';

export interface Verdict {
  status: CoderiveStatus;
  method: string;
  counterexample?: MathCounterexample;
  refutedReason?: string;
}

export interface VerifyOpts {
  mathcheckUrl: string;
  macros: Record<string, string>;
  assumptions: string;
}

/** Anchors that passed the maths guard — the only form verification accepts. */
export interface GuardedAnchors {
  from?: VerificationCandidate;
  to?: VerificationCandidate;
  goal?: VerificationCandidate;
}

const UNKNOWN: Verdict = { status: 'unknown', method: 'no-anchor', refutedReason: 'could not resolve the anchor expression' };

function fromEquivalence(res: EquivalenceResult, refuteLabel: string): Verdict {
  if (res.equivalent === true) return { status: 'verified', method: res.method };
  if (res.equivalent === false) {
    return {
      status: 'unverified',
      method: res.method,
      ...(res.counterexample ? { counterexample: res.counterexample } : {}),
      refutedReason: refuteLabel,
    };
  }
  return { status: 'unknown', method: res.method };
}

const TVERDICT: Record<DerivationTransition['verdict'], CoderiveStatus> = {
  ok: 'verified',
  fail: 'unverified',
  unknown: 'unknown',
  unparseable: 'unknown',
};

function fromTransition(t: DerivationTransition | undefined, refuteLabel: string): Verdict {
  if (!t) return { status: 'unknown', method: 'no-transition' };
  const status = TVERDICT[t.verdict];
  const v: Verdict = { status, method: t.method ?? t.verdict };
  if (status === 'unverified') {
    if (t.counterexample) v.counterexample = t.counterexample;
    v.refutedReason = refuteLabel;
  }
  return v;
}

/** Combine the two transitions of a fill-gap chain A→B→C. */
function combineFillGap(t1: DerivationTransition | undefined, t2: DerivationTransition | undefined): Verdict {
  const a = fromTransition(t1, 'the proposed step is not equal to anchor A');
  const c = fromTransition(t2, 'the proposed step is not equal to anchor C');
  if (a.status === 'unverified') return a;
  if (c.status === 'unverified') return c;
  if (a.status === 'verified' && c.status === 'verified') return { status: 'verified', method: a.method };
  return { status: 'unknown', method: a.status === 'unknown' ? a.method : c.method };
}

/** Verify ONE guard-passed candidate for fill-gap / next-step / justify. SymPy is the sole arbiter. */
export async function verifyCandidate(
  intent: CoderiveIntent,
  anchors: GuardedAnchors,
  candidate: VerificationCandidate,
  opts: VerifyOpts,
): Promise<Verdict> {
  const { mathcheckUrl: url, macros, assumptions } = opts;

  if (intent === 'fill-gap') {
    if (!anchors.from || !anchors.to) return UNKNOWN;
    const res = await checkDerivation(url, [anchors.from, candidate, anchors.to], assumptions, macros);
    return combineFillGap(res.transitions.find((t) => t.to === 1), res.transitions.find((t) => t.to === 2));
  }
  if (intent === 'next-step') {
    if (!anchors.from) return UNKNOWN;
    const res = await checkEquivalent(url, anchors.from, candidate, assumptions, macros);
    return fromEquivalence(res, 'the proposed step is not equal to the current expression');
  }
  if (intent === 'justify') {
    if (!anchors.from || !anchors.to) return UNKNOWN;
    // Verify the EXISTING transition holds; the technique is unverified attribution.
    const res = await checkEquivalent(url, anchors.from, anchors.to, assumptions, macros);
    return fromEquivalence(res, 'the existing transition does not hold (the two sides are not equal)');
  }
  return UNKNOWN;
}

/** Verify a reach-goal chain [from, ...steps, goal] end to end. */
export async function verifyChain(
  from: VerificationCandidate | undefined,
  steps: VerificationCandidate[],
  goal: VerificationCandidate | undefined,
  opts: VerifyOpts,
): Promise<{ overall: Verdict; perStep: Verdict[] }> {
  if (!from || !goal || steps.length === 0) {
    return { overall: UNKNOWN, perStep: steps.map(() => UNKNOWN) };
  }
  const seq = [from, ...steps, goal];
  const res = await checkDerivation(opts.mathcheckUrl, seq, opts.assumptions, opts.macros);
  // step i (seq index i+1) has incoming transition (i → i+1).
  const perStep = steps.map((_, i) =>
    fromTransition(
      res.transitions.find((t) => t.to === i + 1),
      'this step is not equal to the previous expression',
    ),
  );
  const goalTransition = fromTransition(
    res.transitions.find((t) => t.to === seq.length - 1),
    'the final step does not reach the target',
  );
  const all = [...perStep, goalTransition];
  let overall: Verdict;
  const refuted = all.find((v) => v.status === 'unverified');
  if (refuted) overall = refuted;
  else if (all.every((v) => v.status === 'verified')) overall = { status: 'verified', method: 'symbolic' };
  else overall = { status: 'unknown', method: 'chain-undecided' };
  return { overall, perStep };
}
