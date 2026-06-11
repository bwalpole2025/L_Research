import type {
  CandidateProposal,
  CoderiveCandidate,
  CoderiveResponse,
  CoderiveRound,
  ContextBundle,
  ModelProvider,
} from '@latex-studio/shared';
import { summariseBundle } from './context.js';
import { CODERIVE_SYSTEM_PROMPT, buildCorrectionPrompt, buildUserPrompt, parseProposals, type Refutation } from './propose.js';
import { type Verdict, type VerifyOpts, verifyCandidate, verifyChain } from './verify.js';
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

const roundVerdicts = (proposals: CandidateProposal[], verdicts: Verdict[]): CoderiveRound['verdicts'] =>
  proposals.map((p, i) => ({
    latex: p.latex,
    status: verdicts[i]?.status ?? 'unknown',
    method: verdicts[i]?.method ?? 'unknown',
    ...(verdicts[i]?.refutedReason ? { refutedReason: verdicts[i]!.refutedReason } : {}),
  }));

/**
 * The core loop: the LLM PROPOSES, SymPy VERIFIES, refuted proposals are fed
 * the counterexample and re-proposed (bounded). SymPy is the only arbiter of
 * correctness; "unknown" is never upgraded to "verified".
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
  const rounds: CoderiveRound[] = [];
  let candidates: CoderiveCandidate[] = [];
  let refutations: Refutation[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    const proposals = await propose(bundle, refutations, deps, signal);
    if (proposals.length === 0) {
      const empty: CoderiveRound = { round, proposalCount: 0, verdicts: [] };
      rounds.push(empty);
      deps.onRound?.(empty);
      break;
    }

    let verdicts: Verdict[];
    let chainVerified = false;
    if (bundle.intent === 'reach-goal') {
      const chain = await verifyChain(
        bundle.anchors.from,
        proposals.map((p) => p.latex),
        bundle.anchors.goal,
        opts,
      );
      verdicts = chain.perStep;
      chainVerified = chain.overall.status === 'verified';
    } else {
      verdicts = await Promise.all(proposals.map((p) => verifyCandidate(bundle.intent, anchors, p, opts)));
    }

    candidates = proposals.map((p, i) => toCandidate(p, verdicts[i]!, round - 1, fullTextKeys));
    const roundEntry: CoderiveRound = { round, proposalCount: proposals.length, verdicts: roundVerdicts(proposals, verdicts) };
    rounds.push(roundEntry);
    deps.onRound?.(roundEntry);

    const done = bundle.intent === 'reach-goal' ? chainVerified : candidates.some((c) => c.status === 'verified');
    if (done) break;

    // Feed counterexamples back for the next round. If nothing was *refuted*
    // (only unknowns), a counterexample-driven retry cannot help — stop.
    refutations = proposals.flatMap((p, i) =>
      verdicts[i]!.status === 'unverified'
        ? [
            {
              latex: p.latex,
              claimedEqualTo:
                bundle.intent === 'reach-goal'
                  ? (i === 0 ? bundle.anchors.from ?? '' : proposals[i - 1]!.latex)
                  : anchors.from ?? p.claimedEqualTo,
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
    context: summariseBundle(bundle),
    rounds,
    anchors: bundle.anchors,
  };
}
