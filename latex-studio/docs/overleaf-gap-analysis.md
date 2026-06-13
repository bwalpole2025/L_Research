# Overleaf gap analysis — LaTeX Studio

> Read-only audit. Compares the current app to Overleaf, classifies each
> capability area, and gives prioritised recommendations. Every current-state
> claim cites a real file / route / component / test / ADR. **No code, schema,
> config, or test was changed by this audit** — the only new file is this report.
>
> Audit date: against `main` @ `4cd23fc`. Scope: `apps/web`, `apps/api`,
> `services/{mathcheck,pyrun}`, `packages/shared`, `docs/decisions.md` (ADR-001…015).

---

## 1. Executive summary

LaTeX Studio is a **single-user, locally-hosted "personal Overleaf"** that is far
more built than its README implies (the README still says *"scaffolding only … no
editor/compilation/AI features"* — `README.md:8-9` is stale and should be the very
first quick win). The real app has a CodeMirror 6 editor, a real `latexmk`
compile pipeline with bidirectional SyncTeX, a pdf.js viewer, three-tier
diagnostics, projects/files with archive+trash, snapshots, a literature library,
a connectors framework, and a large differentiator stack (SymPy maths
verification, RAG-grounded review, AI co-derivation, predictive maths, embedded
Python, diagram/maths-template tools). Test coverage is substantial: **~36 API
test files, ~21 Playwright e2e specs, ~19 web unit tests.**

**The headline:** the core editing/compiling loop is **Overleaf-grade or close**,
and the maths-verification layer **exceeds Overleaf**. The gaps are concentrated in
a handful of editor conveniences and document-management features that Overleaf
users expect:

- **Editor conveniences:** no code folding, no project-wide (cross-file) search,
  no in-PDF text search, no symbol palette, no Vim/Emacs keymaps.
- **Compilation:** only `pdflatex` (engine not selectable — no XeLaTeX/LuaLaTeX),
  no draft/fast mode, no stop-on-first-error toggle.
- **Document management:** no ZIP import/export, no multi-template/starter gallery,
  no snapshot diff/compare, no document word count.
- **Deferred-but-tracked:** the **source-tree folder migration** (real `folderId`
  + cascading paths) is explicitly deferred in **ADR-010**; source folders today
  are virtual, derived from file paths.

None of these require weakening the differentiators. The recommended path is a
short quick-wins sprint, then PDF/search depth, then finishing the deferred
source-tree migration, then templates/versioning polish.

---

## 2. Feature map (actual state)

Maturity legend: **Tested** (has unit/e2e coverage) · **Present** (shipped, no
dedicated test found) · **Partial** · **Stub/Deferred**.

