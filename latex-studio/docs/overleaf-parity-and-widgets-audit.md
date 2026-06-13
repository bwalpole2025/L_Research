# Overleaf parity, differentiating widgets & referencing — audit + recommendations

**Scope:** recommend concrete, file-referenced modifications so `latex-studio` (1) matches
Overleaf's core editing experience, (2) leans on its differentiating widgets (a Math
Diagram Editor + a general Diagram Editor), and (3) gains a proper referencing / filing
system — while staying self-hostable and privacy-preserving.

**This pass implements nothing.** It only creates this report.

**Two assumptions in the brief are wrong, and that's good news:**
- The brief asks whether to *migrate* the editor to CodeMirror 6 — **it is already CM6**
  (`apps/web/components/editor/CodeEditor.tsx`). No migration is needed.
- The brief says "I already use Mafs" and asks to assess Mafs/tldraw as surfaces — **neither
  Mafs nor tldraw is a dependency.** The math-diagram surface is a **custom SVG canvas**
  (`apps/web/components/diagram/TikzDiagramEditor.tsx`) and the general-diagram surface is
  **Excalidraw** (`@excalidraw/excalidraw`). Recommendations below build on what's actually
  there.

**Net finding:** Section A (parity) is ~95% done; Section B (widgets) already exists with a
working **JSON-spec → LaTeX round-trip** for the TikZ editor; Section C (referencing) has a
real subsystem but several genuine gaps (citation-js, ISBN, **encryption-at-rest for
attachments**, per-entry-type forms, tags, `.bib` export). **No TeX Live package is
missing** — the image is `texlive/texlive:latest-full`.

---

## PHASE 0 — INVENTORY (what's actually there)

| Area | Finding | Evidence |
|---|---|---|
| Frontend | Next.js 14 (App Router), React 18, Tailwind, Zustand | `apps/web/package.json`, `apps/web/app/*` |
| Editor | **CodeMirror 6** (`@codemirror/{state,view,language,autocomplete,search,lint,commands,legacy-modes,language}@^6.x`) | `apps/web/components/editor/CodeEditor.tsx` |
| LaTeX highlighting | Legacy **`stex` stream** mode (not a Lezer grammar) | `apps/web/components/editor/latex.ts` (`StreamLanguage.define(stex)`) |
| Compile pipeline | `api` stages project files to a host bind-mount workspace, then **`docker exec` latexmk** in the persistent `texlive` container; PDF/log read back from the shared dir | `apps/api/src/compile/runner.ts`, `apps/api/src/compile/service.ts`, `apps/api/src/routes/compile.ts` |
| PDF preview | **pdfjs-dist `^4.6.82`** — continuous scroll, zoom 0.3–4×, page nav, fit, download, colour modes | `apps/web/components/PdfViewer.tsx` |
| Data model | Multi-file: `Project.rootFile` (main file), `TexFile{path,content,version}`; `Snapshot{files:Json}` history; `Folder{tree: source\|literature}`; `LiteratureItem`, `LibraryChunk(vector(384))`, `Credential` (vault) | `apps/api/prisma/schema.prisma` |
| `\input`/`\include` | Autocomplete of target paths only; compile stages all files and lets latexmk resolve; **no preprocessor / outline resolution** | `apps/web/components/editor/latexAutocomplete.ts`, `apps/api/src/compile/*` |
| `.bib` / citations | Custom regex BibTeX parser; `\cite` autocomplete from project `.bib`; `/references` picker; library subsystem with arXiv/Crossref/Zotero/Semantic-Scholar sources | `apps/api/src/coderive/bib.ts`, `apps/api/src/routes/library.ts`, `apps/api/src/literature/sources/*`, `apps/web/components/library/LibraryPanel.tsx`, `apps/web/app/references/page.tsx` |
| TeX distribution | **`texlive/texlive:latest-full`** (scheme-full) | `docker-compose.yml` (`texlive:` service) |
| Sandbox (dev) | `texlive` dev service is **root, on the default network, uncapped** (kernel isolation only) | `docker-compose.yml` |
| Sandbox (prod) | `texlive` is hardened in the prod override (`network_mode: none`, non-root, cpu/mem/pids caps); `pyrun` runs `docker run --rm --network none --user 1000 --cpus/--memory/--pids-limit` (+ optional gVisor `--runtime`) | `docker-compose.prod.yml`, `apps/api/src/run/runner.ts` |

