# Review Skeleton

## Review Priorities

- Preserve source-first behavior: skeletons and skills orient agents, but source and tests decide facts.
- Protect stable-ID, reference, numbering, preview, migration, graph, and export invariants.
- Keep target-project AI material clear enough to merge into existing project instructions; executable and integrative AI artifacts belong in `skills/`, while VASMC consumers should prefer catalog exports.
- Keep release artifacts narrow: runtime files, a self-contained Codex plugin, public docs, generated AI artifacts, and VASMC catalog exports. Keep the npm package to CLI/Reader runtime, docs, AI artifacts, and catalog exports; publish the plugin as a copied marketplace snapshot.
- Prefer small deterministic checks over persistent implementation summaries.
- Challenge dependency additions unless they clearly reduce maintenance risk and are pinned and verified.

## Block

- Long-lived implementation KBs, source indexes, call graphs, or architecture mirrors.
- Release inclusion of repository-only development context such as `DEV_SKELETON.md`, `REVIEW_SKELETON.md`, or `AGENTS.md`.
- Release inclusion of `docs-src/`, `skills-src/`, `.vasmc/`, or VASMC build-state files.
- Plugin releases that depend on a globally installed `math-workspace` command or omit their bundled CLI/Reader runtime.
- Changes that damage math, LaTeX, Markdown, or PDF export fidelity for formal writing content.
- Changes that make enhanced preview affect workspaces without formal configuration.
- Changes that make definitions or symbols participate in theorem-like numbering by default.
- Skill or documentation changes that ask target projects to auto-install or auto-update unreviewed remote instructions.
- Broad rewrites that replace focused formal-writing behavior with a generic Markdown framework.

## Risk Patterns

- Regex or parser changes that work for one bilingual syntax form but break Chinese/English parity.
- Markdown preview changes that accidentally escape or flatten LaTeX.
- Export or release changes that copy whole directories instead of explicit public artifacts.
- Migration tools that rewrite more than the requested scope or lose incoming references.
- Performance fixes that hide content or disable math rendering instead of reducing injected data.
- Documentation updates that describe current implementation details as durable truth.
- Public documentation or skill edits made only to generated Markdown when the corresponding `docs-src/**/*.vasm.md` or `skills-src/**/*.vasm.md` source should change.

## Verification Expectations

- Run `npm test` for behavior, scanner, CLI, migration, export, or release-sensitive changes.
- Run `npm run release:local` when changing packaging, release docs, `package.json.files`, skills, or public docs copied to release.
- Run `npm run release:prepare` when the public Codex plugin snapshot or the cross-repository publication workflow changes.
- Use `npm run content:build -- --dry-run` or `npm run content:build -- --plan` to inspect documentation or skill-source build plans without writes.
- Run `npm run content:build` after changing public documentation or skill sources, then handle any `.vasmc/build-report.yaml` actions before committing generated outputs.
- Run focused manual preview checks when changing webview UI, preview scripts, styles, navigation, search, hover, symbol panels, or Markdown-It rendering.
- Run dependency review commands before introducing or upgrading package dependencies.
- Use `git diff --check` before finalizing documentation-heavy edits.

## Review Method

1. Read this file and `DEV_SKELETON.md`.
2. Inspect the actual diff and source files relevant to the change.
3. Lead with concrete findings and file references.
4. Separate source-grounded correctness issues from skeleton-preference concerns.
5. Treat skeleton content as preference and orientation, not factual proof.
