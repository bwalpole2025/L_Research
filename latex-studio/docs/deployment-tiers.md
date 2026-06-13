# Deployment tiers: keep the privacy wedge

LaTeX Studio ships **two deployment tiers from one codebase**. They are the *same
containers and the same image builds* — only a compose **override** and an
**env file** differ. This is a profile switch, **not a fork**: every feature
(editor, compile, PDF, SyncTeX, Python "Run", maths check, encryption-at-rest,
hard-delete, export) is identical in both.

| | **LOCAL** (private) | **HOSTED** (convenience) |
|---|---|---|
| Pitch | *Your data never leaves your machine.* | Reach it from any browser, no VPN client. |
| Ingress | **Caddy**, bound to your **VPN** interface (Tailscale/WireGuard) | **Cloudflare Tunnel** (outbound-only; no open ports) |
| Reachable from | inside your tailnet only | the public internet (behind Cloudflare) |
| Accounts | **None** — single user | **Yes** — Better Auth logins (multi-user) |
| Access control | the VPN + the service bearer | per-user login (+ optional Cloudflare Access) |
| Override file | `docker-compose.local.yml` | `docker-compose.prod.yml` |
| Env file | `.env.local` (`.env.local.example`) | `.env.production` (`.env.production.example`) |
| Runbook | [docs/self-hosting.md](self-hosting.md) | [docs/deploy-single-host.md](deploy-single-host.md) |
| Auth flag | `API_REQUIRE_STRONG_SECRETS=1` (auth **off**) | `DEPLOY_PROFILE=production` (auth **on**) |

Both layer on the same base: `docker compose -f docker-compose.yml -f docker-compose.<tier>.yml …`.

---

## Where your data lives (in BOTH tiers)

The wedge holds in **both** tiers because the data always stays on **your host**:

- **Documents + snapshots** → Postgres on your box, **encrypted at rest** with a
  per-project key derived from your master key (a DB-only breach yields ciphertext).
- **Compiled PDFs, build artefacts, figures, literature PDFs** → the compile
  workspace directory on your host's disk.
- **Connector tokens** (Drive/Notion/…) → AES-256-GCM in the vault, on your box.
- **AI** uses your *subscription* via the `claude` CLI — prompts are **not** logged
  and nothing is stored by a third party. Logs are metadata-only.
- **Erasure**: deleting a project hard-deletes its rows, workspace files and vault
  entries; "export all my data" produces a portable archive.

There is **no SaaS database** and no vendor copy of your documents in either tier.

### What differs — the transit + identity trade-off

- **LOCAL**: traffic only ever crosses **your own VPN** (WireGuard-encrypted,
  end-to-end inside your tailnet). No third party is in the path at all. One user,
  no login. This is the maximal-privacy tier.
- **HOSTED**: Cloudflare **terminates TLS at its edge** and proxies plain HTTP to
  your origin through the tunnel — so Cloudflare is in the request path (it can see
  decrypted request metadata/bodies in transit, as any reverse proxy does), and you
  trade a little of that for not needing a VPN client and for real multi-user
  accounts. Your data still lives only on your host; Cloudflare stores none of it.

> Rule of thumb: **LOCAL for your own thesis; HOSTED only when you need to share
> access with collaborators or reach it from a managed device without a VPN.**

---

## Run the LOCAL (private) tier

Single-user, VPN-only, no accounts. Full walk-through: [docs/self-hosting.md](self-hosting.md).

```bash
cp .env.local.example .env.local      # fill in TUNNEL_BIND_ADDR (tailscale ip -4),
                                       #   TUNNEL_HOSTNAME, secrets, COMPILE_WORKSPACE, DOCKER_GID
cp .env.local .env                    # so the bare compose command works
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

- Caddy publishes **one** port, bound to your Tailscale/WireGuard IP — never a
  public NIC. An external port scan finds nothing.
- `DEPLOY_PROFILE` is **not** set, so `AUTH_REQUIRED` stays off: no login screen,
  single user.

## Run the HOSTED (convenience) tier

Multi-user, Cloudflare Tunnel. Full walk-through: [docs/deploy-single-host.md](deploy-single-host.md).

```bash
cp .env.production.example .env.production   # fill in CLOUDFLARE_TUNNEL_TOKEN, PUBLIC_URL,
                                              #   BETTER_AUTH_SECRET, secrets, COMPILE_WORKSPACE, DOCKER_GID
cp .env.production .env
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

- `cloudflared` is the only ingress (outbound-only). No host ports published.
- `DEPLOY_PROFILE=production` turns on **multi-user auth** (Better Auth) and the
  strong-secrets boot guard.

---

## Backups, updates, secrets

The same scripts serve both tiers — point them at the tier's files:

```bash
# LOCAL
PROD_FILE=docker-compose.local.yml ENV_FILE=.env.local ./scripts/backup.sh
# HOSTED (defaults)
./scripts/backup.sh
```

`./scripts/restore.sh backups/<ts>` restores either (set `PROD_FILE`/`ENV_FILE`
to match). Image updates, schema migrations and secret rotation are identical and
covered in each tier's runbook.

## It's one codebase

There is no `if (hosted)` branching in application code. The differences are
entirely in **deployment configuration**:

- the front-door **service** (`caddy` vs `cloudflared`) in the override file,
- one **env flag** (`API_REQUIRE_STRONG_SECRETS` vs `DEPLOY_PROFILE=production`)
  that the api reads at boot to decide whether to require user accounts.

Switching tiers is changing which override + env file you pass to `docker compose`.
