# Self-hosting LaTeX Studio privately (VPN-only)

This runbook stands the app up on **one host you control**, reachable **only over a
private tunnel** (Tailscale or WireGuard) — never the public internet. It is the
single-user "your data on your machine" deployment. It is **not** multi-user and
has **no public exposure or accounts** by design.

> If you only want local development, ignore this file and use the root `README`
> (`docker compose up -d` + `pnpm dev`, all bound to `127.0.0.1`).

---

## What you get (and the hardening it enforces)

```
                tunnel only (Tailscale/WireGuard)
  your laptop ───────────────────────────────► HOST
   (tunnelled)                                   │
                         ${TUNNEL_BIND_ADDR}:8443 │  ← the ONLY published port,
                                                  ▼     bound to the tunnel IP
                                              ┌─ caddy ─┐  (TLS terminates here)
                                              │   web    │  Next.js: serves UI,
                          internal docker net │  (3000)  │  proxies /api with bearer
                                              │   api    │  Fastify (4000)
                                              │ postgres │  pgvector
                                              │ mathcheck│  SymPy verification
                                              └────┬─────┘
                                       docker socket │ exec / run
                                              ┌──────▼─────────┐
                                              │ texlive (none) │ network-isolated,
                                              │ pyrun (per-run)│ non-root, capped
                                              └────────────────┘
```

- **Network binding** — only Caddy is published, and `docker-compose.prod.yml`
  binds it to `${TUNNEL_BIND_ADDR}` (your tunnel IP). `web`, `api`, `postgres`,
  `mathcheck`, `pyrun`, `texlive` have **no published ports** — they exist only on
  the internal docker network. The api/web listeners bind `0.0.0.0` **inside their
  own container network namespace**, which is not the host's public NIC.
- **Bearer token** — the api **refuses to boot** bound off-loopback without a
  bearer (`apps/api/src/app.ts`). Every route stays behind it (`plugins/auth.ts`).
- **CORS** — pinned to the front-door origin (`WEB_BASE_URL`); reflect-any is only
  used on a loopback dev box.
- **Rate limiting** — `@fastify/rate-limit` caps `/compile`, `/run` and the AI
  routes; a global **compile-concurrency** cap (`COMPILE_MAX_CONCURRENT`) bounds
  parallel compiles. A runaway tab gets `429`, not your host's RAM.
- **Error handler** — unhandled errors return a generic message; no stack traces
  leak (`app.setErrorHandler`).
- **Sandboxes** — `texlive` runs **non-root**, **`network_mode: none`**, CPU/mem/
  pids-capped, `no-new-privileges`, `cap_drop: ALL`. `pyrun` executions are
  throwaway `docker run --rm` with `--network none` + the same caps. A pathological
  `.tex` or script is contained, not host-fatal.
- **Secrets** — come from `.env.production` (gitignored); compose fails fast if any
  are unset. Nothing is hardcoded.

---

## 0. Prerequisites

