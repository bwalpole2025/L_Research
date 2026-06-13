# Untrusted-code isolation & the trust boundary

LaTeX Studio executes two kinds of code the author controls but the *host* must
not trust: **LaTeX** (TeX is Turing-complete and can read/write files and shell
out) and **Python** ("Run"). This document states exactly **what runs where**,
**what each isolation layer does and does not guarantee**, and **the resource
caps**. Multi-user hosts should read this before exposing the app.

## TL;DR

| Workload | Where it runs | Isolation |
| --- | --- | --- |
| Routine **Python** | The user's **browser** (Pyodide / WASM) | Browser tab sandbox — never touches the host |
| **Python** fallback | Server, ephemeral container | non-root · `--network none` · cpu/mem/pids caps · wall-clock kill · **gVisor (runsc)** · read-only project mount |
| **LaTeX** compile | Server, long-lived `texlive` container (`docker exec`) | non-root · `network_mode: none` · cpu/mem/pids caps · `cap_drop: ALL` · `no-new-privileges` · in-container `timeout` · **gVisor (runsc)** |
| Verification (SymPy mathcheck) | Server `mathcheck` container | Trusted first-party code; not user code. **Unchanged** by this work. |

Both server-side paths are admitted through **one queue/quota gate** (below).

## 1. Client-side Python is the default (smallest server attack surface)

