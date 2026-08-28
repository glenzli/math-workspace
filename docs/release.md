# Release

[🌍 English](#en) | [🇨🇳 中文](#zh-cn)

---

<a name="en"></a>

## 🌍 English

`math-workspace` releases include four primary surfaces:

- a vendorable CLI, local Math Workspace runtime, and self-contained Codex plugin;
- human-facing public documentation;
- reviewed AI workflow artifacts that should be merged into target projects;
- VASMC catalog exports for lockable reuse.

### Build

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build the release bundle:

```bash
npm run release:local
```

The release bundle is written directly to `dist/`; that directory represents the current build:

```text
dist/
```

The `dist/` directory represents the current build output and does not add another versioned wrapper directory. The version remains in `manifest.json` and npm package metadata. The source checkout / npm catalog lives at `vasm-catalog/`; the release catalog lives at `dist/vasm-catalog/`.

### Release Layout

```text
dist/
  .agents/plugins/
  cli/
  plugins/
  skills/
  vasm-catalog/
  docs/
  README.md
  LICENSE
  INSTALL.md
  manifest.json
  checksums.txt
```

Artifact roles:

- `cli/`: dependency-free CLI runtime and bundled Math Workspace assets for target projects.
- `.agents/plugins/` and `plugins/`: Codex marketplace and the `math-workspace` MCP plugin, including its relative launcher, CLI, and Reader runtime.
- `skills/`: AI rule and composition guidance artifacts: `skills/editor.md`, `skills/math-writing.md`, `skills/integrator.md`, and `skills/lean-formalization.md`.
- `vasm-catalog/`: catalog for VASMC consumers, including the `editor`, `math-writing`, `integrator`, and `lean-formalization` exports.
- `docs/`: human-facing documentation.
- `manifest.json`: machine-readable artifact map.
- `checksums.txt`: SHA-256 checksums.

`docs-src/`, `skills-src/`, `.vasmc/`, `vasmc-build-state.yaml`, and other
repository-internal content sources or build state files are not release artifacts. External VASMC reuse must go through the artifacts and hashes in `vasm-catalog/`, not by scanning these source directories.

### npm Package

The npm package installs the CLI, local Math Workspace, AI artifacts, and VASMC catalog. The Codex plugin is distributed separately through the marketplace:

```bash
npm install -D math-workspace
```

Target project script:

```json
{
  "scripts": {
    'workspace': "math-workspace"
  }
}
```

npm package entries:

- `bin.math-workspace`: points to `out/cli/math-workspace.js`.
- `out/reader/`: local Math Workspace assets served by the CLI `serve` command.
- `skills/`: `editor.md`, `math-writing.md`, `integrator.md`, and `lean-formalization.md` for plain AI review and integration.
- `vasm-catalog/`: catalog exports for VASMC consumers.
- `docs/`: human-facing usage and release documentation.

The npm package is scoped by the root `package.json.files`.

Use the npm package catalog:

```bash
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export editor --alias math-workspace-editor
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export math-writing --alias math-workspace-math-writing
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export integrator --alias math-workspace-integrator
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export lean-formalization --alias math-workspace-lean-formalization
```

### Run the Local Math Workspace

For a first project setup:

```bash
math-workspace init
math-workspace open
```

Or use the vendored release CLI:

```bash
node tools/math-workspace/out/cli/math-workspace.js open
```

Omit the project directory to open the local launcher and choose a target from the native folder chooser or recent projects:

```bash
math-workspace open
```

The command listens only on `127.0.0.1`, scans the project read-only, and refreshes after source changes. Recent-project records stay in local user state rather than the project.

### Use the Codex MCP Plugin

The release bundle includes a marketplace and self-contained `math-workspace` plugin. Add the release bundle as a marketplace and install the plugin:

```bash
codex plugin marketplace add /path/to/math-workspace-release
codex plugin add math-workspace@personal
```

The plugin's relative launcher runs its bundled `math-workspace mcp`; no global command is required. It can start or reuse the local Math Workspace for Codex's built-in browser and resolve active discussion-mark source locators alongside focused formal, dependency, Lean, and read-only validation context.

### Vendor CLI

Copy the CLI into a target project:

```bash
mkdir -p path/to/project/tools/math-workspace
cp -R dist/cli/* path/to/project/tools/math-workspace/
```

Add the script in the target project:

```json
{
  "scripts": {
    'workspace': "node tools/math-workspace/out/cli/math-workspace.js"
  }
}
```

Initialize:

```bash
npm run workspace -- init
```

Verify:

```bash
npm run workspace -- verify
```

### AI Skill Distribution

The `skills/` directory contains reviewable AI artifacts, not a remote installer. If the target project uses VASMC, prefer the release catalog.

Target projects should:

1. review `skills/editor.md`;
2. review the project-neutral `skills/math-writing.md`;
3. review `skills/integrator.md`;
4. review `skills/lean-formalization.md` when the project uses Lean;
5. merge the rules into project-native AI instructions;
6. preserve project-specific assumptions, terminology, writing style, and release rules.
   Keep source and generated layers separate:

- `skills-src/*.vasm.md` is the sole content source for generic skills.
- `skills/*.md` and `vasm-catalog/*` are generated consumer artifacts.
- `plugins/math-workspace/skills/*/SKILL.md` is deterministically generated from the same VASM output; `agents/openai.yaml` carries matching UI metadata.
- After changing a source, run `npm run content:build`, review `.vasmc/build-report.yaml` and the generated diff, then run `npm run release:local`. Do not patch generated `SKILL.md` files directly.

If the target project also uses VASMC, lock the catalog exports:

```bash
vasmc add --catalog path/to/vasm-catalog/vasmc-catalog.yaml --export math-writing --alias math-workspace-math-writing
vasmc add --catalog path/to/vasm-catalog/vasmc-catalog.yaml --export editor --alias math-workspace-editor
vasmc add --catalog path/to/vasm-catalog/vasmc-catalog.yaml --export integrator --alias math-workspace-integrator
vasmc add --catalog path/to/vasm-catalog/vasmc-catalog.yaml --export lean-formalization --alias math-workspace-lean-formalization
```

The consumer `vasmc-lock.yaml` fixes artifact hashes; the integrative export's `appliesTo` is also resolved to the editor and math-writing artifact hashes. The target project does not need to scan a remote repository or trust an unlocked path.

### Release Checks

If public docs or skills changed, generate VASMC outputs first:

```bash
npm run content:build -- --dry-run
npm run content:build
```

`--plan` is an alias for `--dry-run`; both only inspect the plan and do not write generated outputs, build-state, or the default report.
Before release, run `npm run content:build`, read `.vasmc/build-report.yaml`, complete pending translate or review actions, and then continue release checks.

Run npm audit against the official registry:

```bash
npm audit --registry=https://registry.npmjs.org --omit=optional
```

Run the full test gate:

```bash
npm test
```

Build the release:

```bash
npm run release:local
```

To copy the same validated plugin snapshot into the sibling local marketplace repository:

```bash
npm run release:marketplace:local
```

The target catalog must already contain a local `./plugins/math-workspace` entry. The source plugin, `dist` snapshot, and marketplace copy are validated separately; the marketplace stores a copied versioned snapshot, not a symlink.

Review:

- `dist/manifest.json`
- `dist/checksums.txt`

### Release Orchestration

`release:local` only builds local artifacts. Use the publish orchestration script for platform releases:

```bash
npm run release -- --dry-run
npm run release -- --only github,npm
npm run release -- --skip gitlab
```

Shortcut commands:

```bash
npm run release:github
npm run release:gitlab
npm run release:npm
```

Pre-publish gate:

```bash
npm run release:check
```

`release:check` validates the release script syntax, runs `release:local`, runs npm pack dry-run, and runs `git diff --check`.

Default release targets:

- `npm`: publish the `math-workspace` npm package with CLI, Math Workspace, public docs, `skills/`, and `vasm-catalog/`. The Codex plugin comes from the marketplace surface.
- `github`: push the current branch and release tag to the `github` remote, then create a GitHub release with `gh`.
- `gitlab`: push the current branch and release tag to the `gitlab` remote, then create a GitLab release with `glab`.

GitHub/GitLab releases attach:

- `dist/manifest.json`
- `dist/checksums.txt`
- `dist/INSTALL.md`

Common arguments:

```bash
npm run release -- --tag v0.1.0
npm run release -- --npm-tag latest
npm run release -- --otp 123456
npm run release -- --github-repo glenzli/math-workspace
npm run release -- --gitlab-repo glenzli/math-workspace
```

Real publishing requires a clean Git worktree. `--dry-run` can preview commands from a dirty worktree, but it warns that a real release would stop.

### Dependency Policy

The built Math Workspace, CLI, and self-contained Codex plugin should remain runtime dependency-free.

Development dependencies are allowed for:

- TypeScript compilation;
- Vite bundling;
- tests.

Rules:

- pin development tools where practical;
- avoid fresh major versions unless needed for a security fix;
- run audit against the official npm registry;
- do not add postinstall hooks or runtime remote loaders;
- keep project-specific release hooks outside `math-workspace`.

---

<a name="zh-cn"></a>

## 🇨🇳 中文

`math-workspace` 的 release 包含四类主产物：

- 可 vendoring 的 CLI、本地 Math Workspace 运行时与自包含 Codex plugin；
- 面向人的公开文档；
- 需要融合到目标项目的 AI 工作流 artifact；
- 可由 VASMC 锁定消费的 catalog exports。

## 构建

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

构建 release 包：

```bash
npm run release:local
```

release 包直接输出到 `dist/`；该目录代表当前构建版本：

```text
dist/
```

`dist/` 只表示当前构建结果，不再额外包一层版本目录。版本号保留在 `manifest.json` 和 npm package metadata 中。`vasm-catalog/` 的源码 checkout / npm 发布面位于仓库根目录；release 发布面位于 `dist/vasm-catalog/`。

## Release 结构

```text
dist/
  .agents/plugins/
  cli/
  plugins/
  skills/
  vasm-catalog/
  docs/
  README.md
  LICENSE
  INSTALL.md
  manifest.json
  checksums.txt
```

各产物职责：

- `cli/`：目标项目使用的无运行时依赖 CLI 与内置 Math Workspace 静态资源。
- `.agents/plugins/` 与 `plugins/`：Codex marketplace 与 `math-workspace` MCP plugin；plugin 内含相对路径启动器、CLI 和 Reader 运行时。
- `skills/`：AI 规则与组合指导 artifact，包含 `skills/editor.md`、`skills/math-writing.md`、`skills/integrator.md` 和 `skills/lean-formalization.md`。
- `vasm-catalog/`：面向 VASMC consumer 的 catalog，包含 `vasmc-catalog.yaml`、`editor`、`math-writing`、`integrator` 和 `lean-formalization` exports。
- `docs/`：面向人的文档。
- `manifest.json`：机器可读产物表。
- `checksums.txt`：SHA-256 校验和。

`docs-src/`、`skills-src/`、`.vasmc/`、`vasmc-build-state.yaml` 等仓库内部
内容源和构建状态不是 release 产物。对外 VASMC 复用必须通过 `vasm-catalog/` 中的 artifact 和 hash，而不是直接扫描这些 source 目录。

## npm 包

npm 包用于安装 CLI、本地 Math Workspace、AI artifacts 和 VASMC catalog。Codex plugin 由 marketplace 单独分发：

```bash
npm install -D math-workspace
```

目标项目脚本：

```json
{
  "scripts": {
    'workspace': "math-workspace"
  }
}
```

npm 包入口：

- `bin.math-workspace`：指向 `out/cli/math-workspace.js`。
- `out/reader/`：由 CLI 的 `serve` 命令提供的本地 Math Workspace 静态资源。
- `skills/`：裸 AI 审阅和融合用的 `editor.md` / `math-writing.md` / `integrator.md` / `lean-formalization.md`。
- `vasm-catalog/`：VASMC consumer 使用的 catalog exports。
- `docs/`：面向人的 usage 和 release 文档。

npm 包由根目录 `package.json.files` 控制包含范围。

使用 npm 包里的 catalog：

```bash
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export editor --alias math-workspace-editor
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export math-writing --alias math-workspace-math-writing
vasmc add --catalog node_modules/math-workspace/vasm-catalog/vasmc-catalog.yaml --export integrator --alias math-workspace-integrator
```

## 使用 Math Workspace

首次接入项目时运行：

```bash
math-workspace init
math-workspace open
```

或使用 release vendored CLI：

```bash
node tools/math-workspace/out/cli/math-workspace.js open
```

省略项目目录可打开本机启动台，并从系统目录选择器或最近项目中选择目标：

```bash
math-workspace open
```

命令只监听 `127.0.0.1`，只读扫描项目，并在源文件变化后刷新页面。最近项目记录保存在用户本机状态目录，不写入项目。

## 使用 Codex MCP plugin

release bundle 也包含 Codex marketplace 和自包含 plugin。将 release 根目录注册为 marketplace 后即可安装：

```bash
codex plugin marketplace add /path/to/math-workspace-release
codex plugin add math-workspace@personal
```

plugin 通过自身的相对路径启动器运行 bundle 内的 `math-workspace mcp`，不依赖全局命令。它可返回在 Codex 内置浏览器直接访问的 localhost URL，也可查询当前讨论标记的源码定位、命题、严格依赖、Lean 对齐与只读校验。

## Vendoring CLI

把 CLI 复制到目标项目：

```bash
mkdir -p path/to/project/tools/math-workspace
cp -R dist/cli/* path/to/project/tools/math-workspace/
```

目标项目添加脚本：

```json
{
  "scripts": {
    'workspace': "node tools/math-workspace/out/cli/math-workspace.js"
  }
}
```

初始化：

```bash
npm run workspace -- init
```

校验：

```bash
npm run workspace -- verify
```

## AI Skill 分发

`skills/` 是可审阅的 AI artifact，不是远程安装器。通过 VASMC 使用时，优先使用 release catalog。

目标项目应该：

1. 审阅 `skills/editor.md`；
2. 审阅与具体项目无关的 `skills/math-writing.md`；
3. 审阅 `skills/integrator.md`；
4. 使用 Lean 时审阅 `skills/lean-formalization.md`；
5. 把规则融合进项目原生 AI 指令；
6. 保留目标项目自己的公理、术语、文风和 release 规则。
   源与生成层保持分离：

- `skills-src/*.vasm.md` 是通用 skill 的唯一内容源。
- `skills/*.md` 与 `vasm-catalog/*` 是面向 consumer 的生成 artifact。
- `plugins/math-workspace/skills/*/SKILL.md` 由同一 VASM 产物确定性生成；`agents/openai.yaml` 保存对应界面元数据。
- 修改源后运行 `npm run content:build`，审阅 `.vasmc/build-report.yaml` 和生成 diff，再运行 `npm run release:local`。不要直接修补生成的 `SKILL.md`。

如果目标项目本身也使用 VASMC，推荐锁定 catalog exports：

```bash
vasmc add --catalog path/to/vasm-catalog/vasmc-catalog.yaml --export math-writing --alias math-workspace-math-writing
vasmc add --catalog path/to/vasm-catalog/vasmc-catalog.yaml --export editor --alias math-workspace-editor
vasmc add --catalog path/to/vasm-catalog/vasmc-catalog.yaml --export integrator --alias math-workspace-integrator
vasmc add --catalog path/to/vasm-catalog/vasmc-catalog.yaml --export lean-formalization --alias math-workspace-lean-formalization
```

consumer 的 `vasmc-lock.yaml` 会固定 artifact hash；integrative export 的 `appliesTo` 也会被解析为 editor 与 math-writing artifact 的 hash。这样目标项目不需要扫描远端仓库，也不需要信任未锁定路径。

## Release 检查

如果修改了 public docs 或 skill，先生成 VASMC 输出：

```bash
npm run content:build -- --dry-run
npm run content:build
```

`--plan` 是 `--dry-run` 的别名；二者只查看计划，不写生成物、build-state 或默认 report；真正 release
前再运行 `npm run content:build`，读取 `.vasmc/build-report.yaml`，完成 pending
的 translate 或 review action，再继续 release 检查。

使用官方 registry 做 npm audit：

```bash
npm audit --registry=https://registry.npmjs.org --omit=optional
```

运行完整测试：

```bash
npm test
```

构建 release：

```bash
npm run release:local
```

把相同的已校验 plugin 快照同步到同级的本地 `marketplace` 仓库：

```bash
npm run release:marketplace:local
```

该命令要求目标 marketplace 已有指向 `./plugins/math-workspace` 的 catalog 条目。源码 plugin、`dist/plugins/math-workspace` 和 marketplace 快照分别校验；marketplace 中保存复制出的版本快照，不使用符号链接。

检查：

- `dist/manifest.json`
- `dist/checksums.txt`

## 发布编排

`release:local` 只构建本地产物。真正发布到平台时使用发布编排脚本：

```bash
npm run release -- --dry-run
npm run release -- --only github,npm
npm run release -- --skip gitlab
```

快捷命令：

```bash
npm run release:github
npm run release:gitlab
npm run release:npm
```

发布前门禁：

```bash
npm run release:check
```

`release:check` 会检查发布脚本语法、运行 `release:local`、执行 npm pack dry-run，并运行 `git diff --check`。

默认发布目标是：

- `npm`：发布 `math-workspace` npm 包，包内包含 CLI、Math Workspace、public docs、`skills/` 与 `vasm-catalog/`。Codex plugin 由 marketplace 发布面提供。
- `github`：推送当前 branch 和 release tag 到 `github` remote，并用 `gh` 创建 GitHub release。
- `gitlab`：推送当前 branch 和 release tag 到 `gitlab` remote，并用 `glab` 创建 GitLab release。

GitHub/GitLab release 会附带：

- `dist/manifest.json`
- `dist/checksums.txt`
- `dist/INSTALL.md`

常用参数：

```bash
npm run release -- --tag v0.1.0
npm run release -- --npm-tag latest
npm run release -- --otp 123456
npm run release -- --github-repo glenzli/math-workspace
npm run release -- --gitlab-repo glenzli/math-workspace
```

真实发布会要求 Git worktree 干净。`--dry-run` 允许在 dirty worktree 下预览命令，但会提示真实发布会停止。

## 依赖策略

构建后的 Math Workspace、CLI、自包含 Codex plugin 和 legacy 扩展应保持无 npm 运行时依赖。

开发依赖只用于：

- TypeScript 编译；
- Vite 打包；
- 测试；

规则：

- 尽量固定开发工具版本；
- 除非安全补丁需要，避免刚发布的大版本；
- audit 使用官方 npm registry；
- 不增加 postinstall hook 或运行时远程加载；
- 项目特有 release hook 不写进 `math-workspace`。
