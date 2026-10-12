---
name: open-math-workspace
description: Open the local Math Workspace for a prepared formal Markdown project.
---

# Open Math Workspace

Use `open_reader` to read, inspect, or navigate a prepared Math Workspace project beside the current conversation. Use `open_workspace` for the standalone project entry. When discussing a quoted selection, read the inline Markdown attachment and its source location; use the original file when more context is needed.
- Pass the current project root when it contains `.math-workspace/config.json`.
- Pass a project-relative `pagePath` when the user identified a chapter to open.
- If no prepared project is available, call the tool without a root so the local Math Workspace launcher can select a recent or local project.
- The tool opens a local, read-only Math Workspace. Use its UI for source selection, definitions, and formulas.
- Text selections and formula popovers can add source attachments to the current conversation input. This does not automatically send a message. Selections are temporary; ongoing discussion, edits, and approvals stay in the native conversation.
- Prefer narrow tools over broad pasted context: `lookup_formal_object` for one stable object, `inspect_dependencies` for explicit strict relations, `lookup_knowledge` for maintained terms and notation, `inspect_lean_alignment` for observed Lean evidence, and `verify` for deterministic validation.
- Use `read_symbol_audit` only to inspect a cached report that the user already started in Math Workspace; it never initiates model work.
- Treat dependency, Lean, and audit results as evidence for discussion, not as automatic instructions to propagate edits or rewrite source.