The scariest surface — running arbitrary user Python on the host — is removed for
the common case: Python runs **in the user's browser** via
[Pyodide](https://pyodide.org) (CPython compiled to WebAssembly) in a Web Worker.
It executes inside the browser's tab sandbox, on the user's machine, with the
user's own CPU/RAM — **the host never sees the code or the process**. numpy, scipy
and matplotlib are available; figures are captured the same way as server runs.

The **server-side** Python path (`pyrun`) remains as a **fallback** for workloads
Pyodide can't handle (a package without a WASM wheel, very large data, etc.),
selected by a flag (`NEXT_PUBLIC_PYTHON_RUNTIME` / per-session toggle, default
`client`). LaTeX has no practical in-browser engine, so **LaTeX always compiles
server-side** (under gVisor).

> Trust note: client-side execution protects the **host**, not the **user** — code
> runs with the user's own browser privileges. That is the correct boundary for a
> tool where the user authors the code they run.

## 2. gVisor (runsc) for the server-side containers

The two server-side execution containers run under the **gVisor** runtime
(`runsc`) instead of stock `runc`. gVisor interposes a **user-space kernel** that
implements the Linux syscall surface in a sandboxed process, so a container's
syscalls are serviced by gVisor — not the host kernel directly.

### What gVisor DOES give you
- A second, independent barrier in front of the host kernel: a container kernel
  exploit must first defeat gVisor's re-implementation, dramatically shrinking the
  attack surface vs. sharing the host kernel through runc.
- Defence in depth on top of (not instead of) the existing caps below.

### What gVisor does NOT do
- It is **not** a VM and not a guarantee against all escapes — it's a strong
  mitigation, not a proof.
- It does **not** replace the resource caps, the non-root user, network isolation,
  or the read-only mount — those still do the heavy lifting and gVisor composes
  with them.
- It adds some syscall overhead and a few rough edges for exotic syscalls
  (irrelevant to latexmk / numeric Python).

### Installing gVisor on the host (Linux)
```sh
# Official install (Debian/Ubuntu shown; see gvisor.dev/docs for your distro)
(
  set -e
  ARCH=$(uname -m)
  URL=https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}
  wget -q ${URL}/runsc ${URL}/runsc.sha512 \
       ${URL}/containerd-shim-runsc-v1 ${URL}/containerd-shim-runsc-v1.sha512
  sha512sum -c runsc.sha512 -c containerd-shim-runsc-v1.sha512
  chmod a+rx runsc containerd-shim-runsc-v1
  sudo mv runsc containerd-shim-runsc-v1 /usr/local/bin
)
# Register the runtime with dockerd, then restart docker:
sudo runsc install        # writes the "runsc" runtime into /etc/docker/daemon.json
sudo systemctl restart docker
docker info | grep -i runtimes   # expect: runc runsc
```

`/etc/docker/daemon.json` ends up with:
```json
{ "runtimes": { "runsc": { "path": "/usr/local/bin/runsc" } } }
```

### Selecting runsc for ONLY these two services
The production compose opts these two containers in and **nothing else**:
- **texlive** — `runtime: "${TEXLIVE_RUNTIME:-runsc}"` (docker-compose.prod.yml).
- **pyrun** — each execution is a sibling `docker run`, so the api passes
  `--runtime` per run from `PYRUN_RUNTIME` (default `runsc` in prod;
  `apps/api/src/run/runner.ts`).

postgres, mathcheck, api and web keep the default `runc`. Opt a host without
gVisor back out with `TEXLIVE_RUNTIME=runc` and `PYRUN_RUNTIME=` (empty). The dev
compose (macOS/OrbStack, no gVisor) uses the default runtime.

## 3. Resource caps (the layer that actually bounds a pathological job)

A fork-bomb, an OOM allocator, or an infinite loop is contained by hard caps —
**independent of gVisor** — so the host stays healthy:

| | pyrun (`docker run` per execution) | texlive (`docker exec`) |
| --- | --- | --- |
| User | `--user 1000:1000` (non-root) | `user: 1000:1000` |
| Network | `--network none` (opt-in bridge per project) | `network_mode: none` |
| CPU | `--cpus` (`PYRUN_CPUS`, default 1) | `cpus` (`TEXLIVE_CPUS`, default 2) |
| Memory | `--memory` (`PYRUN_MEMORY`, default 512m) → **OOM-killed** | `mem_limit` (`TEXLIVE_MEM`, default 2g) |
| PIDs | `--pids-limit` (`PYRUN_PIDS_LIMIT`, default 256) → **fork-bomb capped** | `pids_limit: 512` |
| Wall-clock | host timer SIGKILLs at `PYRUN_TIMEOUT_MS` (default 60s); in-container `timeout -s KILL` backstop | host backstop + in-container `timeout -k 5 <compileTimeoutMs>` |
| Filesystem | project mounted **read-only**; only `figures/` + the run's `.pyout/<runId>/` writable | shared workspace; `tmpfs /tmp` in prod |
| Privileges | ephemeral `--rm`; (prod texlive) `cap_drop: ALL`, `no-new-privileges` | `cap_drop: ALL`, `no-new-privileges` |

So: **PIDs cap → fork-bomb dies; memory cap → OOM-kill, host RAM safe; wall-clock
timer → infinite loop killed.** None of these depend on gVisor; gVisor is the
extra barrier around the kernel.

## 4. The admission gate — one queue, global + per-user limits + a daily quota

Both server-side paths (compile **and** run) are admitted through a single
`ExecutionGate` (`apps/api/src/exec/gate.ts`) so no user can starve the pool or
run an unbounded miner:

- **Global concurrency cap** (`EXEC_MAX_CONCURRENT`, defaults to
  `COMPILE_MAX_CONCURRENT`) — total simultaneous sandbox executions across all
  users and both paths. The texlive/pyrun containers are never oversubscribed.
- **Per-user concurrency cap** (`EXEC_PER_USER_CONCURRENT`, default 2) — one user
  can't monopolise the pool. Over the cap you **wait** (FIFO), never rejected.
- **Per-user daily RUN quota** (`EXEC_PER_USER_DAILY_RUNS`, default 500) — the
  anti-miner limit. Applies to **server-side Python runs only** (the
  arbitrary-code vector); **compiles are never daily-capped** (compile-on-save).
  Over quota the run is **rejected with 429 + Retry-After**, before any sandbox
  work — and the user is nudged to run Python client-side instead. Resets at UTC
  midnight.

The gate is keyed by the authenticated **principal**. Today there is one
static-bearer principal, so the per-user limits bound the single user; when
per-user auth lands (see `docs/decisions.md` ADR-016) the same gate becomes
genuinely per-user with **no code change**. HTTP-level rate limits
(`@fastify/rate-limit`) sit in front as a coarser request throttle; the gate is
the resource-accurate concurrency/quota layer.

## What is explicitly OUT of scope here
- The **verification stack** (mathcheck/SymPy, co-derivation, review) is
  first-party trusted code; its correctness and behaviour are unchanged.
- gVisor is a mitigation, not a sandbox-escape proof. For hostile multi-tenant
  workloads at scale, add per-tenant VMs / Kata Containers on top — the seams
  (one gate, per-run `--runtime`, the caps table) make that a config change.
