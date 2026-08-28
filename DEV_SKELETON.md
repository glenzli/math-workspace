# Dev Skeleton

## Purpose

- Support long-form mathematical and technical Markdown writing with stable source IDs, generated reader-facing numbering, reference checks, a local enhanced Reader, and publication exports.
- Make AI-assisted editing safer by letting agents draft with temporary markers while deterministic tooling finalizes IDs and verifies generated state.
- Keep the Reader and CLI usable as local, reviewable tooling that can be vendored into writing projects.

## Non-Goals

- General-purpose Markdown rendering outside the formal-writing workflow.
- Cloud services, remote indexing, telemetry, or hidden state.
- A theorem prover or mathematical correctness checker.
- A persistent AI implementation KB, source index, or call-graph mirror.
- Automatic skill installation, remote skill updates, or target-project policy ownership.

## Source Of Truth

- `packages/core/src/**`: shared formal scanner, numbering, references, lookup, dependency analysis, and conservative project-knowledge discovery.
- `src/cli/**`, `src/reader/**`: primary CLI and localhost Reader implementation.
- `legacy/vscode-extension/**`: frozen historical VS Code implementation, excluded from builds, release artifacts, and product support.
- `tests/math-workspace.test.mjs`: regression coverage for formal syntax, migration, export, graph, and audit behavior.
- `examples/**`: fixtures and sample writing projects used to exercise behavior.
- `docs-src/**/*.vasm.md`: source for maintained public documentation.
- `skills-src/**/*.vasm.md`: source for target-project AI skill outputs.
- `docs-src/fragments/**/*.vasm.md`: shared source fragments used by public docs and skills.
- `README.md`, `docs/usage.md`, `docs/release.md`: generated or reviewed public documentation output.
- `skills/editor.md`: generated executable target-project AI writing rules.
- `skills/integrator.md`: generated VASMC integrative composition guide artifact.
- `package.json`, `tsconfig*.json`, `vite.*.ts`: build and packaging configuration for core, CLI, and Reader.
- Generated outputs under `out/`, `dist/`, and `.math-workspace/` are verification artifacts, not durable development guidance.

## Stable Constraints

- Source Markdown should stay readable to humans and AI; generated numbering must not require broad manual rewrite.
- Formal IDs are stable implementation data; reader-facing numbers are rendered or exported from metadata.
- Definitions and symbols are lookup aids, not theorem-numbering objects.
- Project knowledge analysis may derive context from deliberately named concept/glossary, notation, and summary pages, but must not infer terms or symbol meanings from ordinary prose or rewrite source content.
- The local Reader is opt-in for workspaces with `.math-workspace/config.json`, binds only to loopback, and is source read-only; it may write explicit document lifecycle metadata only after a deliberate local user action. Ordinary Markdown preview should stay ordinary elsewhere.
- Release bundles ship runtime artifacts, a self-contained Codex plugin, public docs, generated AI artifacts under `skills/`, and VASMC catalog exports for lockable reuse. npm packages ship the CLI/Reader runtime, public docs, generated AI artifacts, and catalog exports; the public plugin is distributed as a copied marketplace snapshot.
- Built Reader and CLI runtimes should remain dependency-free after bundling.
- Dependency changes require caution and explicit verification because supply-chain risk matters for editor tooling.
- Entry hints should stay at file or artifact-category level, not function level.
- For no-side-effect VASMC checks, run `npm run content:build -- --dry-run` or the alias `npm run content:build -- --plan`, optionally with `--report-out /tmp/report.yaml`; use `vasmc expand <source> --target-lang <lang>` for single-source import expansion without workspace routing, build-state, or default report writes.
- `vasmc build --out-dir` is not a dry-run substitute: workspace routing still controls matched output paths.

## Domain Assumptions

- Mathematical writing changes structure often; stable references matter more than preserving handwritten numbers.
- AI agents can read the current source for implementation facts. Durable guidance should describe boundaries and review preferences, not current control flow.
- Target projects may already have their own writing instructions; math-workspace rules should be merged into those native instructions instead of layered blindly.

## Entry Hints

- Public usage or target-project integration: start with `docs-src/**/*.vasm.md`, `skills-src/**/*.vasm.md`, generated `README.md` / `docs/*.md`, generated `skills/*.md`, and catalog artifacts under `vasm-catalog/`.
- Writing-rule details: start with `skills-src/editor.vasm.md` and generated `skills/editor.md`.
- CLI or syntax behavior changes: start with `src/cli/math-workspace.ts`, `packages/core/src/formal-core.ts`, and `tests/math-workspace.test.mjs`.
- Reader behavior changes: start with `src/reader/server.ts`, `src/reader/web/**`, `packages/core/src/formal-core.ts`, and the relevant tests or examples.
- Release boundary changes: start with `package.json`, `src/cli/release.ts`, `docs-src/docs/release.vasm.md`, generated `docs/release.md`, and `npm run release:local`.

## Refresh Triggers

Update this file only when project purpose, non-goals, source-of-truth categories, stable constraints, release boundaries, dependency posture, or common entry hints change. Routine implementation changes should not update it.

## Boundary

This skeleton is orientation only. Verify facts against source, tests, config, generated release artifacts, and maintained public docs.
