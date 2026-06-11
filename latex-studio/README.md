# LaTeX Studio

A single-user, locally-hosted LaTeX editing application — your own personal
Overleaf. It runs entirely on your machine: a Next.js editor, a Fastify API that
compiles documents with `latexmk` and proxies AI requests to Claude, and a small
Python service that verifies math with SymPy.

> **Status:** scaffolding only. The workspaces are wired together, all services
> expose `/healthz`, and there is one passing smoke test per app. No editor /
> compilation / AI features are implemented yet.

---

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │                 apps/web                     │
                    │        Next.js 14 · React · Tailwind         │
                    │   editor · PDF viewer · AI panel · math UI   │
                    └──────────────────┬──────────────────────────┘
                                       │  HTTP  (Bearer token)
                                       ▼
                    ┌─────────────────────────────────────────────┐
                    │                 apps/api                     │
                    │            Fastify · TypeScript              │
                    │   projects · compile · ai proxy · mathproxy  │
                    └────┬──────────────┬──────────────┬───────────┘
              Prisma     │      docker  │ exec + vol    │  HTTP
                         ▼              ▼               ▼
                 ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐
                 │   postgres   │ │   texlive    │ │ services/mathcheck │
                 │ projects,    │ │  latexmk ⇒   │ │  FastAPI · SymPy    │
                 │ files, logs, │ │    PDF       │ │  POST /verify      │
                 │ snapshots    │ │ compile-vol  │ │                    │
                 └──────────────┘ └──────────────┘ └────────────────────┘

                  apps/api  ──────── HTTPS ────────▶  api.anthropic.com (Claude)

                 packages/shared — TypeScript types shared by web + api
```

### Workspaces

| Path                  | Stack                                   | Purpose                                            |
| --------------------- | --------------------------------------- | -------------------------------------------------- |
| `apps/web`            | Next.js 14 (App Router), TS, Tailwind   | The editor UI.                                     |
| `apps/api`            | Fastify, TS, Prisma                     | Projects, compilation, AI proxy, mathcheck proxy.  |
| `services/mathcheck`  | Python 3.12, FastAPI, SymPy             | Math verification microservice.                    |
| `packages/shared`     | TypeScript                              | Shared types (`Project`, `TexFile`, `CompileResult`, `Diagnostic`, `CompletionRequest`, `MathCheckRequest/Result`, …). |

---

## How data flows

- **Compile:** editor → `api` writes the project's files to the shared compile
  workspace → `latexmk` runs in the `texlive` container (`docker exec`) → `api`
  parses the `.log` into diagnostics and serves the PDF → pdf.js viewer.
- **SyncTeX:** PDF ⌘-click → `api` (`synctex edit`) → editor jumps to the source
  line; editor "locate in PDF" → `api` (`synctex view`) → PDF highlights.
- **AI assist:** editor → `api` → Claude Agent SDK over **your Claude
  subscription** (`claude login`), billed to your monthly Agent SDK credit —
  **no API key anywhere**. The browser never talks to the SDK; every call goes
  through `api`. Three surfaces: a streaming **chat sidebar**, **Cmd+K** inline
  edit (diff + Accept/Reject), and **"Fix with Claude"** on compile errors. See
  [AI features](#ai-features-claude-agent-sdk-over-your-subscription) and
  `docs/decisions.md` ADR-004/005.
- **Math check:** editor → `api` (proxy) → `mathcheck` (SymPy) → result. The
  "Check derivation" command sends the selected (or enclosing) align/equation
  steps; `mathcheck` verifies each adjacent pair (symbolic ladder → numeric
  sampling) and the editor shows ✓/✗/? gutter markers + a results panel with a
  counterexample for any failing step. Per-project macros and default
  assumptions live in Project settings. See
  [services/mathcheck/README.md](services/mathcheck/README.md).

The browser talks only to `api`, always with the shared bearer token. `api` is
bound to localhost and is the only component holding secrets.

### Compilation & live preview

`POST /projects/:id/compile` stages the files, runs
`latexmk -pdf -interaction=nonstopmode -synctex=1 -file-line-error <rootFile>`
(120 s hard timeout, process-group kill), parses the log into structured
diagnostics, and returns `{ status, pdfUrl, synctexUrl, diagnostics, durationMs }`.
Compiles are **queued one-per-project** — a newer request supersedes a queued
one. The PDF and `.synctex.gz` are served from authenticated routes.

In the UI: **Compile** button or **⌘↵**, a **compile-on-save** toggle, a
diagnostics panel under the editor (click a row to jump to `file:line`), and a
pdf.js viewer with page nav / zoom / fit-width that preserves scroll across
recompiles. The compile workspace is a host directory bind-mounted into texlive
(see [docs/decisions.md](docs/decisions.md), ADR-003), so the host-run api and
texlive share files directly.

---

## Security model (single user)

There are **no auth tables and no user accounts** — this is a personal app. It is
protected two ways instead:

1. **Localhost-only bind.** Every published port binds to `127.0.0.1`. In docker
   the api process listens on `0.0.0.0` *inside* its container but is published
   as `127.0.0.1:4000:4000`, so it is never reachable from your LAN.
2. **Shared bearer token.** Every non-health request to `api` must send
   `Authorization: Bearer $API_BEARER_TOKEN`. The api **fails closed**: if the
   token is unset, protected routes return `503`. `/healthz` is intentionally
   public so health probes work without the secret.

---

## Prerequisites

- [Docker](https://www.docker.com/) + Docker Compose
- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/) 9+
  (`corepack enable` will provide pnpm)

---

## Quick start (from a clean clone)

```bash
# 1. Configure
cp .env.example .env
#    → fill in API_BEARER_TOKEN (e.g. `openssl rand -hex 32`).
#      Do NOT set ANTHROPIC_API_KEY — AI uses your Claude subscription (see below).