| Capability area | Exists? | Where (file / route / component) | Maturity |
|---|---|---|---|
| LaTeX syntax highlighting | Yes | `components/editor/latex.ts:15` (`@codemirror/legacy-modes` `stex`), ADR-002 | Tested (`editor.spec.ts`) |
| Python highlighting (embedded) | Yes | `components/editor/python.ts:5` (`@codemirror/lang-python`) | Present |
| Autocomplete (command/context/snippet/macro/pkg) | Yes | `components/editor/latexAutocomplete.ts`, `lib/latexIndex.ts` | Tested (`latexAutocomplete.test.ts`, `autocomplete.spec.ts`) |
| Adaptive/usage-ranked completion | Yes | `lib/usage.ts`, `routes/usage.ts`, ADR-? | Tested (`adaptiveUsage.test.ts`, `adaptive.spec.ts`) |
| Predictive ghost text / multi-line predict | Yes | `editor/inlineSuggest.ts`, `editor/predictBlock.ts`, ADR-006/011 | Tested (`completions.spec.ts`, `predict.spec.ts`) |
| Find & replace (single file) | Yes | `components/editor/CodeEditor.tsx:24,121,183` (`@codemirror/search`) | Present |
| Find & replace across files | **No** | — | Missing |
| Code folding | **No** | — (no `foldGutter`/`codeFolding` in `CodeEditor.tsx`) | Missing |
| Multiple cursors / rect select | Yes | `CodeEditor.tsx:113` (`allowMultipleSelections`), `:117` (`rectangularSelection`) | Present |
| Vim / Emacs keymaps | **No** | only default keymap (`CodeEditor.tsx:181-186`) | Missing |
| Symbol palette (clickable Σ/∫) | **No** | symbols only via autocomplete (`editor/latexData.ts:82-139`) | Missing |
| Bracket match / auto-close / indent | Yes | `CodeEditor.tsx:114-116` | Present |
| Visual / rich-text editing mode | Yes | `components/editor/VisualView.tsx`, `editor/visualBlocks.ts` | Tested (`visual.spec.ts`, `visualEditor.test.ts`) |
| Compilation (latexmk → PDF) | Yes | `compile/runner.ts`, `compile/service.ts`, `routes/compile.ts`, ADR-003 | Tested (`compile.test.ts`, `compileOutcome.test.ts`) |
| Engine selection (Xe/Lua) | **No** | `compile/runner.ts:26` hardcodes `-pdf` (pdflatex) | Missing |
| Draft/fast mode | **No** | fixed `-interaction=nonstopmode` (`runner.ts:26`) | Missing |
| Stop-on-first-error toggle | **No** | always nonstopmode | Missing |
| Auto-compile on save | Yes | `lib/store.ts` `compileOnSave` (debounced, `COMPILE_ON_SAVE_DELAY`) | Present |
| Incremental compile | Partial | latexmk reuses the persistent workspace (`.fls/.fdb`); no draft/clean-build toggle | Partial |
| PDF viewer (pdf.js) | Yes | `components/PdfViewer.tsx:4,74-82` | Tested (`preview.spec.ts`, `pdfDownload.test.ts`) |
| PDF zoom / fit-width / pages / dark | Yes | `PdfViewer.tsx:386-418, 364-382, 21-27` | Present |
| PDF fit-to-page | **No** | only zoom + fit-width | Missing |
| In-PDF text search | **No** | no search box / pdf.js find controller in `PdfViewer.tsx` | Missing |
| SyncTeX forward (source→PDF) | Yes | `routes/compile.ts:122-137`, `compile/synctexParser.ts:29`, `PdfViewer.tsx:265-272` | Tested (`synctexParser.test.ts`) |
| SyncTeX inverse (PDF→source, ⌘-click) | Yes | `routes/compile.ts:140-157`, `PdfViewer.tsx:274-283` | Tested (`synctexParser.test.ts`) |
| Diagnostics: tiers / panel / gutter / raw log | Yes | `compile/severityTable.ts`, `compile/logParser.ts`, `components/DiagnosticsPanel.tsx`, `editor/diagnosticsLint.ts` | Tested (`logParser.test.ts`, `diagnostics.spec.ts`) |
| Deterministic quick-fix (add amsmath) | Yes | `compile/logParser.ts` `deterministicFix`, `DiagnosticsPanel.tsx` `diag-quick-fix` | Tested (`logParser.test.ts`, `quickFix.spec.ts`) |
| PDF problem highlights (orange/yellow/violet) | Yes | `lib/pdfFlags.ts`, `PdfViewer.tsx` | Tested (`pdfFlags.test.ts`, `pdfFlags.spec.ts`) |
| File tree | Yes | `components/FileTree.tsx`, `lib/treeUtils.ts:35` (`buildTree`) | Tested (`treeUtils.test.ts`, `editor.spec.ts`) |
| Project-level folders (Home) | Yes | `routes/projectFolders.ts`, `components/projects/ProjectFolderTree.tsx`, ADR-010 | Tested (`projectFolders.test.ts`) |
| Source-tree folders (real `folderId`) | **Deferred** | virtual from paths only; `files.ts` is path-only; `TexFile.folderId` nullable prep (`schema.prisma:227+`), ADR-010 | Stub/Deferred |
| Drag-drop upload (files + folders) | Yes | `FileTree.tsx:102-123`, `lib/dropUpload.ts:79-96` | Tested (`upload.spec.ts`, `uploadPath.test.ts`) |
| Single-file / project ZIP export | **No** | `routes/files.ts` is per-file CRUD only; PDF download exists | Missing |
| ZIP import | **No** | upload is per-file / folder-walk only | Missing |
| File rename / delete / move | Yes | `FileTree.tsx:315-316`, `routes/files.ts:110-151` (move = path change) | Present |
| Project archive + trash | Yes | `routes/projects.ts` (archive/restore/purge), `app/files/page.tsx` | Tested (`projectLifecycle.test.ts`, `projectLifecycle.spec.ts`) |
| Snapshots (labelled) + restore | Yes | `routes/snapshots.ts`, `components/SnapshotsDialog.tsx` | Tested (`thesis.spec.ts` adjacent; `snapshots` route) |
| Snapshot diff / compare / timeline | **No** | only labelled restore; `ai/DiffReviewDialog.tsx` is for AI edits, not snapshots | Missing |
| References page / cite aggregation | Yes | `app/references/page.tsx:21-60` | Tested (`pages.spec.ts`) |
| Cite-key / `\ref` autocomplete | Yes | `latexAutocomplete.ts:195-215`, `latexIndex.ts:85-162` | Tested (`latexAutocomplete.test.ts`) |
| Document outline / section nav | Yes | `components/thesis/OutlinePanel.tsx:57`, `routes/thesis.ts` | Tested (`thesis.spec.ts`) |
| Cross-reference health (xref) | Yes | `components/thesis/XrefPanel.tsx:36`, `routes/thesis.ts` | Tested (`thesis.spec.ts`) |
| Templates: starter/project gallery | **No** | single seed only (`api/src/lib/seedTemplate.ts`); a gallery does not exist | Missing |
| Templates: diagram/maths objects | Yes (exceeds) | `components/diagram/TemplatePalette.tsx`, `lib/diagram/templates/catalog`, ADR-015 | Tested (`templates.spec.ts`, `diagramTemplates.test.ts`, `templateAcceptance.test.ts`) |
| Integrations / connectors | Yes | `connectors/manifest.ts`, `routes/connectors.ts`, `app/plugins/page.tsx`, ADR-012 | Tested (`connectors.test.ts`, `storageConnectors.test.ts`, `oauth.test.ts`) |
| Git / GitHub integration | **No** | connectors cover storage (Drive/Dropbox/OneDrive/Notion) + literature + AI CLIs; no Git | Missing |
| Spell / grammar (prose) | Yes | `components/thesis/ProsePanel.tsx:78`, `routes/thesis.ts` prose | Tested (`prose.test.ts`, `thesis.spec.ts`) |
| Keyboard shortcut reference | Yes | `components/KeyboardReference.tsx:36` (⌘/ opens) | Present |
| Landing / product tour / settings | Yes | `Landing.tsx`, `ProductTour.tsx`, `ProjectSettingsDialog.tsx` | Tested (`pages.spec.ts`) |
| Word count / document stats | **No** | `app/stats/page.tsx` is AI latency stats, not document stats | Missing |
| **SymPy maths verification** | Yes (exceeds) | `services/mathcheck`, `routes/mathcheck.ts`, ADR-008 | Tested (`mathHonesty.test.ts`, `verificationGuard.test.ts`) |
| **AI co-derivation (LLM proposes, SymPy decides)** | Yes (exceeds) | `routes/coderive.ts`, `components/coderive/*`, ADR-008 | Tested (`coderive.test.ts`, `coderive.spec.ts`) |
| **RAG-grounded document review** | Yes (exceeds) | `routes/review.ts`, `components/review/ReviewPanel.tsx`, ADR-009 | Tested (`review.test.ts`, `ragCheck.test.ts`, `documentVerify.test.ts`) |
| **Maths audit (cached SymPy steps)** | Yes (exceeds) | `routes/thesis.ts`, `components/thesis/MathsAuditPanel.tsx`, ADR-007 | Tested (`thesis.test.ts`) |
| **Predictive maths / doc-aware predict** | Yes (exceeds) | `routes/docmodel.ts`, `lib/documentModelStore.ts`, ADR-011 | Tested (`docmodel.test.ts`, `documentModel.test.ts`) |
| **Embedded Python ("Run", sandboxed)** | Yes (exceeds) | `routes/run.ts`, `services/pyrun`, `routes/pythonCheck.ts`, ADR-013 | Tested (`pyrun.test.ts`, `queue.test.ts`) |
| **Diagram editor (scene→TikZ) + GNUplot** | Yes (exceeds) | `components/diagram/TikzDiagramEditor.tsx`, `routes/diagram.ts`, ADR-014 | Tested (`diagram.spec.ts`, `gnuplot.test.ts`, `diagramTikz.test.ts`) |
| AI chat / inline edit / fix-with-Claude | Yes | `components/ai/*`, `routes/ai.ts`, ADR-004/005 | Tested (`ai.test.ts`, `fix.spec.ts`, `inline-edit.spec.ts`) |

