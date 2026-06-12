import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MAIN_TEX = `\\documentclass{article}
\\usepackage{graphicx}

\\title{LaTeX Studio Demo}
\\author{You}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Hello}
Welcome to your locally-hosted LaTeX Studio. This minimal document compiles
with \\texttt{latexmk}.

\\begin{equation}
  e^{i\\pi} + 1 = 0
\\end{equation}

\\section{A Python-generated figure}
The figure below is produced locally by \\texttt{kdv\\_spectral\\_rk4.py}. Press
\\emph{Run} to execute it in the sandbox, or \\emph{Run \\& Compile} to regenerate
the figure and rebuild this PDF. It shows a Korteweg--de Vries soliton keeping its
shape and a two-soliton interaction in which the solitons re-emerge unchanged.
% !py kdv_spectral_rk4.py -> figures/kdv.png
\\IfFileExists{figures/kdv.png}{%
  \\begin{center}\\includegraphics[width=\\linewidth]{figures/kdv.png}\\end{center}%
}{\\begin{center}\\emph{Run kdv\\_spectral\\_rk4.py to generate figures/kdv.png.}\\end{center}}

\\end{document}
`;

// KdV via a Fourier spectral method + integrating-factor RK4 (see the docstring).
// Embedded as the demo's runnable example; "Run & Compile" regenerates figures/kdv.png.
const KDV_PY = `"""
Korteweg-de Vries (KdV) equation  u_t + 6 u u_x + u_xxx = 0  on a periodic domain,
solved with a FOURIER SPECTRAL method in space and INTEGRATING-FACTOR RK4 in time.

Scheme
------
In Fourier space the equation becomes
    uhat_t = i k^3 uhat  -  3 i k * FFT(u^2),
a stiff LINEAR part  L = i k^3  (the u_xxx term; spatial derivatives are exact via
multiplication by i k and (i k)^3) plus a nonlinear part  N(uhat) = -3 i k FFT(u^2)
(since 6 u u_x = 3 (u^2)_x).

Why not plain RK4?  The linear term oscillates as fast as k^3 (k ~ N/2, ~1e4 here),
so explicit RK4 on it is STIFF and blows up unless dt is tiny.  The integrating-
factor (Lawson) RK4 factors the linear part out EXACTLY with E = exp(L t) — which
has unit modulus, so it neither grows nor decays — and applies RK4 only to the
well-behaved nonlinear term.  That keeps the method "RK4" while staying stable at a
sensible dt.

Outputs figures/kdv.png: a single soliton (keeps its shape) and a two-soliton
interaction (the taller, faster soliton overtakes the shorter one and both
re-emerge, a hallmark of integrability).
"""
import os
import time
import numpy as np
import matplotlib

matplotlib.use("Agg")  # headless; never opens a window
import matplotlib.pyplot as plt


def soliton(x, kappa, x0):
    """One-soliton profile: amplitude 2*kappa**2, speed 4*kappa**2."""
    return 2.0 * kappa**2 / np.cosh(kappa * (x - x0)) ** 2


def integrate(u0, L, dt, tfinal, n_snapshots):
    """Integrate KdV with integrating-factor RK4; return (t_snap, U_snap)."""
    N = u0.size
    k = 2.0 * np.pi * np.fft.fftfreq(N, d=L / N)          # wavenumbers
    Lop = 1j * k**3                                       # exact linear operator
    E = np.exp(Lop * dt)
    E2 = np.exp(Lop * dt / 2.0)
    Einv, E2inv = np.conj(E), np.conj(E2)                # |E| = 1  =>  inverse = conj
    mask = np.abs(k) < (2.0 / 3.0) * np.abs(k).max()     # 2/3 dealiasing

    def Nhat(uhat):
        u = np.real(np.fft.ifft(uhat))
        return mask * (-3j * k * np.fft.fft(u * u))

    nsteps = int(round(tfinal / dt))
    stride = max(1, nsteps // n_snapshots)
    uhat = np.fft.fft(u0)
    snaps_t, snaps_u = [0.0], [u0.copy()]
    t0 = time.time()
    for n in range(1, nsteps + 1):
        k1 = Nhat(uhat)
        k2 = E2inv * Nhat(E2 * (uhat + 0.5 * dt * k1))
        k3 = E2inv * Nhat(E2 * (uhat + 0.5 * dt * k2))
        k4 = Einv * Nhat(E * (uhat + dt * k3))
        uhat = E * (uhat + dt / 6.0 * (k1 + 2 * k2 + 2 * k3 + k4))
        if n % stride == 0:
            u = np.real(np.fft.ifft(uhat))
            snaps_t.append(n * dt)
            snaps_u.append(u)
            print(f"  t = {n * dt:6.3f}   max|u| = {np.abs(u).max():7.4f}", flush=True)
    print(f"  {nsteps} steps in {time.time() - t0:.2f}s", flush=True)
    return np.array(snaps_t), np.array(snaps_u)


def conservation(x, u0, uf):
    """Mass and momentum should be conserved (a check on numerical stability)."""
    dx = x[1] - x[0]
    m0, mf = np.sum(u0) * dx, np.sum(uf) * dx
    p0, pf = np.sum(u0**2) * dx, np.sum(uf**2) * dx
    print(f"  mass:     {m0:.6f} -> {mf:.6f}  (drift {abs(mf - m0):.2e})", flush=True)
    print(f"  momentum: {p0:.6f} -> {pf:.6f}  (drift {abs(pf - p0):.2e})", flush=True)


def main():
    N = 256
    L = 40.0
    x = -L / 2.0 + L * np.arange(N) / N
    dt = 1.0e-3
    tfinal = 6.0
    n_snap = 140

    print("KdV via Fourier spectral + integrating-factor RK4", flush=True)

    print("\\n[1/2] single soliton (kappa=1.2) — should keep its shape", flush=True)
    u0 = soliton(x, 1.2, -10.0)
    t1, U1 = integrate(u0, L, dt, tfinal, n_snap)
    conservation(x, U1[0], U1[-1])

    print("\\n[2/2] two-soliton interaction — taller overtakes shorter, both re-emerge", flush=True)
    u0 = soliton(x, 1.6, -14.0) + soliton(x, 1.0, -4.0)
    t2, U2 = integrate(u0, L, dt, tfinal, n_snap)
    conservation(x, U2[0], U2[-1])

    os.makedirs("figures", exist_ok=True)
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2), constrained_layout=True)
    for ax, (t, U, title) in zip(
        axes, [(t1, U1, "Single soliton"), (t2, U2, "Two-soliton interaction")]
    ):
        im = ax.imshow(
            U, extent=[x.min(), x.max(), t.min(), t.max()],
            origin="lower", aspect="auto", cmap="magma",
        )
        ax.set_title(title)
        ax.set_xlabel("x")
        ax.set_ylabel("t")
        fig.colorbar(im, ax=ax, label="u(x, t)")
    fig.suptitle(r"KdV:  $u_t + 6 u u_x + u_{xxx} = 0$  (Fourier spectral + IF-RK4)")
    out = os.path.join("figures", "kdv.png")
    fig.savefig(out, dpi=120)
    print(f"\\nwrote {out}", flush=True)


if __name__ == "__main__":
    main()
`;

async function main(): Promise<void> {
  const existing = await prisma.project.findFirst({ where: { name: 'Demo Project' } });
  if (existing) {
    console.log(`Demo project already exists (id=${existing.id}); nothing to seed.`);
    return;
  }

  const project = await prisma.project.create({
    data: {
      name: 'Demo Project',
      rootFile: 'main.tex',
      pythonRunTarget: 'kdv_spectral_rk4.py',
      files: {
        create: [
          { path: 'main.tex', content: MAIN_TEX },
          { path: 'kdv_spectral_rk4.py', content: KDV_PY },
        ],
      },
    },
    include: { files: true },
  });

  console.log(`Seeded "${project.name}" (id=${project.id}) with ${project.files.length} file(s).`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
