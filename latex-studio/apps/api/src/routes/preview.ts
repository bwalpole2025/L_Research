import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * SEMI-COMPILED SNIPPET RENDERER for the Visual editor: compiles ONE equation or
 * TikZ picture through the real TeX engine (standalone/preview class + the
 * project's own macros and tikz libraries) and rasterises it to PNG via
 * mathcheck/PyMuPDF. Results are cached on disk by content hash, so each snippet
 * compiles once; subsequent loads are instant.
 */

const renderBody = z.object({
  latex: z.string().min(1).max(20_000),
  kind: z.enum(['tikz', 'math']),
  /** Maths only: typeset inline ($…$) rather than display — for prose chips. */
  inline: z.boolean().optional(),
  /** TikZ only: extra preamble packages/libraries the snippet needs (template
   *  objects: pgfplots surfaces, tikz-3dplot frames, decoration paths). Both
   *  are filtered through server-side whitelists — never client-trusted. */
  packages: z.array(z.string()).max(8).optional(),
  tikzLibraries: z.array(z.string()).max(12).optional(),
  /** Opaque cache discriminator: the SAME TikZ may \input generated artefacts
   *  (GNUplot PDFs) that change on disk without the TikZ text changing, which
   *  would otherwise serve a stale cached PNG. The client passes a fingerprint
   *  of those artefacts so a regenerated plot recompiles. */
  variant: z.string().max(400).optional(),
});

/** Heavyweight-but-safe extras a TikZ snippet may request (template previews). */
const SNIPPET_EXTRA_PKGS = new Set(['pgfplots', 'tikz-3dplot']);
const SNIPPET_TIKZ_LIBS = new Set([
  'decorations.pathmorphing', 'decorations.pathreplacing', 'decorations.markings',
  'fillbetween', // pgfplots library — see PGFPLOTS_TIKZ_LIBS
  'calc', 'patterns', 'angles', 'quotes', '3d', 'shapes.geometric',
]);
/** Must load via \usepgfplotslibrary — the \usetikzlibrary form half-loads
 *  (fill between's addplot handler stays undefined). Mirrors the web set in
 *  lib/diagram/templates/types.ts. */
const PGFPLOTS_TIKZ_LIBS = new Set(['fillbetween']);

const memCache = new Map<string, { pngBase64: string; width: number; height: number }>();

function sha(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

/**
 * Preamble pieces harvested from the project. Macro definitions are copied
 * VERBATIM (argument specs like [2] and #1 bodies preserved exactly) — the only
 * transforms are \newcommand/\renewcommand → \providecommand so a clash with a
 * package can never abort the snippet. Reconstruction from a parsed table is
 * exactly what broke argumented macros before; never do that.
 */
const MACRO_LINE_RE = /^\s*\\(?:newcommand\*?|renewcommand\*?|providecommand\*?|DeclareMathOperator\*?|def\\[a-zA-Z]+)\b/;

/** Maths-relevant packages a snippet may safely load (no layout/driver side
 *  effects under the standalone/preview class). */
const SNIPPET_PKG_WHITELIST = new Set([
  'amsmath', 'amssymb', 'amsthm', 'amsfonts', 'bm', 'mathtools', 'stmaryrd', 'siunitx',
  'physics', 'cancel', 'accents', 'esint', 'dsfont', 'mathrsfs', 'upgreek', 'gensymb',
  'nicefrac', 'xfrac', 'braket', 'slashed', 'tensor',
]);

export function harvest(files: Array<{ path: string; content: string }>, projectMacros: Record<string, string>) {
  const defMap = new Map<string, string>();
  const seen = new Set<string>();
  // Packages the document loads that a snippet can load too: whitelisted maths
  // packages, plus the project's OWN .sty files (the snippet compiles inside
  // the project workspace, so \usepackage{rjwmath} just works and brings every
  // macro with it — far more robust than re-extracting definitions).
  const localSty = new Set(files.filter((f) => f.path.toLowerCase().endsWith('.sty')).map((f) => f.path.replace(/\.sty$/i, '')));
  const pkgs: string[] = [];
  const pkgSeen = new Set<string>(['amsmath', 'amssymb', 'bm']); // already in the base preamble
  for (const f of files) {
    if (!/\.tex$/i.test(f.path)) continue;
    for (const m of f.content.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g)) {
      for (const raw of (m[1] ?? '').split(',')) {
        const name = raw.trim();
        if (!name || pkgSeen.has(name)) continue;
        if (SNIPPET_PKG_WHITELIST.has(name) || localSty.has(name)) {
          pkgSeen.add(name);
          pkgs.push(name);
        }
      }
    }
  }
  for (const f of files) {
    if (!/\.(tex|sty|cls)$/i.test(f.path)) continue;
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const first = lines[i]!.trim();
      if (!MACRO_LINE_RE.test(first)) continue;
      // Accumulate a possibly multi-line definition until braces balance
      // (e.g. \newcommand{\RomanNumeralCaps}[1] ⏎ {\MakeUppercase{...}}).
      let def = first;
      let depth = braceDepth(first);
      let consumed = 0;
      while ((depth !== 0 || !/\}\s*%?\s*$/.test(def)) && consumed < 4 && i + consumed + 1 < lines.length) {
        consumed += 1;
        const next = lines[i + consumed]!.trim();
        def += ` ${next}`;
        depth += braceDepth(next);
        if (def.length > 600) break;
      }
      if (depth !== 0) continue; // never completed — skip rather than emit junk
      // Class-internal or fragile constructs have no place in a snippet preamble.
      if (def.includes('@') || def.includes('##')) continue;
      if (/\\def\\[a-zA-Z]+\s*[^{]/.test(def)) continue; // \def with params/delimiters
      const name = /\\(?:(?:newcommand|renewcommand|providecommand)\*?\s*\{?\\([a-zA-Z]+)|DeclareMathOperator\*?\s*\{\\([a-zA-Z]+)|def\\([a-zA-Z]+))/.exec(def);
      const macroName = name?.[1] ?? name?.[2] ?? name?.[3];
      if (!macroName || seen.has(macroName)) {
        i += consumed;
        continue;
      }
      seen.add(macroName);
      defMap.set(
        macroName,
        def
          .replace(/\\renewcommand\*?/g, '\\providecommand')
          .replace(/\\newcommand\*?(?!ed)/g, '\\providecommand')
          .replace(/^\\def\\([a-zA-Z]+)\s*\{/, '\\providecommand{\\$1}{'),
      );
      i += consumed;
    }
  }
  // The Settings macro table too (string bodies; arity inferred from #n).
  for (const [k, body] of Object.entries(projectMacros)) {
    const name = k.replace(/^\\/, '');
    if (!name || seen.has(name) || !body.trim()) continue;
    seen.add(name);
    const arity = Math.max(0, ...[...body.matchAll(/#(\d)/g)].map((m) => Number(m[1])));
    defMap.set(name, `\\providecommand{\\${name}}${arity > 0 ? `[${arity}]` : ''}{${body}}`);
  }
  const libs = new Set<string>();
  for (const f of files) {
    for (const m of f.content.matchAll(/\\usetikzlibrary\s*\{([^}]*)\}/g)) {
      for (const lib of (m[1] ?? '').split(',')) if (lib.trim()) libs.add(lib.trim());
    }
  }
  return { defMap, tikzLibs: [...libs], pkgs };
}

/** ONLY the macro definitions the snippet actually uses (resolved transitively —
 *  \pp may expand to \p). Class-layout internals never reach the preamble. */
export function neededDefs(latex: string, defMap: Map<string, string>): string {
  const needed = new Map<string, string>();
  let frontier = [...latex.matchAll(/\\([a-zA-Z]+)/g)].map((m) => m[1]!);
  for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const name of frontier) {
      if (needed.has(name)) continue;
      const def = defMap.get(name);
      if (!def) continue;
      needed.set(name, def);
      for (const m of def.matchAll(/\\([a-zA-Z]+)/g)) next.push(m[1]!);
    }
    frontier = next;
  }
  return [...needed.values()].join('\n');
}

/** Width/height from a PNG's IHDR chunk (bytes 16–23) — the disk cache must
 *  report REAL dimensions; the client sizes inline chips from them, and a 0
 *  height collapses the image to its minimum size. */
function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24) return { width: 0, height: 0 };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function braceDepth(line: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === '{') d += 1;
    else if (ch === '}') d -= 1;
  }
  return d;
}