---

## 3. Per-area assessment vs Overleaf

Classification: **PRESENT** / **PARTIAL** / **MISSING** / **N/A** (single-user
local) / **ALREADY-EXCEEDS**.

### 3.1 Editor

| Overleaf feature | State | Justification |
|---|---|---|
| Syntax highlighting | PRESENT | `stex` legacy mode (`editor/latex.ts:15`), Python lang (`editor/python.ts:5`). |
| Autocomplete (cmd/context/snippets) | ALREADY-EXCEEDS | Context-aware cite/ref/begin/end/pkg/macro completion (`latexAutocomplete.ts:70-143`) **plus** usage-ranking and AI ghost/predict text — beyond Overleaf's static autocomplete. |
| Code folding | MISSING | No `foldGutter`/`codeFolding` extension in `CodeEditor.tsx`. |
| Find & replace (single file) | PRESENT | `@codemirror/search` + `searchKeymap` (`CodeEditor.tsx:24,121,183`). |
| Find & replace across files | MISSING | No project-wide search; search is scoped to the active document. |
| Multiple cursors | PRESENT | `allowMultipleSelections` + `rectangularSelection` (`CodeEditor.tsx:113,117`). |
| Keybindings: default | PRESENT | `defaultKeymap`+history+completion+closeBrackets+indentWithTab (`CodeEditor.tsx:181-186`). |
| Keybindings: Vim / Emacs | MISSING | No `@replit/codemirror-vim` / emacs keymap; no setting. |
| Symbol palette / maths insertion | MISSING | Symbols exist only via the autocomplete dropdown (`latexData.ts:82-139`), no clickable palette. |

