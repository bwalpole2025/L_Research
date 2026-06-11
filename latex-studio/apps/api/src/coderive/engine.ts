import {
  makeVerificationCandidate,
  type CandidateProposal,
  type CoderiveCandidate,
  type CoderiveResponse,
  type CoderiveRound,
  type CoderiveSkipped,
  type ContextBundle,
  type ModelProvider,
  type VerificationCandidate,
} from '@latex-studio/shared';
import { bareMath } from '../audit/extract.js';
import { summariseBundle } from './context.js';
import { CODERIVE_SYSTEM_PROMPT, buildCorrectionPrompt, buildUserPrompt, parseProposals, type Refutation } from './propose.js';
import { type GuardedAnchors, type Verdict, type VerifyOpts, verifyCandidate, verifyChain } from './verify.js';
import type { ResolvedAnchors } from './anchors.js';

export interface CoderiveDeps {
  modelProvider: ModelProvider;
  mathcheckUrl: string;
  /** Model used to PROPOSE (never to decide correctness). */
  model: string;
  maxRounds?: number;
  /** Called after each round so the route can stream propose→verify→retry progress. */
  onRound?: (round: CoderiveRound) => void;
}

const debugLog = (msg: string): void => {
  if (process.env.CODERIVE_DEBUG) console.log(`[coderive] ${msg}`);
};

async function propose(
  bundle: ContextBundle,
  refutations: Refutation[],
  deps: CoderiveDeps,
  signal?: AbortSignal,
): Promise<CandidateProposal[]> {
  const user =
    refutations.length > 0
      ? `${buildUserPrompt(bundle)}\n\n${buildCorrectionPrompt(refutations)}`
      : buildUserPrompt(bundle);
  let text = '';
  for await (const delta of deps.modelProvider.chatStream(
    { system: CODERIVE_SYSTEM_PROMPT, messages: [{ role: 'user', content: user }], model: deps.model },
    signal,
  )) {
    text += delta.text;
  }
  return parseProposals(text);
}

/** A proposal that passed the maths guard, paired with its verification form. */
interface GuardedProposal {
  proposal: CandidateProposal;
  candidate: VerificationCandidate;
}

/**
 * Run every raw LLM proposal through the maths guard. Rejected ones are
 * recorded with the internal reason and NEVER reach mathcheck or the
 * insertable-candidate list.
 */
function guardProposals(proposals: CandidateProposal[], skipped: CoderiveSkipped[]): GuardedProposal[] {
  const out: GuardedProposal[] = [];
  for (const p of proposals) {
    const made = makeVerificationCandidate(bareMath(p.latex), 'llm-step');
    if (made.rejected !== undefined) {
      debugLog(`guard rejected proposal (${made.rejected}): ${p.latex.slice(0, 120)}`);
      skipped.push({ latex: p.latex, reason: made.rejected });
      continue;
    }
    out.push({ proposal: p, candidate: made.candidate });
  }
  return out;
}

/** Build the guarded anchors once; an anchor the guard refuses simply yields no-anchor verdicts. */
function guardAnchors(anchors: ResolvedAnchors, goalSourceOk: boolean): GuardedAnchors {
  const mk = (s: string | undefined, source: 'display-math' | 'user-target'): VerificationCandidate | undefined => {
    if (!s) return undefined;
    const made = makeVerificationCandidate(s, source);
    if (made.rejected !== undefined) {
      debugLog(`guard rejected anchor (${made.rejected}): ${s.slice(0, 120)}`);
      return undefined;
    }
    return made.candidate;
  };
  const from = mk(anchors.from, 'display-math');
  const to = mk(anchors.to, 'display-math');
  const goal = goalSourceOk ? mk(anchors.goal, 'user-target') : undefined;
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(goal ? { goal } : {}),
  };
}

function toCandidate(
  p: CandidateProposal,
  v: Verdict,
  retriesUsed: number,
  fullTextKeys: Set<string>,
): CoderiveCandidate {
  return {
    latex: p.latex,
    status: v.status,
    method: v.method,
    ...(v.counterexample ? { counterexample: v.counterexample } : {}),
    technique: p.technique,
    groundedIn: p.groundedIn,
    rationale: p.rationale,
    claimedEqualTo: p.claimedEqualTo,
    retriesUsed,
    attributionUnverified: p.groundedIn.some((k) => !fullTextKeys.has(k)),
  };
}

