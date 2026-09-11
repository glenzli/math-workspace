# Usage

[🌍 English](#en) | [🇨🇳 中文](#zh-cn)

---

<a name="en"></a>

## 🌍 English

This guide explains the source syntax and normal command workflow for `math-workspace`.

The short version:

1. Write stable markers where human numbering would normally appear.
2. Use `@h-...` references in prose.
3. Let the CLI generate hash IDs, preview metadata, and reports.

### Core Model

- Stable numbering: source stores stable `#h-...` markers, new objects start as `#tmp-*`, prose references use only `@h-...`, `@h-....title`, or `@h-....full`, and reader-facing numbers are rendered by the tool.
- Definition lookup: definitions do not get hash IDs or refs; the tool scans standard `定义（术语）：...` / `Definition (Term): ...` entries and deliberately named concept/glossary appendices. AI maintains `.math-workspace/definitions.json` only for missing lookup entries, nonstandard definitions, aliases, bilingual lookup, and unreliable boundaries.
- Project knowledge: `.math-workspace/project-analysis.json` / `.math-workspace/project-analysis.md` are generated summaries of concept/glossary, notation, and summary pages. Math Workspace rebuilds them in memory and sends current-book sources with Codex discussion context.
- Symbol table: `.math-workspace/symbols.json` records only project-defined special LaTeX notation with an explicit semantic change, not generic variables, complete derivations, or one-off symbols.
- Dependency graph: explicit dependencies between theorem-like objects and proof-backed hash remarks come from `@h-...`; the canonical data is `.math-workspace/dependency-graph.json`; plain remarks have no graph node, and AI- or prover-suggested edges must be stored separately as suggested data.
- Export: ordinary Markdown/PDF does not consume formal source directly; use `export-md` or `export-md-split` to lower markers/refs first, then run project-specific postprocessing and `render-pdf`.
- Tool loop: run `prepare` when entering a task or when the index may be stale, then run `finish <file-or-dir>` for ordinary edits; `finish` validates. Run `verify` separately only after direct `finalize`, a migration, or as an independent release gate.

### Core Syntax

Draft with temporary IDs:

```markdown
# #tmp-1 Measure Theory

## #tmp-2 Weak Convergence

Definition (Tight family): A family of probability measures is tight if ...

Theorem #tmp-3 (Prokhorov Criterion): Let \(\mathcal{P}\) be a family of probability measures.

Proof: ...

The implication follows from @tmp-3.
```

After `finish`, temporary IDs are replaced with stable hash IDs:

```markdown
Theorem #h-3f7a1c9d5b0e72aa (Prokhorov Criterion): ...
```

Declaration syntax and reference syntax are intentionally different:

```text
#h-...      declaration
#tmp-*      temporary declaration
@h-...      prose reference
@h-....title title-only reference
@h-....full  label plus title reference
```

Do not use declaration syntax in prose. For example, write `by @h-...`, not `by Theorem #h-...`.

### Exercises and Solutions

Exercises have their own chapter counter. Each question and each solution has a separate stable ID; an explicit target connects a solution to its question:

```markdown
Exercise #tmp-ex (Finite sum): Compute the following expression.

$$
\sum_{k=1}^{n} k
$$

**(a)** Check small cases first.

Hint: Pair the first and last terms.
```

A solution may live in the same book's final solutions appendix:

```markdown
Solution #tmp-sol (for @tmp-ex): Pair the terms and add the pairs.
```

Chinese syntax is `习题 #tmp-ex（标题）：...` and `解答 #tmp-sol（对应 @tmp-ex）：...`. Add an optional solution title after a semicolon, such as `(for @tmp-ex; Another method)`. Several solutions may target one exercise, with separate IDs. Each solution displays the original exercise number, such as “Solution to Exercise 2.3”, rather than a new appendix number. Missing targets, targets of another kind, and targets in another book are errors. Use `finish --all` to finalize temporary references across files.

A prompt continues until the next formal object or Markdown heading and includes multiple paragraphs, formulas, lists, and subquestions. Use lists or bold labels for subquestions; a Markdown heading ends the prompt. A separate `Hint:` or `Solution:` paragraph starts support content; leave a blank line before it. Prompt recall excludes support content. The Reader initially collapses hints and answers and provides links in both directions. Markdown and PDF exports include complete hints and solutions and compile their original question numbers and references consistently.

The dependency graph retains exercise and solution references with `layer: pedagogical`. Its separate `pedagogicalLinks` records solution ownership without adding proof cycles. `graph impact` follows references and question/answer associations; Reader mainline importance and `graph bridges` exclude pedagogical references. A mainline result that references an exercise or solution produces a review notice: keep required claims and proofs in the main text so the solution appendix does not supply a missing argument.

When turning a formalized result into an exercise, retain its hash and Lean declarations. Exercises belong to the default `coverageTypes`. Anchored exercises remain in the denominator even if a custom type list omits exercises; solutions do not duplicate the default coverage count. Lean contracts separately fingerprint the statement, associated hints/proofs/linked solutions, and declaration signatures. An answer edit requires review of its question; a question edit also requires review of anchored solutions. Lean dependency comparison attributes explicit strict references in a linked solution to its exercise and records the answer as provenance; ownership itself is not a premise. In `lean-index.json`, `status.markdownChanges` distinguishes `statement` and `proof` changes. Legacy contracts without proof fingerprints are `untracked`; review the source and declarations before running `lean capture` to establish the new baseline.

### Numbered Objects

Supported declarations:

```markdown
## #tmp-1 Section Title

Proposition #tmp-2 (Local Estimate): ...

Lemma #tmp-3 (Compactness Lemma): ...

Theorem #tmp-4 (Main Theorem): ...

Corollary #tmp-5 (Uniqueness): ...

Equation #tmp-6:
$$
\|Tx\| \le C\|x\|
$$

Figure #tmp-7 (Commutative diagram): ...

Table #tmp-8 (Parameter ranges):
```

Chinese markers are also supported:

```markdown
命题 #tmp-1（局部估计）：...
引理 #tmp-2（紧性引理）：...
定理 #tmp-3（主定理）：...
推论 #tmp-4（唯一性）：...
公式 #tmp-5：
图 #tmp-6（交换图）：...
表 #tmp-7（参数范围）：
```

Sections are anchors and navigation targets. They do not create recall previews.

Theorem-like objects create recall previews. The preview captures the statement and stops before `Proof` / `证明`.

### Definitions

Definitions are lookup entries, not numbered references.

Standard definitions are scanned automatically:

```markdown
Definition (Bounded operator): A linear map \(T:X\to Y\) is bounded if ...

定义（有界算子）：若线性映射 \(T:X\to Y\) 满足 ...
```

The tool also recognizes deliberately named concept or terminology appendices, such as `appendix-*-concepts.md`, glossary, terminology, or their Chinese equivalents. In those pages, `Term | Definition` / `术语 | 定义` tables and deepest concept-entry headings become supplemental lookup entries. `prepare` writes `.math-workspace/project-analysis.json` and `.math-workspace/project-analysis.md`; Math Workspace rebuilds the same structure in memory and supplies current-book sources to Codex discussions.

These are derived reading aids, not new writing sources. The tool does not infer terms or symbol meaning from ordinary prose.

Use `.math-workspace/definitions.json` only for exceptions:

- nonstandard prose definitions;
- aliases;
- Chinese/English lookup pairs;
- stable multi-paragraph preview content;
- cases where the automatic range is likely unreliable.

Example:

```json
[
  {
    "term": "bounded operator",
    "aliases": ["有界算子"],
    "source": "book/01-foundations.md:42",
    "content": "A bounded operator is a linear map \(T:X\\to Y\) such that \\(\\|Tx\\|\\le C\\|x\\|\\)."
  }
]
```

### Symbols

Only project-specific notation whose semantics have explicitly changed belongs in `.math-workspace/symbols.json`.

```json
[
  {
    "pattern": "\\operatorname{Spec}(${operator})",
    "meaning": "The spectrum of the matched operator.",
    "scope": "book",
    "source": "book/02-operators.md:18"
  }
]
```

Do not index generic variables, standard notation, or complete derivation formulas. A detected notation appendix appears in project knowledge context, but does not automatically produce a `pattern` or `meaning`.

### Normal Workflow

Initialize a project, generate context, and open the Reader:

```bash
npm run workspace -- init
npm run workspace -- open
```

`open` finds `.math-workspace/config.json` by walking up from the current directory. Use `prepare` when only the index needs to be refreshed, and `doctor` to inspect installation, project discovery, and optional tools.

Edit a file or directory, then finalize temporary IDs and refresh reports:

```bash
npm run workspace -- finish path/to/chapter-or-dir
```

`finish` already validates. Run the strict gate separately only after direct `finalize`, a migration, or when an independent release gate is required:

```bash
npm run workspace -- verify
```

### Local Math Workspace

The normal Reader entry is:

```bash
npm run workspace -- open /path/to/project
```

You can run `open` from any subdirectory of an initialized project. If no path is supplied and the current directory is outside one, it opens the local project launcher. The lower-level `serve` command remains available for scripts that need explicit launch behavior:

```bash
npm run workspace -- serve
```

The launcher can use the native folder chooser or reopen a recent project. A selected directory must already contain `.math-workspace/config.json`. Recent-project records stay in local user state and never write project sources or `.math-workspace/`; the browser submits only a recent-project index, while the local Math Workspace service retains the directory path.

The command prints a URL bound only to `127.0.0.1`. Open it in Codex's local browser side panel or a normal browser. The Math Workspace provides:

- multi-book, multi-volume, and chapter navigation;
- current-page contents;
- theorem-like recall loaded only when needed;
- project-wide definition search and current-page symbols;
- in-text dependency markers for propositions, lemmas, theorems, corollaries, and proof-backed hash remarks;
- light Lean badges that open anchor, baseline, build, and direct-dependency details on demand;
- optional source-block starting line numbers remembered in the local browser;
- live refresh after source changes.

The line-number toolbar button shows each locatable source block's starting line in the article gutter. It helps map rendered content back to Markdown without pretending that visual wraps are source lines or changing article layout. The view is off by default and its preference stays in the current browser.

Dependency markers read only explicit `@h-...` relationships. A short line above the dot means the statement or proof explicitly references formal items such as a section, definition, theorem-like object, or proof-backed hash remark. A vertical line below means a later dependency node depends on it; a fork means multiple direct downstream nodes. Mainline theorem-like nodes use the ordinary impact colors: muted is a terminal node, blue is directly cited, and green is both explicitly grounded and cited later. Hash remarks use a muted supplemental color and label; plain `注（...）` / `Remark (...)` entries have no graph node or marker. Hover for reference and transitive-impact counts. These are structural signals, not measures of mathematical importance.

Open the in-document **Marking tools** to choose selection, lasso, proposition, or erase. The selection tool marks dragged text, the lasso marks source blocks inside a closed gesture, the proposition tool selects one whole formal object, and erase or the × shown at the top-right of a hovered highlight removes one mark. Marks remain visible as a soft highlight in the article. Discussion marks retain only a project root, Markdown file, line range, optional formal/formula anchor, and source hash. They do not retain manuscript text or create a temporary conversation or task binding.

Then ask directly in a native Codex task. When the user refers to marked material, `read_marks` returns the lightweight locators, and Codex reads the corresponding Markdown from the same project before answering. This flow assumes Math Workspace and Codex share a project directory; cross-project handoff is deliberately out of scope.

The project needs `.math-workspace/config.json`; run `prepare` once to create it. The Math Workspace does not require `workspace-index.json`.

The former VS Code preview is archived and unsupported. Project reading and interaction now use the local Math Workspace Reader.

### Exploratory Drafts and Document Stages

An exploratory draft is earlier than a formal document's Initial Draft stage: it may be an idea, a failed attempt, or material not yet intended for the manuscript. Draft collections are configured explicitly in `.math-workspace/config.json`; they are not discovered from a directory name alone:

```json
{
  "scan": {
    "exclude": ["draft/**"]
  },
  "documents": {
    "collections": [
      {
        "id": "drafts",
        "title": "Exploratory drafts",
        "mode": "draft",
        "include": ["draft/**"]
      }
    ]
  }
}
```

`scan.exclude` keeps the directory out of the formal scan, while `documents.collections` makes its Markdown files visible in a collapsible Reader group. Drafts remain readable but do not produce formal hashes, definition or symbol indexes, dependency nodes, Lean alignment, or symbol-audit input; the corresponding tools are disabled on draft pages.

Formal documents use separate lifecycle metadata. They start as Initial Draft and can be changed to Revising or Stable Draft. The navigation context menu updates one document or a multi-selection; the Reader continues to display the first selected document. A document can also record a free-form milestone such as `RC1` or `v1`; Math Workspace stores the content hash at that point and later marks the document as changed when the hash differs.

State is stored in `.math-workspace/documents.json` by default and keyed by project-relative path. Moving or renaming a file leaves the old record orphaned by design instead of guessing semantic identity. Set `documents.stateFile` to use another project-relative state path.

### Codex MCP Entry

The Math Workspace remains an independent local client and can also be opened through Codex MCP. MCP starts or reuses the local workspace and provides narrow selection, formal-object, strict-dependency, Lean-alignment, and read-only validation queries; it does not embed or duplicate Math Workspace rendering or a Codex discussion surface.

```bash
math-workspace mcp
```

The MCP working directory is the default project. To pin a project root:

```bash
math-workspace mcp --root /path/to/project
```

Install the public plugin from the marketplace:

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add math-workspace@glenzli-marketplace
```

The plugin includes the CLI and Reader runtime. For development, run `npm run build` and then register the repository root as a local marketplace:

```bash
codex plugin marketplace add /path/to/math-workspace
codex plugin add math-workspace@personal
```

The plugin calls `open` for the current project or a project-relative Markdown page. `read_marks` returns active source locators, while `lookup_formal_object`, `inspect_dependencies`, `lookup_knowledge`, `inspect_lean_alignment`, `read_symbol_audit`, and `verify` provide focused context on demand. The audit tool only reads results the user has already generated; it never starts model work. If no prepared project is available, `open` shows the local project launcher. MCP binds only to `127.0.0.1` and does not write manuscript or `.math-workspace/` artifacts.

### Academic Archives

Academic archives retain original drafts, signing evidence, and version relationships in the writing project's `.math-archive/` directory. This storage is separate from rebuildable Reader indexes and document stage labels. Only explicit `archive sign` or the Reader's Authenticate and sign action starts a signing operation. Reading, conversion, import, verification, and preparation do not sign, edit source prose, commit Git changes, or publish a work.

Declare a stable work ID, a file scope, and an accepted signing identity:

```bash
math-workspace archive init --work-id my-book --title "My Book" --path book --identity author@example.com --issuer https://accounts.google.com
math-workspace archive prepare --label "September draft"
math-workspace archive sign --prepared <returned-full-digest>
math-workspace archive verify
```

Repeat `--path` for several source roots. Directory scopes recursively include `.md` files by default; use `--extension`, `--depth`, and `--exclude` to refine the scope. Explicitly selected files are captured as original bytes. Directory traversal skips hidden paths, Git, dependencies, and generated output, and rejects symbolic links. Include Lean source or build evidence explicitly when needed. Signing a build report neither reruns a proof nor establishes complete formalization.

Preparation freezes original bytes and records their relative paths, full SHA-256 digests, scope, label, signer, and predecessor. A successor binds both the preceding record and its original bundle digest. The first native record binds the imported history indexes. `preparedAt` and a Git base commit are locators, not independently authenticated signing times. Records use UTF-8 JSON with keys sorted by UTF-8 byte order, no insignificant whitespace, one final LF, and safe integer values.

After authentication, the workflow rechecks the source set, scope, identity, predecessor, and historical objects before atomically publishing the head. Existing valid bundles are reused on retry. Resume with the same `--prepared` digest; `archive recover-lock` releases a local abandoned lock only when its recorded process no longer exists. Signed records keep their original bytes. A project policy may be edited explicitly, while retaining the identities needed to verify older evidence.

The Reader's history icon, labeled Version history, opens a timeline with work snapshots and optional volume records, original text, source view, gaps, file comparisons, and stable-ID history. Historical reading does not substitute current workspace content or reference targets. Signature validity, source completeness, and current-source coverage are shown separately. Lean status remains with the existing Lean tools. The earliest occurrence in available evidence does not establish original authorship or priority.

#### OET Conversion and Compatibility

Built-in adapters accept `oet.legacy-signatures/v1` and `oet.sign-record/v1`. They read the original index, MANIFEST files, bundles, and content objects. They do not re-sign older records, replace their time evidence, or invent predecessor links between independent signatures. All three original manifest hashes must match; unresolved original content remains a gap. OET tooling continues to own Git-history collection and historical temporary-manifest reconstruction. The generic importer validates the converted evidence.

From the repository containing the OET work directory:

```bash
math-workspace archive sources
math-workspace archive convert --format oet --from the-operator-evolution-theory/.signatures --out oet-archive.json
math-workspace archive import-oet --from the-operator-evolution-theory/.signatures --initialize
```

`convert` writes the exchange document and reports a suggested project policy. `import-oet --initialize` adopts the declared work scope and identities and performs cryptographic verification; it will not replace a different existing policy. The Reader previews the scope and identities before an explicit import action. Older OET tooling may keep producing its original formats, which can be converted and imported again. New native signing signs the declared source snapshot directly and does not require separate per-volume MANIFEST bundles.

#### Format Interface and Portable Evidence

`archive formats` lists the accepted evidence formats. The `math-workspace.archive-exchange/v1` transport contains:

- `workId`: the stable work identifier;
- `records[]`: a format ID, original payload digest, original bundle digest, and optional metadata;
- `objects`: full SHA-256 digests mapped to base64-encoded original bytes.

A converter cannot supply a trusted verified status. Import checks object digests, then the corresponding `ArchiveFormat.project` derives file membership and relationships from original signed evidence. Cosign verifies the signature, identity, transparency-log material, and time evidence. A new evidence format needs an explicit validating adapter. Reformatting an old signed payload as new JSON cannot preserve its old signature. Project configuration never executes arbitrary converter code. Reusable types and local APIs ship in `out/cli/archive.js`; the CLI and Reader use the same implementation.

```bash
math-workspace archive export --out evidence.json
math-workspace archive import --from evidence.json
math-workspace archive history --formal-id h-0123456789abcdef
math-workspace archive show --record <record-ID> --file book/01.md
math-workspace archive compare --left <record-ID> --right <record-ID>
math-workspace archive verify --expected-head <independently-retained-head-digest>
```

An export includes original drafts and evidence for verification in another project copy under the chosen trust policy. Import preserves the original records and relationships. The receiving project's next native signing operation binds the import indexes; import time never replaces historical signing time. An independently retained head enables rollback checks. Verifying one history alone cannot establish that it is complete or current. Export does not publish anything, and the author chooses whether to share the private drafts it contains.

Signing and cryptographic verification require `cosign` and `openssl`. Verification uses the local Sigstore TrustedRoot cache when available, or Cosign's normal trust-root retrieval. Supply `--trusted-root` or `MATH_WORKSPACE_SIGSTORE_TRUSTED_ROOT` for an explicit trust file. Machine-specific paths do not enter signed records.

The read-only MCP tool `read_archives` supports paginated `list`, `history`, and `source` queries. Read original archived source before drawing historical conclusions. Evidence without a current verification result is explicitly reported as `unchecked`.

### Codex File-Link Navigation

Codex Desktop supports user-level custom file handlers. Register Math Workspace so Markdown file links in Codex can be handed to the Reader from the Open in menu:

```bash
math-workspace codex-handler install
```

The installer manages only a clearly delimited Math Workspace block in `~/.codex/config.toml`; it preserves all other Codex settings. Restart Codex Desktop, then select Math Workspace from a file link's Open in menu. The choice can also be saved as the preferred handler for a project. Codex passes the absolute file path and any available one-based line and column.

When a Reader page for the project is already open, the handler reuses its local server and navigates that page in place. If the server has no connected page, it opens the precise `path + line` URL. If no server is running, it starts a local Reader first. The target must be a Markdown file inside a prepared Math Workspace project.

Inspect or remove the integration with:

```bash
math-workspace codex-handler status
math-workspace codex-handler remove
```

This feature handles source navigation only. It does not change the links Codex generates or turn Math Workspace into a second editor or conversation UI.

### AI Workflow Integration

AI rules no longer live in a separate public documentation page. Target projects should read the AI artifacts shipped with the package:

```text
skills/editor.md      # writing and migration rules
skills/math-writing.md  # project-neutral mathematical writing and proof-audit rules
skills/integrator.md  # how to merge those rules into native project instructions
skills/lean-formalization.md  # Lean anchoring, implementation, and validation rules
```

For npm installs, the paths are:

```text
node_modules/math-workspace/skills/editor.md
node_modules/math-workspace/skills/math-writing.md
node_modules/math-workspace/skills/integrator.md
node_modules/math-workspace/skills/lean-formalization.md
```

If the target project uses VASMC, lock the workspace, mathematical-writing, and integration artifacts through the catalog; Lean projects should also lock the Lean artifact:

```bash
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export editor --alias math-workspace-editor
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export math-writing --alias math-workspace-math-writing
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export integrator --alias math-workspace-integrator
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export lean-formalization --alias math-workspace-lean-formalization
```

For release bundles, use this catalog path instead:

```text
dist/vasm-catalog/vasmc-catalog.yaml
```

The CLI can print the key paths for the current installation:

```bash
npm run workspace -- paths
```

Do not auto-fetch remote skills, and do not append the integrator guide verbatim to a target prompt. Review the artifacts first, then merge the rules into the target project's existing `AGENTS.md`, writing skill, style guide, or release instructions.

### Migration Workflow

Dry-run text reference migration:

```bash
npm run workspace -- migrate-text-refs path/to/chapter-or-volume
```

Apply text reference migration:

```bash
npm run workspace -- migrate-text-refs --apply path/to/chapter-or-volume
```

Dry-run old ID migration:

```bash
npm run workspace -- migrate-ids path/to/chapter-or-volume
```

Apply old ID migration:

```bash
npm run workspace -- migrate-ids --apply path/to/chapter-or-volume
```

### Dependency Graph

Generate the graph summary:

```bash
npm run workspace -- graph summary
```

Inspect one dependency node (a theorem-like object or proof-backed hash remark):

```bash
npm run workspace -- graph focus <h-id> --depth 2
```

Find downstream impact:

```bash
npm run workspace -- graph impact <h-id>
```

Inspect upstream dependencies:

```bash
npm run workspace -- graph upstream <h-id>
```

Summarize chapter-level flow:

```bash
npm run workspace -- graph matrix chapter
```

The graph records explicit `@h-...` references only. Its reports separate mainline theorem-like statistics from supplemental hash-remark statistics, and plain `注（...）` / `Remark (...)` entries are excluded. Suggested or inferred mathematical dependencies should be stored separately by the target project.

### Lean Anchors

After declaring a Lean project in `.math-workspace/config.json`, `prepare` scans `.lean` files under the configured source roots, reads stable hashes from named-declaration docstrings, and writes:

```text
.math-workspace/lean-index.json
.math-workspace/lean-report.md
.math-workspace/lean-contracts.json        # appears after capture
.math-workspace/lean-build.json            # appears after build
.math-workspace/lean-dependency-graph.json # appears after dependencies
.math-workspace/lean-dependency-report.md  # appears after dependencies
```

Use `lean scan` to rebuild the index, `lean coverage` to print the anchor report, and `lean verify` to reject unknown hashes, unreadable roots, or anchored docstrings without a supported named declaration:

```bash
npm run workspace -- lean scan
npm run workspace -- lean coverage
npm run workspace -- lean verify
npm run workspace -- lean capture
npm run workspace -- lean build [--project <key>]
npm run workspace -- lean dependencies
```

`capture` records a reviewed baseline for the Markdown object's type, title, statement, associated proof/solution content, and anchored declaration signature; later changes surface as contract drift. `build` runs `lake build [target]` in configured project roots and records the result; source changes make an older result stale. `dependencies` uses Lean elaboration to inspect direct references in anchored declaration types and proof values, then compares them only with explicit strict Markdown `@h-...` edges. Markdown-only edges merit review; Lean-only edges usually provide implementation or reusable-support context. Neither kind establishes a mathematical conflict by itself.

The Reader marks anchored statements and graph nodes with a light `L`. Clicking an in-text `L` shows its anchored declarations, contract, latest build, and dependency-comparison state. These are auditable engineering signals, not a claim of semantic equivalence, complete formalization, or proof coverage. Coverage starts from configured `coverageTypes` and always retains anchored exercises; these numbers cannot substitute for a scope statement.

### Project Structure

The scanner infers books, volumes, chapters, intro pages, summaries, and appendices from paths.

```text
book/
  00-introduction.md
  01-foundations.md
  02-main-results.md
  summary.md
  appendix-a-background.md

multi-volume-book/
  vol-01-foundations/
    intro.md
    01-basic-objects.md
    02-compactness.md
    summary.md
    appendix-a-notation.md
  vol-02-applications/
    03-stability.md
    04-examples.md
```

Volume directories add a navigation layer. They do not reset chapter numbering.

Appendix numbering is appendix-local, such as `A.1`, `A.2`.

### Configuration

Common `.math-workspace/config.json`:

```json
{
  "language": "en",
  "scan": {
    "exclude": [
      ".build/**",
      ".context/**",
      "draft/**",
      "notes/private/**"
    ]
  },
  "lookup": {
    "bookDependencies": {
      "advanced-book": ["foundations-book"]
    }
  },
  "lean": {
    "projects": [
      {
        "key": "formal-book",
        "root": "formal-book",
        "sourceRoots": ["FormalBook"],
        "target": "FormalBook",
        "module": "FormalBook",
        "anchorPrefix": "Book anchor:"
      }
    ],
    "coverageTypes": ["theorem", "lemma", "prop", "cor", "remark", "exercise"]
  },
  "render": {
    "pageHeadingStyle": "label-title"
  }
}
```

Cross-book references and lookup require explicit dependencies in `lookup.bookDependencies`.

Lean `root` and `sourceRoots` paths are relative to the Math Workspace project root. `target` is the optional `lake build` target; `module` is imported for dependency inspection and defaults to `target`. `anchorPrefix` must match the prefix used in Lean docstrings; `coverageTypes` changes the report queue, not anchor parsing.

### PDF Export

Export formal source to ordinary Markdown before using other publication tools:

```bash
npm run workspace -- export-md path/to/book --out dist/book.md
```

Export formal source while preserving the source file tree:

```bash
npm run workspace -- export-md-split path/to/book --out dist/public
```

Export formal source directly to PDF with the local Pandoc/LaTeX engine:

```bash
npm run workspace -- export-pdf path/to/book --out dist/book.pdf
```

Render an already compiled Markdown file:

```bash
npm run workspace -- render-pdf dist/book.md --out dist/book.pdf
```

`render-pdf` does not scan formal source, rewrite `#h-*`, or resolve `@h-*`.
It only renders an already compiled Markdown file with the shared Pandoc
layout options. Use it when a project needs this release flow:

```text
export-md -> project postprocess -> render-pdf
```

Default PDF behavior:

- paper: `a4`;
- margin: `2.5cm`;
- table of contents: enabled;
- TOC depth: `2`;
- TOC title: selected from `language`, such as `Contents` or `目录`;
- TOC page break: enabled;
- PDF engine: `xelatex`;
- title page: optional, with the `simple` cover style;
- publication metadata page: optional, after the title page and before the TOC;
- front matter pages: optional, after metadata and before the TOC.

PDF settings live under the `pdf` key in `.math-workspace/config.json`:

```json
{
  "language": "en",
  "pdf": {
    "title": "Book Title",
    "subtitle": "Volume I: Foundations",
    "author": "Author Name",
    "date": "Revised 2026-06-26",
    "titlePage": true,
    "metadataPage": true,
    "license": "CC BY 4.0",
    "repository": "https://example.com/project",
    "frontMatter": [
      {
        "title": "AI Assistance Statement",
        "source": "AI-PARTICIPATION.short.md",
        "toc": false
      }
    ]
  }
}
```

CLI flags can override config values, including `--pdf-engine`, `--paper`,
`--margin`, `--toc-depth`, `--title`, `--subtitle`, `--author`, `--date`,
`--metadata-page`, `--front-matter`, `--title-page`, `--cover-style`, and
`-V key:value`.

The repository does not bundle Pandoc or a LaTeX distribution. If the PDF
engine is missing, produce `export-md` first and run PDF rendering after the
local engine is installed.

---

<a name="zh-cn"></a>

## 🇨🇳 中文

这份文档说明 `math-workspace` 的源码语法和常用命令流程。

最简流程：

1. 在原本需要人工维护编号的位置写稳定 marker。
2. 在正文中使用 `@h-...` 引用。
3. 由 CLI 生成 hash ID、预览缓存和报告。

## 核心模型

- 稳定编号：源码保存稳定 `#h-...`，新增对象先写 `#tmp-*`；正文引用只用 `@h-...`、`@h-....title` 或 `@h-....full`，读者编号由工具渲染。
- 定义查询：定义不加 hash、不参与 ref；工具自动扫描标准 `定义（术语）：...` / `Definition (Term): ...`，并在发现概念/术语附录时利用其表格和末级条目建立补充索引。AI 只为查询缺失、非标准定义、别名、中英互查和不可靠边界维护 `.math-workspace/definitions.json`。
- 项目知识：`.math-workspace/project-analysis.json` / `.math-workspace/project-analysis.md` 是工具生成的概念附录、符号附录和 summary 页面摘要；Math Workspace 在内存中按内容变化重建，供 Codex 通过窄范围 MCP 查询核对。
- 符号表：`.math-workspace/symbols.json` 只记录项目明确约定且发生语义变化的特殊 LaTeX 记号，不索引通用变量、完整推导公式或一次性符号。
- 依赖图：命题/引理/定理/推论与带 hash、可证明的补充注释之间的显式依赖来自 `@h-...`，权威数据是 `.math-workspace/dependency-graph.json`；普通 `注（...）` 不进入图。AI 或证明器推测出的边必须另存为 suggested 数据。
- 导出：普通 Markdown/PDF 不直接消费 formal 源；先用 `export-md` 或 `export-md-split` 降级 marker/ref，项目级后处理之后再用 `render-pdf`。
- 工具闭环：进入任务或索引可能过期时运行 `prepare`，普通编辑后运行 `finish <file-or-dir>`（它会校验）；仅在直接 `finalize`、执行迁移或独立 release 门禁时另行运行 `verify`。

## 核心语法

写作时先使用临时 ID：

```markdown
# #tmp-1 测度论基础

## #tmp-2 弱收敛

定义（紧族）：一族概率测度称为紧族，如果 ...

定理 #tmp-3（Prokhorov 判据）：设 \(\mathcal{P}\) 为一族概率测度。

证明：...

该结论由 @tmp-3 得到。
```

运行 `finish` 后，临时 ID 会被替换成稳定 hash：

```markdown
定理 #h-3f7a1c9d5b0e72aa（Prokhorov 判据）：...
```

声明语法和引用语法必须区分：

```text
#h-...       正式声明
#tmp-*       临时声明
@h-...       正文引用
@h-....title 只渲染标题
@h-....full  渲染标签和标题
```

不要在正文里写声明语法。应写 `由 @h-... 可得`，不要写 `由定理 #h-... 可得`。

## 习题与解答

习题按章独立编号，不占用定理编号。题目和解答分别持有稳定 ID，解答用显式目标关联题目：

```markdown
习题 #tmp-ex（有限求和）：计算下式。

$$
\sum_{k=1}^{n} k
$$

**(a)** 先检验小规模情形。

提示：考虑首尾配对。
```

可以把解答放到同一本书的最后一个题解附录，使用如下声明：

```markdown
解答 #tmp-sol（对应 @tmp-ex）：将首尾项配对，再求和。
```

英文写法为 `Exercise #tmp-ex (Title): ...` 和 `Solution #tmp-sol (for @tmp-ex): ...`。可选解答标题写作 `（对应 @tmp-ex；另一种方法）`。多个解答可以关联同一道题，各自使用不同 ID；解答显示原题编号，例如“习题 2.3 的解答”，不使用所在附录的新编号。缺失、非习题或跨书目标会报错。跨文件临时引用用 `finish --all` 一并固化。

题面延续到下一个正式对象或 Markdown 标题，包含多段文字、公式、列表和分问。分问用列表或加粗标签；不要用会结束题面的 Markdown 标题。独立段落中的 `提示：` / `Hint:`、`解答：` / `Solution:` 开始辅助内容；这些标记与前文之间留一个空行。提示和解答不会进入题面 recall，Reader 默认折叠它们；题目与附录解答支持双向跳转。Markdown 与 PDF 导出保留完整提示及解答，并统一编译原题编号和引用。

依赖图保留习题、解答的显式引用，标记 `layer: pedagogical`；`pedagogicalLinks` 单独保存题解关联，不参与证明循环。`graph impact` 会沿引用和题解关联追踪影响；Reader 主线重要性和 `graph bridges` 不计教学引用。正文主线引用习题或解答时会提示审查：必要命题及证明应保留在正文，避免让题解承担主线缺失的论证。

已形式化的命题改为习题时保留原 hash 与 Lean 声明。习题进入默认 `coverageTypes`；即便自定义类型列表遗漏习题，已有 Lean 锚点的习题仍计入覆盖分母，解答不在默认分母中重复计数。Lean 契约分别记录题面、相关提示/证明/跨文件解答和声明签名；修改题解会使题目待复核，修改题面也会使锚定解答待复核。Lean 依赖比对会把关联解答中的显式严格引用计作原题的证明前提，并保留题解来源；关联本身不是前提。`lean-index.json` 的 `status.markdownChanges` 区分 `statement` 与 `proof` 变化。旧版缺少证明指纹的契约显示 `untracked`；审阅原文及对应声明后运行 `lean capture` 建立基线，不要用 capture 掩盖未审阅的修改。

## 编号对象

支持的声明形式：

```markdown
## #tmp-1 小节标题

命题 #tmp-2（局部估计）：...

引理 #tmp-3（紧性引理）：...

定理 #tmp-4（主定理）：...

推论 #tmp-5（唯一性）：...

公式 #tmp-6：
$$
\|Tx\| \le C\|x\|
$$

图 #tmp-7（交换图）：...

表 #tmp-8（参数范围）：
```

英文 marker 也支持：

```markdown
Proposition #tmp-1 (Local Estimate): ...
Lemma #tmp-2 (Compactness Lemma): ...
Theorem #tmp-3 (Main Theorem): ...
Corollary #tmp-4 (Uniqueness): ...
Equation #tmp-5:
Figure #tmp-6 (Commutative diagram): ...
Table #tmp-7 (Parameter ranges):
```

小节只作为编号和跳转锚点，不生成 recall 预览。

命题类对象会生成 recall 预览。预览只收录陈述部分，并在 `证明` / `Proof` 前停止。

## 定义

定义是查询对象，不是编号对象。

标准定义会被自动扫描：

```markdown
定义（有界算子）：若线性映射 \(T:X\to Y\) 满足 ...

Definition (Bounded operator): A linear map \(T:X\to Y\) is bounded if ...
```

工具还会识别明确命名的概念/术语附录，例如 `appendix-*-concepts.md`、glossary、terminology 或中文概念表。此类页面中，`术语 | 定义` / `Term | Definition` 表格与最末级概念条目会作为补充查询条目。`prepare` 会生成 `.math-workspace/project-analysis.json` 和 `.math-workspace/project-analysis.md`，列出被采用的概念、符号和 summary 页面；Math Workspace 在内存中同步重建这份结构，供 Codex 通过窄范围 MCP 查询核对。

这些条目是派生索引，不是新的写作源，也不会由工具从普通正文猜测术语或符号含义。

只有例外情况才写入 `.math-workspace/definitions.json`：

- 非标准行文定义；
- 别名；
- 中英互查；
- 需要稳定多段预览内容；
- 自动范围可能不可靠的定义。

示例：

```json
[
  {
    "term": "有界算子",
    "aliases": ["bounded operator"],
    "source": "book/01-foundations.md:42",
    "content": "有界算子是满足 \\(\\|Tx\\|\\le C\\|x\\|\\) 的线性映射 \\(T:X\\to Y\\)。"
  }
]
```

## 符号表

只有项目明确约定且语义发生变化的记号才写入 `.math-workspace/symbols.json`。

```json
[
  {
    "pattern": "\\operatorname{Spec}(${operator})",
    "meaning": "匹配到的算子的谱。",
    "scope": "book",
    "source": "book/02-operators.md:18"
  }
]
```

不要索引普通变量、通用记号或完整推导公式。检测到的符号/记号附录会出现在项目知识摘要中，但不会自动推导 `pattern` 或 `meaning`。

## 常规流程

首次接入项目并生成上下文：

```bash
npm run workspace -- init
npm run workspace -- open
```

`open` 会从当前目录向上查找 `.math-workspace/config.json`。需要单独刷新索引时仍可运行 `prepare`；检查安装、项目发现和可选工具链时运行 `doctor`。

编辑文件或目录后，固化临时 ID 并刷新报告：

```bash
npm run workspace -- finish path/to/chapter-or-dir
```

`finish` 已执行校验。只有直接使用 `finalize`、执行迁移，或需要独立 release 门禁时，再运行：

```bash
npm run workspace -- verify
```

## Math Workspace

Math Workspace 是 `math-workspace` 引擎之上的本地工作区界面。日常入口是：

```bash
npm run workspace -- open /path/to/project
```

也可以在项目内的任意子目录运行 `open`。不传项目路径且当前目录不在已初始化项目中时，会打开本机项目启动台。底层 `serve` 命令保留给需要明确控制启动行为的脚本：

```bash
npm run workspace -- serve
```

启动台可以从系统目录选择器选择项目，或重开最近项目。选择的目录必须已有 `.math-workspace/config.json`；最近记录只保存在本机用户状态目录，不写入项目源码或 `.math-workspace/`。网页只提交最近项目的索引，目录路径始终由本地 Math Workspace 服务处理。

命令会打印一个仅绑定 `127.0.0.1` 的本地 URL。可在 Codex 的本地浏览器侧栏或普通浏览器中打开。Math Workspace 提供：

- 多书/多卷/章节导航；
- 当前页目录；
- 仅在需要时加载的命题类 recall；
- 全书定义查找与当前页符号表；
- 命题、引理、定理、推论和带 hash 补充注释旁的页内依赖标记；
- 可切换并在本机记忆的源码块起始行号；
- 源文件改动后的实时刷新。

工具栏的行号按钮在正文左侧显示每个可定位源码块的起始行。它用于从渲染结果回到 Markdown 位置，不把视觉换行伪装成源码行，也不改变正文排版；默认关闭，选择只保存在当前浏览器。

依赖标记只读取显式 `@h-...` 关系。圆点上方的短线表示该陈述或证明显式引用了 formal 对象（可为小节、定义或命题）；下方纵线表示后续依赖对象依赖它，分叉表示多个直接下游。主线命题使用常规颜色；带 hash 的、可证明的补充注释使用低强调度的注释颜色。灰色是没有下游对象的终点，蓝色表示被直接引用，绿色分叉表示既有显式前提也被后续对象引用。悬停可查看引用数与传递影响范围；这些是结构信号，不等同于数学重要性。权威依赖图包含命题/引理/定理/推论之间的边，也包含带 hash 补充注释的入边、出边；普通 `注（...）` 不进入图，也没有标记。

打开正文中的“标记工具”后，可使用选区、圈选、命题与擦除。选区工具会将拖拽选中的正文加入标记；圈选会标记闭合区域内的来源块；命题工具可一键选择整条 formal 对象；擦除工具或每个高亮块悬停时右上角的 × 都可单独移除标记。讨论标记只保存项目根、Markdown 文件、行号、可选的 formal/公式锚点和来源 hash，不保存正文，也不创建临时会话或任务绑定。

之后直接在原生 Codex 任务中提问即可。用户提及标记材料时，Codex 可调用 `read_marks`，取得轻量定位后再读取同一项目中的对应 Markdown 源码；因此后续讨论、工具调用、修改与审批完全留在原生任务历史中。这个工作流假定 Math Workspace 和 Codex 面对的是同一项目目录；跨项目共享并非此交互的目标。

项目需要先有 `.math-workspace/config.json`；首次使用可运行 `prepare`。Math Workspace 不要求预先生成 `workspace-index.json`。

旧 VS Code 预览已归档；项目阅读与交互统一通过本地 Math Workspace 提供。

## 探索稿与文档阶段

探索稿比正式文档的“初稿”更早：它可以是灵感、错误尝试或尚未确定进入书稿的材料。探索稿需要在 `.math-workspace/config.json` 中显式配置，而不是按目录名自动发现：

```json
{
  "scan": {
    "exclude": ["draft/**"]
  },
  "documents": {
    "collections": [
      {
        "id": "drafts",
        "title": "探索稿",
        "mode": "draft",
        "include": ["draft/**"]
      }
    ]
  }
}
```

`scan.exclude` 让目录不进入正式扫描；`documents.collections` 让其中 Markdown 仍在 Reader 的可折叠探索稿区出现。探索稿只用于阅读，不生成 formal hash、定义或符号索引、依赖图、Lean 对齐或符号审计输入，因此相关工具在探索稿页默认禁用。

正式文档使用独立的阶段元数据：默认“初稿”，可改为“修订中”或“稳定稿”。目录右键菜单支持单篇或多选批量修改；多选时 Reader 仍打开选中的第一篇。还可以为单篇文档记录 `RC1`、`v1` 等自由格式里程碑，Math Workspace 同时保存当时的内容 hash，并在后续内容变化时标记“有改动”。

状态默认写入 `.math-workspace/documents.json`，以项目相对路径为键。移动或重命名文件后，旧记录会成为 orphan；这是有意的轻量行为，不做不可靠的语义猜测。若需改变状态文件位置，可设置 `documents.stateFile`。

## Codex MCP 入口

Math Workspace 可作为独立本地客户端运行，也可通过 Codex MCP 打开。MCP 可启动或复用本机工作区，也提供讨论标记、命题、严格依赖、Lean 对齐与只读校验查询；它不嵌入或复制工作区渲染，更不维护第二套 Codex 对话实现。

CLI 入口是：

```bash
math-workspace mcp
```

默认项目是 MCP 进程的工作目录。若需要固定项目根，可传：

```bash
math-workspace mcp --root /path/to/project
```

公开 plugin 从 marketplace 安装：

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add math-workspace@glenzli-marketplace
```

plugin 自带 CLI 和 Reader 运行时。开发仓库时先运行 `npm run build`，再将仓库根目录注册为本地 marketplace：

```bash
codex plugin marketplace add /path/to/math-workspace
codex plugin add math-workspace@personal
```

发布版本同样可以从安装包根目录添加 marketplace。插件调用 `open` 打开当前项目或某个项目相对 Markdown 页面；`read_marks` 返回当前标记的轻量源码定位，`lookup_formal_object`、`inspect_dependencies`、`lookup_knowledge`、`inspect_lean_alignment`、`read_symbol_audit` 与 `verify` 提供按需的窄范围上下文。符号审计接口只读取用户已经运行的缓存结果，不会静默调用模型；没有可用项目时会打开 Math Workspace 的本机项目启动台。

MCP 与 Math Workspace 一样只绑定 `127.0.0.1`，不写入书稿或 `.math-workspace/` 产物。

## 学术留档

学术留档把原稿、签名材料及版本关系保存在项目内的 `.math-archive/`。它独立于可重建的 Reader 索引，也独立于文档的“草稿 / 修订 / 稳定”标签。只有显式 `archive sign` 或 Reader 中的“认证并签署”会发起新签名；查看、转换、导入、核验和准备快照均不签署，也不修改正文、提交 Git 或发布作品。

新项目先声明稳定作品 ID、文件范围和签署身份：

```bash
math-workspace archive init --work-id my-book --title "My Book" --path book --identity author@example.com --issuer https://accounts.google.com
math-workspace archive prepare --label "September draft"
math-workspace archive sign --prepared <返回的完整摘要>
math-workspace archive verify
```

`--path` 可重复，默认递归采集范围内的 `.md` 文件；`--extension`、`--depth` 和 `--exclude` 可进一步声明范围。明确指定的单个文件按原字节纳入。目录遍历跳过隐藏目录、Git、依赖及生成输出，拒绝符号链接。Lean 源码或构建材料需要明确纳入范围；签署一份构建记录不等于重新运行证明，也不表示全书已形式化。

准备阶段冻结原始文件字节，记录相对路径、完整 SHA-256、范围、版本名称、签署身份及前驱。后继同时绑定前一份记录和前一份原始 bundle 的摘要；首次通用记录绑定已导入历史的索引摘要。`preparedAt` 和 Git 基础提交仅作定位信息，不替代签名时间。记录按 UTF-8 JSON 编码，键按 UTF-8 字节顺序排序，不留多余空格，末尾一个 LF，数值限于安全整数。

认证完成后再次检查正文集合、范围、身份、前驱及历史对象，再原子更新链头。失败时不覆盖原有有效 bundle；用同一个 `--prepared` 摘要恢复。若进程退出留下本机锁，`archive recover-lock` 仅在记录的本机进程已不存在时释放它。历史记录保持原字节；策略文件可显式编辑，但应保留仍需核验的旧签署身份。

Reader 工具栏的历史图标（提示为“版本记录”）打开时间线，默认显示作品快照，可加入分卷记录，查看原稿、源码、缺失引用、文件差异以及按稳定 ID 找到的历史声明。原稿阅读不套用当前工作区正文或引用目标。界面分别显示签名核验、原稿完整性与当前内容是否被链头覆盖；Lean 状态仍由原有 Lean 功能解释。某个对象在现有材料中的最早出现不是原创性或优先权裁定。

### OET 格式转换与兼容

内置适配器支持 `oet.legacy-signatures/v1` 和 `oet.sign-record/v1`。它读取原始索引、MANIFEST、bundle 和内容对象，不重签旧记录，不改变旧时间，也不为独立旧签名补造前驱。三种原清单哈希均须匹配；未找到的原稿继续列为缺口。OET/IDFS 的 Git 历史搜集和临时清单恢复仍由 OET 工具负责，通用导入器验证转换结果。

在包含 OET 作品目录的仓库中执行：

```bash
math-workspace archive sources
math-workspace archive convert --format oet --from the-operator-evolution-theory/.signatures --out oet-archive.json
math-workspace archive import-oet --from the-operator-evolution-theory/.signatures --initialize
```

`convert` 输出标准交换文件及建议的项目策略。`import-oet --initialize` 采用该作品声明的范围和身份，并执行完整验签；已有策略不同时拒绝覆盖。Reader 的导入流程先展示这些范围和身份，待用户明确执行后才写入。旧 OET 工具继续维护原格式；之后产生的新旧记录可再次转换、导入。新通用签署不依赖逐卷 MANIFEST bundle，直接签署已声明范围内的原稿快照。

### 格式接口与验证材料

`archive formats` 列出支持的证据格式。转换器交换格式为 `math-workspace.archive-exchange/v1`：

- `workId`：稳定作品 ID；
- `records[]`：`format`、原始 `payload` 摘要、原始 `bundle` 摘要及可选 `metadata`；
- `objects`：完整 SHA-256 到原始字节 base64 的映射。

转换器不提供可信的“已验签”结论。导入器逐对象验哈希，由对应 `ArchiveFormat.project` 从原签名载荷解析文件范围和关系，再调用 Cosign 核验签名、身份、透明日志及时间材料。新格式需要增加明确的格式校验适配器，不能把任意旧载荷换成新的 JSON 后沿用原签名。项目配置不会自动执行外部转换程序。可复用的类型和本地接口随 `out/cli/archive.js` 提供，命令入口与 Reader 使用相同实现。

```bash
math-workspace archive export --out evidence.json
math-workspace archive import --from evidence.json
math-workspace archive history --formal-id h-0123456789abcdef
math-workspace archive show --record <记录 ID> --file book/01.md
math-workspace archive compare --left <记录 ID> --right <记录 ID>
math-workspace archive verify --expected-head <独立保存的链头摘要>
```

导出材料包含原稿和原始证据，可在另一项目副本中按所选择的信任策略独立核验。导入保留原记录及原关系，接收项目后续首次签署通过导入索引接续这些材料；不会把导入时间视为历史签署时间。只有提供独立保存的链头才能检查是否回退，单独验证一段历史不能证明它是完整的最新历史。没有对外发布动作；导出包含私人原稿，是否分享由作者决定。

运行签署或密码学核验需要可用的 `cosign` 与 `openssl`。默认采用本地 Sigstore TrustedRoot 缓存，或者 Cosign 自身的信任根获取流程；`--trusted-root` 或 `MATH_WORKSPACE_SIGSTORE_TRUSTED_ROOT` 可指定可信根文件。机器路径不进入签署记录。

MCP `read_archives` 以 `list`、`history`、`source` 提供分页只读查询。先读归档原稿，再解释历史结论；未经本次核验的材料明确标为 `unchecked`。

## Codex 文件链接定位

Codex Desktop 支持用户级自定义文件处理器。安装 Math Workspace 处理器后，Codex 回复中的 Markdown 文件链接可以从“Open in / 打开方式”菜单交给 Reader：

```bash
math-workspace codex-handler install
```

安装命令只维护 `~/.codex/config.toml` 中带有 Math Workspace 起止注释的一小段配置，不覆盖其他 Codex 设置。重启 Codex Desktop 后，在文件链接的打开菜单中选择 Math Workspace；也可以把它保存为当前项目的首选处理器。Codex 会传递绝对文件路径以及可用的行列位置。

如果对应项目的 Reader 页面已经打开，处理器会复用本机服务并让现有页面原位跳转；如果服务存在但没有页面连接，则打开精确的 `path + line` URL；如果服务尚未启动，则先启动一个本地 Reader。目标文件必须是已初始化 Math Workspace 项目内的 Markdown 文件。

检查或移除这项用户级集成：

```bash
math-workspace codex-handler status
math-workspace codex-handler remove
```

这项能力只接管文件定位，不改变 Codex 生成的链接格式，也不把 Math Workspace 变成第二套编辑器或对话界面。

## AI 工作流接入

AI 规则不再放在单独的 public doc 中。目标项目应直接读取随包发布的 AI artifacts：

```text
skills/editor.md      # 具体写作和迁移规则
skills/math-writing.md  # 通用数学撰写、修订与证明审计规则
skills/integrator.md  # 如何融合进目标项目原生 AI 指令
skills/lean-formalization.md  # Lean 锚定、实现与验证规则
```

如果通过 npm 安装，对应路径是：

```text
node_modules/math-workspace/skills/editor.md
node_modules/math-workspace/skills/math-writing.md
node_modules/math-workspace/skills/integrator.md
node_modules/math-workspace/skills/lean-formalization.md
```

如果目标项目使用 VASMC，使用 catalog 锁定工作区、数学写作与融合 artifact；Lean 项目再锁定 Lean artifact：

```bash
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export editor --alias math-workspace-editor
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export math-writing --alias math-workspace-math-writing
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export integrator --alias math-workspace-integrator
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export lean-formalization --alias math-workspace-lean-formalization
```

对于 release bundle，把上面的 catalog 路径替换为：

```text
dist/vasm-catalog/vasmc-catalog.yaml
```

CLI 可打印当前安装中的关键路径：

```bash
npm run workspace -- paths
```

不要自动拉取远端 skill，也不要把 integrator 原样追加到目标 prompt 末尾。应先审阅 artifact，再把规则融合到目标项目已有的 `AGENTS.md`、写作 skill、风格指南或 release 指令中。

## 迁移流程

试运行文字编号引用迁移：

```bash
npm run workspace -- migrate-text-refs path/to/chapter-or-volume
```

应用文字编号引用迁移：

```bash
npm run workspace -- migrate-text-refs --apply path/to/chapter-or-volume
```

试运行旧 ID 迁移：

```bash
npm run workspace -- migrate-ids path/to/chapter-or-volume
```

应用旧 ID 迁移：

```bash
npm run workspace -- migrate-ids --apply path/to/chapter-or-volume
```

## 依赖图

生成依赖图摘要：

```bash
npm run workspace -- graph summary
```

查看某个命题类对象或带 hash 补充注释的局部图：

```bash
npm run workspace -- graph focus <h-id> --depth 2
```

查看下游影响范围：

```bash
npm run workspace -- graph impact <h-id>
```

查看上游依赖：

```bash
npm run workspace -- graph upstream <h-id>
```

汇总章节层面的依赖流：

```bash
npm run workspace -- graph matrix chapter
```

依赖图只记录显式 `@h-...` 引用。报告把主线 theorem-like 对象与带 hash 补充注释分别统计，避免旁支事实改变主线结论；普通 `注（...）` 不成为节点。AI 或领域工具推测出的数学依赖应由目标项目单独维护，不要混入 canonical graph。

## Lean 锚点

在 `.math-workspace/config.json` 中声明 Lean 项目后，`prepare` 会扫描配置源码目录内的 `.lean` 文件，读取具名声明 docstring 中的稳定 hash，并生成：

```text
.math-workspace/lean-index.json
.math-workspace/lean-report.md
.math-workspace/lean-contracts.json        # 显式捕获后才出现
.math-workspace/lean-build.json            # 执行 build 后才出现
.math-workspace/lean-dependency-graph.json # 执行 dependencies 后才出现
.math-workspace/lean-dependency-report.md  # 执行 dependencies 后才出现
```

常用命令：

```bash
npm run workspace -- lean scan
npm run workspace -- lean coverage
npm run workspace -- lean verify
npm run workspace -- lean capture
npm run workspace -- lean build [--project <key>]
npm run workspace -- lean dependencies
```

`scan` 重建索引，`coverage` 打印锚点报告，`verify` 在锚点无法解析、源码根不可读或 docstring 后没有受支持的具名声明时失败。`capture` 把当前正文类型、标题、题面、相关提示/证明/解答与锚定声明签名作为显式审阅基线；基线后的正文或声明改动会显示为漂移。`build` 在每个已配置项目根执行 `lake build [target]` 并记录结果；任何源码变动都会使旧构建结果过期。

`dependencies` 通过 Lean elaborator 读取锚定声明的直接类型与证明值引用，并只与正文中显式、严格的 `@h-...` 边比较。Markdown-only 边是需要核对的候选；Lean-only 边通常是实现细节或复用支撑，仅作为补充上下文。两者都不自动构成数学冲突，也不证明语义等价。

Reader 在命题正文与关系图节点上用轻量 `L` 表示存在一个或多个 Lean 声明锚点。点击正文中的 `L` 可查看锚定声明、正文/声明契约、最近构建和依赖比对状态。这个标记不声称完整形式化或证明覆盖；覆盖以配置的 `coverageTypes` 为基础，并始终保留已锚定习题；数字不能替代范围声明。

## 项目结构

扫描器从路径推断书、卷、章节、导论、总结和附录。

```text
book/
  00-introduction.md
  01-foundations.md
  02-main-results.md
  summary.md
  appendix-a-background.md

multi-volume-book/
  vol-01-foundations/
    intro.md
    01-basic-objects.md
    02-compactness.md
    summary.md
    appendix-a-notation.md
  vol-02-applications/
    03-stability.md
    04-examples.md
```

卷目录只增加导航层，不重置正文章号。

附录采用附录局部编号，例如 `A.1`、`A.2`。

## 配置

常见 `.math-workspace/config.json`：

```json
{
  "language": "zh",
  "scan": {
    "exclude": [
      ".build/**",
      ".context/**",
      "draft/**",
      "notes/private/**"
    ]
  },
  "lookup": {
    "bookDependencies": {
      "advanced-book": ["foundations-book"]
    }
  },
  "lean": {
    "projects": [
      {
        "key": "formal-book",
        "root": "formal-book",
        "sourceRoots": ["FormalBook"],
        "target": "FormalBook",
        "module": "FormalBook",
        "anchorPrefix": "Book anchor:"
      }
    ],
    "coverageTypes": ["theorem", "lemma", "prop", "cor", "remark", "exercise"]
  },
  "render": {
    "pageHeadingStyle": "label-title"
  }
}
```

跨 book 引用和查询必须在 `lookup.bookDependencies` 中显式声明。

Lean 项目的 `root` 与 `sourceRoots` 都相对于 Math Workspace 项目根；`target` 是 `lake build` 的可选目标，`module` 是依赖查询时导入的模块（未设置时使用 `target`）；`anchorPrefix` 必须与 Lean docstring 中使用的前缀一致。`coverageTypes` 控制报告中的候选正文类型，不改变锚点解析。

## PDF 导出

先把 formal 源导出为普通 Markdown，再交给其他发布流程处理：

```bash
npm run workspace -- export-md path/to/book --out dist/book.md
```

导出时保留源目录结构：

```bash
npm run workspace -- export-md-split path/to/book --out dist/public
```

使用本机 Pandoc/LaTeX 引擎从 formal 源直接导出 PDF：

```bash
npm run workspace -- export-pdf path/to/book --out dist/book.pdf
```

渲染已经处理好的普通 Markdown：

```bash
npm run workspace -- render-pdf dist/book.md --out dist/book.pdf
```

`render-pdf` 不扫描 formal 源，不重写 `#h-*`，也不解析 `@h-*`。
它只用共享的 Pandoc 版式参数渲染已经编译好的 Markdown。目标项目
需要自己的 release 后处理时，应使用：

```text
export-md -> project postprocess -> render-pdf
```

默认 PDF 行为：

- 纸张：`a4`；
- 页边距：`2.5cm`；
- 目录：默认开启；
- 目录深度：`2`；
- 目录标题：根据 `language` 选择，例如 `Contents` 或 `目录`；
- 目录独立分页：默认开启；
- PDF 引擎：`xelatex`；
- 封面页：可选，默认 `simple` 风格；
- 出版元数据页：可选，位于封面页之后、目录之前；
- front matter 声明页：可选，位于 metadata 之后、目录之前。

PDF 选项放在 `.math-workspace/config.json` 的 `pdf` 字段中：

```json
{
  "language": "zh-CN",
  "pdf": {
    "title": "书名",
    "subtitle": "卷 I：基础",
    "author": "Author Name",
    "date": "Revised 2026-06-26",
    "titlePage": true,
    "metadataPage": true,
    "license": "CC BY 4.0",
    "repository": "https://example.com/project",
    "frontMatter": [
      {
        "title": "AI 辅助声明",
        "source": "AI-PARTICIPATION.short.md",
        "toc": false
      }
    ]
  }
}
```

CLI 可以覆盖配置，包括 `--pdf-engine`、`--paper`、`--margin`、
`--toc-depth`、`--title`、`--subtitle`、`--author`、`--date`、
`--metadata-page`、`--front-matter`、`--title-page`、`--cover-style`
和 `-V key:value`。

本仓库不捆绑 Pandoc 或 LaTeX 发行版。如果本地缺少 PDF 引擎，先交付
`export-md` 中间稿，等本机引擎安装完成后再运行 PDF 渲染。