# 2. Install JS deps
pnpm install

# 3. Start the backing services (postgres + mathcheck + texlive)
docker compose up -d

# 4. Create the database schema and seed a demo project
pnpm db:migrate          # prisma migrate dev — creates the schema
pnpm db:seed             # one "Demo Project" with a compilable main.tex

# 5. Run the apps with hot reload (web :3000, api :4000)
pnpm dev
```

Then open <http://localhost:3000>. Sanity-check the services:

```bash
curl http://localhost:4000/healthz   # → {"status":"ok","service":"api"}
curl http://localhost:8000/healthz   # → {"status":"ok","service":"mathcheck"}
```

### One-command dev

`pnpm dev` runs both Node apps (web + api) via Turborepo with hot reload, talking
to the dockerized postgres / mathcheck / texlive. `docker compose up -d` is the
companion command that provides those backing services.

### Fully containerized (no Node toolchain)

To run the api in a container too (and reach the texlive volume from inside
docker):

```bash
docker compose --profile full up      # postgres + mathcheck + texlive + api
```

The api container runs `prisma generate` at build time; run `pnpm db:migrate`
once against the published Postgres to create the schema.

---

## Common commands

| Command                | What it does                                              |
| ---------------------- | -------------------------------------------------------- |
| `pnpm dev`             | Web + api with hot reload (Turborepo).                   |
| `pnpm dev:web`         | Just the Next.js app.                                    |
| `pnpm build`           | Build / typecheck every workspace.                       |
| `pnpm test`            | Run every workspace's tests (vitest).                    |
| `pnpm lint`            | Lint every workspace.                                    |
| `pnpm typecheck`       | Strict `tsc --noEmit` across the repo.                   |
| `pnpm format`          | Prettier write.                                          |
| `pnpm db:migrate`      | `prisma migrate dev` — create/apply the schema.          |
| `pnpm db:seed`         | Seed the demo project.                                   |
| `pnpm db:studio`       | Open Prisma Studio.                                      |
| `docker compose up -d` | Start postgres + mathcheck + texlive.                    |

Python service tests:

```bash
cd services/mathcheck && pip install -r requirements.txt && pytest
```

---

## Configuration

All configuration is via `.env` (documented in [`.env.example`](.env.example)):

| Variable            | Used by                         | Notes                                              |
| ------------------- | ------------------------------- | -------------------------------------------------- |
| `DATABASE_URL`      | Prisma, host-run api            | Points at the dockerized Postgres on localhost.    |
| `MODEL_PROVIDER`    | api (AI)                        | `agent-sdk` (default, subscription) or `api` (stub). |
| `MODEL`             | api (AI)                        | Default chat/edit model; per-project override in Settings. |
| `API_BEARER_TOKEN`  | api (auth), web → api           | Required; `docker compose` fails fast if unset.    |
| `MATHCHECK_URL`     | api                             | Host-run api uses localhost; the container uses the service name. |
| `TEXLIVE_MODE`      | api                             | `docker` (texlive container) or `local` (host latexmk). |

---

## AI features (Claude Agent SDK over your subscription)

AI is billed to your **Claude subscription**, not an API key. The api embeds the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) as a
locked-down *writing engine* (no tools, no filesystem/bash, no MCP, single-turn)
and authenticates with your `claude login` credentials. Every call goes through
the api — the browser never talks to the SDK.

**Surfaces** (all via the toolbar's **Claude** button / editor):

- **Chat sidebar** — a streaming, per-project conversation (Markdown + KaTeX).
  We own the transcript in Postgres (`ChatThread`/`ChatMessage`), so it survives
  reloads. Context (current file, selection, pinned files) is sent under a token
  budget. Code blocks have **Insert at cursor** and **Copy**.
- **Cmd+K** — inline edit on a selection: type an instruction, review a
  side-by-side diff, **Accept**/**Reject**. Never auto-applies.
- **Fix with Claude** — on any compile-error diagnostic; sends the error +
  offending region + log through the same diff-and-accept flow.
- **Inline completions** (ghost text) — Copilot-style suggestions as you type:
  Tab accepts, Esc dismisses, Alt+] for an alternative; debounced, cached, with
  per-mode prompts (prose / inline-math / display-align / preamble). Toggle and
  tune in Settings or the status bar. A completed math step is verified against
  the previous step (fire-and-forget mathcheck); a wrong step gets an amber
  underline. **Latency note:** the Agent SDK's per-call overhead means
  completions run ~2.6–3 s even on a warm pre-warmed pool (p50 ~30 % faster than
  cold, but p95 exceeds the 1.5 s budget). See `/stats` for the live
  baseline-vs-warm comparison; Settings exposes a per-route
  `COMPLETIONS_PROVIDER=api` override (defaulted off) to escape that overhead.
  See `docs/decisions.md` ADR-006.

Per-project **model** and **AI instructions** live in Project settings. Per-call
latency/outcome is logged to the `AiCallLog` table (`GET /projects/:id/ai/logs`).

### One-time setup

```bash
# 1. Install Claude Code (bundles the SDK binary; or `npm i -g @anthropic-ai/claude-code`)
curl -fsSL https://claude.ai/install.sh | bash

