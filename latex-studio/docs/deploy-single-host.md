# Deploy LaTeX Studio on a single host behind Cloudflare Tunnel

A production runbook for **one Linux box you control** (Oracle Cloud A1 ARM,
Hetzner CAX/CX, a home server, …), reachable over HTTPS through a **Cloudflare
Tunnel** — **no open inbound ports, no public IP, no port-forwarding**. Cloudflare
terminates TLS; the origin stays plain HTTP on an internal docker network.

```
            ┌─────────── Cloudflare edge (TLS, optional Access) ───────────┐
  browser ──┤  https://latex.example.com                                   │
            └───────────────────────────┬──────────────────────────────────┘
                                         │  outbound-only tunnel (no inbound ports)
            ┌──────── your host ─────────┴──────────────────────────────────┐
            │  cloudflared ─▶ web:3000 ─▶ api:4000 ─▶ postgres / mathcheck   │
            │                                  └─▶ docker exec texlive       │
            │                                  └─▶ docker run  pyrun (--rm)   │
            │  (NOTHING published to the host — internal docker network only) │
            └─────────────────────────────────────────────────────────────────┘
```

> **Scope.** This is the **HOSTED (convenience) tier** — multi-user, with per-user
> login (Better Auth). `DEPLOY_PROFILE=production` requires a logged-in session on
> every request. For the single-user, VPN-only, no-accounts deployment, use the
> **LOCAL tier** instead — see [deployment-tiers.md](deployment-tiers.md).
> Optionally add **Cloudflare Access** in front as defence-in-depth (below).

---

## 1. Provision the box

