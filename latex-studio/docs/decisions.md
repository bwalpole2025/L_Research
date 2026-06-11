# Architecture decisions

A running log of non-obvious technical choices.

## ADR-001 — Editor: CodeMirror 6 (not Monaco)

**Status:** accepted

We need a code editor we can deeply extend later with **custom inline AI
completions** (ghost-text suggestions driven by the api → Anthropic). CodeMirror
6's transaction/extension model (`ViewPlugin`, `StateField`, decorations,
`inputHandler`, completion sources) makes that kind of bespoke behaviour
first-class, whereas Monaco's completion/inline-suggestion API is heavier and
harder to bend to a custom provider. CodeMirror is also dramatically lighter to
bundle. We are committed to CodeMirror 6.

## ADR-002 — LaTeX language support: `@codemirror/legacy-modes` `stex`

**Status:** accepted

**Options evaluated**

| Option | Type | Notes |
| ------ | ---- | ----- |
| `codemirror-lang-latex` | Lezer grammar | Richest structure (a real parse tree, environment nodes, fold info). But it is a smaller community package with a history of lagging CodeMirror `@lezer/*` / `@codemirror/*` peer bumps, which risks install-time peer conflicts and breakage on upgrades. |
| `@codemirror/legacy-modes/mode/stex` | Stream parser | **Official CodeMirror package.** Maintained in lockstep with the `@codemirror/*` releases. Tokenises commands, environments (`\begin`/`\end`), math delimiters (`$`, `\[ \]`), and comments — exactly the highlighting we need now. No extra/peer deps. |
| Hand-written stream parser | Stream parser | Full control, but reinventing a maintained mode for no real benefit today. |

**Decision:** use the official **`stex` stream parser** (`StreamLanguage.define(stex)`).

**Why:** for the current scope (syntax highlighting + a foundation for snippets
and, later, inline completions) the stex mode is the lowest-risk choice that is
guaranteed to stay compatible with the rest of the CodeMirror stack. The
requirement is "highlighting for commands, environments, math delimiters, and
comments", which stex covers.

**Trade-off / revisit:** a stream parser produces tokens, not a full syntax
tree, so we don't get structural folding or environment-aware selection for
free. None of our near-term features need the tree. If/when we want
structure-aware features (e.g. fold an `environment`, smart `\ref` completion
from a parsed document), we can swap in a Lezer grammar **behind the same
`LanguageSupport` boundary** (`components/editor/latex.ts`) without touching the
editor component, snippets, or the begin/end auto-closer — those depend only on
text and `EditorView`, not on the parse tree.

**Consequences for adjacent behaviour**

- We attach `closeBrackets` language data that auto-closes `(`, `[`, and inline
  math `$`, but **deliberately not `{}`**. LaTeX braces are ubiquitous, and
  excluding them lets the `\begin{env}` → `\end{env}` expander (`beginEndCloser`)
  fire cleanly when the user types the closing `}` (otherwise it would fight
  bracket overtyping). See `components/editor/latex.ts`.

## ADR-003 — Compilation: shared bind-mount + `docker exec`, SyncTeX via the CLI

**Status:** accepted

**Compile workspace — bind mount, not a named volume.** The original scaffold
described a named `compile-workspace` volume shared between the api and texlive
containers. But the everyday dev flow runs the **api on the host** (`pnpm dev`)
while only texlive is containerised — and a host process cannot write into a
Docker *named* volume. So the workspace is a **host directory**
(`COMPILE_WORKSPACE`, default `./.compile-workspace`) **bind-mounted** into
texlive at `/workspace`. The host-run api writes `<project>/main.tex` on disk;
texlive sees it instantly at `/workspace/<project>`; latexmk's output lands back
on the host with no copying. Works identically whether the api is on the host or
in a container (the `full` profile mounts the same path).

