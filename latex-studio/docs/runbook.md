# Runbook — local services & operations

How to run the backing services and operate the thesis-authoring tools.

## Services overview

| Service | How it runs | Needed for | Default endpoint |
| --- | --- | --- | --- |
| Postgres | `docker compose up -d postgres` | everything (Prisma) | `localhost:5432` |
| mathcheck (SymPy) | `docker compose up -d mathcheck` | math check + **maths audit** | `127.0.0.1:8000` |
| texlive | `docker compose up -d texlive` | compile + **pre-submit** | (docker exec) |
| **languagetool** | `docker compose --profile prose up -d languagetool` | **prose grammar/style (optional)** | `127.0.0.1:8010` |
| api (Fastify) | **host:** `pnpm dev` (recommended — AI needs `claude login`) | API | `127.0.0.1:4000` |
| web (Next.js) | `pnpm dev` | editor UI | `127.0.0.1:3000` |

```bash
# Minimal stack for the thesis tools (host-run api):
docker compose up -d postgres mathcheck texlive
pnpm dev
```

## Prose check (Feature 2)

The prose check is **fully local**. By default it runs en-GB spelling
(`nspell` + a Hunspell en-GB dictionary) and the rule-based consistency lints
(en-GB mixed usage, double spaces, quote mixing, hyphenation). No text leaves the
machine, and with no LanguageTool configured the checker makes no network call.

### Enabling LanguageTool (optional grammar/style)

LanguageTool adds grammar/style on top of spelling, still **locally** (a
container — nothing is sent off the machine):

```bash
docker compose --profile prose up -d languagetool       # first pull is large (Java)
# then, for a host-run api, in .env:
#   LANGUAGETOOL_URL="http://127.0.0.1:8010"
# (api container path: http://languagetool:8010)
# restart the api so it picks up the URL, then enable the "Grammar (LanguageTool)"
# rule in Settings → Prose. If the container is unreachable the check silently
# stays spelling + lints only.
curl -s 'http://127.0.0.1:8010/v2/check' --data 'language=en-GB&text=He go.' | head -c 200   # smoke test
```

### Growing the per-project dictionary

Domain terms (e.g. *ferrofluid*, *KdV*, *Burgers*, *SymPy*, supervisor names)
will be flagged as spelling mistakes until added to the project's custom
dictionary:

- **From a diagnostic:** click **Add to dictionary** on a spelling row in the
  Prose panel. The word persists on the project (`Project.customWords`) and is
  excluded on the next check.
- **Inspect/seed via the API:**
  ```bash
  TOKEN=...; PID=...
  curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:4000/projects/$PID/dictionary
  curl -s -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
       -d '{"word":"ferrofluid"}' http://127.0.0.1:4000/projects/$PID/dictionary
  # remove: add "remove": true
  ```
  (The web talks to these through the bearer-injecting `/api` proxy; direct curl
  needs the `API_BEARER_TOKEN`.)

## Maths audit (Feature 1)

"Audit maths" sweeps every display-math block through the **mathcheck** service.
Ensure `mathcheck` is up (`docker compose up -d mathcheck`). Results are cached
per normalised equation, so re-auditing after unrelated edits is near-instant.
`unknown` rows are unparseable/macro-heavy equations — add the relevant macros in
**Project settings → Macro table** so they parse.

## Pre-submit check (Feature 3)

"Pre-submit check" runs compile + maths audit + prose + cross-reference health
and shows a one-screen dashboard you can export as Markdown. It needs
`postgres`, `mathcheck`, and `texlive` up (LanguageTool optional).

## Troubleshooting

- **Maths audit returns all `unknown`** → mathcheck is down. `docker compose up -d mathcheck` and `curl 127.0.0.1:8000/healthz`.
- **Prose grammar rule does nothing** → LanguageTool not running or `LANGUAGETOOL_URL` unset; spelling + lints still work.
- **Pre-submit compile is `error`** → open the Problems panel; the same diagnostics power the dashboard's compile totals.