# 2. Log in with your Pro/Max/Team/Enterprise account (opens a browser)
claude            # then follow the prompts;  `/status` shows the active credential

# 3. Run the api on the HOST (not in docker — see "Docker" below)
pnpm dev
```

No `ANTHROPIC_API_KEY`. In fact, **the api refuses to boot** if `ANTHROPIC_API_KEY`
(or `ANTHROPIC_AUTH_TOKEN`) is set under `MODEL_PROVIDER=agent-sdk`: in the SDK's
non-interactive mode an API key is *always* used when present, which would
silently bypass your subscription and bill the API (see `docs/decisions.md`
ADR-004). `unset` it, or set `MODEL_PROVIDER=api` for the (stub) pay-as-you-go
path. Verify the live credential end-to-end with `GET /healthz/model` (a 1-token
round trip → `{provider, model, ok, latencyMs}`).

### Checking remaining Agent SDK credit

From **2026-06-15**, Agent SDK usage on a subscription draws from a **monthly
Agent SDK credit**, separate from interactive usage ($20–$200/mo by plan tier).
Check your balance in the Claude app / Console usage page, or run `claude` and
use `/status`. When the monthly credit is exhausted: if you've enabled usage
credits it spills to standard API rates; otherwise **Agent SDK requests stop
until the credit refreshes**. The app detects this, shows a banner
(*"Agent SDK credit exhausted — resets with your billing cycle"*), and disables
AI features without breaking the editor. See
[Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

### Docker

AI features require the **host-run api** (`pnpm dev`). On macOS your subscription
credential lives in the encrypted Keychain (no file to mount into a container);
OAuth tokens also auto-refresh, which a read-only mount would break. The compose
`api` service therefore carries no AI credential — run the api on the host (it
already shells `docker exec` for compilation). For a fully-containerized run, the
only portable credential is a `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`
env var (inference-scoped). See `docs/decisions.md` ADR-004.

---

## Project layout

```
latex-studio/
├─ apps/
│  ├─ web/                 # Next.js editor
│  └─ api/                 # Fastify API + Prisma
│     └─ prisma/
│        ├─ schema.prisma  # Project, TexFile, CompileLog, Snapshot, ChatThread, ChatMessage, AiCallLog
│        └─ seed.ts        # demo project
├─ services/
│  └─ mathcheck/           # FastAPI + SymPy
├─ packages/
│  └─ shared/              # shared TypeScript types
├─ docker-compose.yml
├─ turbo.json
└─ .env.example
```