**Execution — `docker exec` with an in-container `timeout`.** In docker mode the
runner does `docker exec -w /workspace/<project> latex-studio-texlive sh -lc
"timeout -k 5 <secs> latexmk …"`. The in-container `timeout` is what actually
kills the TeX engine (killing the host-side `docker exec` would leave latexmk
running); a slightly longer host-side timer is a backstop. Local mode spawns
latexmk directly in a detached process group and SIGKILLs the group on timeout.

**SyncTeX — the `synctex` CLI, parsed server-side.** Rather than hand-rolling a
parser for the binary `.synctex.gz` format (hierarchical box records in scaled
points — easy to get subtly wrong), we run the maintained `synctex` binary
(`view` for forward, `edit` for inverse) through the same runner and parse its
small, stable textual output (`src/compile/synctexParser.ts`, unit-tested). This
is the approach battle-tested tools (TeXShop, LaTeX Workshop) use. Note: `view`
reports a box's `v` as its **baseline**, so the forward highlight's top-left is
`(h, v − H)`.

## ADR-004 — Claude Agent SDK over a Claude subscription (no API key)

**Status:** accepted · **Researched against live docs (2026-06):**
- Agent SDK overview — https://code.claude.com/docs/en/agent-sdk/overview
- TypeScript SDK reference — https://code.claude.com/docs/en/agent-sdk/typescript
- Authentication — https://code.claude.com/docs/en/authentication
- Setup — https://code.claude.com/docs/en/setup
- Agent SDK + your Claude plan (monthly credit) — https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- TS SDK repo / changelog — https://github.com/anthropics/claude-agent-sdk-typescript

(`docs.claude.com/en/api/agent-sdk/*` 301→ `platform.claude.com` 307→ `code.claude.com/docs/en/agent-sdk/*` — the SDK is documented under the Claude Code docs.)

### Verified package + API shapes (do not trust memory — these are from the live reference)

- **Package:** `@anthropic-ai/claude-agent-sdk` (TypeScript; `npm install`). Python is `claude_agent_sdk`. The TS package **bundles a native Claude Code binary** per platform as an optional dependency — Claude Code need not be installed separately, but its login/credentials are reused.
- **Entry point:** `query({ prompt, options }): Query`, where `Query extends AsyncGenerator<SDKMessage, void>`. Iterate with `for await (const message of query(...))`.
  - init: `message.type === 'system' && message.subtype === 'init'` → `message.session_id`
  - assistant text: `message.type === 'assistant'` → `message.message.content[]` blocks where `block.type === 'text'` → `block.text`
  - final: `message.type === 'result'` → `message.result` (string), `message.total_cost_usd`, `message.usage`, `message.duration_ms`, `message.subtype` (`'success' | 'error_max_turns' | 'error_during_execution' | …`)
  - partial tokens require `includePartialMessages: true`
