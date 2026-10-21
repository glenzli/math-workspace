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
- Definition lookup: definitions do not get hash IDs or refs; the tool scans standard `定义（术语）：...` / `Definition (Term): ...` entries and uses tables and deepest entries from dedicated concept/glossary pages for supplemental lookup. AI maintains `.math-workspace/definitions.json` only for missing lookup entries, nonstandard definitions, aliases, bilingual lookup, and unreliable boundaries.
- Project knowledge: dedicated concept/glossary, notation, and summary pages are recognized by explicit file names or main titles, regardless of appendix number. Combined concept and notation pages retain both roles. `.math-workspace/project-analysis.json` / `.math-workspace/project-analysis.md` are derived summaries that Math Workspace rebuilds in memory for narrow Codex MCP queries.
- Summary placement: prefer the final appendix of the same book for new concept and notation summaries, following its actual appendix sequence. Reuse suitable existing pages, combine the two purposes when useful, and coordinate their order with solutions and other appendices.
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

### Examples and Counterexamples

Complete, independent examples, worked calculations, and counterexamples may be numbered before any later text cites them. Incidental in-text examples stay ordinary prose. Each numbered object has its own stable ID:

```markdown
Example #tmp-example (Finite sum): Start with a concrete case.

First calculation step.

Second explanation paragraph.

Counterexample #tmp-counterexample (Missing boundedness): Choose the following objects.
```

Chinese declarations are `例 #tmp-example（标题）：...` and `反例 #tmp-counterexample（标题）：...`. Examples and counterexamples share a separate chapter counter, such as “Example 3.1, Counterexample 3.2, Example 3.3”. They never consume the sequence shared by propositions, lemmas, theorems, and corollaries. Figures, tables, equations, and exercises retain their own chapter counters; appendices use A.1, A.2, and so on.

Example recall includes all paragraphs, formulas, lists, fenced code, and worked arguments or proofs until the next formal object, Markdown heading, or thematic break. Headings and declarations inside fenced code remain literal. Use a Markdown thematic break such as `---` to separate following ordinary prose from the example. Source references still use `@tmp-*` / `@h-...`, rather than handwritten display numbers. A numbered example without incoming references is not an audit finding.

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

A solution may live in a solutions appendix near the end of the same book, with its order relative to concept and notation summaries following the overall book structure:

```markdown
Solution #tmp-sol (for @tmp-ex): Pair the terms and add the pairs.
```

Chinese syntax is `习题 #tmp-ex（标题）：...` and `解答 #tmp-sol（对应 @tmp-ex）：...`. Add an optional solution title after a semicolon, such as `(for @tmp-ex; Another method)`. Several solutions may target one exercise, with separate IDs. Each solution displays the original exercise number, such as “Solution to Exercise 2.3”, rather than a new appendix number. Missing targets, targets of another kind, and targets in another book are errors. Use `finish --all` to finalize temporary references across files.

A prompt continues until the next formal object or Markdown heading and includes multiple paragraphs, formulas, lists, and subquestions. Use lists or bold labels for subquestions; a Markdown heading ends the prompt. A separate `Hint:` or `Solution:` paragraph starts support content; leave a blank line before it. Prompt recall excludes support content. The Reader initially collapses hints and answers and provides links in both directions. Markdown and PDF exports include complete hints and solutions and compile their original question numbers and references consistently.

The dependency graph retains exercise and solution references with `layer: pedagogical`. Its separate `pedagogicalLinks` records solution ownership without adding proof cycles. `graph impact` follows references and question/answer associations; Reader mainline importance and `graph bridges` exclude pedagogical references. A mainline result that references an exercise or solution produces a review notice: keep required claims and proofs in the main text so the solution appendix does not supply a missing argument.

When turning a formalized result into an exercise, retain its hash and Lean declarations. Exercises belong to the default `coverageTypes`. Anchored exercises remain in the denominator even if a custom type list omits exercises; solutions do not duplicate the default coverage count. Lean contracts separately fingerprint the statement, associated hints/proofs/linked solutions, and declaration signatures. An answer edit requires review of its question; a question edit also requires review of anchored solutions. Lean dependency comparison attributes explicit strict references in a linked solution to its exercise and records the answer as provenance; ownership itself is not a premise. In `lean-index.json`, `status.markdownChanges` distinguishes `statement` and `proof` changes. Legacy contracts without proof fingerprints are `untracked`; review the source and declarations before running `lean capture` to establish the new baseline.

### Interactive and Static Figures

An image link in its own paragraph declares an interactive figure when its link title is `Interactive figure` or `交互图`. Use project-relative paths for both the image and HTML:

```markdown
[![Operator network evaluation](figures/network.svg)](figures/network.html "Interactive figure")

Figure #tmp-network (Operator network evaluation): Write the caption in Markdown.
```

Ordinary Markdown readers show the image. Math Workspace shows the interactive version in the same place, with a static-image switch and an image fallback if loading fails. Markdown and PDF exports use the saved static image; fenced code examples stay literal. Carry the referenced assets with the published project.

Figure HTML must be self-contained, with inline styles, scripts, and required fonts or images. It runs in an isolated frame without access to the Reader DOM, workspace APIs, or external networks. The project owns the content and layout; Math Workspace handles references, isolated display, size synchronization, and static export.

Before scripts run, the Reader sets `window.mathWorkspaceFigure.mode` to `interactive` or `static`. Use the same drawing function for both modes, with controls and event handlers only in interactive mode. Generate and save the static preview from that same function; the exporter reads the preview without running project scripts. Standalone HTML may default to interactive mode.

Keep a formal caption adjacent to a standalone image paragraph, separated by a blank line. A caption normally follows its image, but may precede it. Reader and PDF preserve that order and group the two together: the figure number and title are centered, and explanatory text appears on a separate, smaller, inset line. PDF keeps the image and caption on one page, so the pair must fit on a page. Portable Markdown retains its ordinary text form. Static and interactive versions of the same figure share one number and caption style.

The Reader synchronizes figure height automatically. Wide mathematical diagrams may retain their layout and implement scaling or horizontal scrolling internally. Check symbol sizes, lines, and captions in the printed version.

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

The tool also recognizes dedicated concept or terminology pages by explicit file names or main titles, such as `appendix-*-concepts.md`, glossary, terminology, or their Chinese equivalents, regardless of appendix number. In those pages, `Term | Definition` / `术语 | 定义` tables and deepest concept-entry headings become supplemental lookup entries. When the file name or main title explicitly identifies both concept and notation purposes, both roles are retained.

Prefer the final appendix of the same book for new concept and notation summaries, following its actual appendix sequence; they may share a page. Reuse suitable existing pages without renaming, moving, or reordering other appendices for detection.

`prepare` writes `.math-workspace/project-analysis.json` and `.math-workspace/project-analysis.md`, listing detected concept, notation, and summary pages. Math Workspace rebuilds the same structure in memory for narrow Codex MCP queries.

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

Do not index generic variables, standard notation, or complete derivation formulas. Dedicated notation pages are recognized by explicit file names or main titles and may share a page with concept summaries. Detection supplies project knowledge context without automatically producing a `pattern` or `meaning`.

### Normal Workflow

Codex installations use the enabled plugin’s CLI, Reader, and generic skills; independent environments use an explicitly installed Math Workspace CLI/npm. See [install.md](install.md) for setup. Keep manuscripts, configuration, and review records in the project; Codex integration does not require another copied tool bundle.

Here `math-workspace` is shorthand for the selected actual CLI: reuse the Reader’s Node/CLI paths and working directory in plugin tasks, use `npx math-workspace` for an npm project dependency, or retain an existing wrapper whose provider is verified.

Initialize a project, generate context, and open the Reader:

```bash
math-workspace init
math-workspace open
```

`open` finds `.math-workspace/config.json` by walking up from the current directory. Use `prepare` when only the index needs to be refreshed, and `doctor` to inspect installation, project discovery, and optional tools.

Edit a file or directory, then finalize temporary IDs and refresh reports:

```bash
math-workspace finish path/to/chapter-or-dir
```

`finish` already validates. Run the strict gate separately only after direct `finalize`, a migration, or when an independent release gate is required:

```bash
math-workspace verify
```

### Creating Chapters and Front/Back Matter

Chapters, prefaces, afterwords, and continued pages each have one maintained source: an ordinary Markdown file inside the project. Check existing manuscripts first, then choose a kind and its book or volume:

| Kind | Purpose and location |
| --- | --- |
| `chapter` | The next chapter of the current book; volume directories do not reset chapter numbering. |
| `front-matter` | The owning book or volume's `front-matter/` directory, which can contain multiple pages with any titles. |
| `back-matter` | The owning book or volume's `back-matter/` directory, which can contain multiple pages with any titles. |
| `continued` | A separate `to-be-continued.md` page for the owning book or volume. |

Front/back matter roles come from placement and do not prescribe titles or genres. An “AI Retirement Note” usually belongs in back matter and can keep that title. Existing `intro.md`, `introduction.md`, and `summary.md` pages remain supported; adopting the new entry point does not require moving them.

In the examples below, `math-workspace` represents the CLI entry from the current installation. An existing project `workspace` script can also use `npm run workspace --`. Standalone CLI users can use `paths` or `help-ai` to locate shipped rules; Codex plugin tasks read current skills and the generated guide. When the Reader supplies exact Node and CLI paths and a working directory, reuse them; projects do not need another global installation or script changes.

Run from the project root that owns `.math-workspace/config.json`. Give `--container` the actual project-relative book/volume directory, or `.` for the project root, rather than its display title. Start with a read-only plan:

```bash
math-workspace create-page --kind back-matter --container book --title "AI 退休寄语" --slug ai-retirement-note --dry-run --json
```

The plan returns fields including `kind`, `title`, `container`, `filePath`, `exists`, and `stateToken`. Check the owning book/volume, destination, and whether a manuscript already exists. Replace `PLAN_STATE_TOKEN` below with the returned value to create the empty manuscript:

```bash
math-workspace create-page --kind back-matter --container book --title "AI 退休寄语" --slug ai-retirement-note --expect-state PLAN_STATE_TOKEN --json
```

The title must be nonempty and fit on one line. Optional `--slug` controls only the filename stem; `continued` has a fixed filename and does not accept `--slug`. The helper allocates the path, order, and stable page ID, then creates an empty Markdown file with a heading without overwriting source. The author or AI writes the body. Existing files are preserved, and a book/volume cannot acquire a duplicate continued page; check whether the existing manuscript should be continued. Refresh outdated plans with another read-only plan; if project, kind, title, container, and destination are unchanged, continue with the new token. Review changed destinations or reuse existing manuscripts first. Let the helper supply chapter numbers and hashes, and do not create a duplicate to bypass a collision.

Write the body at the returned `filePath`, keep its page ID, and run `finish` on that file. Creation does not add it to a publication profile. For publication, explicitly reference this manuscript through `frontMatter[].file`, `backMatter[].file`, or `continued.file`, so everyday reading and the PDF use the same content.

The Reader's “＋” offers the same creation workflow: enter a title, choose the kind and current book/volume, review a read-only plan, then add the request to the Codex input. The request includes the actual command entry and working directory and is not sent automatically. Without conversation-host support, copy the request. The Reader does not write source manuscripts or automatically select new pages for publication.

### Local Math Workspace

The normal Reader entry is:

```bash
math-workspace open /path/to/project
```

You can run `open` from any subdirectory of an initialized project. If no path is supplied and the current directory is outside one, it opens the local project launcher. The lower-level `serve` command remains available for scripts that need explicit launch behavior:

```bash
math-workspace serve
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

The upper-right toolbar keeps frequent Lean comparison and Contents actions directly available as compact icon buttons with hover text. Related tools have separate menus: Reference contains Definitions and Symbols, Review contains Proposition review and Symbol audit, Versions & publication contains Version history and PDF publication, and Display contains interface language, appearance, source line numbers, and text size. Embedded panels also keep Full screen available in the toolbar. Only one menu opens at a time. Menus support arrow keys, Home and End. Escape closes the menu and returns focus to its category button.

**Display → Language** offers **Auto**, **中文**, and **English**; **Display → Appearance** offers **Auto**, **Light**, and **Dark**. Automatic language selection uses the first supported Chinese or English locale from Codex or another MCP host, then the browser, and falls back to English. Automatic appearance follows the host when available, then the system. Manual choices take precedence and can be saved for later use; if the environment cannot save them, they remain effective for the current session.

Interface and manuscript languages are independent. The `language` field in `.math-workspace/config.json` controls manuscript labels and displayed numbering and supplies the default PDF language; publication profiles or explicit PDF options can override that default. Changing interface language or appearance does not rewrite manuscript sources or project configuration, or change these publication settings. Light and dark modes retain the semantic colors for Lean associations, warnings, errors, and dependencies.

In Display, Source line numbers shows each locatable source block's starting line in the article gutter. It helps map rendered content back to Markdown without pretending that visual wraps are source lines or changing article layout. The view is off by default and its preference stays in the current browser.

Dependency markers read only explicit `@h-...` relationships. A short line above the dot means the statement or proof explicitly references formal items such as a section, definition, theorem-like object, or proof-backed hash remark. A vertical line below means a later dependency node depends on it; a fork means multiple direct downstream nodes. Mainline theorem-like nodes use the ordinary impact colors: muted is a terminal node, blue is directly cited, and green is both explicitly grounded and cited later. Hash remarks use a muted supplemental color and label; plain `注（...）` / `Remark (...)` entries have no graph node or marker. Hover for reference and transitive-impact counts. These are structural signals, not measures of mathematical importance.

In a Math Workspace plugin panel beside a conversation, select text or click a formula, then click the quote icon in its popover. The tooltip reads “Quote in conversation.” The quote carries original Markdown or LaTeX, its file path, and its source-line range into the current conversation input. Add a question and send when ready; selecting content does not start a model turn.

For multiple passages, select and quote each one into the same conversation input, then add a question and send them together. Quote and copy buttons have the same compact size. A failed handoff keeps the popover available for retry. Opening or navigating pages only saves reading position and does not add automatic conversation references.

The Reader in an ordinary local browser supports Markdown selection and copying. Conversation references require the Math Workspace plugin panel beside a conversation; the UI explains where to use that feature. Discussion, tool calls, edits, and approvals remain in the native conversation.

On narrow screens, ordinary long formulas wrap at safe relation and operator boundaries while keeping atomic groups, fractions and matrices intact. Expressions that remain too wide scroll within the formula, with their beginning visible and keyboard scrolling available on focus. Multiline derivations use slightly more generous default leading; explicit source spacing and layout commands take precedence.

For complex long display formulas, click the formula and use the Adapt formula icon in its popup to reflow it to the available width, or restore its original layout. Only this action loads the locally bundled MathJax renderer; formulas are not sent to an external service. Unsupported or failed adaptations retain the original formula. Display adjustments preserve the original LaTeX, formula numbering, source locations, copied text and conversation references. PDF output continues to use its paper layout.

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

The sidebar, page header and stage choices share the same document icons: a blank document for Initial Draft, a document with a pencil for Revising, and a document with a check for Stable Draft. The sidebar keeps a compact icon with a hover description. The header keeps the stage icon and name, with milestone and Changed information alongside it. Both the header stage panel and navigation context menu use the same icons beside their stage labels. On narrow screens, the title and stage move to a second row so the stage name and category controls remain visible.

State is stored in `.math-workspace/documents.json` by default and keyed by project-relative path. Moving or renaming a file leaves the old record orphaned by design instead of guessing semantic identity. Set `documents.stateFile` to use another project-relative state path.

### Codex MCP Entry

Codex installations use the plugin’s bundled runtime and generic skills; independent environments use the standalone local CLI. MCP starts or reuses the local workspace and provides narrow selection, formal-object, strict-dependency, Lean-alignment, and read-only validation queries. Desktop hosts with MCP plugin extension support can open Math Workspace from the global sidebar or open a Reader panel beside a conversation. Both entrypoints reuse the existing Reader without a second renderer or Codex discussion interface.

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

The plugin calls `open` for the current project or a project-relative Markdown page. Reader selections can be added directly to the current conversation input; `lookup_formal_object`, `inspect_dependencies`, `lookup_knowledge`, `inspect_lean_alignment`, `read_symbol_audit`, and `verify` provide focused context on demand. The audit tool only reads results the user has already generated; it never starts model work. If no prepared project is available, `open` shows the local project launcher. MCP uses local standard input/output; its Reader binds only to `127.0.0.1`. Queries do not modify manuscript or Lean source. `read_lean_review_context` reads one object's current comparison material, while `submit_lean_review_candidates` saves only explicitly requested assistance candidates, never human verdicts. Reader saves independently check the current revisions.

When the host supplies exactly one current project containing `.math-workspace/config.json`, the sidebar and conversation entrypoints open it directly; otherwise they show the project chooser and recent projects. Each panel keeps its own project, page, and scroll position. Closing one panel stops only its Reader instance; another panel is unaffected. Both load the Reader directly in the plugin resource and access each view’s local API through MCP, retaining its source access and mutation checks. Local HTTP frames are not required.

Content enters the conversation input only when the user clicks the quote button in a selection popover. Hosts without UI entrypoint support can still use `open` to launch the local Reader. After updating the plugin, start a new conversation to load its new tool metadata.

### Academic Archives

Academic archives retain original drafts, signing evidence, and version relationships in the writing project's `.math-archive/` directory. This storage is separate from rebuildable Reader indexes and document stage labels. Daily signing uses explicit volumes and a total record; only `archive sign` or the Reader's Authenticate and sign action starts a new signature. Reading, conversion, import, verification, and preparation do not sign, edit source prose, commit Git changes, or publish a work.

Declare a stable work ID, a file scope, and an accepted signing identity:

```bash
math-workspace archive init --work-id my-book --title "My Book" --path book --volume vol-i=book/vol-i --volume vol-ii=book/vol-ii --volume-title "vol-i=Volume I" --volume-title "vol-ii=Volume II" --identity author@example.com --issuer https://accounts.google.com
math-workspace archive prepare --label "September draft"
math-workspace archive sign --prepared <returned-operation-digest> --auth-flow normal
math-workspace archive verify
```

Repeat `--path` for several source roots. Directory scopes recursively include `.md` files by default; use `--extension`, `--depth`, and `--exclude` to refine the scope. Explicitly selected files are captured as original bytes. Directory traversal skips hidden paths, Git, dependencies, and generated output, and rejects symbolic links. Include Lean source or build evidence explicitly when needed. Signing a build report neither reruns a proof nor establishes complete formalization.

Volumes are explicit archive-policy entries, `volumes: [{ id, title, paths }]`. Directory names, depth, and file counts never infer volumes. Repeat `--volume ID=PATH` to declare them and use `--volume-title ID=TITLE` for names; volumes cannot overlap. The policy's `scope` defines all work files, and volumes partition only part of that set. The total still covers outside-volume files. With no declared volumes, a total covers the entire scope as outside-volume files.

An existing project can update its policy using either form below. `--policy` reads a complete policy JSON containing the work ID, scope, identities, and volumes. Updates retain the stable work ID and accepted historical identities.

```bash
math-workspace archive update-policy --volume vol-i=book/vol-i --volume vol-ii=book/vol-ii --volume-title "vol-i=Volume I" --volume-title "vol-ii=Volume II"
math-workspace archive update-policy --policy archive-policy.json
```

Preparation freezes original bytes and records their relative paths, full SHA-256 digests, policy, label, signer, and predecessor. It reports which volumes need signatures, which original receipts can be reused, and the outside-volume files. Each `math-workspace.archive-volume/v1` binds an exact file set. Under the same policy and file mapping, an unchanged volume reuses its verified original record and bundle without a new signature or replacement signing time. Changed volumes are signed first, then `math-workspace.archive-total/v1` is generated and signed. The total binds each exact volume record and original bundle digest and includes the complete in-scope file mapping. Root documents, drafts, and review material remain covered even when they belong to no volume.

A total successor binds both the preceding record and its original bundle digest. The first native record binds the imported history indexes. The returned `prepared` digest identifies a signing operation; the final total payload digest can differ. Retain `head.record` from the signing result for an independent `verify --expected-head` check. `preparedAt` and a Git base commit are locators, not independently authenticated signing times. Signed records use UTF-8 JSON with keys sorted by UTF-8 byte order, no insignificant whitespace, one final LF, and safe integer values.

`--auth-flow normal` is the default and explicitly uses Cosign's browser authentication and localhost callback, including Reader background operations. Choose `--auth-flow device` when device authentication is needed. Each new signature may require authentication; the Reader shows the authentication link and signing progress, and displays a device code only when one is supplied. After authentication, the workflow rechecks the source set, policy, identity, predecessor, and historical objects before atomically publishing the head. A partial failure retains completed volume signatures and valid bundles. Retry the same `--prepared` operation digest; partial completion does not publish a total. Prepare again if source or policy no longer matches the plan. `archive recover-lock` releases a local abandoned lock only when its recorded process no longer exists.

In the Reader, Versions & publication → Version history opens a timeline with totals and work snapshots, optional volume records, original text, source view, gaps, file comparisons, and stable-ID history. Preparation shows changed volumes, reused original receipts, completed new signatures, and outside-volume file digests. Total details show the bound volume receipts and provide independent volume exports. Action buttons use icons, hover text, and accessible names. Historical reading does not substitute current workspace content or reference targets. Signature validity, source completeness, and current-source coverage by the active head are shown separately. A valid historical signature can still have source gaps. Lean status remains with the existing Lean tools. The earliest occurrence in available evidence does not establish original authorship or priority.

#### Daily History and Locally Hidden Records

Existing single-snapshot records retain their original bytes. Hiding changes only the local daily list. Choose Include locally hidden records in the Reader to inspect, restore, or export them. The default `list` omits hidden rows; verification and full exports always include them. Hiding cannot bypass an invalid signature.

```bash
math-workspace archive list
math-workspace archive list --include-hidden
math-workspace archive hide --record <record-ID>
math-workspace archive restore --record <record-ID>
math-workspace archive hide --record <active-head-record-ID> --retire-head
math-workspace archive verify
math-workspace archive export --out all-evidence.json
```

`--retire-head` explicitly retains the original active branch and rolls the active head back to its original predecessor, or clears it when no predecessor exists. It does not delete, rewrite, or manufacture signed evidence. Restoring visibility does not reactivate a retired head. Later signing prepares a new total from the active head. Hiding alone does not change predecessors or the current-source coverage calculation.

#### OET Conversion and Compatibility

Built-in adapters accept `oet.legacy-signatures/v1` and `oet.sign-record/v1`. They read the original index, MANIFEST files, bundles, and content objects. They do not re-sign older records, replace their time evidence, or invent predecessor links between independent signatures. All three original manifest hashes must match; unresolved original content remains a gap. OET tooling continues to own Git-history collection and historical temporary-manifest reconstruction. The generic importer validates the converted evidence.

From the repository containing the OET work directory:

```bash
math-workspace archive sources
math-workspace archive convert --format oet --from the-operator-evolution-theory/.signatures --out oet-archive.json
math-workspace archive import-oet --from the-operator-evolution-theory/.signatures --initialize
```

`convert` writes the exchange document and reports a suggested project policy. `import-oet --initialize` adopts the declared work scope and identities and performs cryptographic verification; it will not replace a different existing policy. The Reader previews the scope and identities before an explicit import action. Older handwritten volume and root MANIFEST histories remain readable, verifiable, and exportable. New signatures use native volume records and totals without rewriting old MANIFEST files or replacing original bundles. An OET volume policy should explicitly declare its nine actual volumes; other in-scope root, draft, and review files belong to the total's outside-volume coverage, not inferred volumes.

#### Format Interface and Portable Evidence

`archive formats` lists the accepted evidence formats. The `math-workspace.archive-exchange/v1` transport contains:

- `workId`: the stable work identifier;
- `records[]`: a format ID, original payload digest, original bundle digest, and optional metadata;
- `objects`: full SHA-256 digests mapped to base64-encoded original bytes.

A converter cannot supply a trusted verified status. Import checks object digests, then the corresponding `ArchiveFormat.project` derives file membership and relationships from original signed evidence. Cosign verifies the signature, identity, transparency-log material, and time evidence. A new evidence format needs an explicit validating adapter. Reformatting an old signed payload as new JSON cannot preserve its old signature. Project configuration never executes arbitrary converter code. Reusable types and local APIs ship in `out/cli/archive.js`; the CLI and Reader use the same implementation.

```bash
math-workspace archive export --out evidence.json
math-workspace archive export --record <volume-record-ID> --out volume-evidence.json
math-workspace archive import --from evidence.json
math-workspace archive history --formal-id h-0123456789abcdef
math-workspace archive show --record <record-ID> --file book/01.md
math-workspace archive compare --left <record-ID> --right <record-ID>
math-workspace archive verify --expected-head <independently-retained-head-digest>
```

A full export includes hidden history, original drafts, and evidence for verification in another project copy under the chosen trust policy. `export --record` exports the original evidence closure required by the selected record. An independent volume export includes its signed payload, original bundle, bound policy, and exact source bytes; compare its payload and bundle digests with the total's volume pointers. A volume receipt alone does not establish membership in an unavailable total or signing of the entire work. Import preserves the original records and relationships. The receiving project's next native signing operation binds the import indexes; import time never replaces historical signing time. An independently retained head enables rollback checks. Verifying one history alone cannot establish that it is complete or current. Export does not publish anything, and the author chooses whether to share the private drafts it contains.

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

Codex plugin tasks read the currently enabled plugin’s generic skills and generate the workspace `agent-guide.md` through the same plugin. Project-specific skills retain project constraints without embedding generic rules or installing another tool bundle.

Standalone CLI and other-host users may review the AI artifacts shipped with the package:

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

Explicit standalone artifact/VASMC consumers can lock the required catalog exports; this is not a default dependency for Codex plugin projects:

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

The standalone CLI can print shipped artifact paths; Codex plugin tasks use their current plugin skills and generated guide:

```bash
math-workspace paths
```

Do not auto-fetch remote skills, and do not append the integrator guide verbatim to a target prompt. Review the artifacts first, then merge the rules into the target project's existing `AGENTS.md`, writing skill, style guide, or release instructions.

### Migration Workflow

Dry-run text reference migration:

```bash
math-workspace migrate-text-refs path/to/chapter-or-volume
```

Apply text reference migration:

```bash
math-workspace migrate-text-refs --apply path/to/chapter-or-volume
```

Dry-run old ID migration:

```bash
math-workspace migrate-ids path/to/chapter-or-volume
```

Apply old ID migration:

```bash
math-workspace migrate-ids --apply path/to/chapter-or-volume
```

### Dependency Graph

Generate the graph summary:

```bash
math-workspace graph summary
```

Inspect one dependency node (a theorem-like object or proof-backed hash remark):

```bash
math-workspace graph focus <h-id> --depth 2
```

Find downstream impact:

```bash
math-workspace graph impact <h-id>
```

Inspect upstream dependencies:

```bash
math-workspace graph upstream <h-id>
```

Summarize chapter-level flow:

```bash
math-workspace graph matrix chapter
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
math-workspace lean scan
math-workspace lean coverage
math-workspace lean verify
math-workspace lean capture
math-workspace lean build [--project <key>]
math-workspace lean dependencies
```

`capture` records a reviewed baseline for the Markdown object's type, title, statement, associated proof/solution content, and anchored declaration signature; later changes surface as contract drift. `build` runs `lake build [target]` in configured project roots and records the result; source changes make an older result stale. `dependencies` uses Lean elaboration to inspect direct references in anchored declaration types and proof values, then compares them only with explicit strict Markdown `@h-...` edges. Markdown-only edges merit review; Lean-only edges usually provide implementation or reusable-support context. Neither kind establishes a mathematical conflict by itself.

The Reader marks anchored statements and graph nodes with a compact `Lean` badge. Clicking an in-text `Lean` badge shows its anchored declarations, contract, latest build, and dependency-comparison state; **Lean comparison** in the toolbar opens the side-by-side review workbench. These are auditable engineering signals, not a claim of semantic equivalence, complete formalization, or proof coverage. Coverage starts from configured `coverageTypes` and always retains anchored exercises; these numbers cannot substitute for a scope statement.

#### Human review of Lean and prose

The comparison workbench keeps prose and Lean side by side. Switch between the statement, associated proofs and necessary context, and open the anchored declaration's complete source range. Each side scrolls independently; chapter queues and background status updates preserve the comparison position. Basic source reading does not wait for live Lean semantics to start.

The Reader's Lean review panel uses the stable formal-object ID to show the current statement, associated proof/hints/solutions, nearby context, explicitly referenced prose objects, and anchored declaration locations. **Refresh evidence** uses the project's already installed Lean toolchain to run a bounded, cancellable, offline local build and elaborator query. It displays complete types, including implicit parameters, section assumptions and certificate inputs, and recursive axioms returned by Lean `collectAxioms`, including `sorryAx`. It runs only with an existing Lake manifest and locally materialized dependencies. It does not install toolchains, dependencies or caches, or call a model. Opening the panel reads existing evidence; missing, failed and stale evidence are labelled explicitly.

Expand key definitions to inspect source and elaborated types/values, including wrapper predicates and input assumptions. Machine facts (anchor links, build result and evidence freshness) remain separate from human verdicts. Choose **Aligned within scope**, **Partial**, **Difference** or **Undecided**, and enter the scope, note and reviewer. Define subclaims manually and map each to one or more declarations, or leave a subclaim unmapped. A successful build or evidence refresh never creates or refreshes a human conclusion.

Declarations and key definitions can open their complete Lean file in a read-only source viewer with search, folding, location, copying and range selection; long files render the visible region. Highlighting recognizes Lean comments, strings, doc comments, keywords and declaration structure. Source changes are labelled rather than silently retaining an old position. Previous/current material uses unified line differences with previous/current source line numbers, additions, removals and context; bounded snapshots retain truncation notices.

**Start Lean semantics** connects the already installed local Lean language server when its read-only protocol is supported. It provides real cursor hover types, definitions, tactic goals/expected types, diagnostics and semantic tokens supported by that server. F12 or ⌘/Ctrl click follows a definition, with a source return path. Missing toolchains, local dependencies, protocol capabilities or isolation support are labelled unavailable; complete source remains readable and lexical highlighting is never presented as semantic evidence. Live semantic sessions currently require the native read-only, network-isolated process boundary on macOS; complete source preview remains available on other platforms. Live semantics and deliberately saved build evidence are independent. Opening a file does not build, install dependencies or update human conclusions.

Saving records only the current object in `.math-workspace/lean-reviews/<h-id>.json`; explicit refresh caches bounded object evidence in `.math-workspace/lean-review-evidence/<h-id>.json`. A record includes the verdict, time, subclaim mappings, a limited review snapshot and bounded human decision history, and is restored after reopening the Reader. Saves check both the record revision and the displayed evidence fingerprint. If another window has saved, or source has just changed, reload and inspect the current evidence before saving. These records are independent of the existing whole-index `lean capture` contract and never mark other objects reviewed.

**Source associations and issues** lets a reviewer select exact prose from the current statement, proof or related excerpts, and a corresponding range from a Lean excerpt or the complete source viewer. Attach the link to a saved human subclaim, enter its scoped verdict and notes, and list explicit assumption/symbol correspondences. Each link retains both file hashes, quotes and positions in `.math-workspace/lean-audits/<h-id>.json`. Only deliberately created review artifacts are persisted; source Markdown and Lean files are read-only and no source index is created.

Issues reference a link with both source ranges. Categories cover assumptions, symbols, scope, statements, proofs, trust and other concerns. Human dispositions are open, resolved or dismissed, with a rationale. Changes to either file, object evidence, linked human subclaim or correspondence make earlier decisions stale; a formerly resolved issue remains actionable. Ranges are never automatically rebased. Explicitly select and recheck both ranges, then record the issue recheck rationale. After another window saves, old drafts retain their original revision and cannot overwrite the newer record.

The whole-project overview includes manual freshness across chapters, unanchored/unreviewed objects, stale links and unresolved issues, with filters and navigation. Export a current Markdown review report. History includes ordinary object verdicts and link/issue actions: at most 50 object decisions (1.5 MiB) and 120 audit actions (1 MiB) are retained, with explicit dropped counts. The overview supports at most 3000 current objects, and reports at most 500 objects with positional audit records. Exceeding a bound reports an error rather than exporting an incomplete report. Quoting audit material prepares candidate discussion without sending or applying a human verdict.

Statement, associated proof, declaration, expanded definition or build-environment changes make the old human conclusion stale, with previous/current text available for comparison. Lean evidence uses conservative **project inputs** invalidation: changes to the configured project's or its local dependencies' Lean sources, lakefile, manifest, toolchain or target invalidate elaborated evidence. This is not a localization of the semantic difference. Prose context follows explicit references only; if it exceeds the bounded snapshot, freshness conservatively tracks all workspace Markdown fingerprints without creating a source knowledge base. The current page/chapter queue retains unanchored objects, reviewer and review time. Quoting evidence into a native conversation prepares discussion material; it does not send a message or save a verdict automatically.

An interrupted process may leave `.math-workspace/lean-review-refresh.lock` or an object's `.lock` file. After confirming that process has stopped, remove the stale lock manually before retrying. If the declaration's actual defining module cannot be bound to the anchored source, its elaborated evidence remains unavailable.

#### Codex-assisted review

Choose an assumptions, statement, proof or changed-material review task in the comparison panel, then add its current object location and task to the Codex conversation input. Nothing is sent automatically. Ordinary browsers can copy the same task; native panels can quote it directly into the current input. Codex reads bounded project/object material through `read_lean_review_context` and returns candidate concerns through `submit_lean_review_candidates`, without manually copying each answer into the Reader.

Candidates live in `.math-workspace/lean-assistance/<h-id>.json`, separately from build evidence, source associations and human decisions. They carry source-evidence and review revisions; old candidates cannot be applied after the source or corresponding records change. A reviewer can add individual candidates to an **Undecided** local draft or dismiss them, then check the actual scope and explicitly save a human verdict. Candidate submission does not build Lean, change source, approve a result or replace human sign-off.

### Project Structure

The scanner recognizes books, volumes, chapters, front/back matter, continued pages, and appendices from their paths. Legacy introduction and summary pages remain supported. For example:

```text
book/
  front-matter/
    01-preface.md
    02-readers-letter.md
  01-foundations.md
  02-main-results.md
  appendix-a-background.md
  back-matter/
    01-ai-retirement-note.md
  to-be-continued.md

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