Any 64-bit Linux with ≥ 2 vCPU / 4 GB RAM / 20 GB disk. ARM64 is fully supported
(see [§9 ARM](#9-arm-notes)).

- **Oracle Cloud Always Free A1 (ARM):** create an *Ampere A1* VM (Ubuntu 22.04+).
  Because all ingress is via the tunnel, you can leave the security list closed —
  you do **not** need to open 80/443.
- **Hetzner CAX (ARM) / CX (x86):** create the server, Ubuntu 22.04+.

SSH in, then install Docker Engine + the compose plugin:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker   # run docker without sudo
docker compose version                              # need ≥ 2.24 (for the !reset merge tag)
```

Create the workspace + backup directories (owned by uid 1000 — the non-root user
the api and sandboxes run as):

```bash
sudo mkdir -p /srv/latex-studio/workspace /srv/latex-studio/backups-mirror
sudo chown -R 1000:1000 /srv/latex-studio/workspace
```

Get the code:

```bash
git clone https://github.com/bwalpole2025/L_Research.git
cd L_Research/latex-studio
```

---

## 2. Configure secrets (`.env.production`)

```bash
cp .env.production.example .env.production
```

Fill in **every** blank. Generate strong values:

```bash
openssl rand -base64 32   # API_BEARER_TOKEN
openssl rand -base64 32   # BETTER_AUTH_SECRET      (multi-user session signing)
openssl rand -base64 32   # CONNECTORS_MASTER_KEY   ← back this up; losing it loses encrypted content
openssl rand -base64 24   # POSTGRES_PASSWORD       (avoid @ : / — they break the DATABASE_URL)
getent group docker | cut -d: -f3   # DOCKER_GID
```

Set `COMPILE_WORKSPACE=/srv/latex-studio/workspace`, `PUBLIC_URL=https://<your
hostname>`, and (after §3) `CLOUDFLARE_TUNNEL_TOKEN`.

`.env.production` is gitignored. Lock it down: `chmod 600 .env.production`.
Copy it to `.env` so the bare compose command works: `cp .env.production .env`.

**Fail-fast is enforced two ways.** Compose's `${VAR:?…}` aborts `up` if a
required var is unset; the api additionally refuses to boot on a *weak* secret
(short/default bearer, missing master key, default `latex` DB password) because
`API_REQUIRE_STRONG_SECRETS=1` is set in `docker-compose.prod.yml`.

---

## 3. Create the Cloudflare Tunnel

You need a domain on Cloudflare (free plan is fine). In the dashboard:

1. **Zero Trust → Networks → Tunnels → Create a tunnel** → *Cloudflared* → name it.
2. Copy the **tunnel token** → put it in `.env.production` as `CLOUDFLARE_TUNNEL_TOKEN`.
   (Do **not** run the install command they show — our compose runs `cloudflared`.)
3. **Public Hostname** tab → **Add a public hostname**:
   - *Subdomain/Domain*: e.g. `latex.example.com` (this is your `PUBLIC_URL`).
   - *Service*: **HTTP** → `web:3000`  ← the internal service name + port.
4. Save. (No DNS record to create by hand — Cloudflare adds the CNAME for you.)

The tunnel is **outbound-only**: `cloudflared` dials Cloudflare from inside your
host. Nothing listens for inbound connections on the host's public interface.

### Access control

The app itself requires a per-user login (Better Auth) on this tier. For
**defence-in-depth**, you can *also* gate who even reaches the tunnel at the edge:

**Zero Trust → Access → Applications → Add → Self-hosted**, domain
`latex.example.com`, then a policy `Allow` → *Emails* = your address(es) (or
*Google*/*GitHub*). Cloudflare then authenticates the visitor before the request
ever reaches your tunnel, on top of the app's own login.

---

## 4. Bring the stack up

```bash
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

First boot builds the web/api images and the mathcheck + pyrun sandbox images
(several minutes on ARM). Watch it come healthy:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api cloudflared
```

Initialise the database schema (first deploy only), then encrypt content at rest:

```bash
dc() { docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml "$@"; }
dc exec api pnpm exec prisma db push          # create tables (or `prisma migrate deploy`)
dc exec api pnpm --filter @latex-studio/api db:encrypt-content   # encrypt any existing rows (idempotent)
```

Open `https://latex.example.com` (through Cloudflare Access). The editor loads,
compiles, and previews.

---

## 5. Verify it's locked down

**App reachable over HTTPS:**

```bash
curl -I https://latex.example.com           # 200/302 (or the Access login)
```

**Nothing published on the host** — `docker ps` shows NO `0.0.0.0:`/`127.0.0.1:`
port mappings for any service:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps --format '{{.Service}}  {{.Ports}}'
# every Ports column is empty — only cloudflared has an outbound connection
```

**External port scan finds nothing** — from a DIFFERENT machine (your laptop, or
an [online port checker](https://www.yougetsignal.com/tools/open-ports/)), scan
the host's public IP:

```bash
# from elsewhere — replace with the box's public IP
nmap -Pn -p 22,80,443,3000,4000,5432,8000 <PUBLIC_IP>
# Expect: 22 open only if you allow SSH; 80/443/3000/4000/5432/8000 = closed/filtered.
```

If 5432/8000/3000/4000 show as open, something is publishing a port — re-check that
you passed **both** `-f` files (the override resets the base's dev ports).

**Confirm no service binds a public interface:** the only process with a public
footprint is `cloudflared`, and it only makes *outbound* connections:

```bash
sudo ss -ltnp | grep -E ':(3000|4000|5432|8000)\b' || echo "no public listeners ✔"
```

(Postgres/mathcheck/web/api listen only inside the docker network namespace.)

---

## 6. Backups

Nightly Postgres dump + compile-workspace archive, written to `./backups/<ts>/`
and mirrored to a second location (`BACKUP_MIRROR`):

```bash
./scripts/backup.sh        # run once to verify it works
ls backups/*/              # db.sql.gz  workspace.tar.gz  SHA256SUMS
```

Schedule it with cron (3am daily):

```bash
( crontab -l 2>/dev/null; echo "0 3 * * * cd $PWD && ./scripts/backup.sh >> backups/cron.log 2>&1" ) | crontab -
```

> **Also back up `CONNECTORS_MASTER_KEY`** somewhere safe (a password manager). The
> database dump is encrypted at rest; without the key it cannot be decrypted.

### Restore (tested)

```bash
./scripts/restore.sh backups/20260613-030000    # DESTRUCTIVE — verifies checksums first
```

It drops/recreates DB objects from the dump, replaces the workspace, re-asserts
ownership, and tells you to `restart api web`. Test it at least once on a scratch
box (or against a throwaway DB) so you trust it before you need it.

---

## 7. Updating

```bash
git pull
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml up -d --build
dc exec api pnpm exec prisma db push    # apply any schema changes
```

Pull fresh base images periodically (postgres/texlive/cloudflared security fixes):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull postgres texlive cloudflared
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker image prune -f
```

---

## 8. Rotating secrets

- **API_BEARER_TOKEN:** new `openssl rand -base64 32` in `.env.production`, then
  `up -d` (recreates api + web together so they agree on the token).
- **POSTGRES_PASSWORD:** rotate inside Postgres, then update `.env.production`:
  ```bash
  dc exec postgres psql -U latex -c "ALTER USER latex PASSWORD 'NEW';"
  # set POSTGRES_PASSWORD=NEW in .env.production, then:
  dc up -d api
  ```
- **CLOUDFLARE_TUNNEL_TOKEN:** rotate/replace the tunnel in the dashboard, paste the
  new token, `up -d cloudflared`.
- **CONNECTORS_MASTER_KEY:** do **not** change casually — it decrypts existing
  content/credentials. To rotate: `db:encrypt-content -- --decrypt` with the OLD
  key, swap the key, then `db:encrypt-content` with the new key (maintenance window).

---

## 9. ARM notes

The whole stack runs on **arm64** (Oracle A1, Hetzner CAX). Every image is
multi-arch or built from a multi-arch base:

| Image | arm64? |
|---|---|
| `node:20-slim` (web, api) | ✅ official multi-arch |
| `python:3.12-slim` (mathcheck, pyrun) | ✅ official multi-arch |
| `pgvector/pgvector:pg16` | ✅ multi-arch |
| `texlive/texlive:latest-full` | ✅ multi-arch (amd64 + arm64) |
| `cloudflare/cloudflared:latest` | ✅ multi-arch |
| `alpine:3` (workspace-init) | ✅ multi-arch |

The api image fetches the **static docker CLI** for the running arch
(`x86_64`/`aarch64`) — see `apps/api/Dockerfile`. Compile (`pnpm install` + image
builds) is slower on ARM; budget ~10 min for the first `up --build`.

> **If `texlive/texlive:latest-full` ever lacks an arm64 tag for your date-stamped
> release:** pin a known multi-arch tag (e.g. `texlive/texlive:TL2024-historic`), or
> build a small `FROM texlive/texlive` image yourself; the api only needs
> `latexmk`, `synctex` and `texcount` on `PATH` in the `latex-studio-texlive`
> container.

---

## AI in the container

AI features (chat, completions, review, co-derive) use your **Claude subscription
via the `claude` CLI** — there is no API key (the boot guard rejects
`ANTHROPIC_API_KEY` under agent-sdk, ADR-004). The CLI's login lives on a host
keychain, which a headless container can't read, so **AI is off in this profile by
default**. Core editing, multi-file projects, compile, PDF preview, SyncTeX, Python
"Run" and the SymPy maths checker all work without it. To enable AI later, run
`claude login` inside the api container and persist its credential dir — out of
scope for this runbook.

---

## Troubleshooting

- **`up` aborts with `set X is required`** — a required var is missing from
  `.env.production` (or you forgot `--env-file`). That's the fail-fast working.
- **api logs `Refusing to boot … insufficient secrets`** — a secret is present but
  weak (short bearer, default DB password, missing master key). Fix the value.
- **`web` healthy but the site 502s at Cloudflare** — the tunnel's Public Hostname
  must point at `http://web:3000` (service name, not localhost).
- **compile fails with `docker: command not found` / permission denied** — the api
  needs the docker CLI (in the image) + the socket group; check `DOCKER_GID` matches
  `getent group docker | cut -d: -f3` and that `/var/run/docker.sock` is mounted.