- **`Options` fields used here (all verified present):** `model?: string`; `systemPrompt?: string | { type:'preset'; preset:'claude_code'; append?; excludeDynamicSections? }`; `tools?: string[] | { type:'preset'; preset:'claude_code' }`; `allowedTools?: string[]`; `disallowedTools?: string[]`; `mcpServers?: Record<string,McpServerConfig>`; `strictMcpConfig?: boolean`; `settingSources?: ('user'|'project'|'local')[]` (omit ⇒ loads `~/.claude` + project `.claude`; `[]` ⇒ load nothing from disk); `skills?: string[] | 'all'`; `permissionMode?`; `maxTurns?: number`; `includePartialMessages?: boolean`; `env?: Record<string,string|undefined>` (**replaces** the subprocess env when set); `cwd?: string`; `abortController?: AbortController`; `effort?`; `fallbackModel?`; `thinking?`; `resume?/continue?/forkSession?/sessionId?`.
- **Locking the SDK to pure text generation** (this app embeds the model as a *writing engine*, not an agent): `tools: []` (no built-in Read/Write/Edit/Bash/WebSearch/WebFetch/Glob/Grep), `mcpServers: {}` + `strictMcpConfig: true` (no MCP), `settingSources: []` (don't load `.claude/`, `CLAUDE.md`, skills, commands, or any on-disk settings), `skills: []`, `maxTurns: 1` (single-turn unless a route manages a conversation), a **custom `systemPrompt` string** (replaces the `claude_code` agent persona), plus `disallowedTools` as belt-and-suspenders. Encoded in `apps/api/src/providers/lockedOptions.ts` and asserted by a unit test.

### Authentication precedence (verbatim from the Authentication page) — why the boot guard exists

Claude Code (and therefore the SDK) selects credentials in this order:
1. cloud provider (`CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY`)
2. `ANTHROPIC_AUTH_TOKEN` (`Authorization: Bearer`)
3. **`ANTHROPIC_API_KEY`** (`X-Api-Key`) — *"In non-interactive mode (`-p`), the key is always used when present."*
4. `apiKeyHelper`
5. `CLAUDE_CODE_OAUTH_TOKEN` (long-lived, from `claude setup-token`)
6. subscription OAuth from `/login` (default for Pro/Max/Team/Enterprise)

Verbatim: *"If you have an active Claude subscription but also have `ANTHROPIC_API_KEY` set in your environment, the API key takes precedence once approved … Run `unset ANTHROPIC_API_KEY` to fall back to your subscription, and check `/status` to confirm which method is active."*

The SDK runs **non-interactively**, so a present `ANTHROPIC_API_KEY` is used **silently** (no approval prompt) → API billing, bypassing the subscription. Therefore `apps/api` **refuses to boot** when `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) is set while `MODEL_PROVIDER=agent-sdk`, and we never put the key in `.env.example`. As defense-in-depth the provider also passes `env` to the subprocess with those two vars stripped. There is **no reliable `apiKeySource` field** on the TS init message; we instead verify the live credential with a real 1-token round trip at `GET /healthz/model` (and `Query.accountInfo()` is available).

### Login, token, credit (for the README)

- **One-time login:** run `claude` → browser OAuth (Pro/Max/Team/Enterprise). `/status` shows the active method; `/logout` re-auths.
- **Headless / container token:** `claude setup-token` → prints a **one-year** OAuth token (saved nowhere) → `export CLAUDE_CODE_OAUTH_TOKEN=…`. Inference-scoped; requires a paid plan.
- **Credentials on disk:** macOS → **encrypted Keychain** (no file); Linux → `~/.claude/.credentials.json` (mode `0600`); Windows → `%USERPROFILE%\.claude\.credentials.json`. Override dir with `CLAUDE_CONFIG_DIR`.
- **Monthly Agent SDK credit:** from **2026-06-15**, Agent SDK + `claude -p` usage on a subscription draws from a **separate monthly Agent SDK credit** ($20–$200 by tier, one-time opt-in, refreshes monthly) rather than interactive limits. **On exhaustion:** if "usage credits" are enabled it spills to **standard API rates**; if not, **Agent SDK requests stop until the credit refreshes**.

### Docker credential strategy — decision: run `apps/api` on the host

Two options were evaluated for the containerized path:
- **(A) Mount the host's Claude credentials read-only into the api container.** Rejected: on **macOS the subscription credential is in the Keychain — there is no file to mount**, so this can't work on the dev machine at all; and OAuth tokens **auto-refresh**, which a read-only mount would break on expiry (a read-write mount would let the container rotate your host credentials).
- **(B) Run `apps/api` on the host** (where `claude login` ran) while postgres/mathcheck/texlive stay in compose. **Chosen.** It matches the existing architecture — the host api already shells `docker exec` for latexmk (ADR-003) — and the credential store stays where the OS put it, writable and refreshable.

For a genuinely fully-containerized run, the only credential that travels cleanly is `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, passed as an env var (inference-scoped). The compose `api` service therefore carries **no** `ANTHROPIC_API_KEY`; AI features are expected to run via the host api.

### Provider escape hatch

All feature code depends only on the `ModelProvider` interface (`chatStream` / `complete` / `editRegion`) in `packages/shared`. `AgentSdkProvider` is the real implementation; `ApiKeyProvider` is a stub that throws "not configured", selected by `MODEL_PROVIDER=agent-sdk|api`. If any single route must move to metered pay-as-you-go later, it swaps the provider without touching feature code.

## ADR-005 — Chat: replay our stored transcript, not the SDK's session/resume

**Status:** accepted

The chat sidebar's conversation state is owned by us and persisted in Postgres
(`ChatThread` / `ChatMessage`). For each query we **replay the stored transcript**
into a single-turn `query()` (rendered as `User:`/`Assistant:` turns) rather than
using the Agent SDK's `resume`/`continue` session mechanism.

**Why replay over SDK sessions:**
- **Durability & source of truth.** SDK sessions are JSONL on the local
  filesystem; with `settingSources: []` (our lock-down) and across restarts,
  redeploys, or a cleared `~/.claude`, that state is fragile. The DB transcript
  is authoritative and always available.
- **Context control.** We assemble a *budgeted* context block (selection → active
  file windowed around the cursor → pinned files) per query. Replay lets us
  inject exactly that; `resume` would carry the SDK's own accumulated context we
  can't trim.
- **Provider-agnostic.** The `ModelProvider` escape hatch means an
  `ApiKeyProvider` (or any future provider) replays the same transcript trivially;
  `resume` is SDK-specific and would leak into feature code.
- **Single-turn lock-down.** `maxTurns: 1` + a fresh query per message keeps the
  SDK in pure text-generation mode (no agent loop) — consistent with the
  writing-engine framing in ADR-004.

Trade-off: we re-send the (budgeted) transcript each turn rather than relying on
server-side session caching. For an embedded single-user chat that's cheap and
worth the robustness.

## ADR-006 — Ghost-text completions: warm pre-warmed SDK pool (latency)

**Status:** accepted · **Verified against current docs (2026-06):**
- TS Agent SDK reference — https://code.claude.com/docs/en/agent-sdk/typescript
- Sessions — https://code.claude.com/docs/en/agent-sdk/sessions

The Agent SDK carries per-call spawn+init overhead (a cold `complete()` measured
~3.2s at `/healthz/model`). Completions are the latency-critical path
(target: < 1s warm, hard budget 1.5s p95), so we hide that overhead.

**Verified primitive — `startup()` / `WarmQuery`:**
```ts
function startup(params?: { options?: Options; initializeTimeoutMs?: number }): Promise<WarmQuery>;
interface WarmQuery extends AsyncDisposable { query(prompt): Query; close(): void }
```
`startup()` spawns AND initializes the subprocess ahead of time. **Critical
constraint from the docs: a `WarmQuery` is single-use** — `warm.query()` may be
called only once; you must create a new `WarmQuery` for the next query. So the
"persistent warm session per project" is a **pre-warmed pool**, not a long-lived
reused query:

- Keep one ready `WarmQuery` per project (spawned + initialized, idle).
- On a completion: consume the ready one via `warm.query(prompt)` (pays only
  inference, not spawn+init), then **replenish the pool in the background**
  (`startup()` off the request path).
- **Idle-kill after 10 min**: `warm.close()` the pooled query and stop
  replenishing when a project sees no completions for 10 minutes.
- Completions are **stateless**: `persistSession: false` (no JSONL on disk),
  `maxTurns: 1`, neutral `cwd`, plus the same lock-down as chat (no tools/MCP/
  settings). The fixed completion system prompt is set at `startup()`; the
  per-completion prefix/suffix/`<CURSOR>` and the mode reminder go in the
  per-query prompt (so one pool serves all modes). Output token caps are soft
  (prompt instructions) — the SDK exposes no response `max_tokens`.

**Baseline vs warm** are both implemented and tagged on `AiCallLog`
(`variant ∈ baseline|cold|warm|cache`, plus `provider`) so `/stats` shows the
comparison with real percentiles.

**Per-route provider override** (`COMPLETIONS_PROVIDER`, `COMPLETION_MODEL`):
the `/complete` route selects its provider independently of chat. Defaults to
`agent-sdk` + a Haiku-class model. Because feature code depends only on
`ModelProvider` (ADR-004), pointing completions at a metered `api` provider is a
config change — surfaced in Settings (visible, defaulted) per the task.

**Mode detection** is heuristic over the text around the cursor (preamble vs
display-align vs inline-math vs prose) rather than a Lezer tree: the editor uses
the legacy stream `stex` mode (`@codemirror/legacy-modes`), which has no rich
syntax tree. Documented so it's not mistaken for an oversight.

### ADR-006 measurement — baseline vs warm (real subscription SDK, 2026-06)

Measured via `/complete` (Haiku-class, `claude-haiku-4-5`, n=6 each):

| path     | p50     | p95     | min    | max    |
| -------- | ------- | ------- | ------ | ------ |
| baseline | 3974 ms | 4934 ms | 3144   | 4934   |
| warm     | 2797 ms | 5040 ms | 2463   | 5040   |
| cold (1st warm) | — | — | 3417 ms | — |

**Conclusion:** the warm pool removes spawn+init and improves **p50 by ~30%**
(3974 → 2797 ms), but the Agent SDK's per-call inference + protocol overhead over
subscription is ~2.5–3 s, so **neither path meets the 1.5 s p95 budget** (warm
p95 ~5 s, with high jitter). This is the anticipated subscription overhead.

Per the task's step 5 we do **not** silently degrade: `/stats` shows this
baseline-vs-warm comparison from live data, and Settings surfaces that
completions may benefit from `COMPLETIONS_PROVIDER=api` (a bare API call avoids
the SDK subprocess overhead) — **for the `/complete` route only**. That override
is implemented (`completionsProvider` config + per-request `provider`) and
**defaults to `agent-sdk`**; flipping it is a config change, not a code change,
because completions depend only on `ModelProvider` (ADR-004).

## ADR-007 — Phase 7 thesis tools: prose engine + maths-audit cache

**Status:** accepted

### Prose checker (Feature 2)
Chosen: **a local LaTeX-aware stripper + nspell (en-GB Hunspell) + rule-based
lints**, with an **optional local LanguageTool container** for grammar/style —
rather than hand-rolling a grammar engine or sending text to a hosted service.

- **LaTeX-awareness** is a custom tokenizer (`prose/strip.ts`) that reduces
  source to plain prose **with a per-character source map**, skipping the
  preamble, comments, inline/display math, math & verbatim environments, command
  names, and the arguments of reference/citation/structural commands — while
  keeping the text arguments of formatting commands (`\textbf{…}`, `\section{…}`,
  captions). Diagnostics map back to the right line/column via the map.
- **Spelling** uses `nspell` + `dictionary-en-gb` (Hunspell format) — pure JS,
  **fully local**, en-GB enforced (so "color" is flagged, "colour" is not). A
  per-project custom dictionary (`Project.customWords`) is an allowlist applied
  per request, so "add to dictionary" never mutates the shared speller.
- **Consistency lints** (en-GB mixed-usage, double spaces, straight/curly quote
  mixing, inconsistent hyphenation) are deterministic rules, individually
  toggleable — not AI.
- **LanguageTool** is optional and, when used, is a **local container**
  (`LANGUAGETOOL_URL`, docker-compose `prose` profile). `engine.local` is always
  true and, when the URL is unset, the checker makes **no network call at all**.

### Maths-audit verdict cache (Feature 1)
`audit/service.ts` keeps an in-memory cache keyed on **normalised equation
content** (`s.replace(/\s+/g,'')`) + macros + assumptions — not on line numbers.
A re-audit after an unrelated edit (which shifts line numbers but not equation
content) is a full cache hit (`checked: 0`) and re-derives current line numbers
from a fresh extraction, so verdicts stay correct while no equation is rechecked.
`"unknown"` (unparseable / macro-heavy) is reported honestly and never collapsed
into `"passed"`.

### Outline / cross-reference (Feature 3)
`thesis/parse.ts` is a line-based parser (the editor's legacy `stex` mode has no
Lezer tree — see ADR-006), resolving multi-file order by following
`\input`/`\include` from the root, and deriving xref health from the
label/ref/cite/bib index (undefined-ref, duplicate-label, missing-cite as
errors; unused-label and unlabelled-numbered-equation as info).

## ADR-008 — Co-derivation engine: the LLM proposes, SymPy decides

**Status:** accepted

### The seam (architectural rule, absolute)
`POST /projects/:id/coderive` runs **propose → verify → bounded-retry**. The LLM
(subscription `ModelProvider`, Phase 4A) only ever **proposes** candidate steps as
structured JSON (`coderive/propose.ts`). The existing **mathcheck SymPy** service
is the **sole arbiter of correctness** (`coderive/verify.ts`): `/equivalent` for a
single transition, `/check-derivation` for chains, with the project macro table
and assumptions. A refuted candidate is fed SymPy's counterexample and re-proposed
(max 3 rounds; `coderive/engine.ts` logs every round). The LLM's confidence is
irrelevant; only a SymPy `verified` candidate is insertable.

- `unknown` (SymPy could not parse/decide) is the **honest default** and is
  **never** upgraded to `verified` on the model's say-so.
- A persistently-wrong proposal is returned `✗ unverified` with the counterexample
  after 3 rounds — never `✓`. (Proven in `test/coderive.test.ts` against live SymPy.)

### Context assembly (`coderive/context.ts`)
Always: macro table + assumptions (notation match) and a budgeted document window.
References are **graded by provenance** (`coderive/references.ts`):
`full-text` (the cited work's source — `.tex`/`.txt`/`.pdf`, extracted locally and
searched for relevant passages) · `metadata-only` (a `.bib` entry but no source) ·
`not-found`. Metadata-only / not-found references carry an explicit **"content NOT
provided — do not fabricate"** notice in the prompt, and any candidate citing such
a key is flagged `attributionUnverified`. **No external web fetch occurs** — only
project files are read (asserted in tests). PDF text is extracted with
`pdfjs-dist` in-process; extractions are cached.

### The honesty boundary (enforced in the UI and here)
A green SymPy tick establishes **exactly one thing**: the proposed expression is
algebraically equivalent to the expression it claims to equal, under the stated
assumptions. It does **NOT** verify any of:
- that the governing equation / modelling setup is correct;
- that the step is the *intended* or *useful* one (only that it is valid);
- that asymptotic ordering, convergence, or domain of validity holds;
- that a cited reference actually contains the attributed technique/result —
  **citation accuracy is unverified and labelled "attribution unverified — confirm
  against source"**.
The UI never lets a green tick imply these (`CoderivePanel.tsx` shows the boundary
note on every result). Insertion goes through the Phase-5 diff-and-accept flow;
forcing an unverified/unknown step inserts it with the amber "unverified" underline
+ counterexample tooltip.

## ADR-009 — Document Review: annotated review PDF + the honesty contract

**Status:** accepted

### What it is
A single command (`POST /projects/:id/review`) that *composes* the existing
engines into a normalised list of findings on four axes, maps each onto PDF
coordinates, and writes an annotated `<root>.review.pdf` — never touching the
clean original. The only genuinely new capability is the coordinate-mapping +
PDF annotation; everything else is reuse.

- **Axis 1 (maths)** — the Phase-7 maths audit (SymPy). `refuted`/`unknown` only;
  passes are not findings. The ONLY axis that can be certain.
- **Axis 4 spelling** — the Phase-7 prose check, spelling rule only (en-GB,
  deterministic) → `verified-typo`.
- **Axes 2 (literature), 3 (background), 4-prose** — a structured LLM call
  (`ModelProvider`) returning JSON findings. The LLM is a **proposer, never an
  arbiter**: confidence is fixed by axis server-side (`llm-judgement` /
  `llm-judgement-low` / `llm-suggestion`), and a literature claim citing a source
  whose text is NOT in the project is forcibly downgraded to **"attribution
  unverified"** — never a contradiction. An LLM failure never sinks the
  deterministic findings; `deterministicOnly` skips the model entirely.

### Coordinates + annotation
Findings → PDF via the Phase-2 **SyncTeX forward** map; a line that yields nothing
falls back to the nearest mapped line and is flagged "approximate location".
Annotation is done by **PyMuPDF (fitz)** in the mathcheck Python service
(`/annotate-pdf`): colour-coded highlights with popups, an appended **legend**
page (the honesty contract), and an **index** page whose rows are internal
GOTO links to each highlight, plus a back-link from every highlight to the index.

### Licence — PyMuPDF (AGPL-3.0)
PyMuPDF is AGPL-3.0. This is acceptable here because LaTeX Studio is a
**single-user, locally-hosted** tool — there is no distribution of a modified
networked service to third parties. If a permissive licence is ever required
(e.g. shipping this as a hosted multi-tenant service), swap the annotator for
**pikepdf** (MPL-2.0) — the `/annotate-pdf` endpoint is the only place fitz is
used. Documented here per the spec.

### The honesty contract (UI + PDF legend + this ADR)
- Only **red** (SymPy algebra errors) and **blue** (deterministic spelling) are
  machine-verified. **orange** (literature), **purple** (background) and **yellow**
  (prose) are LLM judgements that may be wrong in EITHER direction — false alarms
  AND missed real errors — and must be checked by the author.
- A review with **no red** means SymPy found no algebra errors *in what it could
  parse* — NOT that the document is correct. `unknown` (grey) maths and
  unavailable references are reported as such, never silently treated as fine.
- The LLM never inserts a citation absent from the project `.bib`, and never
  asserts a "known result" it is unsure of — it prefers omission.
- Nothing in this feature edits the document; fixes flow only through the existing
  diff-and-accept. The review output is read-only annotation.

## ADR-010 — Hierarchical folders + the Literature library

**Status:** accepted (Library + linking first; source-tree migration deferred)

### Sequencing
The full spec is two trees on one folder mechanism plus a library, citation
linking, and trash. The **source-tree migration** (moving the working file system
from path-based virtual folders to a real `folderId` + cascading-path model) is
invasive and risks the working compile/SyncTeX. We delivered the **additive,
lower-risk path first**: the `Folder` model (used now for the **literature** tree),
the Literature library, the citation-linking payoff, and Trash — leaving the
source tree on its current path mechanism so compile/SyncTeX keep working. The
source-tree `folderId` migration (cascading paths in one transaction,
cycle/collision rejection, drag-and-drop, source deletes → trash) is a tracked
**follow-up**; `TexFile.folderId` is already added (nullable) as prep.

### Data model
`Folder { tree: source|literature }` with `@@unique(projectId, tree, parentId, name)`
(root NULL-parent collisions are additionally checked in the route, since Postgres
treats NULLs as distinct). `LiteratureItem` holds metadata + a `storagePath`;
`TrashEntry { kind, payload: Json }` soft-deletes with enough to restore.

### Storage
Literature **PDFs are binary → never in Postgres.** They live on the compile-
workspace volume at `<project>/literature/<uuid>.pdf`; the row holds metadata +
`storagePath`. Text is extracted by **PyMuPDF** in the mathcheck service
(`POST /extract-pdf`, bytes in / text+pageCount+offline-metadata out) and cached
into `extractedText`. The API sends bytes (not a path) — mathcheck does not mount
the workspace, matching the `/annotate-pdf` pattern (ADR-009).

### The citation-linking payoff (honesty preserved)
`buildReferences` (used by Co-Derivation and Document-Review) now resolves a cite
key → linked `LiteratureItem` → cached `extractedText` and surfaces the relevant
passages with provenance **"full-text (library)"** (`library: true`). A linked
article with no extracted text, or a bare `.bib` entry, stays **metadata-only**;
an unlinked key stays metadata-only / not-found. The honesty contract is intact:
the review can only claim a literature inconsistency when it actually had the
source text — verified by test (`library.test.ts`: linked ⇒ full-text, unlinked ⇒
metadata-only, never fabricated).

### Trash & safety
Deletes (article, folder) go to `TrashEntry`, never oblivion. A folder delete
captures its whole subtree so restore rebuilds it (same ids preserve cite links).
"Empty trash" is a separate, explicit two-step confirm and is the only thing that
removes the PDF bytes from disk.

### Optional online enrichment
DOI → Crossref (`https://api.crossref.org/works/{doi}`) is the only network path
and is **off by default** — only ever called by an explicit per-item action;
never auto-fetched. Everything else (extraction, metadata heuristics, search) is
offline-first.

## ADR-011 — Document-aware prediction (DocumentModel card + multi-granularity predict-next)

**Status:** accepted

### The core idea: a cached context card
A per-project **DocumentModel** (`docmodel/build.ts`) is recomputed on a **slow
debounce** (3s idle, or on save) — NOT per keystroke — and distilled into a
compact **context card** (~800-token budget): outline (Phase 7), notation table
(`\newcommand`/`\def` + the Phase-3 macro table + a heuristic, explicitly
low-confidence symbol glossary from "let $x$ denote…" phrases), the label registry
(Phase 6), intent signals (abstract + recent heading), and the last few display
equations. `POST /projects/:id/document-model` returns the card + `notationSymbols`;
the client caches it (`documentModelStore`). Every prediction is document-aware via
the **cached card text** + the local window — per-keystroke cost stays low (the card
is cached text, never a recompute on the inline path). Asserted by test:
`scheduleRefresh` fires the build at most once after many input events.

### Part 2 — feeding the 5S inline loop
Every `/complete` request now carries `contextCard` + a cheap, client-computed
`position` ("mid-derivation", "after \\begin{proof}", "at the start of a section",
"in the abstract"). The system prompt gains the document-aware instruction (reuse
the document's macros/symbols, predict what THIS document says next). The 5S inline
loop, latency engineering, cancellation/cache, and the SymPy verification hook are
untouched — they just receive better context. Notation symbols are returned so the
client can flag a prediction introducing an unknown symbol (info only).

### Part 3 — multi-granularity "predict next"
A user-triggered command (⌘⇧Space + a status-bar affordance) calls
`POST /predict-next` with a granularity (auto/prose/maths/structural; `auto`
detected from the cursor context). The result renders as a **distinct multi-line
ghost block** (`predictBlock.ts`, visually separate from the 5S single-line ghost):
**Tab** = accept all, **⌘→** = accept one word/step, **Esc** = dismiss, **Alt+]** =
regenerate. A stronger model is allowed here (user-triggered, not per-keystroke);
inline stays Haiku-class on the 5S budget.

### Maths verification (reused, extended)
A predicted equation step `LHS = RHS` is checked via the existing mathcheck
`/equivalent` hook against the prior line; predicted chains check each step.
Verified steps insert clean; refuted steps carry the Phase-5S amber "unverified —
counterexample" underline; prediction is never blocked. The honesty rule from the
co-derivation engine holds: a predicted step is a suggestion until SymPy verifies
the algebra, and SymPy verifying the algebra does not make it the *intended* step.

### Controls
Settings: document-aware on/off (reverts to plain 5S local window), how much of the
model to include, prediction-granularity default, and a separate model picker for
predict-next. Turning inline completions off entirely (Phase 5S toggle) stops all
calls. The status bar shows when the DocumentModel last refreshed and a "Predict
next" affordance.