**Component / route map (editing · compiling · files · refs):**
- Shell: `EditorApp.tsx` (PanelGroup) → `EditorPane.tsx` (`CodeEditor`/`VisualView`) · `PdfViewer.tsx` · `BottomPanelTabs.tsx` (`DiagnosticsPanel`, `OutlinePanel`, `ReviewPanel`, `PythonOutputPanel`, library).
- Editor extensions: `editor/{latex,latexAutocomplete,latexData,latexFold,latexIndex,inlineSuggest,mathPreview,mathGutter,diagnosticsLint}.ts`.
- Compile/SyncTeX API: `routes/compile.ts` (`POST /projects/:id/compile`, `/synctex/forward`, `/synctex/inverse`), `compile/{runner,service,synctexParser}.ts`.
- Files API: `routes/files.ts`, `routes/snapshots.ts`, `lib/store.ts` (autosave/compile scheduling).
- Refs API: `routes/library.ts`, `routes/connectors.ts`, `literature/sources/*`, `literature/storage.ts`, `rag/indexer.ts`.
- Widgets: `app/diagram/page.tsx` + `components/diagram/DiagramEditor.tsx` (Excalidraw); `app/math-diagram/page.tsx` + `components/diagram/TikzDiagramEditor.tsx` + `lib/diagram/{model,tikz,templates/*}.ts`; `routes/diagram.ts`, `routes/preview.ts`, `run/gnuplot.ts`.

---

## SECTION A — OVERLEAF PARITY (gap analysis)

Legend: **HAVE** / **PARTIAL** / **MISSING** · effort **S/M/L**.