- A Linux host you control (a NUC, an old laptop, a VPS you treat as private).
- Docker Engine + the Docker Compose plugin.
- A tunnel: a [Tailscale](https://tailscale.com) account (easiest) **or**
  WireGuard. The host and every device you'll use must be on it.

---

## 1. Put the host on the tunnel

### Tailscale (recommended)
```bash
# On the HOST:
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4          # → your TUNNEL_BIND_ADDR, e.g. 100.64.1.5
tailscale status         # note the MagicDNS name → TUNNEL_HOSTNAME
#   e.g. latex.your-tailnet.ts.net
```
Install Tailscale on each **client** device too and sign into the same tailnet.

### WireGuard (alternative)
Bring up a `wg0` interface on the host with a private address (e.g. `10.7.0.1`).
Use that as `TUNNEL_BIND_ADDR` and a name you resolve to it as `TUNNEL_HOSTNAME`
(add it to clients' `/etc/hosts` if you have no DNS). Add each client as a peer.

---

## 2. Configure secrets (`.env.production`)

```bash
cp .env.production.example .env.production
```
Fill it in. Generate strong secrets:
```bash
openssl rand -hex 32     # API_BEARER_TOKEN  (and CONNECTORS_MASTER_KEY)
openssl rand -hex 24     # POSTGRES_PASSWORD
getent group docker | cut -d: -f3   # DOCKER_GID
tailscale ip -4          # TUNNEL_BIND_ADDR
```
Required, no defaults: `TUNNEL_BIND_ADDR`, `TUNNEL_HOSTNAME`, `API_BEARER_TOKEN`,
`POSTGRES_PASSWORD`, `CONNECTORS_MASTER_KEY`, `DOCKER_GID`, `COMPILE_WORKSPACE_HOST`.

Create the workspace dir on disk (Section 5 says where):
```bash
sudo mkdir -p /srv/latex-studio/workspace     # = COMPILE_WORKSPACE_HOST
```
`.env.production` is **gitignored** — it never enters version control or the image.

---

## 3. Bring up the stack (bound to the private interface)

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
Then run the database migrations once:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec api pnpm --filter @latex-studio/api exec prisma migrate deploy
```
Check everything is healthy and that **only caddy** publishes a port:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production config \
  | grep -A3 'published'      # → exactly one mapping, host_ip = your tunnel IP
```

**The exact bind:** Caddy publishes `${TUNNEL_BIND_ADDR}:${TUNNEL_PORT}->8443`
(e.g. `100.64.1.5:8443`). No other service has a `ports:` entry, so nothing else
is reachable from any host interface.

---

## 4. Reach it from a tunnelled device

From a second device **on the tunnel**:
```
https://${TUNNEL_HOSTNAME}:8443
```
(See **TLS** below for the certificate warning.)

---

## 5. Confirm it is NOT publicly exposed  ← do this every deploy

The whole point: reachable on the tunnel, invisible off it.

**A. From a device that is NOT on the tunnel** (e.g. your phone on cellular), find
the host's *public* IP and scan it:
```bash
nmap -Pn -p 8443,3000,4000,5432,8000 <HOST_PUBLIC_IP>
# EXPECT: all filtered/closed. Nothing open. If 8443 is open here, your bind is
# wrong (it must be the tunnel IP, not 0.0.0.0) — fix TUNNEL_BIND_ADDR.
```

**B. On the host, confirm the listener is on the tunnel IP only:**
```bash
sudo ss -tlnp | grep -E ':8443|:5432|:4000|:3000'
# EXPECT: one line, 100.x.y.z:8443 (your tunnel IP). NOT 0.0.0.0:8443, and NO
# lines for 5432/4000/3000 (those services aren't published at all).
```

**C. Over the tunnel it should work; off it should hang/refuse:**
```bash
curl -k https://${TUNNEL_HOSTNAME}:8443        # on-tunnel: 200
curl --max-time 5 https://<HOST_PUBLIC_IP>:8443   # off-tunnel: timeout/refused
```

If `nmap` shows 8443 open on the public IP, `TUNNEL_BIND_ADDR` is not your tunnel
address — fix it and `up -d` again. (Also check no host firewall/router forwards
the port.)

---

## 6. Verify the mandatory hardening

- **Bearer fail-fast:** temporarily blank `API_BEARER_TOKEN` and `up` the api — it
  refuses to boot ("Refusing to boot: API_BEARER_TOKEN is empty while bound to a
  non-loopback host"). Restore the token.
- **Rate limits:** hammer a heavy route past its ceiling and you get `429`:
  ```bash
  for i in $(seq 1 40); do
    curl -s -o /dev/null -w "%{http_code} " -X POST \
      -H "authorization: Bearer $API_BEARER_TOKEN" \
      https://${TUNNEL_HOSTNAME}:8443/api/projects/none/compile -k
  done; echo   # → 404s, then 429 once past RATE_LIMIT_COMPILE_MAX
  ```
- **Sandbox:** `docker inspect latex-studio-texlive --format \
  '{{.HostConfig.NetworkMode}} {{.Config.User}} {{.HostConfig.Memory}}'`
  → `none 1000:1000 <bytes>`. A `\write18`/infinite-loop `.tex` is killed by the
  compile timeout + caps; it cannot reach the network.

---

## 7. Backups (it now holds real work)

**Where the data lives:** Postgres in the `pgdata` named volume; the compile
workspace at `COMPILE_WORKSPACE_HOST` (e.g. `/srv/latex-studio/workspace`).

`scripts/backup.sh` writes a `pg_dump` + a workspace archive (+ SHA256SUMS) to
`./backups/<timestamp>/`, optionally mirrored to a second location:
```bash
./scripts/backup.sh                      # → backups/20260613-030000/
BACKUP_MIRROR=/mnt/usb-backup ./scripts/backup.sh   # also copy to an attached drive
```
**Schedule it nightly** (host crontab):
```cron
15 3 * * *  cd /srv/latex-studio/app && BACKUP_MIRROR=/mnt/usb-backup ./scripts/backup.sh >> /var/log/latex-backup.log 2>&1
```

### Restore
```bash
./scripts/restore.sh backups/20260613-030000
docker compose -f docker-compose.prod.yml --env-file .env.production restore api web
```
This verifies checksums, restores the DB (the dump drops & recreates objects) and
the workspace, then you restart. Test a restore into a throwaway dir periodically —
an untested backup is a hope, not a backup.

---

## 8. Updating

- **App code / images:**
  ```bash
  git pull
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
  docker compose -f docker-compose.prod.yml --env-file .env.production \
    exec api pnpm --filter @latex-studio/api exec prisma migrate deploy
  ```
- **TeX Live:** the `texlive/texlive:latest-full` image is network-isolated, so you
  don't `tlmgr install` inside it — you refresh the whole image:
  ```bash
  docker compose -f docker-compose.prod.yml --env-file .env.production pull texlive
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d texlive
  ```
- **Base images (caddy/postgres/pgvector):** `... pull && ... up -d`. Back up first.

---

## 9. Rotating secrets & the bearer

1. Generate a new value (`openssl rand -hex 32`).
2. Update it in `.env.production`.
3. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d` to
   recreate the affected containers (api **and** web for the bearer, so the proxy
   and the validator stay in lockstep).
4. **Postgres password:** rotating `POSTGRES_PASSWORD` only affects a *fresh* data
   dir. To change it on an existing DB, also run
   `ALTER USER latex WITH PASSWORD '…';` inside the db, then update the env.
5. Rotate the bearer if a device is lost or you suspect exposure; old tunnelled
   sessions stop working immediately.

---

## 10. TLS for the tunnel hostname

`Caddyfile` uses `tls internal` — Caddy's own CA issues a cert for
`${TUNNEL_HOSTNAME}`. The tunnel already encrypts the wire, so this is mainly to
satisfy the browser. To avoid the warning, trust Caddy's root on each client:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
# import caddy-root.crt into the OS/browser trust store on each device
```
Or, since the tunnel is already encrypted, switch the `Caddyfile` site address to
`http://{$TUNNEL_HOSTNAME}` and drop `tls internal`.

---

## 11. AI in the container (limitation)

AI features (chat, edit, co-derive, completions) use your **Claude subscription via
`claude login`**, whose credential lives in a host keychain — not in a container,
and **no `ANTHROPIC_API_KEY`** (the boot guard rejects one, ADR-004). The
containerized stack fully serves **editing, compilation, the SymPy verification,
and Python runs**; for AI you either run the `api` on the host (`pnpm dev`-style,
bound to the tunnel) with `claude login`, or mount the credential into the api
container. The rest of this runbook is unaffected.

---

## Non-goals

Single-user private hosting only. No multi-user auth, no public exposure, no
accounts. If you ever want those, that's a separate project — keep this one
"your data, your machine, reachable privately."