Volume directories add a navigation layer without resetting chapter numbers.

Numeric prefixes inside `front-matter/` and `back-matter/` control order, not chapter numbers. After a container is chosen, the `create-page` plan allocates paths and order; the author still chooses titles and content.

Appendices use local numbering, such as `A.1` and `A.2`.

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

### Publish Selected Chapters as PDF

To publish a book in stages, open **Versions & publication → PDF publication** in the Reader. Select this edition’s volumes and chapters, then maintain shared work details under **Layout & details → Project metadata**. Store only edition overrides, its version, date and DOI in the plan. Edit websites, repository URLs and each author’s native name, aliases, ORCID and affiliation there. Review the resolved metadata, included and omitted pages, manuscript sources and references outside the edition before building, previewing and downloading the PDF. Zenodo upload and public publication remain separate later actions.

A publication plan stores selections and metadata without rewriting the manuscript. The body retains the original chapter and object numbers for the whole book: selecting chapters 3 and 5 does not renumber them as chapters 1 and 2. The finished order is cover, publication metadata, front matter, contents, selected body pages, back matter, and the “To be continued” declaration included by default for a partial edition. The contents and declaration can be disabled in the plan. References outside the selected scope are listed for review and do not automatically add other chapters.

Prefaces, afterwords and the continuing-work declaration can live directly in manuscript files. Read them in the Reader during normal writing, then reference those same sources for publication. For example:

```text
book/
  front-matter/
    preface.md
    readers-letter.md
  vol-i/
    intro.md
    01-foundations.md
    summary.md
  back-matter/
    conclusion.md
    ai-retirement-note.md
  to-be-continued.md
```

The `front-matter/` and `back-matter/` directories can contain several pieces with any headings the author chooses. Numeric filename prefixes such as `01-` and `02-` control their order without becoming chapter numbers. For example, `ai-retirement-note.md` can be titled “An AI's retirement letter”; it does not have to become a conclusion. `to-be-continued.md` is a separate final page. Existing `intro.md`, `introduction.md` and `summary.md` files remain supported. Front matter and back matter within a volume stay at that volume's beginning and end. Keep stable page identifiers under the manuscript's normal rules. File references and relative images use the same compilation rules as the body.

New Reader plans automatically include structurally identified prefaces, endings and appendices for the selected books and volumes. CLI profiles opt in with `"matter": { "automatic": true }`. Book-wide matter goes into its corresponding front/back position, volume-level matter stays around that volume, and appendices remain numbered body pages. Roles come from manuscript structure rather than arbitrary prose headings. Other books and unselected volumes are not imported. A uniquely matching continuing-work page may be reused; choose an explicit page when several match.

Exclude individual automatic pages with the Reader controls or `matter.exclude` paths. **Customize inclusion and order** converts the current result into manual selections; front/back entries can then be moved up, moved down or removed. Existing plans retain their scope until automatic inclusion is explicitly enabled. Creating a manuscript does not rewrite a saved plan; automatic plans rediscover matching pages when planned again.

A file assigned to front matter, back matter or a declaration is not printed again in the body. Resolve duplicate roles before building. The review shows actual source paths and content; source, resource or metadata changes require another review.

#### Shared Work Metadata and Edition Overrides

Maintain shared work details in `.math-workspace/config.json.metadata`, merging with the existing configuration:

```json
{
  "metadata": {
    "title": "My Book",
    "subtitle": "Foundations",
    "authors": [{
      "name": "Author Name",
      "nativeName": "作者本名",
      "aliases": ["Author Alias"],
      "orcid": "https://orcid.org/0000-0002-1825-0097",
      "affiliation": "Research Institute"
    }],
    "language": "en-US",
    "description": "A description of the work.",
    "website": "https://example.org/book",
    "repository": "https://github.com/example/book",
    "license": "cc-by-4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "keywords": ["mathematics"],
    "preferredCitation": "Author Name. My Book."
  }
}
```

An existing work DOI belongs in `metadata.doi.conceptDoi`, with its source note in `metadata.doi.provenance`. An edition DOI belongs in `profile.doi.versionDoi` or the edition’s Zenodo binding. Do not use a previous edition DOI as the work DOI.

The Reader edits project values and per-field edition overrides, including individual author identities. Turn off an edition override to inherit again. The same CLI supports:

```bash
math-workspace publication metadata
math-workspace publication save-metadata metadata.json --expected-revision <revision returned by metadata>
```

The input file contains only the common fields inside `metadata`, without the response’s `value`/`revision` envelope. Saving checks the complete current config revision and preserves other configuration keys. Reload before saving a conflicting update. Reader retains unsaved drafts; refreshing does not silently rebase a draft over someone else’s changes.

Resolution uses legacy `pdf` identity fields as a compatibility fallback, then project metadata, then explicit edition overrides. Missing fields inherit; empty text or lists clear optional values. Authors replace the whole list; DOI fields merge individually. A resolved title is required. Version, edition note, publication date, source tag/commit and edition DOI belong to an edition. Existing explicit profile fields remain overrides until the author chooses to inherit.