| # | Capability | Status | Where | Recommendation (library · files · effort) |
|---|---|---|---|---|
| A1 | CM6 editor | **HAVE** | `editor/CodeEditor.tsx` | None — already CM6. (Brief's "migration" is moot.) |
| A2 | LaTeX syntax highlighting | **HAVE** (stex stream) | `editor/latex.ts` | Optional: a Lezer grammar (`@codemirror/lezer`-based `lang-latex`) would give a real syntax tree (better folding/selection). **Low value, M.** Not recommended now. |
| A3 | Bracket + `\begin/\end` matching | **HAVE** | `editor/latex.ts` (`bracketMatching`, `beginEndCloser`) | None. |
| A4 | Snippets | **HAVE** | `editor/latexData.ts`, `latexAutocomplete.ts` (`snippetCompletion`) | None. |
| A5 | Autocomplete: commands / `\begin` / `\cite` (from `.bib`) / `\ref`·`\label` | **HAVE** (3-layer, adaptive ranking) | `editor/latexAutocomplete.ts`, `lib/latexIndex.ts` | None. (Ties into C — `\cite` already sources the project `.bib`.) |
| A6 | Resizable 3-pane (tree · source · PDF), collapsible, persistent | **HAVE** | `EditorApp.tsx` (`PanelGroup`/`PanelResizeHandle`, `autoSaveId`) | None — `react-resizable-panels@^2.0.22`. |
| A7 | PDF.js continuous scroll · zoom · page nav · fit · download | **HAVE** | `PdfViewer.tsx` | None — `pdfjs-dist@^4.6.82`. (Perf note below.) |
| A8 | Explicit Recompile + build-status indicator | **HAVE** | `Toolbar.tsx`, `CompileStatusPill.tsx` | None. |
| A9 | Compile-on-idle (debounced) | **PARTIAL** | `lib/store.ts` (`scheduleCompile`, `COMPILE_ON_SAVE_DELAY=1100`) | It debounces on *save*, not on *idle while typing without save-trigger*. Functionally close. Recommendation: rename/clarify and optionally add a true idle timer; **S**, low value. |
| A10 | Parsed log/errors panel, each error clickable → source line | **HAVE** | `DiagnosticsPanel.tsx` (`jump`→`revealLocation`), `editor/diagnosticsLint.ts` (gutter+squiggles) | None. |
| A11 | SyncTeX forward (source→PDF) | **HAVE** | `PdfViewer.tsx` (Crosshair), `store.locateInPdf`, `routes/compile.ts` `/synctex/forward`, `compile/service.forward` (`synctex view`) | None. |
| A12 | SyncTeX inverse (PDF click→source) | **HAVE** | `PdfViewer.onPageClick` (⌘/Ctrl-click), `store.syncInverseJump`, `/synctex/inverse`, `compile/service.inverse` (`synctex edit`) | None. |
| A13 | Document outline / section navigator | **HAVE** | `components/thesis/OutlinePanel.tsx` (server-parsed, click→reveal) | None. |
| A14 | Find & replace | **HAVE** | `editor/CodeEditor.tsx` (`@codemirror/search`, `searchKeymap`) | None. |
| A15 | **Command palette (in-editor)** | **MISSING** | — (a *project* palette exists: `components/projects/ProjectPalette.tsx`, ⌘K) | Add an in-editor action palette (run compile, toggle auto-compile, insert env/snippet, jump to outline/section, open widget). Reuse the `ProjectPalette` pattern or add `cmdk` (MIT). **Files:** new `components/editor/CommandPalette.tsx` + a keymap entry in `CodeEditor.tsx`. **S–M.** |
| A16 | Multi-file projects + main-file setting | **HAVE** | `schema.prisma` (`Project.rootFile`, `TexFile.path`), file tree | None. |
| A17 | Autosave | **HAVE** | `lib/store.ts` (`AUTOSAVE_DELAY=800`, `api.updateFile`) | None. |
| A18 | Lightweight version history | **HAVE** | `schema.prisma` `Snapshot`, `routes/snapshots.ts`, `SnapshotsDialog.tsx` | None. |

**Section A verdict:** 16 HAVE · 1 PARTIAL (compile-on-idle nuance) · 1 MISSING (in-editor
command palette). The single concrete gap is **A15**. Everything else is at or beyond parity
(AI ghost-text, predict-block, math-preview, code folding, math gutter **exceed** Overleaf).

---

## SECTION B — DIFFERENTIATING WIDGETS

### B0 — Architecture (the round-trip requirement)

**Status: PARTIAL — the spec-as-source-of-truth round-trip already exists for the TikZ
editor, but not as a unified "widgets side panel," and Excalidraw exports raster only.**

What exists today (the good part):
- The TikZ editor's source of truth is a **structured JSON spec** persisted as a project
  file: `<name>.diagram.json` (`lib/diagram/model.ts` — `DiagramScene` discriminated union:
  rect/ellipse/polygon/line/path/node/edge/text/raw-tikz/plot/template). It **regenerates
  LaTeX on every edit** via `sceneToTikz()` (`lib/diagram/tikz.ts`) and writes `.tikz` +
  a frozen `.pdf`/preview `.png`. Re-opening the `.diagram.json` re-loads the editable
  scene. **This is exactly the design the brief asks for.**
- Excalidraw scenes persist as `diagrams/diagram.excalidraw` (re-editable scene JSON) but
  **export only a raster `figures/diagram.png`** — no LaTeX/vector spec→source path.
- `.tikz`, `.excalidraw`, `.json`, `.diagram.json` are allow-listed text file kinds
  (`apps/web/lib/fileKind.ts`, `apps/api/src/lib/paths.ts`).

Recommendations:
- **B0a — Unify the surfaces into a "widgets" panel/launcher** and standardise the spec
  convention (sidecar `*.diagram.json` is already the de-facto standard; keep it). Document
  insert-at-cursor = `\input{diagrams/<name>.tikz}` (or `\includegraphics` for raster) +
  reopen = open the sidecar. **Files:** a small `components/widgets/WidgetsPanel.tsx`
  surfacing the existing `/math-diagram` and `/diagram` editors + an "insert reference"
  action wired through `lib/store.ts`. **M.** (No new dep.)
- **B0b — LaTeX-injection safety in emitters:** `sceneToTikz()` interpolates user
  label/colour/coordinate values into TikZ. Audit it (and the `raw-tikz` passthrough) for
  escaping of `{}\%$&#^_~` and reject control sequences in non-raw fields, so a label can't
  break out of the picture into the compile. The `raw-tikz` element is intentionally opaque
  — keep it, but it only ever runs inside the **sandboxed** texlive (no relaxation needed).
  **Files:** `lib/diagram/tikz.ts`, `routes/diagram.ts` (validate). **S.**

### B1 — Math Diagram Editor (plots / geometry / commutative diagrams)

**Status: HAVE for plots & geometry; PARTIAL for commutative diagrams.**

- **Plots — HAVE.** `PlotElement` (`lib/diagram/model.ts`) compiles via gnuplot's
  **`cairolatex pdf`** terminal in the sandbox (`apps/api/src/run/gnuplot.ts`) — curves in
  PDF, labels typeset by the document; pgfplots templates also exist
  (`lib/diagram/templates/*`). The brief's "Mafs as the interactive surface" is **not** how
  it's built (no Mafs dep) — it's a custom SVG canvas + KaTeX label preview. Recommendation:
  none required; **optionally** adopt Mafs (`mafs`, MIT) for a nicer interactive plotting
  surface, but it's additive and not necessary. **L, low priority.**
- **Geometry — HAVE.** Node/edge/shape tools emit clean TikZ (`sceneToTikz`), preamble
  auto-patching detects missing `\usepackage`/`\usetikzlibrary` and offers the lines.
- **Commutative diagrams (tikz-cd) — PARTIAL (the real wedge).** A template object exists
  but there is **no quiver-style grid editor**; users drop to raw TikZ. **Recommendation:**
  build a dedicated commutative-diagram mode — a grid of objects + arrows with labels/curve/
  style — that serializes to a new `DiagramScene` element and a **tikz-cd emitter**
  (`\begin{tikzcd} … \end{tikzcd}`). Model it on **quiver** (q.uiver.app, MIT) — study its
  data model (objects on a lattice, arrows as (source,target,label,style)); no dependency,
  reimplement the model. **Files:** `lib/diagram/model.ts` (+`CommDiagramElement`),
  `lib/diagram/tikz.ts` (tikz-cd emitter), a `components/diagram/CommDiagramEditor.tsx`, and
  `lib/diagram/templates/catalog.tsx`. **M–L.** Highest differentiating value.

### B2 — General Diagram Editor (figures / flowcharts / blocks)

**Status: PARTIAL.** Excalidraw canvas is **HAVE**; export today is **PNG via
`\includegraphics`** (HAVE), but there is **no TikZ export and no SVG-vector path**, and the
scene round-trips as Excalidraw JSON rather than a LaTeX-spec.

Recommendation — **keep the raster path as the robust default, add SVG (not TikZ):**
- **Excalidraw → TikZ is brittle** (arbitrary freehand/handles don't map cleanly to TikZ);
  do **not** build it.
- The robust upgrade is **vector SVG**: `exportToSvg()` (already in `@excalidraw/excalidraw`)
  → embed with `\includesvg` (the `svg` package) **or** pre-rasterise/convert. ⚠️
  `\includesvg` shells out to **Inkscape** at compile time, which the sandbox forbids
  (`network_mode: none`, non-root, no extra binaries) — so **don't** use `\includesvg`.
  Instead convert SVG→PDF **in the `api`/pyrun sandbox** (e.g. `cairosvg`, already feasible
  alongside the matplotlib stack) and embed the PDF with `\includegraphics` — vector, no
  Inkscape, no isolation relaxation. **Files:** `components/diagram/DiagramEditor.tsx`
  (add SVG export + sidecar `.excalidraw` as the editable spec), an `api` conversion step
  near `run/gnuplot.ts`. **M.** Net: scenes stay re-editable (Excalidraw JSON), output
  becomes crisp vector.

### B3 — Compile compatibility / TeX Live packages

**Every package the widgets need is present in `texlive/texlive:latest-full` — NO image
rebuild required.**

| Widget output | Needs | In `latest-full`? |
|---|---|---|
| TikZ geometry | `tikz` (`pgf`) | ✅ |
| Plots | `pgfplots`, `tikz` | ✅ |
| 3D templates | `tikz-3dplot` | ✅ |
| Commutative diagrams (recommended) | `tikz-cd` | ✅ |
| Standalone diagram PDFs | `standalone` | ✅ |
| gnuplot overlay | `pgfplots` + the doc's fonts (cairolatex) | ✅ |
| Bibliography (Section C) | `biblatex`, `biber`, `natbib` | ✅ |

The `api` already whitelists `pgfplots`/`tikz-3dplot` for diagram + snippet rendering
(`routes/diagram.ts`, `routes/preview.ts`). **Confirmed:** generated LaTeX compiles inside
the existing hardened sandbox — diagrams need **no network**, so they are fully compatible
with the prod `texlive` (`network_mode: none`, non-root, capped). **No widget requires
relaxing isolation.** (Caveat: the *dev* `docker-compose.yml` texlive is unhardened root/
networked — out of scope here, but noted; the prod override is the secure baseline.)

### B4 — Client-side preview (no full recompile)

**Status: HAVE.** KaTeX renders math labels live (`editor/mathPreview.ts`,
`TikzDiagramEditor` labels); the canvas previews the diagram itself; the server snippet
renderer (`routes/preview.ts` → `/render-snippet`, hash-cached) gives true-TeX thumbnails.
None required.

**Section B verdict:** 2 HAVE (texlive compat, preview) · 3 PARTIAL (unified architecture,
commutative diagrams, general-diagram vector export) · 0 MISSING at the group level. The
spec→LaTeX round-trip the brief specifies **already exists** for the TikZ editor; the wedge
work is the **tikz-cd commutative-diagram editor (B1)** and **vector export for Excalidraw
(B2)**.

---

## SECTION C — REFERENCING / FILING SYSTEM

| # | Capability | Status | Where | Recommendation (library · files · effort) |
|---|---|---|---|---|
| C1 | Bibliography manager panel | **HAVE** | `components/library/LibraryPanel.tsx` (folder tree + item editor) | None for the panel itself. |
| C2 | Per-entry-type field form (@article/@book/@inproceedings…) | **MISSING** | `LibraryPanel.tsx` (generic title/authors/year/doi/abstract only) | Add entry-type-aware field schemas. Drive them from **citation-js** field defs (see C3). **Files:** `LibraryPanel.tsx`, a new `lib/bib/entryTypes.ts`. **M.** |
| C3 | Parse/format BibTeX **+ BibLaTeX/biber** robustly | **PARTIAL** (custom regex parser) | `apps/api/src/coderive/bib.ts` | Replace the regex with **citation-js** (`@citation-js/core` + `@citation-js/plugin-bibtex`, MIT) for correct parsing/formatting, dedup, key generation, and BibLaTeX. Run it in `api` (keep web bundle lean). **Files:** new `apps/api/src/bib/citation.ts`, refactor callers in `routes/library.ts`, keep `coderive/bib.ts`'s thin needs. **M.** |
| C4 | Import: **DOI → BibTeX** (Crossref) | **HAVE** | `literature/sources/crossref.ts` (`api.crossref.org`, content-negotiation) | None. (Egress note below.) |
| C5 | Import: **arXiv → BibTeX** (+ PDF) | **HAVE** | `literature/sources/arxiv.ts` (`export.arxiv.org`) | None. |
| C6 | Import: **ISBN → BibTeX** | **MISSING** | — | Add an ISBN source (Open Library `openlibrary.org` or Google Books — no key, no dep) following the existing `LiteratureSource` interface. **Files:** `literature/sources/isbn.ts`, register in `literature/sources/index.ts`, `connectors/manifest.ts`. **S.** |
| C7 | `\cite` autocomplete from project `.bib` | **HAVE** | `editor/latexAutocomplete.ts` + `lib/latexIndex.ts` (`indexedBib`) | None. |
| C8 | Citation-picker UI | **HAVE** | `app/references/page.tsx` (cross-project, copy `\cite{}`) | Optional: an in-editor inline picker (ties to A15 palette). **S.** |
| C9 | Reference library w/ PDF attachments, searchable by author/title/year | **HAVE** | `schema.prisma` `LiteratureItem` + `LibraryChunk`, `routes/library.ts` (`/search` full-text + RAG), `literature/storage.ts` | None for search. (See C10/C11 for gaps.) |
| C10 | Search by **tag** | **MISSING** | — | Add `tags String[]` to `LiteratureItem`, filter in `/library/search`, chips in `LibraryPanel`. **Files:** `schema.prisma`, `routes/library.ts`, `LibraryPanel.tsx`. **S–M.** |
| C11 | **Attachments encrypted at rest** | **MISSING** | `literature/storage.ts` writes PDFs **plaintext** to `<workspace>/<project>/literature/*.pdf`; `apps/api/src/content/crypto.ts` (AES-256-GCM, per-project key) exists but is **not** applied to library PDFs | Encrypt attachments at rest with the **existing** `content/crypto.ts` regime (per-project key, vault master key). Decrypt only in `api` when serving/extracting; never log. **Files:** `literature/storage.ts` (wrap read/write), confirm `rag/indexer.ts` extraction reads via the decrypt path. **M.** Closes a stated privacy gap. |
| C12 | Attachments in hard-delete & export | **PARTIAL** | hard-delete **HAVE** (`lib/hardDelete.ts` removes the project dir incl. PDFs); **no standard export** | Add a `.bib`/`.zip` export (project bibliography + attachments). **Files:** new `routes/library-export.ts`, button in `LibraryPanel`. **S–M.** Ensure encrypted attachments are decrypted into the export (C11 dependency). |
| C13 | Zotero / Better BibTeX opt-in sync | **PARTIAL** | Zotero source **HAVE** (`literature/sources/zotero.ts`, API key in the **vault**, per-connector); **no Better BibTeX** | Keep Zotero as opt-in (already vault-keyed). Better BibTeX is a Zotero plugin export format — add an importer that accepts its `.bib`/JSON; **never** a mandatory dependency. **Files:** `literature/sources/zotero.ts` (export-format option) or the C3 importer. **S–M.** |

**Egress (mandatory documentation):** Crossref, arXiv, Semantic Scholar, Zotero (and the
recommended ISBN/Open Library) calls **originate from the `api` service**
(`literature/sources/*`), **not** from the network-isolated `pyrun`/`texlive` sandboxes.
They are **deliberate, allow-listed egress exceptions** to the sandbox network-off
discipline: only an identifier (DOI/arXiv-id/ISBN/query) leaves the box — **no document
content is sent upstream**. Recommendation: codify this as an explicit allow-list
(`crossref.org`, `export.arxiv.org`, `api.semanticscholar.org`, `api.zotero.org`,
`openlibrary.org`) in docs and, optionally, an egress guard in the `api` fetch layer.

**Section C verdict:** 6 HAVE · 4 PARTIAL · 3 MISSING. Real gaps worth doing: **C11
(encrypt attachments)**, **C3 (citation-js)**, **C6 (ISBN)**, C10 (tags), C2 (per-type
forms), C12 (export).

---

## CROSS-CUTTING FINDINGS

**Verification stack (mathcheck) — confirmed untouched.** None of the recommendations
modify, depend on, or relax mathcheck. The editor interacts with it only as a *client*:
math-gutter verdict markers (`editor/mathGutter.ts`), RAG embeddings (`/embed`) and PDF text
extraction (`/extract-pdf`) for the library — all read-only consumers. The widget emitters
and the referencing system add no mathcheck coupling.

**New dependencies (only those the recommendations introduce):**

| Dep | For | License | arm64 | Bundle / placement |
|---|---|---|---|---|
| `@citation-js/core` + `@citation-js/plugin-bibtex` (C3) | robust BibTeX/BibLaTeX | MIT | ✅ pure JS | Run in **`api`** (server-side) — keeps the web bundle untouched |
| `cmdk` (A15, optional) | in-editor command palette | MIT | ✅ pure JS | Small; or reuse existing `ProjectPalette` with **no** new dep |
| `cairosvg` (B2, optional) | Excalidraw SVG→PDF in-sandbox | LGPL/BSD (Python) | ✅ | Inside the `pyrun` image, no host changes |
| `mafs` (B1, optional only) | nicer plot surface | MIT | ✅ pure JS | Web; not required |
| *(none)* quiver model (B1) | tikz-cd editor | — (design ref, MIT) | — | Reimplement; no dep |

Already-present libraries the report relies on are **arm64-proven** (they run today):
`@codemirror/*`, `pdfjs-dist@^4.6.82`, `katex@^0.17.0`, `react-resizable-panels@^2.0.22`,
`@excalidraw/excalidraw@^0.18.1`, `better-auth@^1.6.18`. Deploy targets (Oracle A1 / Hetzner
CAX) are fine — base images `node:20-slim`, `python:3.12-slim`, `texlive/texlive:latest-full`
all ship arm64, and the `api` Dockerfile already fetches the docker CLI for both arches.

**Security surfaces introduced:**
- *External API calls* (C4–C6, C13): identifiers only, allow-listed hosts, from `api`; add
  size/timeout caps and validate identifiers (DOI/arXiv/ISBN regex) before fetch.
- *File uploads* (attachments, SVG): enforce size caps + MIME/type checks (the upload path
  already base64-bounds via the 24 MB body limit) and **encrypt at rest** (C11).
- *Generated-LaTeX injection* (B0b): escape user fields in TikZ emitters; `raw-tikz` stays
  opaque but only ever runs in the **isolated** texlive sandbox.
- No recommendation relaxes the sandbox (`network_mode: none`, non-root, caps).

**Self-host / privacy:** every recommendation runs on a single self-hosted box with **no
mandatory third-party service**. Crossref/arXiv/ISBN/Zotero are *opt-in* enrichment; the app
is fully functional offline (manual `.bib`, uploaded PDFs, all widgets compile locally).

**Performance watch-items:**
- `PdfViewer` renders pages on a continuous canvas stack — large PDFs (100+ pp) can be heavy;
  consider virtualised page rendering if big documents appear (`PdfViewer.tsx`).
- `\cite` autocomplete indexes `.bib` in the background (`lib/latexIndex.ts`) — fine, but a
  very large shared `.bib` (10k+ entries) should stay server-indexed; keep the existing
  async refresh.
- Excalidraw scenes with thousands of elements + the SVG→PDF step (B2) should be size-capped.
- citation-js parsing of huge `.bib` should run in `api`, not the browser (C3 placement).

---

## PRIORITISED BUILD ORDER (quick wins first)

1. **C11 — Encrypt library PDF attachments at rest** (reuse `content/crypto.ts`). Real
   privacy gap, vault pattern already exists. **M, high value.**
2. **A15 — In-editor command palette.** The only Section A gap; reuses `ProjectPalette`. **S.**
3. **C6 — ISBN → BibTeX source.** Drop-in to the existing `LiteratureSource` pattern. **S.**
4. **C3 — Adopt citation-js** for parse/format/BibLaTeX (replaces the regex parser); unblocks
   **C2 (per-entry-type forms)** and **C12 (export)**. **M.**
5. **B1 — Commutative-diagram (tikz-cd) editor** — the strongest differentiator vs Overleaf;
   builds on the existing `.diagram.json` spec + a new tikz-cd emitter. **M–L.**
6. **C10 — Tags** on library items (search facet). **S–M.**
7. **B2 — Excalidraw vector (SVG→PDF) export** in-sandbox. **M.**
8. **C12 — `.bib`/`.zip` library export** (depends on C3/C11). **S–M.**
9. **B0a — Unified "widgets" panel/launcher** + documented insert/reopen convention. **M.**
10. *(optional, low priority)* A2 Lezer LaTeX grammar; B1 Mafs plotting surface; A9 true
    idle-compile timer.

## FOLLOW-UP IMPLEMENTATION PROMPTS (titles only — request individually)

1. **"Encrypt library attachments at rest via the existing AES content vault"** (C11)
2. **"Add an in-editor command palette to the CodeMirror editor"** (A15)
3. **"Add ISBN → BibTeX import as an allow-listed `api` literature source"** (C6)
4. **"Replace the regex BibTeX parser with citation-js (parse/format/BibLaTeX) in the api"** (C3)
5. **"Add per-entry-type bibliography field forms driven by citation-js"** (C2)
6. **"Build a tikz-cd commutative-diagram editor on the existing diagram-spec round-trip"** (B1)
7. **"Add tags to library items + tag-faceted search"** (C10)
8. **"Add vector (SVG→PDF, in-sandbox) export to the Excalidraw diagram editor"** (B2)
9. **"Add `.bib`/`.zip` library export including decrypted attachments"** (C12)
10. **"Introduce a unified widgets panel + documented insert/reopen spec convention"** (B0a)
11. **"Harden TikZ emitters against LaTeX injection from user fields"** (B0b)
12. **"Document + enforce the literature egress allow-list"** (cross-cutting)

---

## ACCEPTANCE SELF-CHECK

- Report exists at `docs/overleaf-parity-and-widgets-audit.md`, grouped A/B/C, with the
  Phase 0 inventory, per-item HAVE/PARTIAL/MISSING, library + files + effort per gap, the
  TeX Live package list (**none missing**), cross-cutting findings, a prioritised build
  order, and titled follow-up prompts. ✅
- Every recommendation cites real files and a named library with license + arm64 note. ✅
- Section B specifies the editable-spec round-trip (the existing `*.diagram.json` →
  `sceneToTikz` model) and the exact TeX packages (all in `latest-full`). ✅
- Section C specifies the egress exceptions (api-only, identifiers-only, allow-listed) and
  the encrypted-attachment storage recommendation (reuse `content/crypto.ts`). ✅
- Verification stack (mathcheck) confirmed untouched; **nothing was implemented.** ✅
