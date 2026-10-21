# Installation and Project Adaptation

[🌍 English](#en) | [🇨🇳 中文](#zh-cn)

---

<a name="en"></a>

## 🌍 English

Choose the tool provider to match the installation: Codex installations reuse the plugin’s CLI, Reader, and generic skills; independent environments use Math Workspace’s own CLI/npm. Configuration, manuscripts, review records, and project-specific rules remain in the writing project.

### 1. Prerequisites and choice

| Environment | Tool provider | Project integration |
| --- | --- | --- |
| Codex plugin task | Installed and enabled Math Workspace plugin, including CLI, Reader, and generic skills | Keep configuration and project-specific rules; do not copy another runtime or generic rules. |
| Independent terminal, automation, CI, or another host | Math Workspace standalone CLI/npm or an independently managed release CLI | Use one explicitly selected CLI; Codex is not required. |

- The standalone CLI needs Node.js; npm installation also needs npm. The Codex plugin launcher uses an available Node runtime supplied by its host environment.
- Configure Lean only when the project already has a buildable Lean 4/Lake project.
- Pandoc and LaTeX are needed only for PDF export, not for the Reader.

### 2. Install and prepare through the selected provider

#### Codex plugin path

Install from the public marketplace:

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add math-workspace@glenzli-marketplace
```

Start a new Codex task after installation or updates, then ask it to initialize and open the writing project. The project does not need another npm dependency, a copied `tools/math-workspace/`, a bundle-sync script, or generic skill copies.

Use the current plugin’s actual entry for initialization and other CLI operations, for example:

```bash
/absolute/path/to/installed-plugin/scripts/launch_math_workspace_mcp init /path/to/project
```

Resolve that path from the actual installation; do not hardcode a machine path or cache version into the project. Reuse exact Node/CLI paths and working directories supplied by the Reader. If a project needs a script, keep only a thin entry that locates the current enabled plugin. If the plugin is missing, disabled, or ambiguous, identify the intended provider rather than falling back to an old project bundle.

#### Standalone CLI path

Without Codex, explicitly install and pin the npm package in the project:

```bash
npm install -D math-workspace
npx math-workspace init
npx math-workspace open
```

A release CLI can also be managed outside the project and called from the project root. Codex is not required. npm and marketplace releases may differ, so verify the version used by the workflow.

In this guide, `math-workspace` is shorthand for the selected actual CLI: use the plugin entry in Codex, `npx math-workspace` for an npm project dependency, or an existing project `workspace` script whose provider has been verified.

`init` creates or completes `.math-workspace/config.json` and generates indexes. `open` finds the project root upward from the working directory and serves the Reader only on `127.0.0.1`. CLI `prepare`, `finish`, and `verify` update derived artifacts; use the plugin’s MCP `verify` for read-only validation. Project source and human records remain authoritative.

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

### 4. Adapt the project with AI

Read the target repository’s existing `AGENTS.md`, project skills, mathematical axioms, and release rules first, and identify the selected tool provider.

- Codex plugin users read the installed plugin’s `math-writing`, `lean-formalization`, and `open-math-workspace` skills. The same plugin generates workspace editing rules in `.math-workspace/agent-guide.md`. Project skills route to those current rules and retain only project-specific axioms, terminology, style, paths, and stricter requirements.
- Standalone CLI or other-host users may review `skills/editor.md`, `skills/math-writing.md`, `skills/lean-formalization.md`, and `skills/integrator.md` from the release. Lock catalog artifacts only when explicitly choosing VASMC distribution; this is not a default dependency for Codex plugin projects.
- Keep configuration, definition and symbol source tables, document state, Lean contracts, build evidence, and human review records in the project. Tool updates do not delete records or recapture unreviewed objects as reviewed.

An adaptation request can say:

```text
Adapt Math Workspace to this mathematical repository. Read its existing AGENTS.md, skills, build workflow, and mathematical conventions, then identify the tool provider:
1. In a Codex plugin task, reuse the installed and enabled plugin’s CLI/Reader/generic skills. Do not copy runtime or generic rules, or add an old-bundle sync workflow. Independent environments use their explicitly installed Math Workspace CLI/npm.
2. Identify formal manuscripts, drafts, private material, and generated directories. Set the smallest scan boundary without bulk rewriting prose or inventing hashes for onboarding.
3. Initialize configuration, run required prepare/verify checks, and explain issues. Prefer MCP verify for read-only checks.
4. Preserve project axioms, terminology, stricter requirements, configuration, and review records. Reference current generic rules and report real conflicts.
5. If Lean is present, check the project and this task’s alignment goal. Report anchors, build results, and human review separately.
6. Report the actual provider/version, changed scope, validation evidence, and daily entry.
```

### 5. Codex queries and project operations

The plugin’s query interfaces are read-only:

- `open`, `open_reader`, `open_workspace`
- `lookup_formal_object`, `lookup_knowledge`
- `inspect_dependencies`, `inspect_lean_alignment`
- `read_lean_review_context`
- `read_symbol_audit`, `verify`

Use narrow MCP tools for queries and the same plugin’s actual CLI for page creation, ID finalization, export, and builds. Independent users call the equivalent commands through their selected CLI. Both paths use the same project files and configuration format.

`submit_lean_review_candidates` saves only explicitly requested AI candidate metadata; it cannot change prose, Lean source, or human decisions. Reader “Add to draft” still requires human review and an explicit save. Symbol-audit queries read existing user-started cache results and never silently start a model.

### 6. Optional Codex file navigation

To route `Markdown file:line` links from Codex replies directly to the Reader, explicitly install the Desktop file handler:

```bash
math-workspace codex-handler install
```

Restart Codex Desktop, then choose Math Workspace from a file link's Open in menu. Saving it as the preferred handler for a project also routes ordinary clicks through this integration. An open Reader navigates in place; otherwise the handler starts or opens the local service. The command manages only its own marked block in `~/.codex/config.toml`. Use `codex-handler status` to inspect it and `codex-handler remove` to remove it.

### 7. Optional Lean alignment

Configure `lean.projects` in `.math-workspace/config.json` only after manuscript objects are reasonably stable and the Lean project builds independently. The minimal sequence is:

```bash
math-workspace lean scan
math-workspace lean verify
math-workspace lean coverage
math-workspace lean build
```

An anchor records the presence of a corresponding declaration. Coverage, contract review, build evidence, and dependency comparison remain separate signals and do not jointly prove complete formalization. During conceptual rewrites, an older Lean implementation can remain as historical evidence without immediately capturing a new baseline.

### 8. Daily use and acceptance

```bash
# Finalize temporary anchors in one chapter and validate it
math-workspace finish path/to/chapter.md

# Validate the whole project and refresh derived artifacts
math-workspace verify

# Start the local Reader
math-workspace open
```

A useful adaptation should satisfy at least these conditions:

- `verify` reports no errors, and warnings have been understood rather than discarded.
- The Reader shows only the intended manuscript; drafts and private material are outside the scan.
- Formal objects use stable hashes, and new objects use `tmp-*` until finalized. No permanent hash is invented by hand.
- The project-specific skill preserves project semantics instead of turning generic rules into performative process.
- A new Codex task can see the Math Workspace plugin, discuss quoted Reader selections, or run a narrow query.

### 9. Update the selected provider

Codex plugin users refresh their marketplace and reinstall the plugin:

```bash
codex plugin marketplace upgrade glenzli-marketplace
codex plugin add math-workspace@glenzli-marketplace
```

Start a new task to load the current plugin, skills, and MCP definitions; existing tasks do not hot-reload them. Continue using the plugin CLI without updating a project-owned tool bundle. Preserve configuration and review records and inspect project-specific rules as needed.

Independent npm users update their dependency and validate through the same CLI:

```bash
npm update math-workspace
npx math-workspace verify
```

For source-based plugin development, build first and update the corresponding installation. Run `init` only when configuration needs completion. Do not use configuration completion or recapture to suppress review drift.

### 10. Troubleshooting

- No enhanced Reader: check `.math-workspace/config.json` and use the actual CLI’s `doctor` to inspect project discovery. Run `init` if the project is unconfigured.
- Codex cannot find MCP: verify that the installed release plugin contains `out/cli` and `out/reader`, then start a new task.
- Stale plugin icon, skills, or tools: check the enabled plugin, marketplace, and version; update that installation and start a new task. Do not switch to an old project bundle.
- Index/source mismatch: run `prepare` or `verify`; do not hand-edit `workspace-index.json`.
- No symbol audit result: start the desired scope, model, and effort explicitly in the Reader; audits do not run in the background.
- Stale Lean state: rerun relevant Lean verification, builds, or dependency checks after input changes. Old build evidence does not prove the current state.

See [usage.md](usage.md) for commands and configuration, and [release.md](release.md) for packaging and plugin development.

---

<a name="zh-cn"></a>

## 🇨🇳 中文

按实际安装方式选择工具来源：通过 Codex 安装时，复用插件自带的 CLI、Reader 和通用 skills；不使用 Codex 时，走 Math Workspace 的独立 CLI/npm。项目配置、原稿、审阅记录和项目特化规则始终留在写作项目中。

## 1. 前置条件与选择

| 使用环境 | 工具来源 | 项目侧接入 |
| --- | --- | --- |
| Codex 插件任务 | 已安装并启用的 Math Workspace 插件，包含 CLI、Reader 和通用 skills | 保留项目配置与特化规则，不再复制工具包或通用规则。 |
| 独立终端、自动化、CI 或其他宿主 | Math Workspace 独立 CLI/npm 或独立管理的 release CLI | 使用明确安装并管理的同一个 CLI，不依赖 Codex。 |

- 独立 CLI 需要 Node.js；npm 安装还需要 npm。Codex 插件的启动器会使用宿主已有的可用 Node 运行时。
- Lean 只在项目已经有可构建的 Lean 4/Lake 工程时配置。
- Pandoc 与 LaTeX 只在需要 PDF 导出时安装，不是 Reader 的依赖。

## 2. 按来源安装并准备项目

### Codex 插件路径

从公开 marketplace 安装：

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add math-workspace@glenzli-marketplace
```

安装或更新后新建 Codex 任务，让它初始化并打开当前写作项目。项目不需要再安装 `math-workspace` npm 依赖、内置 `tools/math-workspace/`、维护工具包同步脚本或复制插件通用 skills。

初始化及其他 CLI 操作使用当前插件的实际入口，例如：

```bash
/absolute/path/to/installed-plugin/scripts/launch_math_workspace_mcp init /path/to/project
```

这里的路径必须来自实际安装，不把机器路径或带版本号的缓存路径硬编码进项目。Reader 提供确切的 Node、CLI 路径和工作目录时直接复用；项目确需保留脚本时，只保留定位当前启用插件的薄入口。插件缺失、禁用或有多个候选时明确核对来源，不自动回退到仓库旧包。

### 独立 CLI 路径

不通过 Codex 使用时，可以在项目中明确安装并锁定 npm 包：

```bash
npm install -D math-workspace
npx math-workspace init
npx math-workspace open
```

独立 release CLI 也可以放在项目之外统一管理，从项目根调用其实际入口。无需安装 Codex；npm 与 marketplace 可能提供不同发布版本，应核对本流程实际使用的版本。

下文的 `math-workspace` 是已选 CLI 的简写：Codex 中使用插件实际入口；npm 项目依赖使用 `npx math-workspace`；已有且已核对来源的 `workspace` 脚本也可以继续使用。

`init` 创建或补全 `.math-workspace/config.json` 并生成索引；`open` 从当前目录向上查找项目根，只在 `127.0.0.1` 启动本地 Reader。CLI 的 `prepare`、`finish`、`verify` 会更新派生产物；需要只读检查时，使用插件的 MCP `verify`。项目源码与人工记录仍是事实来源。

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

## 4. 让 AI 适配项目

先读取目标仓库已有的 `AGENTS.md`、项目 skill、数学公理和发布规则，并确认所选工具来源。

- Codex 插件用户读取当前插件的 `math-writing`、`lean-formalization` 和 `open-math-workspace` skills；工作区编辑细则由同一插件生成的 `.math-workspace/agent-guide.md` 提供。项目特化 skill 路由到这些当前规则，只保存自己的公理、术语、文风、路径和更严格约束。
- 独立 CLI/其他 AI 宿主可以审阅发行物中的 `skills/editor.md`、`skills/math-writing.md`、`skills/lean-formalization.md` 和 `skills/integrator.md`。明确采用 VASMC catalog 时再锁定相应 artifact；这不是 Codex 插件项目的默认依赖。
- 配置、定义和符号源表、文档状态、Lean 契约、构建证据与人工审阅记录留在项目中。工具升级不删除记录，也不把未审阅对象重新 capture 为已审阅。

可以把下面的适配任务交给 AI：

```text
请把 Math Workspace 适配到当前数学仓库。先读取仓库已有的 AGENTS.md、skills、构建方式和数学约定，再确认本项目的工具来源：
1. 在 Codex 插件任务中复用已安装并启用的插件及其 CLI/Reader/通用 skills，不复制运行时或通用规则，不另建旧包同步流程；独立使用时沿用明确安装的 Math Workspace CLI/npm。
2. 识别正式正文、草稿、私人材料和生成目录，设置最小扫描边界；不要为接入批量改写正文或补造正式 hash。
3. 初始化配置，运行必要的 prepare 与 verify，解释错误和警告；只读检查优先用插件 MCP verify。
4. 项目特化规则保留公理、术语和更严格约束，引用当前通用规则并报告真实冲突；保留现有项目配置和审阅记录。
5. 有 Lean 时先核对工程与本轮对齐目标；锚点、成功构建和人工审阅分别报告。
6. 最后报告实际工具来源和版本、修改范围、校验结果与日常入口。
```

## 5. Codex 查询与项目操作

插件的查询接口保持只读：

- `open`、`open_reader`、`open_workspace`
- `lookup_formal_object`、`lookup_knowledge`
- `inspect_dependencies`、`inspect_lean_alignment`
- `read_lean_review_context`
- `read_symbol_audit`、`verify`

需要查询时使用窄范围 MCP 工具。需要建稿、固化标识、导出或构建时，调用同一插件的实际 CLI。独立 CLI 用户直接使用所选 CLI 的对应命令；两条路径使用同一套文件与配置格式。

`submit_lean_review_candidates` 只保存明确发起的 AI 候选元数据，不能修改正文、Lean 源码或人工结论。Reader 中的“加入草稿”仍须人工核对并主动保存。符号审计查询只读取用户已经运行的缓存，不会静默启动模型。

## 6. 可选 Codex 文件定位

若希望 Codex 回复中的 `Markdown 文件:行号` 链接直接交给 Reader，可以显式安装 Desktop 文件处理器：

```bash
math-workspace codex-handler install
```

重启 Codex Desktop 后，从文件链接的“Open in / 打开方式”菜单选择 Math Workspace；按项目保存为首选处理器后，普通点击也会走这条链路。已打开的 Reader 会直接跳转，未启动时则启动本地服务。该命令只维护用户 `~/.codex/config.toml` 中自己的注释块；用 `codex-handler status` 检查，用 `codex-handler remove` 移除。

## 7. 可选 Lean 对齐

只有在正文对象已相对稳定并且 Lean 工程可以独立构建时，才配置 `.math-workspace/config.json` 的 `lean.projects`。最小顺序是：

```bash
math-workspace lean scan
math-workspace lean verify
math-workspace lean coverage
math-workspace lean build
```

锚点只表示存在对应声明；覆盖、contract、构建和依赖比较分别提供不同证据，不共同推出“完整形式化”。概念性重写期间可以保留旧 Lean 作为历史实现，而不立即 capture 新基线。

## 8. 日常使用与验收

```bash
# 完成一章的临时锚点并校验
math-workspace finish path/to/chapter.md

# 校验整个项目并刷新派生产物
math-workspace verify

# 启动本地 Reader
math-workspace open
```

一次有效接入至少满足：

- `verify` 没有错误；警告已经被理解而非简单忽略。
- Reader 只展示预期正文，草稿和私有材料没有误入扫描。
- 正式对象使用稳定 hash，新增对象只使用 `tmp-*`，不手造正式 hash。
- 项目特化 skill 保留项目语义，没有把通用规则当作强制流程表演。
- Codex 能在新任务中看到 Math Workspace plugin，并能读取标记或执行窄范围查询。

## 9. 按所选来源更新

Codex 插件用户更新 marketplace 并重新安装插件：

```bash
codex plugin marketplace upgrade glenzli-marketplace
codex plugin add math-workspace@glenzli-marketplace
```

之后新建任务以加载当前 plugin、skills 和 MCP；已打开任务不会热加载新定义。继续使用插件提供的实际 CLI，不用更新项目内的工具包。项目配置与审阅记录保留，项目特化规则按需核对。

独立 npm 用户按包管理器更新自己的依赖，再用同一 CLI 校验：

```bash
npm update math-workspace
npx math-workspace verify
```

从源码开发插件时先构建，再更新对应安装。仅在确需补全配置时运行 `init`；不要把配置补全或重新 capture 当作消除审阅漂移的方法。

## 10. 故障排查

- Reader 没有增强功能：确认项目根存在 `.math-workspace/config.json`，先用实际工具入口的 `doctor` 检查项目发现；尚未初始化时再运行 `init`。
- Codex 找不到 MCP：确认安装的是包含 `out/cli` 与 `out/reader` 的发布 plugin，并在安装或更新后新建任务。
- plugin 图标、skill 或工具没有刷新：核对实际启用的插件、marketplace 和版本，更新对应安装并新建任务；不要改用项目里遗留的工具包。
- 索引与源码不一致：运行 `prepare` 或 `verify`；不要手工编辑生成的 `workspace-index.json`。
- 符号审计没有结果：它不会后台运行，需在 Reader 中显式选择范围、模型和强度后启动。
- Lean 状态过期：正文或 Lean 源码变化后重新运行相应的 `lean verify`、`lean build` 或依赖检查，不要用旧构建记录推断当前状态。

更多命令与配置见 [usage.md](usage.md)，打包与本地 plugin 开发见 [release.md](release.md)。
