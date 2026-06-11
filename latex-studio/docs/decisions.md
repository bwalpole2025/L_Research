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