### 3.2 Visual / rich-text editing

| Overleaf feature | State | Justification |
|---|---|---|
| Rich-text ("Visual") editor | ALREADY-EXCEEDS | `VisualView.tsx` renders prose+maths editable in place, with KaTeX + real-TeX-engine snippet rendering of equations and chips — richer than Overleaf's Visual Editor for maths-heavy docs. |

### 3.3 Compilation

| Overleaf feature | State | Justification |
|---|---|---|
| pdfLaTeX | PRESENT | `latexmk -pdf` (`compile/runner.ts:26`). |
| XeLaTeX / LuaLaTeX | MISSING | Engine hardcoded; no `-xelatex`/`-lualatex` flag or project setting. |
| Compile settings UI | PARTIAL | `ProjectSettingsDialog.tsx` covers root file/macros/AI/Python, but no compile-engine/mode controls. |
| Draft / fast mode | MISSING | Fixed `-interaction=nonstopmode`; no `-draftmode`. |
| Incremental / cache | PARTIAL | latexmk's own incremental rebuild on a persistent workspace; no draft toggle / clean-build. |
| Stop on first error | MISSING | Always nonstopmode (recovers past errors). |
| Auto-compile | PRESENT | `compileOnSave` debounced recompile (`lib/store.ts`). |

### 3.4 PDF viewer

| Overleaf feature | State | Justification |
|---|---|---|
| Render + zoom + fit-width + pages | PRESENT | `PdfViewer.tsx:386-418,364-382`. |
| Fit-to-page | MISSING | Only zoom and fit-width modes. |
| SyncTeX forward + inverse | PRESENT | Both endpoints + UI (`routes/compile.ts:122-157`, `PdfViewer.tsx:265-283`). |
| Scroll sync | PRESENT | Scroll ratio preserved across re-renders (`PdfViewer.tsx:150-181`). |
| In-PDF text search | MISSING | No text-layer search box. |
| Dark/invert + download | PRESENT (exceeds) | Three colour modes (`PdfViewer.tsx:21-27`) + authenticated download. |

### 3.5 Error / warning handling

| Overleaf feature | State | Justification |
|---|---|---|
| Severity tiers, panel, gutter, raw log | ALREADY-EXCEEDS | Four-tier classifier with the "red == no-PDF" rule, gutter squiggles, raw-log expander, **plus** deterministic quick-fixes and PDF problem-highlights (`severityTable.ts`, `DiagnosticsPanel.tsx`, `pdfFlags.ts`) — beyond Overleaf's log panel. |

