# Installation and Project Adaptation

[🌍 English](#en) | [🇨🇳 中文](#zh-cn)

---

<a name="en"></a>

## 🌍 English

Math Workspace can be adopted in layers. The CLI and Reader form the base; the Codex plugin, project-specific skills, symbol audit, and Lean alignment can be added when a real need appears. Do not copy every workflow merely to make the installation look complete.

### 1. Prerequisites and scope

- Basic use requires Node.js, npm, and a local project whose primary manuscript source is Markdown.
- Install the Codex plugin only when native Codex tasks need to query marks, propositions, project knowledge, dependencies, Lean evidence, or cached audits.
- Configure Lean only when the project already has a working Lean 4/Lake project.
- Pandoc and LaTeX are needed only for PDF export, not for the Reader.

### 2. Install the CLI and prepare the project

Install Math Workspace in the target project and keep a stable script:

```bash
npm install -D math-workspace
```

```json
{
  "scripts": {
    "workspace": "math-workspace"
  }
}
```

Then run:

```bash
npm run workspace -- init
npm run workspace -- open
```

`init` creates or completes `.math-workspace/config.json` and generates inspectable indexes. `open` finds the project root from the current directory and starts the local Reader on `127.0.0.1` only. `verify` remains the project-wide gate for structure, references, and migration residue. Project source remains the source of truth.

### 3. Define the scan boundary

When adapting an existing repository, first decide which Markdown files belong to the formal manuscript. Exclude drafts, private notes, build output, and historical material before adding hashes in bulk:

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
  }
}
```

If `draft/**` should stay outside the formal scan but remain visible in the Reader as exploratory material, declare a collection as well:

```json
{
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

Draft collections are collapsible and do not produce formal hashes, dependency nodes, Lean anchors, or symbol-audit input. Formal documents default to Initial Draft; one or several selected documents can be changed to Revising or Stable Draft, and checkpoints such as `RC1` or `v1` record a content hash. State is kept in `.math-workspace/documents.json` and identifies files by project-relative path.

After saving the configuration, run `prepare` and `verify` again. The Reader navigation and adoption status should match the intended scan scope before stable anchors are migrated. See [usage.md](usage.md#configuration) for the complete configuration reference.

### 4. Let AI adapt the project instead of replacing it

The release and npm package include four reviewable artifacts:

- `skills/math-writing.md`: project-neutral mathematical writing, redesign, and audit rules.
- `skills/editor.md`: workspace rules for stable anchors, references, definitions, and symbols.
- `skills/lean-formalization.md`: manuscript–Lean alignment rules.
- `skills/integrator.md`: guidance for composing generic rules with an existing project skill.

An adaptation task for Codex or another AI should require it to:

1. Read the target repository's `AGENTS.md`, project skills, mathematical axioms, and release rules first.
2. Import only the generic artifacts needed for the current task rather than copying the whole package.
3. Preserve project terminology, directory conventions, wrappers, and stricter checks without silently weakening mathematical rigor.
4. Surface genuine conflicts for user judgment instead of allowing a merge script to choose automatically.
5. Treat dependency graphs and Lean as evidence during conceptual rewrites, not as a mandate to propagate obsolete structure or synchronize unstable prose.

Prefer one project-specific skill, such as `co-edit`, that routes to generic rules over several copied prompts that drift independently. VASMC projects can lock artifact hashes from `vasm-catalog/vasmc-catalog.yaml`; other projects can review and incorporate the files manually.

The following task can be given directly to an AI. It describes adaptation constraints but does not replace the target repository's own rules:

```text
Adapt Math Workspace to the current mathematical repository. Read and obey the existing AGENTS.md, skills, build workflow, and mathematical conventions before making changes.
1. Distinguish formal manuscript files from drafts, private material, and generated directories, then propose the smallest scan boundary. Do not rewrite the manuscript in bulk or invent permanent hashes without confirmation.
2. Install or update Math Workspace, run prepare and verify, and explain every remaining error or warning.
3. Select only the math-writing, editor, and lean-formalization rules needed by this project. Use integrator to produce a project-specific skill, preserving project terminology and stricter constraints while reporting conflicts explicitly.
4. If Lean already exists, confirm that it builds independently before configuring alignment. Never describe the presence of an anchor as complete formalization.
5. Report changed files, validation results, semantic questions that still need user judgment, and the normal daily commands.
```

### 5. Install the Codex plugin

Install the public plugin from the marketplace:

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add math-workspace@glenzli-marketplace
```

The plugin carries the built CLI and Reader, so it does not depend on a global `math-workspace` command. Start a new Codex task after installation or update.

For development from the current checkout, build first and then install the repository as a local marketplace:

```bash
cd /absolute/path/to/math-workspace
npm install
npm run build
codex plugin marketplace add /absolute/path/to/math-workspace
codex plugin add math-workspace@personal
```

Its interfaces are read-only:

- `open`, `read_marks`
- `lookup_formal_object`, `lookup_knowledge`
- `inspect_dependencies`, `inspect_lean_alignment`
- `read_symbol_audit`, `verify`

The interfaces live in the `math-workspace` MCP namespace, so the tool names do not repeat the brand prefix. `read_symbol_audit` reads only a cached report that the user has already run; it never calls a model silently.

### 6. Optional Lean alignment

Configure `lean.projects` in `.math-workspace/config.json` only after manuscript objects are reasonably stable and the Lean project builds independently. The minimal sequence is:

```bash
npm run workspace -- lean scan
npm run workspace -- lean verify
npm run workspace -- lean coverage
npm run workspace -- lean build
```

An anchor records the presence of a corresponding declaration. Coverage, contract review, build evidence, and dependency comparison remain separate signals and do not jointly prove complete formalization. During conceptual rewrites, an older Lean implementation can remain as historical evidence without immediately capturing a new baseline.

### 7. Daily use and acceptance

```bash
# Finalize temporary anchors in one chapter and validate it
npm run workspace -- finish path/to/chapter.md

# Inspect the whole project without writing source
npm run workspace -- verify

# Start the local Reader
npm run workspace -- open
```

A useful adaptation should satisfy at least these conditions:

- `verify` reports no errors, and warnings have been understood rather than discarded.
- The Reader shows only the intended manuscript; drafts and private material are outside the scan.
- Formal objects use stable hashes, and new objects use `tmp-*` until finalized. No permanent hash is invented by hand.
- The project-specific skill preserves project semantics instead of turning generic rules into performative process.
- A new Codex task can see the Math Workspace plugin and read marks or run a narrow query.

### 8. Update

Update the project dependency normally, then rebuild indexes and run read-only validation:

```bash
npm update math-workspace
npm run workspace -- init
npm run workspace -- verify
```

For a plugin used from source, pull the new version, build it, update the cachebuster, and reinstall the plugin. Existing Codex tasks do not hot-load a new manifest, skill, or MCP definition, so verify it in a new task. After generic skills change, review the composition again instead of overwriting the project-specific skill.

### 9. Troubleshooting

- Reader enhancements are missing: confirm that `.math-workspace/config.json` exists at the project root, run `init` again, or use `doctor` to inspect project discovery.
- Codex cannot find the MCP server: confirm that the installed plugin contains `out/cli` and `out/reader`, then start a new task after installing or updating it.
- The plugin icon, skills, or tools did not refresh: update the plugin cachebuster and run `codex plugin add math-workspace@personal` again.
- Indexes disagree with source: run `prepare` or `verify`; never edit generated `workspace-index.json` manually.
- Symbol audit has no result: it never runs in the background; explicitly choose a scope, model, and effort in the Reader and start it.
- Lean status is stale: after manuscript or Lean source changes, rerun the relevant `lean verify`, `lean build`, or dependency comparison instead of inferring current state from old evidence.

See [usage.md](usage.md) for commands and configuration, and [release.md](release.md) for packaging and local plugin development.

---

<a name="zh-cn"></a>

## 🇨🇳 中文

Math Workspace 可以分层接入。CLI 与 Reader 是基础；Codex plugin、项目特化 skill、符号审计和 Lean 对齐都可以在真实需要出现后再启用。不要为了“完整”一次性复制所有流程。

## 1. 前置条件与选择

- 基础使用需要 Node.js、npm 和一个以 Markdown 为主要正文源的本地项目。
- Codex plugin 只在需要从原生 Codex 任务查询标记、命题、项目知识、依赖、Lean 或缓存审计时安装。
- Lean 只在项目已经有可构建的 Lean 4/Lake 工程时配置。
- Pandoc 与 LaTeX 只在需要 PDF 导出时安装，不是 Reader 的依赖。

## 2. 安装 CLI 并准备项目

在目标项目中安装并保留稳定脚本：

```bash
npm install -D math-workspace
```

```json
{
  "scripts": {
    "workspace": "math-workspace"
  }
}
```

然后执行：

```bash
npm run workspace -- init
npm run workspace -- open
```

`init` 创建或补全 `.math-workspace/config.json` 并生成可审阅索引；`open` 从当前目录向上查找项目根，再只在 `127.0.0.1` 启动本地 Reader。`verify` 保留为结构、引用和迁移遗留的整项目门禁。项目源码仍是事实来源。

## 3. 明确扫描边界

接入已有仓库时，第一件事不是批量添加 hash，而是确认哪些 Markdown 属于正式正文。草稿、私人笔记、构建目录和历史材料应先排除：

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
  }
}
```

如果希望 `draft/**` 不参与正式扫描、但仍作为探索稿出现在 Reader 中，可以同时声明一个集合：

```json
{
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

探索稿集合可折叠，但不会产生 formal hash、依赖节点、Lean 锚点或符号审计输入。正式文档默认处于“初稿”，可以在目录中单篇或多选改为“修订中 / 稳定稿”，并记录 `RC1`、`v1` 等内容 hash 里程碑；这些记录保存在 `.math-workspace/documents.json`，按项目相对路径识别文件。

保存配置后重新运行 `prepare` 和 `verify`。Reader 左侧目录与接管状态应和预期扫描范围一致，然后再迁移稳定锚点。完整配置见 [usage.md](usage.md#配置)。

## 4. 让 AI 适配项目，而不是覆盖项目

release 和 npm 包中包含四份可审阅 artifact：

- `skills/math-writing.md`：通用数学写作、重构和审计底线。
- `skills/editor.md`：稳定锚点、引用、定义和符号等工作区规则。
- `skills/lean-formalization.md`：正文—Lean 对齐规则。
- `skills/integrator.md`：把通用规则组合进已有项目 skill 的指南。

给 Codex 或其他 AI 的适配任务应明确要求：

1. 先读取目标仓库现有的 `AGENTS.md`、项目 skill、数学公理和发布规则。
2. 只引入当前任务真正需要的通用 artifact，不整包复制。
3. 项目规则可以增加术语、目录、wrapper 和更严格的验证，但不能静默削弱数学严谨性底线。
4. 遇到真实冲突时保留冲突并交给用户判断，不由融合脚本自动择一。
5. 概念性重写时，依赖图和 Lean 只作为证据；不要默认传播旧结构或强制同步尚未稳定的正文。

建议让 AI 产出一个项目特化 skill（例如 `co-edit`），在正文中链接或路由到通用规则，而不是复制多个互相漂移的长提示。使用 VASMC 的项目可以从 `vasm-catalog/vasmc-catalog.yaml` 固定 artifact hash；不用 VASMC 的项目也可以人工审阅后纳入自己的 skill。

可以把下面这段直接交给 AI；它描述的是接入约束，不替代目标仓库自己的规则：

```text
请把 Math Workspace 适配到当前数学仓库。先读取并遵守仓库已有的 AGENTS.md、skills、构建方式和数学约定，再完成以下工作：
1. 识别正式正文、草稿、私人材料和生成目录，提出最小扫描边界；未经确认不要批量改写正文或补造正式 hash。
2. 安装或更新 Math Workspace，运行 prepare 与 verify，并解释每项遗留错误或警告。
3. 只选取本项目需要的 math-writing、editor、lean-formalization 规则，用 integrator 生成项目特化 skill；保留项目术语和更严格约束，显式报告冲突。
4. 若项目已有 Lean，先确认工程可独立构建，再配置对齐；不要把存在锚点表述为完整形式化。
5. 最后报告改动文件、验证结果、仍需用户判断的语义问题，以及日常使用命令。
```

## 5. 安装 Codex plugin

公开版本从 marketplace 安装：

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add math-workspace@glenzli-marketplace
```

plugin 自带构建后的 CLI 与 Reader，不依赖全局 `math-workspace` 命令。安装或更新后新建 Codex 任务以加载 plugin、skills 和 MCP。

开发当前仓库时，先构建，再把仓库根目录作为本地 marketplace 安装：

```bash
cd /absolute/path/to/math-workspace
npm install
npm run build
codex plugin marketplace add /absolute/path/to/math-workspace
codex plugin add math-workspace@personal
```

插件提供的接口保持只读：

- `open`、`read_marks`
- `lookup_formal_object`、`lookup_knowledge`
- `inspect_dependencies`、`inspect_lean_alignment`
- `read_symbol_audit`、`verify`

接口位于 `math-workspace` MCP 命名空间内，因此工具名不再重复品牌前缀。`read_symbol_audit` 只读取用户已经运行的缓存报告，不会静默调用模型。

## 6. 可选 Lean 对齐

只有在正文对象已相对稳定并且 Lean 工程可以独立构建时，才配置 `.math-workspace/config.json` 的 `lean.projects`。最小顺序是：

```bash
npm run workspace -- lean scan
npm run workspace -- lean verify
npm run workspace -- lean coverage
npm run workspace -- lean build
```

锚点只表示存在对应声明；覆盖、contract、构建和依赖比较分别提供不同证据，不共同推出“完整形式化”。概念性重写期间可以保留旧 Lean 作为历史实现，而不立即 capture 新基线。

## 7. 日常使用与验收

```bash
# 完成一章的临时锚点并校验
npm run workspace -- finish path/to/chapter.md

# 只读检查整个项目
npm run workspace -- verify

# 启动本地 Reader
npm run workspace -- open
```

一次有效接入至少满足：

- `verify` 没有错误；警告已经被理解而非简单忽略。
- Reader 只展示预期正文，草稿和私有材料没有误入扫描。
- 正式对象使用稳定 hash，新增对象只使用 `tmp-*`，不手造正式 hash。
- 项目特化 skill 保留项目语义，没有把通用规则当作强制流程表演。
- Codex 能在新任务中看到 Math Workspace plugin，并能读取标记或执行窄范围查询。

## 8. 更新

项目内安装可以按包管理器正常更新，然后重跑只读验证：

```bash
npm update math-workspace
npm run workspace -- init
npm run workspace -- verify
```

从源码使用 plugin 时，拉取新版本后先构建并更新 cachebuster，再重新安装 plugin；已经打开的 Codex 任务不会热加载新 manifest、skill 或 MCP 定义，需要新建任务验证。更新通用 skill 后，项目特化 skill 应重新做一次融合审阅，不应被整份覆盖。

## 9. 故障排查

- Reader 没有增强功能：确认项目根存在 `.math-workspace/config.json`，重新运行 `init`，或运行 `doctor` 查看项目发现结果。
- Codex 找不到 MCP：确认安装的是包含 `out/cli` 与 `out/reader` 的发布 plugin，并在安装或更新后新建任务。
- plugin 图标、skill 或工具没有刷新：更新 plugin cachebuster 后重新执行 `codex plugin add math-workspace@personal`。
- 索引与源码不一致：运行 `prepare` 或 `verify`；不要手工编辑生成的 `workspace-index.json`。
- 符号审计没有结果：它不会后台运行，需在 Reader 中显式选择范围、模型和强度后启动。
- Lean 状态过期：正文或 Lean 源码变化后重新运行相应的 `lean verify`、`lean build` 或依赖检查，不要用旧构建记录推断当前状态。

更多命令与配置见 [usage.md](usage.md)，打包与本地 plugin 开发见 [release.md](release.md)。