const roundVerdicts = (guarded: GuardedProposal[], verdicts: Verdict[]): CoderiveRound['verdicts'] =>
  guarded.map((g, i) => ({
    latex: g.proposal.latex,
    status: verdicts[i]?.status ?? 'unknown',
    method: verdicts[i]?.method ?? 'unknown',
    ...(verdicts[i]?.refutedReason ? { refutedReason: verdicts[i]!.refutedReason } : {}),
  }));

/**
 * The core loop: the LLM PROPOSES, SymPy VERIFIES, refuted proposals are fed
 * the counterexample and re-proposed (bounded). SymPy is the only arbiter of
 * correctness; "unknown" is never upgraded to "verified". Every proposal passes
 * the maths guard first — non-math (bibliography, prose, …) is skipped with a
 * reason and never reaches mathcheck.
 */
export async function runCoderive(
  bundle: ContextBundle,
  anchors: ResolvedAnchors,
  deps: CoderiveDeps,
  signal?: AbortSignal,
): Promise<CoderiveResponse> {
  const maxRounds = deps.maxRounds ?? 3;
  const opts: VerifyOpts = { mathcheckUrl: deps.mathcheckUrl, macros: bundle.macros, assumptions: bundle.assumptions };
  const fullTextKeys = new Set(bundle.references.filter((r) => r.provenance === 'full-text').map((r) => r.key));
  const guarded = guardAnchors(anchors, bundle.intent === 'reach-goal');
  const rounds: CoderiveRound[] = [];
  const skipped: CoderiveSkipped[] = [];
  let candidates: CoderiveCandidate[] = [];
  let refutations: Refutation[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    const rawProposals = await propose(bundle, refutations, deps, signal);
    const skippedBefore = skipped.length;
    const accepted = guardProposals(rawProposals, skipped);
    const skippedThisRound = skipped.length - skippedBefore;

    if (accepted.length === 0) {
      const empty: CoderiveRound = {
        round,
        proposalCount: rawProposals.length,
        ...(skippedThisRound > 0 ? { skippedCount: skippedThisRound } : {}),
        verdicts: [],
      };
      rounds.push(empty);
      deps.onRound?.(empty);
      break;
    }

    let verdicts: Verdict[];
    let chainVerified = false;
    if (bundle.intent === 'reach-goal') {
      const chain = await verifyChain(
        guarded.from,
        accepted.map((g) => g.candidate),
        guarded.goal,
        opts,
      );
      verdicts = chain.perStep;
      chainVerified = chain.overall.status === 'verified';
    } else {
      verdicts = await Promise.all(accepted.map((g) => verifyCandidate(bundle.intent, guarded, g.candidate, opts)));
    }

    candidates = accepted.map((g, i) => toCandidate(g.proposal, verdicts[i]!, round - 1, fullTextKeys));
    const roundEntry: CoderiveRound = {
      round,
      proposalCount: rawProposals.length,
      ...(skippedThisRound > 0 ? { skippedCount: skippedThisRound } : {}),
      verdicts: roundVerdicts(accepted, verdicts),
    };
    rounds.push(roundEntry);
    deps.onRound?.(roundEntry);

    const done = bundle.intent === 'reach-goal' ? chainVerified : candidates.some((c) => c.status === 'verified');
    if (done) break;

    // Feed counterexamples back for the next round. If nothing was *refuted*
    // (only unknowns), a counterexample-driven retry cannot help — stop.
    refutations = accepted.flatMap((g, i) =>
      verdicts[i]!.status === 'unverified'
        ? [
            {
              latex: g.proposal.latex,
              claimedEqualTo:
                bundle.intent === 'reach-goal'
                  ? (i === 0 ? bundle.anchors.from ?? '' : accepted[i - 1]!.proposal.latex)
                  : anchors.from ?? g.proposal.claimedEqualTo,
              reason: verdicts[i]!.refutedReason ?? 'not algebraically equal',
            },
          ]
        : [],
    );
    if (refutations.length === 0) break;
  }

  return {
    intent: bundle.intent,
    candidates,
    skipped,
    context: summariseBundle(bundle),
    rounds,
    anchors: bundle.anchors,
  };
}