### 3.6 Files / projects

| Overleaf feature | State | Justification |
|---|---|---|
| File tree | PRESENT | `FileTree.tsx`, recursive `buildTree` (`treeUtils.ts:35`). |
| Project-level (Home) folders | PRESENT | App-level folder tree with trash (`routes/projectFolders.ts`, ADR-010). |
| Source-tree nested folders | PARTIAL (deferred) | Rendered as virtual folders from paths; no real `folderId` model, cascading-path move, or source-delete-to-trash. ADR-010 marks this a tracked follow-up; `TexFile.folderId` is prep only. |
| Upload (drag-drop) | PRESENT | Files + folder hierarchies (`dropUpload.ts:79-96`). |
| Download single file | PARTIAL | PDF download yes; no per-source-file download button. |
| ZIP import / export | MISSING | No project-archive endpoint. |
| Rename / delete / move | PRESENT | `routes/files.ts:110-151` (move via path). |

### 3.7 History & versioning

| Overleaf feature | State | Justification |
|---|---|---|
| Snapshots + labels + restore | PRESENT | `routes/snapshots.ts`, `SnapshotsDialog.tsx`. |
| Diff / compare versions | MISSING | No snapshot-to-snapshot or snapshot-to-current diff. |
| Automatic history timeline | MISSING | Snapshots are manual; no auto-checkpointing. (Overleaf's premium history; partly **N/A** for solo, but a lightweight diff is "useful even solo".) |

### 3.8 References / bibliography

| Overleaf feature | State | Justification |
|---|---|---|
| cite / ref autocomplete | PRESENT | `latexAutocomplete.ts:195-215`. |
| .bib management | PRESENT | References page + library cite-key linking (`app/references/page.tsx`, `routes/library.ts`). |
| Outline navigation | PRESENT | `OutlinePanel.tsx:57`. |
| Cross-reference health | ALREADY-EXCEEDS | `XrefPanel.tsx` flags undefined refs + unused labels — Overleaf has no built-in xref linter. |

### 3.9 Templates

| Overleaf feature | State | Justification |
|---|---|---|
| Project/template gallery | MISSING | Only one seed `main.tex` (`seedTemplate.ts`); no class/journal/thesis starter picker. |
| Diagram/maths template objects | ALREADY-EXCEEDS | Data-driven, compile-proven TikZ/pgfplots catalogue (ADR-015) — not an Overleaf feature. |

### 3.10 Integrations

| Overleaf feature | State | Justification |
|---|---|---|
| Cloud storage (Drive/Dropbox/OneDrive) | PRESENT | OAuth connectors with list/import/upload (`routes/connectors.ts:72-150`, ADR-012). |
| Literature sources (arXiv/CrossRef/Zotero/S2) | ALREADY-EXCEEDS | Search + BibTeX + PDF import + RAG indexing (`routes/library.ts`) — beyond Overleaf. |
| Git / GitHub | MISSING | No Git connector or `.git` sync. |

### 3.11 Collaboration (Overleaf core)

| Overleaf feature | State | Justification |
|---|---|---|
| Real-time co-editing | N/A | Single-user local app (README, ADR-004). No second user exists. |
| Sharing / link sharing | N/A | No multi-user/auth model beyond the single local session (`lib/session.ts`). |
| Project chat (人-to-人) | N/A | There is an **AI** chat (`ai/ChatSidebar.tsx`), which is the solo-useful reinterpretation. |
| Track changes | MISSING but "useful even solo" | AI edits get a diff-review (`ai/DiffReviewDialog.tsx`); human self-review track-changes does not exist. |
| Comments | MISSING but "useful even solo" | No anchored self-review comments; the review/audit panels are the closest analogue. |

### 3.12 Onboarding / UX polish

| Overleaf feature | State | Justification |
|---|---|---|
| Landing / home / product tour | PRESENT | `Landing.tsx`, `ProductTour.tsx`. |
| Settings | PRESENT | `ProjectSettingsDialog.tsx`. |
| Keyboard reference | PRESENT | `KeyboardReference.tsx` (⌘/). |
| Spell / grammar | ALREADY-EXCEEDS | Prose engine with rules + optional LanguageTool + per-project dictionary (`ProsePanel.tsx`, ADR-007). |
| Word count / document stats | MISSING | `app/stats/page.tsx` is AI latency, not words/pages/figures. |
| Empty states | PRESENT | Throughout (FileTree, Snapshots, Outline, Xref, References). |

---

## 4. Recommendations (prioritised)

Effort: **S** ≤1 day · **M** ~2-4 days · **L** ~1-2 weeks. Impact = how much it
closes the Overleaf-feel gap. **Planned** = covered by an existing ADR/plan;
**Net-new** = no current plan.

### 4.1 Quick wins (do first — high impact / low effort)

| # | Recommendation | Why it matters | Effort | Impact | Status |
|---|---|---|---|---|---|
| 1 | **Fix the stale README** (it says "scaffolding only / no features") | Misrepresents the product to any reader/contributor | S | Med | Net-new |
| 2 | **Code folding** — add `codeFolding()` + `foldGutter()` to `CodeEditor.tsx` | Expected editor staple; trivial CM6 extension | S | High | Net-new |
| 3 | **Document word count** — a small panel/status (client-side `.tex` tokenizer or `texcount`), distinct from `app/stats` | Writers track length constantly; conspicuous absence | S–M | High | Net-new |
| 4 | **Compile engine selector** — project setting → `latexmk -xelatex/-lualatex/-pdf` | Unicode/`fontspec`/CJK documents can't compile correctly on pdflatex-only | M | High | Net-new |
| 5 | **Project ZIP export** — one endpoint streaming the project's files | Backup/portability/submission; currently no way to get a whole project out | M | Med | Net-new |
| 6 | **Stop-on-first-error toggle** + **draft mode** — surface latexmk flags in settings | Standard Overleaf compile controls; cheap once the engine setting exists | S | Med | Net-new |

### 4.2 Core depth (next)

| # | Recommendation | Why it matters | Effort | Impact | Status |
|---|---|---|---|---|---|
| 7 | **In-PDF text search** — pdf.js text layer + find controller in `PdfViewer.tsx` | Heavily-used Overleaf feature; the viewer already loads pdf.js | M | High | Net-new |
| 8 | **Project-wide find & replace** — a search panel over all `TexFile` rows | Multi-file projects need cross-file search/rename | M | High | Net-new |
| 9 | **Finish the source-tree folder migration** — real `folderId`, cascading-path move in one transaction, cycle/collision guards, drag-drop, source-delete→trash | Closes the only *deferred* architectural gap; current source folders are path-illusions | L | High | **Planned (ADR-010)** |
| 10 | **PDF fit-to-page** mode | Small completeness gap next to fit-width | S | Low | Net-new |

### 4.3 Document management & polish (later)

| # | Recommendation | Why it matters | Effort | Impact | Status |
|---|---|---|---|---|---|
| 11 | **Starter-template gallery** — choose article/report/beamer/thesis/journal on new-project; reuse the diagram-template registry pattern | Overleaf's gallery is a major on-ramp; reduces blank-page friction | M | Med | Net-new |
| 12 | **Snapshot diff/compare** — reuse `ai/DiffReviewDialog.tsx`'s diff UI for snapshot↔current/snapshot↔snapshot | Makes the existing snapshots genuinely useful for review | M | Med | Net-new |
| 13 | **ZIP import** (pairs with #5) | Round-trips projects in/out | M | Med | Net-new |
| 14 | **Self-review comments + track-changes** (solo reinterpretation of Overleaf collab) | Anchored notes/changes are useful even for one author; complements AI review | L | Med | Net-new |
| 15 | **Symbol palette** — clickable maths-symbol inserter (the catalogue already exists in `latexData.ts`) | Nice-to-have; autocomplete already covers the need | M | Low | Net-new |
| 16 | **Vim/Emacs keymaps** — opt-in `@replit/codemirror-vim` | Power-user expectation; lower priority for a maths-verification tool | M | Low | Net-new |
| 17 | **Git/GitHub connector** — fits the ADR-012 connector framework | Version-control sync; large surface, audience-dependent | L | Med | Net-new (fits ADR-012) |

### 4.4 Explicitly NOT applicable

- **Real-time co-editing, link sharing, multi-user project chat** — the app is
  single-user and local by design (README; ADR-004 uses the local subscription
  CLI, no multi-tenant auth). Building multi-user collaboration would contradict
  the product. *Reinterpretations that ARE worth it are captured as #14 (self-
  review comments/track-changes) and the existing AI chat.*

---

## 5. Already exceeds Overleaf — protect these (do not weaken)

These are the reason to use this app over Overleaf. No recommendation above
removes, gates, or dilutes any of them.

| Differentiator | Where | ADR |
|---|---|---|
| **SymPy maths verification** (LLM never decides correctness) | `services/mathcheck`, `routes/mathcheck.ts` | ADR-008 |
| **AI co-derivation** — LLM proposes, SymPy decides; honest verdicts | `routes/coderive.ts`, `components/coderive/*` | ADR-008 |
| **RAG-grounded document review** — claims only from sourced text; honesty contract | `routes/review.ts`, `ReviewPanel.tsx` | ADR-009 |
| **Maths audit** — cached, per-step SymPy verification + gutter ✓/✗/? | `routes/thesis.ts`, `MathsAuditPanel.tsx`, `editor/mathGutter.ts` | ADR-007 |
| **Document-aware predictive maths** — DocumentModel card + multi-granularity predict | `routes/docmodel.ts`, ADR-011 | ADR-011 |
| **Embedded Python "Run"** — sandboxed, separate from compile | `routes/run.ts`, `services/pyrun` | ADR-013 |
| **Diagram editor + maths-template objects** — scene→TikZ, GNUplot, compile-proven catalogue | `TikzDiagramEditor.tsx`, `routes/diagram.ts`, ADR-014/015 | ADR-014/015 |
| **Three-tier diagnostics + deterministic quick-fixes + PDF problem highlights** | `severityTable.ts`, `logParser.ts`, `pdfFlags.ts` | — |
| **Cross-reference health linter** | `XrefPanel.tsx` | ADR-010 adjacent |
| **Connector framework (no API keys; CLI + OAuth) + literature library/RAG** | `connectors/manifest.ts`, `routes/library.ts` | ADR-012, ADR-010 |

**Guardrail:** the target is *Overleaf-grade editing/compiling UX **plus** the
maths-verification edge* — never trade the second for the first.

---

## 6. Recommended sequence

A coherent order that front-loads cheap wins, then depth, then the deferred
migration, reconciled with ADR-010.

1. **Sprint 0 (quick wins, ~1 week):** README fix (#1) → code folding (#2) →
   word count (#3) → engine selector + draft/stop-on-error (#4, #6) → ZIP export
   (#5). All low-risk, no schema changes, immediately felt.
2. **Sprint 1 (viewer + search depth):** in-PDF search (#7) → fit-to-page (#10)
   → project-wide find & replace (#8).
3. **Sprint 2 (the deferred architecture):** finish the **source-tree folder
   migration** (#9, ADR-010) — do this before further file-tree polish so
   drag-drop, source-delete→trash, and cascading moves rest on the real model
   rather than path strings. Highest-risk item; sequence it when the team can
   give compile/SyncTeX regression testing room.
4. **Sprint 3 (document management):** starter-template gallery (#11) → snapshot
   diff/compare (#12) → ZIP import (#13).
5. **Backlog (audience-dependent):** self-review comments/track-changes (#14) →
   symbol palette (#15) → Vim/Emacs keymaps (#16) → Git connector (#17).

Throughout: keep the differentiators (§5) first-class; new Overleaf-parity
features should integrate with them (e.g. the template gallery can seed
maths-verified starters; project-wide search should index the same buffers the
xref/audit tools already read).

---

### Appendix — audit method & accuracy notes

- Current-state claims were grounded by reading route files, the main editor/
  viewer/panel components, `prisma/schema.prisma`, the test directories, and all
  of `docs/decisions.md` (ADR-001…015), cross-checked against `git log`.
- **Spot-checks that are accurate as cited:** engine hardcoded to pdflatex
  (`compile/runner.ts:26`); SyncTeX both ways (`routes/compile.ts:122-157`);
  source-tree migration deferred (ADR-010 "Status: … source-tree migration
  deferred"; `files.ts` path-only); no in-PDF search / folding / cross-file
  search / word count (absent from `PdfViewer.tsx`, `CodeEditor.tsx`, repo grep);
  README stale (`README.md:8-9`).
- **Known stale doc:** `README.md` describes the app as "scaffolding only" — this
  is inaccurate and is recommended as quick win #1.