The immutable build records common values, overrides and resolved metadata. PDF, `citation.json` and Zenodo use that same resolution. PDF publication pages include websites, repository URLs, licenses, author identities and DOI; the abstract and keywords also feed PDF properties. Citation JSON retains ORCID/affiliation, source links, license, language, abstract, date and DOI. Zenodo uses creators/ORCID/affiliations and subjects; website and repository URLs use `isDescribedBy` and `isDerivedFrom`. Supplemental native names, aliases, preferred citation and license links go into Notes. Metadata changes require another plan and build; existing artifacts and published editions retain their frozen values. See the [Zenodo API](https://developers.zenodo.org/) and [InvenioRDM metadata reference](https://inveniordm.docs.cern.ch/reference/metadata/) for provider fields.

#### Minimal Profile and Local Build

Run from a project root containing `.math-workspace/config.json`. Put actual chapter paths in `publication.json`. Title and authors inherit from project metadata unless overridden; select at least one chapter:

```json
{
  "id": "book",
  "workId": "my-book",
  "version": "0.1.0",
  "chapters": [
    "book/vol-i/01-foundations.md",
    "book/vol-i/02-main-results.md"
  ],
  "matter": {
    "automatic": true
  },
  "frontMatter": [
    {
      "file": "book/front-matter/preface.md",
      "includeInToc": false
    },
    {
      "file": "book/front-matter/readers-letter.md",
      "includeInToc": true
    }
  ],
  "backMatter": [
    {
      "file": "book/back-matter/conclusion.md",
      "includeInToc": true
    },
    {
      "file": "book/back-matter/ai-retirement-note.md",
      "includeInToc": true
    }
  ],
  "continued": {
    "enabled": true,
    "file": "book/to-be-continued.md"
  }
}
```

`id` reopens the same publication plan; `workId` identifies the work across editions, and `version` identifies this edition. When adding chapters or volumes later, continue editing the same plan, save with its current revision, and retain old builds and provider bindings.

```bash
math-workspace publication inspect
math-workspace publication save publication.json --expected-revision new
math-workspace publication plan book
math-workspace publication build book --fingerprint <fingerprint returned by plan>
math-workspace publication status book
```

These commands return JSON. Use `--expected-revision new` for the first save; for updates, use `profile.revision` from `status`. Both `plan` and `build` also accept a profile JSON path. Build with the `fingerprint` from the plan just reviewed. Replan and review after manuscript, metadata or resource changes. Omitted manuscript pages can still contribute to whole-book numbering and remain bound inputs of the build.

Optional configuration follows. Paths are relative to the project root and refer to files within the project:

| Field | Purpose |
| --- | --- |
| `scope.books`, `scope.volumes`, `scope.paths` | Define the work's scope with book/volume identities from `inspect` or directory paths. Their union determines which pages remain omitted. When unspecified, use the selected chapters' books, or the project scope when those pages have no book. |
| `cover.image`, `cover.showVersion` | Optional cover image and version display. |
| `frontMatter`, `backMatter` | Arrays of front matter and back matter. Each entry can reference project Markdown through `file`. Its first H1 supplies the default heading; `title` can override that heading, and `includeInToc` controls the contents entry. Without `file`, the existing inline `content` field remains available. |
| `toc.enabled`, `toc.depth`, `toc.title` | Contents switch, depth and heading. |
| `continued.enabled`, `continued.file`, `continued.title`, `continued.text` | Declaration switch and manuscript reference. `file` supplies the content when present, and `title` can override its heading. Without a file, use inline `text`, then the default declaration. A referenced file is enabled when the switch is unspecified. Existing plans with neither a file nor an explicit switch enable the declaration only for partial editions. An explicitly enabled declaration is also included when all chapters are selected. |
| `pdf.engine`, `pdf.paper`, `pdf.margin`, `pdf.documentClass` | Local PDF engine and layout. |

Existing inline front matter, back matter and declarations continue to work and are not automatically converted into manuscript files. Selecting a file retains any existing `content` or `text` as a fallback; it does not append that text to the file's content. Clear the file selection to return to inline or default text. This preserves existing plans while allowing normal reading and PDF publication to share one manuscript source. Referenced files must be project Markdown that is not excluded from scanning. Paths cannot traverse directories or follow symbolic links.

Building requires local Pandoc and a LaTeX engine; the default is `xelatex`. Chinese publication profiles use `ctexart` when `pdf.documentClass` is not set, requiring CTeX. On macOS, an already installed, readable system Songti font is reused; other environments use TeX’s Fandol. The selected font and its file details are recorded with build tools; no fonts are installed or copied. Explicit document classes and English defaults retain their existing behavior. `inspect` reports whether the tools are available. If tools are missing, save and review the plan first, then build after installing them.

Each build is retained under `.math-workspace/publications/builds/<id>/<build-id>/`, with `publication.pdf`, `compiled.md`, `manifest.json`, `citation.json`, `checksums.sha256` and the `build.json` record. The Reader can preview and download the PDF and retrieve its edition manifest and citation data. The manifest records included and omitted scope, source input digests, DOI state and artifact checksums. The build record also retains the PDF's SHA-256. During preview, check the cover, front matter, back matter, contents, numbering, images, references outside the edition and DOI against this build's actual files. A PDF's DOI source note does not report live registration status; check the provider's record. The manifest binds sources to artifacts. It does not certify a manuscript signature, mathematical correctness or Lean proof coverage. Academic source archiving remains the separate `archive` workflow.

#### Manually Entered DOI

Local publication does not require a provider connection. Enter an existing DOI in the Reader or add it to the profile:

```json
{
  "doi": {
    "versionDoi": "10.1234/example-version",
    "conceptDoi": "10.1234/example-work",
    "provenance": "DOI provider and location of its registration or reservation record"
  }
}
```

These numbers are format examples only. `versionDoi` identifies this edition; `conceptDoi` represents the work and its version collection. Manually supplied values alone remain `unverified`: typing a number does not request, register or verify it. Keep a work DOI distinct from an edition DOI.

#### Zenodo Reservation and Publication

Set `zenodo.environment` to `sandbox` or `production`, optionally set `zenodo.tokenEnv` (default `ZENODO_TOKEN`), and save the profile normally. Put the token only in the environment of the CLI or Reader server process. The profile stores its environment variable name; the Reader reports whether credentials are configured without collecting a token. Local planning, building and downloads work without credentials; external actions require them. Sandbox and production use separate accounts and tokens. See [Zenodo API authentication](https://developers.zenodo.org/#authentication): draft writes need `deposit:write`, while publication and related actions need `deposit:actions`.

The plugin forwards the default `ZENODO_TOKEN` from its host process environment. Configure it before starting Codex, then reopen the Reader. A custom `zenodo.tokenEnv` also needs explicit forwarding by the host; alternatively, launch the Reader with the CLI and that variable configured in its process environment. Keep token values out of project files and the browser.

Before uploading, save at least one author and a `description`. Use `YYYY-MM-DD` for an optional `publicationDate`. `license` uses a Zenodo-supported identifier and defaults to `cc-by-4.0`. Upload review lists current draft files and checksums. Unowned files block upload and remain preserved; only old PDFs with a recorded name and checksum can be replaced after review. Previously published editions remain intact.

Reserving a DOI allows it to be embedded in the final PDF before upload. Reservation and registration are separate; registration occurs on publication, as explained in [Zenodo's DOI guide](https://help.zenodo.org/docs/deposit/describe-records/reserve-doi/).

1. Explicitly reserve a DOI, creating or reusing the profile's bound draft. Confirm the reservation in the native draft's `pids.doi`; a placeholder `prereserve_doi` from the compatibility API is not reservation evidence.
2. Plan again, build the final PDF containing the reserved DOI, and review it.
3. Explicitly read the upload difference and inspect draft files, old PDFs to replace, the target file and checksums.
4. Upload the same build with the reviewed upload fingerprint.
5. Separately confirm public publication against the current draft ID and revision.

```bash
math-workspace publication reserve-doi book --expected-revision <profile.revision>
math-workspace publication plan book
math-workspace publication build book --fingerprint <fresh-plan-fingerprint>
math-workspace publication status book
math-workspace publication review-upload book --build <build-id> --pdf-sha256 <reviewed-PDF-SHA256> --remote-revision <remote.revision>
math-workspace publication upload book --build <build-id> --pdf-sha256 <same-PDF-SHA256> --remote-revision <remote.revision> --upload-fingerprint <reviewed-upload-fingerprint>
math-workspace publication status book
math-workspace publication publish book --build <build-id> --pdf-sha256 <same-PDF-SHA256> --remote-revision <fresh-remote.revision> --record-id <draft-id>
```

Reservation, upload and publication contact an external service and each require authorization for that action. Inspection, planning and local builds do not trigger them. `status` reads locally saved bindings; `review-upload` explicitly reads the remote draft and returns the proposed upload difference. Use fresh revisions after actions. If inputs, the profile, draft or build change, review again rather than reusing approval of an older file or upload difference.

Explicitly attach an existing draft or published record to continue it:

```bash
math-workspace publication attach-zenodo book --expected-revision <profile.revision> --kind draft --record-id <draft-id>
math-workspace publication attach-zenodo book --expected-revision <profile.revision> --kind record --record-id <published-record-id>
```

Choose the one command matching the existing record's state. Continue using the same draft while unpublished. To add chapters or change files after publication, retain `id`, `workId` and the work DOI, update edition metadata, and explicitly create a new version of the same work before repeating the build, review, upload and publication steps:

```bash
math-workspace publication reserve-doi book --expected-revision <profile.revision> --new-version --record-id <published-record-id>
```

The new draft provides a new edition DOI; do not carry the previous edition DOI into its manual edition field. Earlier files and DOIs remain retained. Zenodo's Concept DOI represents the version collection and resolves to the latest version; cite a version DOI to identify exact files. See [DOI versioning](https://zenodo.org/help/versioning) and [version management](https://help.zenodo.org/docs/deposit/manage-versions/). If local state reports an unknown remote outcome, inspect Zenodo and attach the correct existing draft or record instead of creating a disconnected work to retry.

#### Independent Post-publication Verification

The Zenodo publication acknowledgement and verification of the public edition are recorded separately. After publishing, choose **Verify public edition** in the Reader, or run:

```bash
math-workspace publication verify-published book --build <build-id> --pdf-sha256 <published-PDF-SHA-256> --record-id <published-record-id>
math-workspace publication status book
```

Verification needs no token. It anonymously reloads the public record and checks the edition and work DOIs, title, version, creators, license, filename, size and checksum. It downloads the actual PDF and compares its byte count and SHA-256, reloads the public record after downloading, and checks that the edition DOI resolves to that exact public edition. It only reads public services and saves a local verification receipt; it does not reserve, upload, publish again or save unsaved profile edits.

`status.verifications` reports the public record, downloaded file and DOI separately. All three must pass for `verified`. Temporary service errors, rate limits or an unresolved DOI remain `pending`; mismatches are `failed`. The command exits with 0, 2 and 1 respectively. An incomplete or failed check does not erase the publication acknowledgement. Retry verification of the same build instead of publishing again. Receipts live in `.math-workspace/publications/verifications/<profile-id>/<build-id>.json`. Bound historical editions can be verified even after the current manuscript changes.

Production uses `https://doi.org/`; sandbox checks `https://handle.test.datacite.org/`. The [Zenodo sandbox homepage](https://sandbox.zenodo.org/) explicitly states that its test DOIs are not real and do not resolve. A 404 therefore leaves DOI resolution unverified, and the Reader distinguishes verified public files from unverified DOI resolution. A working sandbox record or download never establishes complete acceptance. Real DOI registration and resolution need separate acceptance on a production record; this workflow never creates one automatically. See the [DataCite testing guide](https://support.datacite.org/docs/testing-guide) for its test and production systems.

### Markdown and One-off PDF Export

Export formal source to ordinary Markdown before using other publication tools:

```bash
math-workspace export-md path/to/book --out dist/book.md
```

Export formal source while preserving the source file tree:

```bash
math-workspace export-md-split path/to/book --out dist/public
```

Export formal source directly to PDF with the local Pandoc/LaTeX engine:

```bash
math-workspace export-pdf path/to/book --out dist/book.pdf
```

Render an already compiled Markdown file:

```bash
math-workspace render-pdf dist/book.md --out dist/book.pdf
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
  "metadata": {
    "title": "Book Title",
    "authors": [
      {
        "name": "Author Name"
      }
    ],
    "license": "cc-by-4.0",
    "repository": "https://example.com/project"
  },
  "pdf": {
    "date": "Revised 2026-06-26",
    "titlePage": true,
    "metadataPage": true,
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

Shared identity fields belong in `metadata`; old `pdf` identity fields remain a compatibility fallback. Use `--authors-json` for structured author overrides, `--website` / `--repository` for separate source links, `--description` for the PDF subject and repeated `--keyword` for keywords. CLI overrides do not write configuration. Pandoc `-V` variables do not create new project metadata fields.

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
- 定义查询：定义不加 hash、不参与 ref；工具自动扫描标准 `定义（术语）：...` / `Definition (Term): ...`，并在发现概念/术语专页时利用其表格和末级条目建立补充索引。AI 只为查询缺失、非标准定义、别名、中英互查和不可靠边界维护 `.math-workspace/definitions.json`。
- 项目知识：工具按明确文件名或页面主标题识别概念/术语、符号/记号与 summary 专页，不限定附录序号；合并概念与符号的页面保留两类上下文。`.math-workspace/project-analysis.json` / `.math-workspace/project-analysis.md` 是派生摘要，Math Workspace 在内存中按内容变化重建，供 Codex 通过窄范围 MCP 查询核对。
- 汇总布局：新建概念与符号汇总时优先放在同书最后一个附录，沿用实际序号；已有合适页直接复用，可合为一页，并与题解等其他附录按整书结构协调。
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

## 例与反例

完整、独立的例子、算例和反例可以主动编号，不要求已经被后文引用。随文的一句“例如……”仍写普通正文。声明使用独立稳定 ID：

```markdown
例 #tmp-example（有限求和）：先考察一个具体情形。

第一步计算。

第二步说明计算结果。

反例 #tmp-counterexample（缺少有界性）：取如下对象。
```

英文写作 `Example #tmp-example (Title): ...` 和 `Counterexample #tmp-counterexample (Title): ...`。例与反例共用独立的章内连续序列，例如“例 3.1、反例 3.2、例 3.3”；不占用命题、引理、定理、推论共享的编号。图、表、公式和习题仍各自独立按章编号；附录对应使用 A.1、A.2。

例与反例的引用预览保留多段文字、公式、列表、代码块及其中的推导或证明，到下一个正式对象、Markdown 标题或分隔线结束。代码块中的标题和声明只是示例，不结束当前例子。需要在例后接普通正文时，用 `---` 等 Markdown 分隔线明确结束例子。源码引用仍使用 `@tmp-*` / `@h-...`，不手写显示编号。未被引用的编号例子不构成审计问题。

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

可以把解答放到同一本书书末的题解附录，与概念、符号汇总的先后按整书结构安排，使用如下声明：

```markdown
解答 #tmp-sol（对应 @tmp-ex）：将首尾项配对，再求和。
```

英文写法为 `Exercise #tmp-ex (Title): ...` 和 `Solution #tmp-sol (for @tmp-ex): ...`。可选解答标题写作 `（对应 @tmp-ex；另一种方法）`。多个解答可以关联同一道题，各自使用不同 ID；解答显示原题编号，例如“习题 2.3 的解答”，不使用所在附录的新编号。缺失、非习题或跨书目标会报错。跨文件临时引用用 `finish --all` 一并固化。

题面延续到下一个正式对象或 Markdown 标题，包含多段文字、公式、列表和分问。分问用列表或加粗标签；不要用会结束题面的 Markdown 标题。独立段落中的 `提示：` / `Hint:`、`解答：` / `Solution:` 开始辅助内容；这些标记与前文之间留一个空行。提示和解答不会进入题面 recall，Reader 默认折叠它们；题目与附录解答支持双向跳转。Markdown 与 PDF 导出保留完整提示及解答，并统一编译原题编号和引用。

依赖图保留习题、解答的显式引用，标记 `layer: pedagogical`；`pedagogicalLinks` 单独保存题解关联，不参与证明循环。`graph impact` 会沿引用和题解关联追踪影响；Reader 主线重要性和 `graph bridges` 不计教学引用。正文主线引用习题或解答时会提示审查：必要命题及证明应保留在正文，避免让题解承担主线缺失的论证。

已形式化的命题改为习题时保留原 hash 与 Lean 声明。习题进入默认 `coverageTypes`；即便自定义类型列表遗漏习题，已有 Lean 锚点的习题仍计入覆盖分母，解答不在默认分母中重复计数。Lean 契约分别记录题面、相关提示/证明/跨文件解答和声明签名；修改题解会使题目待复核，修改题面也会使锚定解答待复核。Lean 依赖比对会把关联解答中的显式严格引用计作原题的证明前提，并保留题解来源；关联本身不是前提。`lean-index.json` 的 `status.markdownChanges` 区分 `statement` 与 `proof` 变化。旧版缺少证明指纹的契约显示 `untracked`；审阅原文及对应声明后运行 `lean capture` 建立基线，不要用 capture 掩盖未审阅的修改。

## 交互图与静态图

单独一段中的图片链接可声明交互图。链接标题写 `交互图` 或 `Interactive figure`，图片和 HTML 都使用项目内相对路径：

```markdown
[![算子网络的求值](figures/network.svg)](figures/network.html "交互图")

图 #tmp-network（算子网络的求值）：图注与正文仍用 Markdown 书写。
```

普通 Markdown 阅读器显示图片；Math Workspace 在同一位置显示交互图，并提供“静态图”切换。加载失败时仍显示图片。`export-md`、`export-md-split` 和 PDF 导出使用静态图片；代码块内的示例不变。静态图片按现有图片路径规则导出，发布项目时仍需一同携带相应资源。

交互 HTML 必须自包含：样式、脚本以及需要的字体或图片均内联，不依赖外部网络、相邻脚本文件或阅读器的样式。它运行在隔离框架内，可以运行自身脚本，不能访问阅读器 DOM、工作区接口或外部网络。图的内容与排版由项目拥有，Math Workspace 只负责引用、隔离显示、尺寸同步和静态导出。

阅读器在图脚本运行前设置 `window.mathWorkspaceFigure.mode`，取值为 `interactive` 或 `static`。图组件应让两种模式调用相同的绘图函数，只在交互模式下创建控件和事件处理。静态预览也应由同一绘图函数生成并随源文件保存；导出器读取该预览，不在本机执行项目脚本。独立打开 HTML 时可自行以 `interactive` 为默认模式。

正式图注与独立图片段落相邻，推荐放在图后，也支持放在图前；两者之间用空行分段。Reader 与 PDF 都保持原稿的前后顺序，并将图与图注组成一个整体：图号和图题居中，说明另起一行、略小并缩进。PDF 将图与图注保持在同一页；单幅图及图注应能容纳于一页。普通 Markdown 导出保留原有文字形式。静态图片与交互图使用同一套图注样式，同一幅图的静态预览和交互版本共用一个图号。

图的页面高度由阅读器自动同步。横向数学图可保留其布局；图内部负责缩放或横向浏览，不必为了窄屏改变节点关系。纸面版应验证符号字号、线条和图注是否清晰。

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

工具还会按明确的文件名或页面主标题识别概念/术语专页，例如 `appendix-*-concepts.md`、glossary、terminology 或中文概念表，不限定附录序号。此类页面中，`术语 | 定义` / `Term | Definition` 表格与最末级概念条目会作为补充查询条目；文件名或主标题同时明确概念与符号用途时，保留两类上下文。

新建概念与符号汇总时，优先放在同书最后一个附录，沿用整书实际序号；可合为一页。已有合适页面时直接复用，不为识别而改名、移动或重排其他附录。

`prepare` 会生成 `.math-workspace/project-analysis.json` 和 `.math-workspace/project-analysis.md`，列出被采用的概念、符号和 summary 页面；Math Workspace 在内存中同步重建这份结构，供 Codex 通过窄范围 MCP 查询核对。

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

不要索引普通变量、通用记号或完整推导公式。符号/记号专页按明确的文件名或页面主标题识别，可与概念汇总合页；检测结果只提供项目知识上下文，不会自动推导 `pattern` 或 `meaning`。

## 常规流程

通过 Codex 安装时，CLI、Reader 和通用 skills 使用当前启用插件提供的一份；独立使用时，使用明确安装的 Math Workspace CLI/npm。安装步骤见 [install.md](install.md)。项目保留原稿、配置与审阅记录，Codex 接入无需再复制工具包。

下文 `math-workspace` 代表所选实际 CLI：插件任务复用 Reader 提供的 Node/CLI 与工作目录；npm 项目依赖使用 `npx math-workspace`；已有且核对来源的项目 wrapper 可继续使用。

首次接入项目并生成上下文：

```bash
math-workspace init
math-workspace open
```

`open` 会从当前目录向上查找 `.math-workspace/config.json`。需要单独刷新索引时仍可运行 `prepare`；检查安装、项目发现和可选工具链时运行 `doctor`。

编辑文件或目录后，固化临时 ID 并刷新报告：

```bash
math-workspace finish path/to/chapter-or-dir
```

`finish` 已执行校验。只有直接使用 `finalize`、执行迁移，或需要独立 release 门禁时，再运行：

```bash
math-workspace verify
```

## 创建章节与前后文

正文、前言、后记和未完待续页都以项目内的普通 Markdown 为唯一维护源。先检查已有稿件，再选择类型和所属的书或卷：

| 类型 | 用途与位置 |
| --- | --- |
| `chapter` | 当前书的下一章；卷目录不重置章号。 |
| `front-matter` | 所属书或卷的 `front-matter/`，可以有多篇任意标题的文章。 |
| `back-matter` | 所属书或卷的 `back-matter/`，可以有多篇任意标题的文章。 |
| `continued` | 所属书或卷的独立 `to-be-continued.md`。 |

前后文的角色由所在位置决定，不限定标题或文体。“AI 退休寄语”通常属于后文，可以保留这个标题。旧 `intro.md`、`introduction.md` 与 `summary.md` 继续兼容，不必为采用新入口搬动旧稿。

下例的 `math-workspace` 代表所选安装提供的 CLI 入口；项目已有且核对来源的 `workspace` script 时也可用 `npm run workspace --`。独立 CLI 可用 `paths` 或 `help-ai` 定位随包规则；Codex 插件读取当前 skills 和生成指南。Reader 交接提供确切的 Node、CLI 路径和工作目录时，直接复用；不要求项目额外安装全局命令或修改脚本。

从拥有 `.math-workspace/config.json` 的项目根运行。`--container` 使用真实的项目相对书/卷目录，项目根为 `.`，不要填写显示书名。先查看只读计划：

```bash
math-workspace create-page --kind back-matter --container book --title "AI 退休寄语" --slug ai-retirement-note --dry-run --json
```

计划返回 `kind`、`title`、`container`、`filePath`、`exists` 和 `stateToken` 等信息。核对所属书卷、路径及是否已有稿件后，将下面的 `PLAN_STATE_TOKEN` 换成计划返回的值，再创建空白稿件：

```bash
math-workspace create-page --kind back-matter --container book --title "AI 退休寄语" --slug ai-retirement-note --expect-state PLAN_STATE_TOKEN --json
```

标题须为非空的单行文字。`--slug` 可选，只决定文件名词干；`continued` 使用固定文件名，不能加 `--slug`。helper 分配文件路径、顺序和稳定页 ID，以不覆盖方式写入一个带标题的空白 Markdown；正文由作者或 AI 续写。已有文件不会覆盖，同一书卷已有的未完待续页也不重复创建；先检查是否应继续原稿。计划过期时先重新只读规划，项目、类型、标题、容器与目标路径均未变即可用新 token 继续；目标变化或已存在时先核对差异或复用原稿。不手写章号或 hash，也不通过另造副本绕过冲突。

创建后沿返回的 `filePath` 写正文，保留页 ID，然后对该文件运行 `finish`。创建不会自动加入出版方案；出版时显式以 `frontMatter[].file`、`backMatter[].file` 或 `continued.file` 引用这份原稿，日常阅读与 PDF 共同使用同一内容。

Reader 的“＋”提供同一创建入口：填写标题、选择类型和当前书/卷，查看只读计划后将请求加入 Codex 输入框。请求附带实际命令入口和工作目录，不自动发送；无会话宿主支持时可以复制请求。Reader 本身不写源稿，也不自动将新稿选入出版。

## Math Workspace

Math Workspace 是 `math-workspace` 引擎之上的本地工作区界面。日常入口是：

```bash
math-workspace open /path/to/project
```

也可以在项目内的任意子目录运行 `open`。不传项目路径且当前目录不在已初始化项目中时，会打开本机项目启动台。底层 `serve` 命令保留给需要明确控制启动行为的脚本：

```bash
math-workspace serve
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

右上角直接提供“Lean 对照”和“目录”，以及“查阅”“审阅”“版本与出版”“显示”四个分类图标；插件内嵌阅读器还可直接全屏。“查阅”提供定义和符号，“审阅”提供命题审阅和符号审计，“版本与出版”提供版本记录和 PDF 出版，“显示”提供界面语言、外观、源码行号和字号调整。分类图标通过悬停提示和无障碍名称说明用途，菜单内显示功能名称。菜单支持方向键切换、Home / End 跳到首尾，以及 Escape 关闭并返回对应分类入口。

“显示 → 语言”提供“自动”“中文”“English”，“显示 → 外观”提供“自动”“浅色”“深色”。自动语言依次采用 Codex 或其他 MCP 宿主、浏览器提供的中文或英文，均不匹配时使用英文；自动外观优先跟随宿主，未提供时跟随系统。手动选择优先于自动检测，保存后可供下次使用；环境不支持保存时，选择仍在当前会话中生效。

界面语言与书稿语言独立。`.math-workspace/config.json` 中的 `language` 控制书稿的正式标签与编号展示，并提供 PDF 的默认语言；出版方案或显式 PDF 选项可覆盖该默认值。切换界面语言与外观不改写原稿或项目配置，也不改变这些出版设置。浅色与深色模式保留 Lean 关联、警告、错误和依赖关系的语义颜色。

在“显示”切换源码行号，可在正文左侧显示每个可定位源码块的起始行。它用于从渲染结果回到 Markdown 位置，不把视觉换行伪装成源码行，也不改变正文排版；默认关闭，选择只保存在当前浏览器。

依赖标记只读取显式 `@h-...` 关系。圆点上方的短线表示该陈述或证明显式引用了 formal 对象（可为小节、定义或命题）；下方纵线表示后续依赖对象依赖它，分叉表示多个直接下游。主线命题使用常规颜色；带 hash 的、可证明的补充注释使用低强调度的注释颜色。灰色是没有下游对象的终点，蓝色表示被直接引用，绿色分叉表示既有显式前提也被后续对象引用。悬停可查看引用数与传递影响范围；这些是结构信号，不等同于数学重要性。权威依赖图包含命题/引理/定理/推论之间的边，也包含带 hash 补充注释的入边、出边；普通 `注（...）` 不进入图，也没有标记。

在会话内的 Math Workspace 插件面板中，拖拽选中文字或点击公式，然后点击浮层中的引用图标（提示为“引用到会话”）。引用会携带原始 Markdown / LaTeX、文件路径与源码行范围，加入当前会话输入框；补充问题后再发送。选择内容不会自动发起模型对话。

多段内容可分次选取、分次加入同一会话输入框，最后统一补充问题并发送。引用按钮与复制按钮使用相同的紧凑尺寸；失败时保留弹窗供重试。打开页面和翻页仅保存阅读位置，不自动向会话添加引用。

普通本地浏览器中的 Reader 可以选取和复制 Markdown；会话引用需要从会话内的 Math Workspace 插件面板使用。插件会明确提示入口位置。后续讨论、工具调用、修改与审批留在原生会话中。

窄界面中的普通长公式会在关系符、运算符等安全断点换行，保留括号、分式和矩阵等不可拆结构。仍然超宽时，只在公式内部横向滚动，起始部分保持可见；键盘聚焦后也可滚动。多行推导使用温和的默认行距，源码明确指定的行距和排版命令优先。

复杂长公式可以点击公式，再用弹窗中的“适应宽度”图标按当前可用宽度重新排版，或恢复原排版。这个动作才加载随本地插件提供的 MathJax 渲染器，不把公式发往外部服务；不适用或重排失败时保留原公式。显示调整不改原始 LaTeX、公式编号、源码定位、复制或会话引用内容；PDF 仍按纸张宽度排版。

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

侧栏、页眉及两处阶段菜单使用同一组文档图标：初稿为空白文档，修订中为文档加笔，稳定稿为文档加勾。页眉始终保留阶段图标与名称，里程碑和“有改动”作为补充；侧栏保持紧凑图标，可悬停查看完整状态。窄屏将标题与阶段放在工具栏的下一行，保留全部分类入口。

状态默认写入 `.math-workspace/documents.json`，以项目相对路径为键。移动或重命名文件后，旧记录会成为 orphan；这是有意的轻量行为，不做不可靠的语义猜测。若需改变状态文件位置，可设置 `documents.stateFile`。

## Codex MCP 入口

通过 Codex 安装的 Math Workspace 使用插件自带的运行时和通用 skills；非 Codex 环境使用独立本地 CLI。MCP 可启动或复用本机工作区，也提供命题、严格依赖、Lean 对齐与只读校验查询。支持 MCP 插件扩展的桌面端还可从全局侧边栏打开 Math Workspace，或在当前会话旁打开 Reader 面板；两个入口复用同一 Reader，不维护第二套渲染器或 Codex 对话实现。

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

发布版本同样可以从安装包根目录添加 marketplace。插件调用 `open` 打开当前项目或某个项目相对 Markdown 页面；Reader 选取可直接引用到当前会话输入框；`lookup_formal_object`、`inspect_dependencies`、`lookup_knowledge`、`inspect_lean_alignment`、`read_symbol_audit` 与 `verify` 提供按需的窄范围上下文。符号审计接口只读取用户已经运行的缓存结果，不会静默调用模型；没有可用项目时会打开 Math Workspace 的本机项目启动台。

宿主提供唯一的当前项目且该项目已有 `.math-workspace/config.json` 时，侧边栏与会话入口会直接打开该项目；否则显示项目选择与最近项目。各个面板独立保存所选项目、页面和滚动位置，可展开阅读长公式。正文从当前源码读取；只有主动点击选取弹窗中的引用按钮，内容才进入当前会话输入框。

插件页面直接加载 Reader，数据通过 MCP 访问各视图的本机 Reader API；保留现有的项目与操作校验，不要求宿主允许嵌入本机 HTTP 页面。关闭面板会释放对应 Reader，MCP 退出会关闭其全部视图。缺少 UI 扩展支持的客户端仍可调用 `open` 获取普通浏览器 URL。安装或更新插件后，新建会话以刷新入口。

MCP 使用本地标准输入输出通信；它启动的 Reader 只绑定 `127.0.0.1`。查询不修改书稿或 Lean 源码。`read_lean_review_context` 读取一个对象的当前对照材料，`submit_lean_review_candidates` 仅保存明确发起的辅助审核候选，不写入人工结论；Reader 的人工保存仍独立校验当前版本。

## 学术留档

学术留档把原稿、签名材料及版本关系保存在项目内的 `.math-archive/`。它独立于可重建的 Reader 索引，也独立于文档的“草稿 / 修订 / 稳定”标签。日常签署采用显式分卷及总记录；只有 `archive sign` 或 Reader 中的“认证并签署”会发起新签名。查看、转换、导入、核验和准备均不签署，也不修改正文、提交 Git 或发布作品。

新项目先声明稳定作品 ID、文件范围和签署身份：

```bash
math-workspace archive init --work-id my-book --title "My Book" --path book --volume vol-i=book/vol-i --volume vol-ii=book/vol-ii --volume-title "vol-i=Volume I" --volume-title "vol-ii=Volume II" --identity author@example.com --issuer https://accounts.google.com
math-workspace archive prepare --label "September draft"
math-workspace archive sign --prepared <返回的准备操作摘要> --auth-flow normal
math-workspace archive verify
```

`--path` 可重复，默认递归采集范围内的 `.md` 文件；`--extension`、`--depth` 和 `--exclude` 可进一步声明范围。明确指定的单个文件按原字节纳入。目录遍历跳过隐藏目录、Git、依赖及生成输出，拒绝符号链接。Lean 源码或构建材料需要明确纳入范围；签署一份构建记录不等于重新运行证明，也不表示全书已形式化。

分卷属于归档策略的 `volumes: [{ id, title, paths }]`，必须明确声明；不从目录名、目录层级或文件数量推断。`--volume ID=PATH` 可重复声明，`--volume-title ID=TITLE` 设置名称；卷之间不能重叠。`scope` 决定作品的全部文件范围，分卷仅划分其中的文件，卷外文件仍由总记录覆盖。没有分卷时生成仅含卷外文件的总记录。

已有项目可通过以下任一种方式更新策略。`--policy` 指向包含作品 ID、范围、身份和分卷的完整策略 JSON；更新保留稳定作品 ID 和已接受的历史身份。

```bash
math-workspace archive update-policy --volume vol-i=book/vol-i --volume vol-ii=book/vol-ii --volume-title "vol-i=Volume I" --volume-title "vol-ii=Volume II"
math-workspace archive update-policy --policy archive-policy.json
```

准备阶段冻结原始文件字节，记录相对路径、完整 SHA-256、策略、版本名称、签署身份及前驱，并列出每卷的新签或复用计划及卷外文件。`math-workspace.archive-volume/v1` 逐卷绑定精确文件集合；相同策略和文件集合下，核验有效的未变卷复用原始记录及 bundle，不重签、不改变旧签署时间。变化的卷先签署，再生成并签署 `math-workspace.archive-total/v1`：总记录绑定每卷记录及其原始 bundle 的完整摘要，同时包含全部范围内文件的精确映射，根目录正文、探索稿与复核稿等卷外材料不会因未归入卷而被遗漏。

总记录后继同时绑定前一份记录和前一份原始 bundle 的摘要；首次通用记录绑定已导入历史的索引摘要。准备返回的 `prepared` 是签署操作摘要，最终总记录的载荷摘要可能不同；保存签署结果中的 `head.record`，供 `verify --expected-head` 独立检查。`preparedAt` 和 Git 基础提交仅作定位信息，不替代签名时间。签署记录按 UTF-8 JSON 编码，键按 UTF-8 字节顺序排序，不留多余空格，末尾一个 LF，数值限于安全整数。

`--auth-flow normal` 是默认流程，显式使用 Cosign 的普通浏览器认证与本机 localhost 回调，适用于 Reader 后台操作；需要设备认证时可选择 `--auth-flow device`。每份新签材料可能分别需要认证，Reader 显示认证入口和签署进度，有设备码时才显示设备码。认证完成后再次检查正文集合、策略、身份、前驱及历史对象，再原子更新链头。中途失败保留已完成卷签名及有效 bundle，用同一个 `--prepared` 操作摘要重试；不把部分完成当作已发布的总记录。准备后正文或策略改变时需重新准备。若进程退出留下本机锁，`archive recover-lock` 仅在记录的本机进程已不存在时释放它。

Reader 的“版本与出版 → 版本记录”打开时间线，默认显示总记录与作品快照，可加入分卷记录，查看原稿、源码、缺失引用、文件差异以及按稳定 ID 找到的历史声明。准备区列出变化的卷、复用的原始卷证据、已完成的新签和卷外文件摘要；总记录详情展示绑定的卷证据，并可直接独立导出各卷。操作按钮通过图标、hover 提示和无障碍名称说明用途。原稿阅读不套用当前工作区正文或引用目标。界面分别显示签名核验、原稿完整性与当前内容是否被当前链头覆盖；旧材料可以签名有效而原稿有缺口，Lean 状态仍由原有 Lean 功能解释。某个对象在现有材料中的最早出现不是原创性或优先权裁定。

### 日常列表与本机隐藏历史

已有单快照记录继续保留原始字节。隐藏只修改本机日常列表，可在 Reader 中选择“含本机隐藏记录”查看、恢复或导出；默认 `list` 不列出隐藏记录，但核验和完整导出始终包含它们，隐藏不能跳过无效签名。

```bash
math-workspace archive list
math-workspace archive list --include-hidden
math-workspace archive hide --record <记录 ID>
math-workspace archive restore --record <记录 ID>
math-workspace archive hide --record <当前链头记录 ID> --retire-head
math-workspace archive verify
math-workspace archive export --out all-evidence.json
```

`--retire-head` 是明确的链头退役操作：保存原链头分支，再回退到其原前驱，没有前驱时清空活动链头；不会删除、重写或伪造签署材料。恢复可见性不重新激活已退役链头。后续签署依据活动链头准备新总记录；仅隐藏一条记录不改变前驱关系或当前内容覆盖判断。

### OET 格式转换与兼容

内置适配器支持 `oet.legacy-signatures/v1` 和 `oet.sign-record/v1`。它读取原始索引、MANIFEST、bundle 和内容对象，不重签旧记录，不改变旧时间，也不为独立旧签名补造前驱。三种原清单哈希均须匹配；未找到的原稿继续列为缺口。OET/IDFS 的 Git 历史搜集和临时清单恢复仍由 OET 工具负责，通用导入器验证转换结果。

在包含 OET 作品目录的仓库中执行：

```bash
math-workspace archive sources
math-workspace archive convert --format oet --from the-operator-evolution-theory/.signatures --out oet-archive.json
math-workspace archive import-oet --from the-operator-evolution-theory/.signatures --initialize
```

`convert` 输出标准交换文件及建议的项目策略。`import-oet --initialize` 采用该作品声明的范围和身份，并执行完整验签；已有策略不同时拒绝覆盖。Reader 的导入流程先展示这些范围和身份，待用户明确执行后才写入。旧手写分卷 MANIFEST 与根 MANIFEST 历史继续可读、可核验和可导出。之后的新签使用通用卷记录及总记录，不改写旧 MANIFEST 或替换旧 bundle。OET 的分卷策略应明确列出九个实际卷；根目录、draft 与 review 等其余范围内文件作为卷外材料进入总记录，不把这些目录误算为卷。

### 格式接口与验证材料

`archive formats` 列出支持的证据格式。转换器交换格式为 `math-workspace.archive-exchange/v1`：

- `workId`：稳定作品 ID；
- `records[]`：`format`、原始 `payload` 摘要、原始 `bundle` 摘要及可选 `metadata`；
- `objects`：完整 SHA-256 到原始字节 base64 的映射。

转换器不提供可信的“已验签”结论。导入器逐对象验哈希，由对应 `ArchiveFormat.project` 从原签名载荷解析文件范围和关系，再调用 Cosign 核验签名、身份、透明日志及时间材料。新格式需要增加明确的格式校验适配器，不能把任意旧载荷换成新的 JSON 后沿用原签名。项目配置不会自动执行外部转换程序。可复用的类型和本地接口随 `out/cli/archive.js` 提供，命令入口与 Reader 使用相同实现。

```bash
math-workspace archive export --out evidence.json
math-workspace archive export --record <分卷记录 ID> --out volume-evidence.json
math-workspace archive import --from evidence.json
math-workspace archive history --formal-id h-0123456789abcdef
math-workspace archive show --record <记录 ID> --file book/01.md
math-workspace archive compare --left <记录 ID> --right <记录 ID>
math-workspace archive verify --expected-head <独立保存的链头摘要>
```

完整导出包含隐藏历史、原稿和原始证据，可在另一项目副本中按所选择的信任策略独立核验。`export --record` 为指定记录导出所需原始证据闭包；分卷可独立导出其签署载荷、原 bundle、绑定策略及精确文件原稿，再与总记录中的卷载荷和 bundle 摘要比对。仅有分卷证据不表示它属于某个未提供的总记录，也不表示整部作品已签署。导入保留原记录及原关系，接收项目后续首次签署通过导入索引接续这些材料；不会把导入时间视为历史签署时间。只有提供独立保存的链头才能检查是否回退，单独验证一段历史不能证明它是完整的最新历史。没有对外发布动作；导出包含私人原稿，是否分享由作者决定。

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

Codex 插件任务读取当前启用插件的通用 skills，并由同一插件生成工作区 `agent-guide.md`；项目特化 skill 只保存项目约束，不内嵌通用规则或另装工具包。

独立 CLI/其他 AI 宿主可以按需审阅随包的 AI artifacts：

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

独立 artifact 消费者明确选择 VASMC 时，使用 catalog 锁定所需 artifact；这不是 Codex 插件项目的默认依赖：

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

独立 CLI 可打印随包 artifact 的关键路径；Codex 插件使用其当前 skills 和生成指南：

```bash
math-workspace paths
```

不要自动拉取远端 skill，也不要把 integrator 原样追加到目标 prompt 末尾。应先审阅 artifact，再把规则融合到目标项目已有的 `AGENTS.md`、写作 skill、风格指南或 release 指令中。

## 迁移流程

试运行文字编号引用迁移：

```bash
math-workspace migrate-text-refs path/to/chapter-or-volume
```

应用文字编号引用迁移：

```bash
math-workspace migrate-text-refs --apply path/to/chapter-or-volume
```

试运行旧 ID 迁移：

```bash
math-workspace migrate-ids path/to/chapter-or-volume
```

应用旧 ID 迁移：

```bash
math-workspace migrate-ids --apply path/to/chapter-or-volume
```

## 依赖图

生成依赖图摘要：

```bash
math-workspace graph summary
```

查看某个命题类对象或带 hash 补充注释的局部图：

```bash
math-workspace graph focus <h-id> --depth 2
```

查看下游影响范围：

```bash
math-workspace graph impact <h-id>
```

查看上游依赖：

```bash
math-workspace graph upstream <h-id>
```

汇总章节层面的依赖流：

```bash
math-workspace graph matrix chapter
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
math-workspace lean scan
math-workspace lean coverage
math-workspace lean verify
math-workspace lean capture
math-workspace lean build [--project <key>]
math-workspace lean dependencies
```

`scan` 重建索引，`coverage` 打印锚点报告，`verify` 在锚点无法解析、源码根不可读或 docstring 后没有受支持的具名声明时失败。`capture` 把当前正文类型、标题、题面、相关提示/证明/解答与锚定声明签名作为显式审阅基线；基线后的正文或声明改动会显示为漂移。`build` 在每个已配置项目根执行 `lake build [target]` 并记录结果；任何源码变动都会使旧构建结果过期。

`dependencies` 通过 Lean elaborator 读取锚定声明的直接类型与证明值引用，并只与正文中显式、严格的 `@h-...` 边比较。Markdown-only 边是需要核对的候选；Lean-only 边通常是实现细节或复用支撑，仅作为补充上下文。两者都不自动构成数学冲突，也不证明语义等价。

Reader 在命题正文与关系图节点上用紧凑的 `Lean` 标记表示存在一个或多个 Lean 声明锚点。点击正文中的 `Lean` 可查看锚定声明、正文/声明契约、最近构建和依赖比对状态；工具栏的“Lean 对照”打开正文与 Lean 的并排审阅工作台。这个标记不声称完整形式化或证明覆盖；覆盖以配置的 `coverageTypes` 为基础，并始终保留已锚定习题；数字不能替代范围声明。

### Lean 与正文人工审阅

对照工作台并排显示正文和 Lean，可在陈述、关联证明与必要上下文之间切换，并打开对应声明的完整源码范围。两侧独立滚动；章节队列和后台状态更新不应打断当前对照位置。普通源码阅读不等待实时 Lean 语义启动。

Reader 的 Lean 审阅面板以稳定对象 ID 展示当前题面、关联证明/提示/解答、附近正文、显式引用的正文对象与锚定声明的源码位置。点击“刷新证据”后，Reader 使用项目已安装的 Lean toolchain，离线执行有时限、可取消的本地构建与 elaborator 查询，展示包括隐式参数、section 假设和 certificate 输入的完整类型，以及 Lean `collectAxioms` 返回的递归公理依赖；`sorryAx` 会保留显示。只有已有 Lake manifest 且依赖已在本地就绪时才执行；不会安装 toolchain、依赖或缓存，也不会自动调用模型。读取面板仅使用现有证据；缺失、失败和过期证据均明确标记。

可展开关键定义的源码与 elaborated 类型/值，核对包装谓词与输入假设。机器事实（存在锚点、构建结果、证据是否新鲜）和人工结论分别显示。人工选择“范围内一致”“部分对应”“存在差异”或“未决定”，填写审阅范围、备注和审阅者；可手工拆分正文分项，将每项映射到一个或多个声明，也可保留未映射分项。构建通过或刷新证据不会生成或更新人工结论。

声明与关键定义可打开完整 Lean 文件，在只读源码查看器中搜索、折叠、定位、复制和选择范围；长文件按可见区域显示。高亮识别 Lean 的注释、字符串、文档注释、关键字及声明结构。源码变化时，查看器明确提示旧位置已变化。上次与当前材料以统一差异展示，分别保留此前与当前源码行号，显示增删行和上下文；有界快照被截断时保留提示。

点击“启动 Lean 语义”后，使用已安装且支持当前只读协议的本地 Lean 语言服务，按光标位置查看真实类型提示、定义位置、战术目标/期望类型、文件诊断和服务支持的语义 token。F12 或 ⌘/Ctrl 点击可沿定义跳转，保留源码返回路径。缺少工具链、本地依赖、协议能力或隔离支持时，明确显示不可用；完整源码仍可阅读，词法高亮不冒充语义结果。当前实时语义会话仅在 macOS 的原生只读、断网隔离下启用；其他平台继续提供完整源码预览。实时语义与显式保存的构建证据独立，打开文件不会自动构建、安装依赖或更新人工结论。

点击保存只记录当前对象，存入项目的 `.math-workspace/lean-reviews/<h-id>.json`；显式刷新产生的证据缓存存入 `.math-workspace/lean-review-evidence/<h-id>.json`。记录包含人工结论、时间、分项映射、有限的审阅快照与有界的人工决定历史，重开 Reader 后恢复。保存同时核对记录版本和正在显示的证据指纹；另一窗口已保存，或源码刚发生变化时，必须重新读取和核对后再保存。它与现有全量 `lean capture` 契约互不替代，不会把其他对象标为已审阅。

“位置关联与问题”面板可从当前题面、证明或相关正文摘录选择精确原文，再从 Lean 摘录或完整源码查看器选择对应范围。可附到已保存的人工分项，填写此范围的人工结论、说明，以及逐条假设/符号对应。每条关联保留两侧的文件指纹、原文和位置，存入 `.math-workspace/lean-audits/<h-id>.json`；只记录主动创建的审阅材料，不建立源码索引，也不修改 Markdown 或 Lean 源码。

问题必须关联两侧范围，可按假设、符号、范围、陈述、证明、信任边界或其他类别记录，保留“未解决”“已解决”“已撤回”和处理依据。任一文件、对象证据、已关联人工分项或对应关系变化，都使相关旧决定待复核；先前已解决的问题仍计入待处理。位置不会自动重定位，需明确重新选择两侧范围、核对关联，再填写问题的复核依据。另一窗口保存后，旧草稿保留原版本且不能覆盖新记录。

项目总览包含各章节的人工结论新鲜度、未锚定/未审阅对象、过期关联及未解决问题，支持筛选和跳转；可导出当前项目 Markdown 审阅报告。历史同时展示整对象结论与位置/问题动作：最多保留 50 次整对象决定（1.5 MiB）及 120 次位置/问题动作（1 MiB），被移除的旧项数量明确显示。项目总览最多处理 3000 个当前对象，报告最多读取 500 个位置审阅对象，超过上限会报错，不导出不完整报告。向会话引用审阅材料只准备候选讨论，不自动发送或应用人工结论。

正文陈述、关联证明、声明、展开定义或构建环境变化后，旧人工结论显示为待复核，并可对照上次与当前文本。Lean 证据采用保守的“项目输入”失效范围：配置项目及其本地依赖的 Lean 源码、lakefile、manifest、toolchain 或 target 改变都会使已有 elaborated 证据过期，不能理解成工具已定位了具体语义差异。正文上下文只沿显式引用收集；超过有限快照范围时，审阅新鲜度保守地跟踪工作区全部 Markdown 的指纹，不建立源码知识库。当前页/章节的队列保留未锚定对象、审阅者与审阅时间，便于逐对象继续审阅。向原生会话引用证据只准备讨论材料，不自动发送，也不自动保存审阅结论。

工具异常退出可能留下 `.math-workspace/lean-review-refresh.lock` 或对象旁的 `.lock` 文件；确认相应进程已停止后，人工移除该锁再重试。无法核对声明实际所属模块与锚定源码时，elaborated 证据保持不可用。

### Codex 辅助审核

在对照面板中选择检查假设、陈述、证明或复核变化，将任务和当前对象定位加入 Codex 会话输入框。材料不会自动发送。普通浏览器可复制同一任务；支持原生引用的面板可直接加入当前输入框。Codex 通过 `read_lean_review_context` 读取绑定到当前项目和对象的有限材料，再通过 `submit_lean_review_candidates` 回填候选疑点，无需把回复逐条复制回 Reader。

候选保存在 `.math-workspace/lean-assistance/<h-id>.json`，与构建证据、位置关联和人工决定分开。它们携带源码证据及审阅版本；源码或相应记录变化后，旧候选不能直接应用。审阅者可逐条加入“未决定”的本地草稿或忽略，核对实际范围后再保存人工结论。模型提交候选不会运行 Lean 构建、修改书稿、判定通过或替代人工签认。

## 项目结构

扫描器从路径识别书、卷、章节、前后文、未完待续页和附录；旧导论与总结页继续兼容。例如：

```text
book/
  front-matter/
    01-preface.md
    02-readers-letter.md
  01-foundations.md
  02-main-results.md
  appendix-a-background.md
  back-matter/
    01-ai-retirement-note.md
  to-be-continued.md

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

`front-matter/` 与 `back-matter/` 中的文件序号只控制先后，不作为章号。选定容器后，路径与顺序由 `create-page` 计划分配；标题和正文仍由作者决定。

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

## 按章节发布 PDF

需要逐步发布同一部书时，在 Reader 的“版本与出版 → PDF 出版”新建或继续已有方案。选择本版的卷和章节，在“版面与信息”的“项目公共信息”维护作品信息；本版只单独设置需要覆盖的字段、版本、日期与 DOI。网站、仓库和每位作者的本名、别名、ORCID、机构均可编辑。先审阅收录范围、实际使用的元信息、未收录页与跨范围引用，再生成、预览和下载实际 PDF；Zenodo 的草稿上传与正式发布是之后分别启动的动作。

发布方案保存选择与元数据，不改写原稿。正文保留整书原有的章号与对象编号；选取第 3、5 章不会改成第 1、2 章。成品顺序为封面、出版信息、前文、目录、所选正文、后文，以及部分发布默认附上的“未完待续 / To be continued”声明；目录和声明可按方案关闭。范围外引用会列入审阅，不会因此自动加入其他章节。

前言、后记和“未完待续”可以直接写成书稿文件，平时在 Reader 中阅读，出版时引用同一份原稿。例如：

```text
book/
  front-matter/
    preface.md
    readers-letter.md
  vol-i/
    intro.md
    01-foundations.md
    summary.md
  back-matter/
    conclusion.md
    ai-retirement-note.md
  to-be-continued.md
```

`front-matter/` 与 `back-matter/` 可容纳多篇任意标题的文章，文件名前的 `01-`、`02-` 等数字只控制先后，不作为章号；例如 `ai-retirement-note.md` 的标题可以是“AI 退休寄语”，不必改写成“结语”。`to-be-continued.md` 是独立尾页。已有 `intro.md`、`introduction.md` 与 `summary.md` 继续兼容；卷内的前后文仍在该卷两端。各页按书稿规则保留稳定页标识，文件引用与相对图片沿用正文的编译规则。

Reader 新方案默认开启“自动收录所选书卷的序言、后记、附录等内容”；CLI 方案设 `"matter": { "automatic": true }`。工具复用稿件扫描识别的结构角色：全书前后文进入对应位置，卷内前后文仍在对应卷的两端，附录作为正文保留原有附录号与对象编号；不会仅凭任意正文标题猜测角色，也不会把别的书或未选择卷的前后文加入本版。唯一匹配的“未完待续”稿件可沿用；存在多个候选时需明确选择声明稿件。

可以逐项取消自动收录，CLI 用 `matter.exclude` 保存相对路径；“手动调整收录与顺序”把当前结果转成手动选择，前后文条目可以上移、下移和移除。已有方案保持原有选择，需主动开启自动收录再审阅变化。创建稿件不会改写保存的方案；自动方案在下一次规划时重新识别实际稿件。

同一文件被前文、后文或声明中的一个条目引用后，不会在正文重复输出；同一文件重复用于多个条目或角色时，需要先在方案中消除歧义。审阅页列出实际文件路径及内容，原稿、资源或元信息变化后需重新审阅。

### 公共元信息与本版覆盖

公共作品信息维护在项目 `.math-workspace/config.json` 的 `metadata`，不要复制到每一版方案中。例如，在已有配置中合并：

```json
{
  "metadata": {
    "title": "My Book",
    "subtitle": "Foundations",
    "authors": [{
      "name": "Author Name",
      "nativeName": "作者本名",
      "aliases": ["Author Alias"],
      "orcid": "https://orcid.org/0000-0002-1825-0097",
      "affiliation": "Research Institute"
    }],
    "language": "en-US",
    "description": "A description of the work.",
    "website": "https://example.org/book",
    "repository": "https://github.com/example/book",
    "license": "cc-by-4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "keywords": ["mathematics"],
    "preferredCitation": "Author Name. My Book."
  }
}
```

已有作品 DOI 可维护在 `metadata.doi.conceptDoi`，来源说明在 `metadata.doi.provenance`；本版 DOI 始终在方案的 `doi.versionDoi` 或其 Zenodo 绑定中维护。不要把上一版 DOI 填成作品 DOI。

Reader 提供项目公共信息与本版覆盖入口，作者按人编辑；关闭某字段的“本版单独设置”即可恢复继承。也可以使用同一工具入口：

```bash
math-workspace publication metadata
math-workspace publication save-metadata metadata.json --expected-revision <metadata 返回的 revision>
```

`metadata.json` 仅包含上例中 `metadata` 内的公共字段，不含返回值的 `value`、`revision` 外壳。保存检查完整项目配置的当前修订，并保留其他配置；冲突时重新读取后再保存。Reader 会保留未保存的草稿，刷新不会自动用新修订覆盖别人的更改；可以明确重新载入公共信息后编辑。

解析顺序为旧 `pdf` 身份字段的兼容回退、项目 `metadata`、本版明确覆盖。缺少字段表示继承；空字符串或空列表可以清除可选值，作者列表整体替换，DOI 按子字段覆盖。实际标题不能为空。版本、版次、出版日期与本版 DOI 属于本版。旧方案原来明确填写的字段继续作为覆盖保留，工具不会猜测并删除作者的选择。

构建清单冻结公共信息、本版覆盖及解析结果；PDF、`citation.json` 和 Zenodo 使用同一结果。PDF 出版信息页显示网站、仓库、许可、作者身份与 DOI，简介和关键词还提供给 PDF 属性；引用文件保留作者 ORCID/机构、网址、仓库、许可、语言、简介、日期和 DOI。Zenodo 作者映射到 creators/ORCID/affiliations，关键词映射到 subjects，网站和仓库分别成为 `isDescribedBy`、`isDerivedFrom` 的 URL 关联；本名、别名、推荐引用、许可链接等补充信息进入 Notes。元信息修改后需要重新规划和构建，旧成品与已发布版本保留原值。服务字段说明见 [Zenodo API](https://developers.zenodo.org/) 与 [InvenioRDM 元信息](https://inveniordm.docs.cern.ch/reference/metadata/)。

### 最小方案与本地构建

从拥有 `.math-workspace/config.json` 的项目根运行。将实际章节路径填入 `publication.json`；标题和作者可从项目公共信息继承，也可在本版单独设置，至少选择一章：

```json
{
  "id": "book",
  "workId": "my-book",
  "version": "0.1.0",
  "chapters": ["book/vol-i/01-foundations.md", "book/vol-i/02-main-results.md"],
  "matter": { "automatic": true },
  "frontMatter": [
    { "file": "book/front-matter/preface.md", "includeInToc": false },
    { "file": "book/front-matter/readers-letter.md", "includeInToc": true }
  ],
  "backMatter": [
    { "file": "book/back-matter/conclusion.md", "includeInToc": true },
    { "file": "book/back-matter/ai-retirement-note.md", "includeInToc": true }
  ],
  "continued": { "enabled": true, "file": "book/to-be-continued.md" }
}
```

`id` 用来恢复同一个发布方案；`workId` 是跨版保持不变的作品标识，`version` 表示本版。后续增补章节或卷时继续编辑同一方案，保存时使用当前修订号，保留旧构建与服务绑定。

```bash
math-workspace publication inspect
math-workspace publication save publication.json --expected-revision new
math-workspace publication plan book
math-workspace publication build book --fingerprint <plan 返回的 fingerprint>
math-workspace publication status book
```

这些命令返回 JSON。首次保存用 `--expected-revision new`；更新已有方案时改用 `status` 中的 `profile.revision`。`plan` 与 `build` 也接受方案 JSON 路径。构建前使用刚审阅计划的 `fingerprint`，原稿、元数据或资源变化后重新规划并审阅；未收录的原稿也可能参与整书编号，仍属于构建绑定的输入。

可选配置如下；路径相对于项目根，使用项目内文件：

| 字段 | 用途 |
| --- | --- |
| `scope.books`、`scope.volumes`、`scope.paths` | 用 `inspect` 中的 book/volume 标识或目录路径明确作品范围，三者取并集，用于判断尚未收录的页面；不指定时采用所选章节所属 book，无归属 book 时采用项目范围。 |
| `cover.image`、`cover.showVersion` | 可选封面图片及版本显示。 |
| `frontMatter`、`backMatter` | 前后文数组，每项优先用 `file` 引用项目内 Markdown；默认沿用稿件首个一级标题，`title` 可覆盖该标题，`includeInToc` 控制目录项。无 `file` 时沿用旧的 `content` 手填入口。 |
| `toc.enabled`、`toc.depth`、`toc.title` | 目录开关、深度与标题。 |
| `continued.enabled`、`continued.file`、`continued.title`、`continued.text` | 声明开关和稿件引用。`file` 优先提供正文，`title` 可覆盖稿件标题；无文件时沿用手填 `text`，再回退到默认声明。文件已指定而未填写开关时启用；旧方案未指定文件或开关时，仅在部分发布时自动启用。显式启用的声明也会用于已收录全部章节的版本。 |
| `pdf.engine`、`pdf.paper`、`pdf.margin`、`pdf.documentClass` | 本地 PDF 引擎与版式。 |

旧方案的手填前后文与声明仍可直接使用，不会自动转换成稿件文件。选择文件后，已有 `content` 或 `text` 会保留为备用，不会附加到文件内容；清空文件选择后恢复手填或默认文字。这样既能保留旧方案，也能让日常阅读与 PDF 只维护一份稿件。引用文件须是未被扫描排除的项目内 Markdown，路径不能穿越目录或跟随符号链接。

构建依赖本机 Pandoc 与 LaTeX 引擎，默认使用 `xelatex`；中文出版方案未指定 `pdf.documentClass` 时使用 `ctexart`，需要本机 TeX 发行版提供 CTeX。macOS 已有可读取的系统宋体时复用该字体，否则使用 TeX 的 Fandol；所选字体及其文件信息记录在构建工具信息中，不安装或复制字体。显式文档类与英文默认保持原设置。`inspect` 显示工具是否可用。工具缺失时可先保存和审阅方案，安装完成后再生成 PDF。

每次构建保存在 `.math-workspace/publications/builds/<id>/<build-id>/`，包含 `publication.pdf`、`compiled.md`、`manifest.json`、`citation.json`、`checksums.sha256` 和构建记录 `build.json`。Reader 可预览、下载 PDF，并取得本版清单和引用信息。清单记录收录与未收录范围、源输入摘要、DOI 状态和产物校验值；构建记录还保留 PDF 的 SHA-256。预览时核对封面、前后文、目录、编号、图片、范围外引用和 DOI，确认的是这份构建的实际文件。PDF 的 DOI 来源说明不是实时登记状态，请到对应平台记录核对。清单建立来源绑定，不是原稿签名、数学正确性或 Lean 证明覆盖的认证；学术留档仍使用独立的 `archive` 流程。

### 手填 DOI

没有连接发布服务也可以本地出版。已有 DOI 时，在 Reader 中填写，或在方案中加入：

```json
{
  "doi": {
    "versionDoi": "10.1234/example-version",
    "conceptDoi": "10.1234/example-work",
    "provenance": "DOI 提供方及其登记或预留记录的位置"
  }
}
```

这里的号码仅为格式示例。`versionDoi` 指向本版，`conceptDoi` 表示整个作品及其版本集合；单独手填的值标为 `unverified`，填写文字不会申请、登记或验证 DOI。只有作品 DOI 时不要把它冒充为本版 DOI。

### Zenodo 预留与正式发布

如需由 Zenodo 提供 DOI，在方案中设置 `zenodo.environment`（`sandbox` 或 `production`）和可选的 `zenodo.tokenEnv`（默认 `ZENODO_TOKEN`），并通过正常保存流程更新方案。令牌只放在启动 CLI 或 Reader 服务的进程环境中；配置只存环境变量名，Reader 只显示是否配置，不收集令牌。未配置令牌时，本地规划、构建和下载仍可使用，外部动作不可用。sandbox 与 production 使用各自的账户和令牌。令牌权限见 [Zenodo API 文档](https://developers.zenodo.org/#authentication)：草稿写入需要 `deposit:write`，正式发布等动作需要 `deposit:actions`。

通过 Codex 插件打开 Reader 时，插件会转发 Codex 宿主进程环境中的默认 `ZENODO_TOKEN`。先在 Codex 的启动环境中配置该变量，再打开或重新打开 Reader。使用自定义 `zenodo.tokenEnv` 时，还需明确配置宿主转发该变量，或在含有该变量的环境中单独启动 Reader。不要将令牌值填入方案、浏览器或受版本管理的配置文件。

上传前还需在已保存方案中提供至少一位作者及 `description` 作品介绍；若填写 `publicationDate`，使用 `YYYY-MM-DD`。`license` 使用 Zenodo 支持的许可标识，未指定时使用 `cc-by-4.0`。上传差异列出草稿当前文件及校验值；有未经本流程归属的文件时阻止上传，保留这些材料。只有已记录文件名与校验值的旧 PDF 可在审阅后替换，已正式发布的旧版仍保留。

预留 DOI 可让最终 PDF 在上传前就写入正确号码；预留与正式登记分开，登记在正式发布时发生，见 [Zenodo DOI 说明](https://help.zenodo.org/docs/deposit/describe-records/reserve-doi/)。流程为：

1. 显式预留 DOI，创建或复用该方案已绑定的草稿，并取得原生草稿 `pids.doi` 确认的真实预留号码；旧兼容接口中的占位 `prereserve_doi` 不作为预留证据。
2. 重新规划，生成包含预留 DOI 的最终 PDF，并审阅成品。
3. 显式读取上传差异，核对草稿文件、将替换的旧 PDF、目标文件与摘要。
4. 使用已审阅差异的指纹，显式上传同一构建到草稿。
5. 单独确认正式发布，使用当前草稿 ID 与修订号。

```bash
math-workspace publication reserve-doi book --expected-revision <profile.revision>
math-workspace publication plan book
math-workspace publication build book --fingerprint <新的 fingerprint>
math-workspace publication status book
math-workspace publication review-upload book --build <build-id> --pdf-sha256 <已审阅 PDF 的 SHA-256> --remote-revision <remote.revision>
math-workspace publication upload book --build <build-id> --pdf-sha256 <同一 PDF 的 SHA-256> --remote-revision <remote.revision> --upload-fingerprint <上传差异的 fingerprint>
math-workspace publication status book
math-workspace publication publish book --build <build-id> --pdf-sha256 <同一 PDF 的 SHA-256> --remote-revision <新的 remote.revision> --record-id <draft-id>
```

上述预留、上传和发布命令会访问外部服务，应分别在相应操作已获授权时执行；查看、规划和本地构建不会自动执行它们。`status` 显示本地保存的绑定状态，`review-upload` 显式读取远端草稿并返回上传差异。每次动作后取新的修订号；源输入、方案、草稿或构建改变时，重新核对，不能沿用旧成品或旧上传差异的确认。

已有 Zenodo 草稿或已发布记录时，先显式接入，避免另建一条无关联记录：

```bash
math-workspace publication attach-zenodo book --expected-revision <profile.revision> --kind draft --record-id <draft-id>
math-workspace publication attach-zenodo book --expected-revision <profile.revision> --kind record --record-id <published-record-id>
```

两行分别用于草稿和已发布记录，按实际情况执行一行。编辑未发布版时继续同一草稿；正式发布后增补章节或修改 PDF 时，保留 `id`、`workId` 和作品 DOI，更新本版元数据，显式创建同一作品的新版本，再重复预留后构建、审阅、上传和发布：

```bash
math-workspace publication reserve-doi book --expected-revision <profile.revision> --new-version --record-id <published-record-id>
```

新草稿提供新的本版 DOI；不要把上一版 DOI 继续填作新版 DOI。本流程保留此前版本的文件与 DOI。Zenodo 的作品 DOI（Concept DOI）表示版本集合并解析到最新版；引用精确文件时使用该版 DOI，见 [DOI 版本说明](https://zenodo.org/help/versioning)和[版本管理](https://help.zenodo.org/docs/deposit/manage-versions/)。本地状态若提示远端结果未知，先核对 Zenodo 现状，再接回正确草稿或记录，不为重试另建一部作品。

### 发布后的独立核验

Zenodo 的发布回执和公开版本核验分别记录。发布后，在 Reader 选择“核验公开版本”，或运行：

```bash
math-workspace publication verify-published book --build <build-id> --pdf-sha256 <已发布 PDF 的 SHA-256> --record-id <published-record-id>
math-workspace publication status book
```

核验不使用令牌：匿名重新读取公开记录，核对本版与作品 DOI、标题、版本、作者、许可和文件名、大小、校验值；实际下载 PDF，比对字节数和 SHA-256；下载后再次读取公开记录，并检查本版 DOI 是否解析到同一版本的公开页面。只访问公开服务并保存本地核验凭据，不预留、上传或再次发布，也不保存方案内尚未保存的编辑。

`status.verifications` 分别显示公开记录、下载文件和 DOI 的结果。三项均通过才是 `verified`；服务暂不可用、限流或 DOI 尚未解析时保持 `pending`，发现不一致时为 `failed`。核验命令相应退出码为 0、2、1。未完成或失败的核验不会抹掉“已发布”的回执；可对同一构建重试，不必重新发布。核验凭据保存在 `.math-workspace/publications/verifications/<profile-id>/<build-id>.json`，可核验已绑定的历史版本，不要求当前书稿仍与旧版相同。

正式环境通过 `https://doi.org/` 核验本版 DOI；sandbox 检查 `https://handle.test.datacite.org/`。[Zenodo sandbox 首页](https://sandbox.zenodo.org/)明确说明其测试 DOI 不是真实 DOI，且不会解析。因此，测试号返回 404 时 DOI 项仍为未验收，界面明确区分“公开文件核验通过”和“DOI 解析未验收”；不能仅凭 sandbox 公开记录或文件可访问就报告整个核验通过。正式 DOI 注册和解析需要在正式记录上另行验收；这里不会自动创建正式记录。DataCite 自身测试系统与正式系统的区别见[测试说明](https://support.datacite.org/docs/testing-guide)。

## Markdown 与单次 PDF 导出

先把 formal 源导出为普通 Markdown，再交给其他发布流程处理：

```bash
math-workspace export-md path/to/book --out dist/book.md
```

导出时保留源目录结构：

```bash
math-workspace export-md-split path/to/book --out dist/public
```

使用本机 Pandoc/LaTeX 引擎从 formal 源直接导出 PDF：

```bash
math-workspace export-pdf path/to/book --out dist/book.pdf
```

渲染已经处理好的普通 Markdown：

```bash
math-workspace render-pdf dist/book.md --out dist/book.pdf
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
- 图片按正文顺序排入，不从替代文本另生成图号或图题；图题使用正文的正式图对象；
- 封面页：可选，默认 `simple` 风格；
- 出版元数据页：可选，位于封面页之后、目录之前；
- front matter 声明页：可选，位于 metadata 之后、目录之前。

公共书名、作者和来源地址复用上文的 `metadata`；普通导出的版式选项放在 `.math-workspace/config.json` 的 `pdf` 字段中。旧 `pdf.title`、`pdf.author`、`pdf.repository` 等身份字段保留兼容回退，新配置集中维护公共信息：

```json
{
  "language": "zh-CN",
  "metadata": {
    "title": "书名",
    "authors": [{ "name": "Author Name" }],
    "license": "cc-by-4.0",
    "repository": "https://example.com/project"
  },
  "pdf": {
    "date": "Revised 2026-06-26",
    "titlePage": true,
    "metadataPage": true,
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

结构化作者可通过 `--authors-json '[{"name":"Author Name","orcid":"https://orcid.org/0000-0002-1825-0097","affiliation":"Institute"}]'` 传入；`--website`、`--repository`、`--description`、重复的 `--keyword` 与既有许可、引用和 DOI 参数可覆盖本次导出。参数不自动写回配置。`-V` 是 Pandoc 模板变量入口，不会创建新的项目元信息字段。

本仓库不捆绑 Pandoc 或 LaTeX 发行版。如果本地缺少 PDF 引擎，先交付
`export-md` 中间稿，等本机引擎安装完成后再运行 PDF 渲染。