function snippetDoc(kind: 'tikz' | 'math', latex: string, macroDefs: string, tikzLibs: string[], inline = false, pkgs: string[] = [], extraPkgs: string[] = [], plotLibs: string[] = []): string {
  const pkgLines = pkgs.map((p) => `\\usepackage{${p}}`).join('\n');
  if (kind === 'tikz') {
    return [
      '\\documentclass[tikz,border=4pt]{standalone}',
      '\\usepackage{amsmath,amssymb}',
      pkgLines,
      // Extra packages BEFORE the libraries: pgfplots libraries only exist
      // once pgfplots is loaded.
      ...extraPkgs.map((p) => `\\usepackage{${p}}${p === 'pgfplots' ? '\n\\pgfplotsset{compat=newest}' : ''}`),
      tikzLibs.length ? `\\usetikzlibrary{${tikzLibs.join(',')}}` : '',
      plotLibs.length ? `\\usepgfplotslibrary{${plotLibs.join(',')}}` : '',
      macroDefs,
      '\\begin{document}',
      latex,
      '\\end{document}',
    ]
      .filter(Boolean)
      .join('\n');
  }
  // Maths: preview-class page cropped to the formula. Labels are meaningless in a
  // standalone snippet and send latexmk into a rerun loop, so they're stripped.
  // DISPLAY maths is typeset as $\displaystyle …$ (aligned for & rows), NOT as a
  // display environment: \[…\] occupies the FULL line width, so the PNG would be
  // mostly centring whitespace and the client could not size the glyphs to the
  // text. A content-tight box keeps display-style glyphs at a knowable scale.
  //
  // EXCEPTION — equation TAGS. `\tag`/`\intertext` are amsmath display-only:
  // illegal inside `aligned` or inline `$…$` ("\tag not allowed here"). A tagged
  // equation therefore needs a REAL numbered environment. align* supports \tag,
  // &, \\ and adds no spurious numbers on untagged rows; it does span the line
  // width, but that is exactly how a numbered equation reads in the document.
  const cleaned = latex.replace(/\\label\s*\{[^}]*\}/g, '').replace(/\\(?:nonumber|notag)\b/g, '');
  const needsDisplayEnv = /\\(?:tag\*?|intertext)\b/.test(cleaned);
  const body = inline
    ? `$${cleaned}$`
    : needsDisplayEnv
      ? `\\begin{align*}\n${cleaned}\n\\end{align*}`
      : /\\\\|&/.test(cleaned)
        ? `$\\displaystyle\\begin{aligned}\n${cleaned}\n\\end{aligned}$`
        : `$\\displaystyle ${cleaned}$`;
  // Near-zero border: the PNG is just the glyphs, so the client can size it
  // 1:1 with the surrounding text.
  return [
    '\\documentclass[preview,border=0.5pt]{standalone}',
    '\\usepackage{amsmath,amssymb,bm}',
    pkgLines,
    // Journal math alphabets (\\DeclareMathAlphabet in classes) — approximate.
    '\\providecommand\\mathsfbi[1]{\\boldsymbol{\\mathsf{#1}}}',
    '\\providecommand\\mathsfi[1]{\\mathsf{#1}}',
    macroDefs,
    '\\begin{document}',
    body,
    '\\end{document}',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function previewRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/projects/:id/render-snippet', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = renderBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    const files = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      select: { path: true, content: true, encoding: true },
    });
    const textFiles = files.filter((f) => f.encoding !== 'base64').map((f) => ({ path: f.path, content: f.content }));
    // Staging input. A TikZ snippet may \includegraphics a generated artefact —
    // most importantly a GNUplot cairolatex .pdf (stored base64) whose .tex
    // overlay the snippet \input: if the .pdf is not on disk the \includegraphics
    // aborts the compile, so the plot's axes and labels never render. So for
    // TikZ we stage BINARY files too; maths chips never reference them, so they
    // keep staging only text (no extra IO per chip). Harvesting uses textFiles.
    const stageInput =
      parsed.data.kind === 'tikz'
        ? files.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding as 'utf8' | 'base64' }))
        : textFiles.map((f) => ({ ...f, encoding: 'utf8' as const }));
    const { defMap, tikzLibs, pkgs } = harvest(textFiles, (project.macros as Record<string, string> | null) ?? {});
    const macroDefs = neededDefs(parsed.data.latex, defMap);

    const extraPkgs = (parsed.data.packages ?? []).filter((p) => SNIPPET_EXTRA_PKGS.has(p));
    const requested = (parsed.data.tikzLibraries ?? []).filter((l) => SNIPPET_TIKZ_LIBS.has(l));
    const plotLibs = requested.filter((l) => PGFPLOTS_TIKZ_LIBS.has(l));
    const allLibs = [...new Set([...tikzLibs, ...requested.filter((l) => !PGFPLOTS_TIKZ_LIBS.has(l))])];

    const doc = snippetDoc(parsed.data.kind, parsed.data.latex, macroDefs, allLibs, parsed.data.inline ?? false, pkgs, extraPkgs, plotLibs);
    // The variant discriminates otherwise-identical docs whose \input artefacts
    // (GNUplot PDFs) changed on disk — without it a restyled plot serves a stale
    // cached image.
    const hash = `snip${sha(doc + (parsed.data.variant ?? ''))}`;

    const hit = memCache.get(hash);
    if (hit) return { ...hit, cached: true };

    const pngPath = join(app.compileService.projectDir(project.id), '.preview', `${hash}.png`);
    try {
      const png = await readFile(pngPath);
      const result = { pngBase64: png.toString('base64'), ...pngSize(png) };
      memCache.set(hash, result);
      return { ...result, cached: true };
    } catch {
      /* not cached on disk */
    }

    // Compile the standalone snippet inside the project workspace (own basename →
    // no clash with the document's artifacts), then rasterise via mathcheck.
    // The project's files are staged first: the snippet preamble loads the
    // project's own .sty packages, and \input/\includegraphics targets (e.g. a
    // GNUplot cairolatex .tex + .pdf pair) must exist on disk.
    await app.compileService.stageFiles(project.id, stageInput);
    await app.compileService.writeSnippet(project.id, `${hash}.tex`, doc);
    const compiled = await app.compileService.compileSnippet(project.id, `${hash}.tex`);
    // A non-zero exit with only warnings (rerun-for-labels etc.) still produces a
    // good PDF — accept it. A FATAL TeX error ("! …") means the PDF is junk even
    // if nonstop mode emitted one — reject it.
    // -file-line-error prints errors as "./x.tex:N: …" (no leading "! ").
    const fatal =
      /(^|\n)!\s/.test(compiled.logTail) ||
      /(^|\n)[^\n]*\.tex:\d+:\s/.test(compiled.logTail) ||
      /Emergency stop|Fatal error/i.test(compiled.logTail);
    if (!compiled.ok && fatal) {
      return reply.code(422).send({ error: 'snippet failed to compile', log: compiled.logTail.slice(-1500) });
    }
    let pdf: Buffer;
    try {
      pdf = await readFile(app.compileService.pdfPath(project.id, `${hash}.tex`));
    } catch {
      return reply.code(422).send({ error: 'snippet failed to compile', log: compiled.logTail.slice(-1500) });
    }
    let res: Response;
    try {
      res = await fetch(`${app.config.mathcheckUrl}/pdf-png`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pdf_base64: pdf.toString('base64'), dpi: 180 }),
      });
    } catch {
      return reply.code(502).send({ error: 'rasteriser unavailable' });
    }
    const data = (await res.json()) as { png_base64?: string; width?: number; height?: number; error?: string };
    if (!data.png_base64) return reply.code(502).send({ error: data.error ?? 'rasterise failed' });

    await mkdir(dirname(pngPath), { recursive: true }).catch(() => undefined);
    await writeFile(pngPath, Buffer.from(data.png_base64, 'base64')).catch(() => undefined);
    const result = { pngBase64: data.png_base64, width: data.width ?? 0, height: data.height ?? 0 };
    memCache.set(hash, result);
    return { ...result, cached: false };
  });
}
