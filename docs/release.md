# Release

[🌍 English](#en) | [🇨🇳 中文](#zh-cn)

---

<a name="en"></a>

## 🌍 English

`math-workspace` releases include four primary surfaces:

- a self-contained Codex plugin and a standalone CLI/Reader for independent environments;
- human-facing public documentation;
- AI workflow artifacts to reference or review through the selected installation;
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

### Standalone npm Package (Optional)

Independent users can choose the npm package for the CLI, Reader, AI artifacts, and VASMC catalog. Codex installations reuse the plugin without adding this second dependency. Install once a standalone npm version has been published:

```bash
npm install -D math-workspace
```

Target project script:

```json
{
  "scripts": {
    "workspace": "math-workspace"
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

### Use the Selected Entry

Codex installations reuse the current plugin’s actual Node/CLI, launcher, and working directory. Use its CLI for initialization and file operations, and prefer MCP for queries and read-only checks. Independent environments use their own CLI/npm:

```bash
math-workspace init
math-workspace open
```

Here `math-workspace` represents the selected entry; npm project dependencies use `npx math-workspace`. A release CLI can also be managed outside the project:

```bash
node /absolute/path/to/math-workspace-release/cli/out/cli/math-workspace.js open /path/to/project
```

The Reader binds only to `127.0.0.1`. Recent-project state stays in the user’s local state directory; configuration, manuscripts, review, and evidence records remain in the project.

### Use the Codex MCP Plugin

The release bundle includes a marketplace and self-contained `math-workspace` plugin. Add the release bundle as a marketplace and install the plugin:

```bash
codex plugin marketplace add /path/to/math-workspace-release
codex plugin add math-workspace@personal
```

The plugin's relative launcher runs its bundled `math-workspace mcp`; no global command is required. It can return a localhost URL for Codex's built-in browser, add explicitly quoted Reader selections as source attachments in the current conversation input, and provide focused formal, dependency, Lean, and read-only validation context.

### Project Integration Boundary

- Codex plugin tasks use the installed plugin’s CLI, Reader, and generic skills. Do not copy `cli/` into `tools/math-workspace/`, add a second npm dependency, or maintain old-bundle sync scripts merely for Codex integration.
- Independent terminal, CI, or other-host environments use their selected CLI/npm. Pin and manage that version when reproducibility is required; Codex is not required.
- Projects retain configuration, source, Lean, review records, and project-specific rules. Existing scripts can remain verified thin entries. Do not mix different runtime versions between scripts and the Reader.

### AI Skill Distribution

The `skills/` directory contains reviewable AI artifacts, not a remote installer.

- Codex projects read the installed plugin’s generic skills. Project-specific skills retain only project constraints and route to current rules; the same plugin generates workspace editing details in `agent-guide.md`.
- Standalone CLI and other-host users may review `editor.md`, `math-writing.md`, `integrator.md`, and `lean-formalization.md`. Lock catalog exports only when explicitly choosing VASMC distribution; this is not a default Codex plugin dependency.
- Both paths preserve project-specific axioms, terminology, style, and release rules. Tool updates do not overwrite configuration or human review records.

Keep source and generated layers separate:

- `skills-src/*.vasm.md` is the sole content source for generic skills.
- `skills/*.md` and `vasm-catalog/*` are generated consumer artifacts.
- Plugin `math-writing` and `lean-formalization` skills are generated from the same VASM output. `open-math-workspace/SKILL.md` is the maintained plugin-entry source; `agents/openai.yaml` carries matching UI metadata.
- After changing a source, run `npm run content:build`, review `.vasmc/build-report.yaml` and the generated diff, then run `npm run release:local`. Do not patch generated `SKILL.md` files directly.

Explicit standalone artifact/VASMC consumers can lock the required catalog exports:

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

`release:local` only builds local artifacts. A formal release starts with an unused version; existing tags are neither rewritten nor reused. The npm package version must match the base plugin version. The plugin version may append a Codex cachebuster.

Prepare the npm package and marketplace snapshot for review:

```bash
npm run release:prepare
```

`release:prepare` generates the public docs and plugin, runs the full build and test gate, copies the plugin snapshot into the sibling `marketplace` repository, runs npm pack dry-run, and checks both patches. Review `dist/manifest.json`, `dist/checksums.txt`, the npm pack file list, and both repository diffs; then commit the source and marketplace repositories separately. Both worktrees must be clean for a real release.

The release script always uses `https://registry.npmjs.org` and does not depend on a user-level registry setting. The publisher logs in at the final stage:

```bash
npm_config_cache=/private/tmp/math-workspace-npm-cache npm login --registry=https://registry.npmjs.org
npm_config_cache=/private/tmp/math-workspace-npm-cache npm whoami --registry=https://registry.npmjs.org
```

The separate cache prevents permissions or stale mirror state in an old user-level npm cache from affecting the release. The release script uses the same path for npm ping, lookup, publication, and readback.

After committing and logging in, run the read-only preflight and dry-run:

```bash
npm run release:preflight
npm run release -- --dry-run
```

Preflight checks source and marketplace versions, snapshots, and clean state; reads Git remotes and existing tags; checks `gh`, `glab`, and npm authentication; and distinguishes an unpublished npm version from registry or authentication errors. It does not create tags, push, or publish.

Run the default release after reviewing those checks:

```bash
npm run release
```

The mutation order is fixed:

1. push the marketplace branch;
2. create the source tag and push the source branch and tag to GitHub and GitLab;
3. create the GitHub and GitLab releases;
4. run `npm publish` last;
5. read back Git refs, release state, and npm package metadata.

npm is last so the package cannot become public before its source tag and marketplace snapshot. If the same npm package version already exists, the script only verifies it. If the same tag points to another commit, the script stops and requires a version bump.

Default target responsibilities:

- `npm`: publish the `math-workspace` npm package with CLI, Math Workspace, public docs, `skills/`, and `vasm-catalog/`. The Codex plugin comes from the marketplace surface.
- `github`: push the current branch and release tag to the `github` remote, then create a GitHub release with `gh`.
- `gitlab`: push the current branch and release tag to the `gitlab` remote, then create a GitLab release with `glab`.

GitHub/GitLab releases attach:

- `dist/manifest.json`
- `dist/checksums.txt`
- `dist/INSTALL.md`

Common controls:

```bash
npm run release -- --npm-tag latest
npm run release -- --otp 123456
npm run release -- --skip gitlab
npm run release -- --only github,npm
```

`release:github`, `release:gitlab`, and `release:npm` are recovery commands for a failed platform step. A first npm publication cannot use `release:npm` alone: a matching tag for the current commit must already exist on GitHub or GitLab. Use `--skip-marketplace` only when another controlled process has already published the marketplace snapshot.

A version in `package.json` or local build output does not mean the package is published. The official registry readback is authoritative.

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

- 自包含 Codex plugin，以及供非 Codex 环境独立使用的 CLI/Reader；
- 面向人的公开文档；
- 供按所选入口引用或审阅的 AI 工作流 artifact；
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

- `cli/`：供独立使用的无运行时依赖 CLI 与 Reader 静态资源；Codex 项目使用插件内的同套运行时。
- `.agents/plugins/` 与 `plugins/`：Codex marketplace 与 `math-workspace` MCP plugin；plugin 内含相对路径启动器、CLI 和 Reader 运行时。
- `skills/`：AI 规则与组合指导 artifact，包含 `skills/editor.md`、`skills/math-writing.md`、`skills/integrator.md` 和 `skills/lean-formalization.md`。
- `vasm-catalog/`：面向 VASMC consumer 的 catalog，包含 `vasmc-catalog.yaml`、`editor`、`math-writing`、`integrator` 和 `lean-formalization` exports。
- `docs/`：面向人的文档。
- `manifest.json`：机器可读产物表。
- `checksums.txt`：SHA-256 校验和。

`docs-src/`、`skills-src/`、`.vasmc/`、`vasmc-build-state.yaml` 等仓库内部
内容源和构建状态不是 release 产物。对外 VASMC 复用必须通过 `vasm-catalog/` 中的 artifact 和 hash，而不是直接扫描这些 source 目录。

## 独立 npm 包（按需）

不通过 Codex 使用时，可以选择 npm 包安装 CLI、Reader、AI artifacts 和 VASMC catalog。通过 Codex 安装的项目直接复用插件，不需要再添加这份依赖。独立 npm 版本发布后安装：

```bash
npm install -D math-workspace
```

目标项目脚本：

```json
{
  "scripts": {
    "workspace": "math-workspace"
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

## 使用所选入口

通过 Codex 安装时，复用当前插件提供的实际 Node/CLI、启动器和工作目录；初始化及文件写入使用其 CLI，读取与只读校验优先使用 MCP。独立环境使用自己安装的 CLI/npm，首次接入运行：

```bash
math-workspace init
math-workspace open
```

这里的 `math-workspace` 代表所选实际入口；npm 项目依赖使用 `npx math-workspace`。也可以从项目之外管理 release CLI：

```bash
node /absolute/path/to/math-workspace-release/cli/out/cli/math-workspace.js open /path/to/project
```

Reader 只监听 `127.0.0.1`。最近项目记录保存在用户本机状态目录；项目配置、原稿、审阅与证据记录仍在项目中。

## 使用 Codex MCP plugin

release bundle 也包含 Codex marketplace 和自包含 plugin。将 release 根目录注册为 marketplace 后即可安装：

```bash
codex plugin marketplace add /path/to/math-workspace-release
codex plugin add math-workspace@personal
```

plugin 通过自身的相对路径启动器运行 bundle 内的 `math-workspace mcp`，不依赖全局命令。它可返回在 Codex 内置浏览器直接访问的 localhost URL，也可将 Reader 选取作为源码附件加入当前会话输入框，并查询命题、严格依赖、Lean 对齐与只读校验。

## 项目接入边界

- Codex 插件任务使用已安装插件的 CLI、Reader 和通用 skills。不要为接入再复制 `cli/` 到 `tools/math-workspace/`、添加第二份 npm 依赖或维护旧包同步脚本。
- 独立终端、CI 或其他宿主使用自己选定的 CLI/npm。需要可复现环境时明确锁定其版本并管理更新，不要求安装 Codex。
- 项目只维护自己的配置、源稿、Lean、审阅记录和特化规则。已有脚本可作为经核对来源的薄入口；同一流程不要混用不同版本的脚本和 Reader。

## AI Skill 分发

`skills/` 是可审阅的 AI artifact，不是远程安装器。

- Codex 项目读取已安装插件的通用 skills，项目特化 skill 只保存本项目约束并引用当前规则。工作区编辑细则由同一插件生成的 `agent-guide.md` 提供。
- 独立 CLI/其他 AI 宿主按需审阅 `editor.md`、`math-writing.md`、`integrator.md` 和 `lean-formalization.md`。明确采用 VASMC catalog 时再锁定所需 exports；这不是 Codex 插件项目的默认依赖。
- 两条路径都保留项目自己的公理、术语、文风和发布规则，不以工具更新覆盖配置或人工审阅记录。

源与生成层保持分离：

- `skills-src/*.vasm.md` 是通用 skill 的唯一内容源。
- `skills/*.md` 与 `vasm-catalog/*` 是面向 consumer 的生成 artifact。
- 插件的 `math-writing` 与 `lean-formalization` `SKILL.md` 由同一 VASM 产物生成；`open-math-workspace/SKILL.md` 是插件入口规则的维护源，`agents/openai.yaml` 保存对应界面元数据。
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

`release:local` 只构建本地产物。正式发布从一个未使用过的版本号开始；已有 tag 不改写、不复用。npm package version 与 plugin version 的基础部分必须一致，plugin 可以追加 Codex cachebuster。

先生成待审阅的 npm 包和 marketplace 快照：

```bash
npm run release:prepare
```

`release:prepare` 会生成 public docs 和 plugin，运行完整构建与测试，把 plugin 快照复制到同级 `marketplace` 仓库，执行 npm pack dry-run，并检查两个仓库的 patch。检查 `dist/manifest.json`、`dist/checksums.txt`、npm pack 文件表和两个仓库的 diff；然后分别提交 source 与 marketplace。真实发布要求两个 worktree 都干净。

发布脚本固定使用 `https://registry.npmjs.org`，不依赖用户级 registry 配置。登录由发布者在最后执行：

```bash
npm_config_cache=/private/tmp/math-workspace-npm-cache npm login --registry=https://registry.npmjs.org
npm_config_cache=/private/tmp/math-workspace-npm-cache npm whoami --registry=https://registry.npmjs.org
```

独立 cache 避免用户目录中旧 npm cache 的权限或镜像状态影响发布。发布脚本对 npm ping、查询、发布和回读使用同一路径。

提交并登录后，先运行只读 preflight 和 dry-run：

```bash
npm run release:preflight
npm run release -- --dry-run
```

preflight 检查 source 与 marketplace 的版本、快照和 clean state，读取 Git remotes 与既有 tags，检查 `gh`、`glab` 和 npm 登录状态，并区分 npm 上的未发布版本与 registry/auth 错误。它不创建 tag、不推送、不发布。

确认后执行默认发布：

```bash
npm run release
```

变更顺序固定为：

1. 推送 marketplace branch；
2. 创建 source tag，并推送 source branch/tag 到 GitHub 与 GitLab；
3. 创建 GitHub 与 GitLab release；
4. 最后执行 `npm publish`；
5. 回读 Git refs、release 状态与 npm package metadata。

npm 放在最后，避免 package 已公开而源码 tag 或 marketplace 快照尚未发布。脚本遇到已有同版本 npm package 时只做回读校验；遇到指向其他 commit 的同名 tag 时停止，要求提升版本。

默认目标职责：

- `npm`：发布 `math-workspace` npm 包，包内包含 CLI、Math Workspace、public docs、`skills/` 与 `vasm-catalog/`。Codex plugin 由 marketplace 发布面提供。
- `github`：推送当前 branch 和 release tag 到 `github` remote，并用 `gh` 创建 GitHub release。
- `gitlab`：推送当前 branch 和 release tag 到 `gitlab` remote，并用 `glab` 创建 GitLab release。

GitHub/GitLab release 会附带：

- `dist/manifest.json`
- `dist/checksums.txt`
- `dist/INSTALL.md`

常用控制参数：

```bash
npm run release -- --npm-tag latest
npm run release -- --otp 123456
npm run release -- --skip gitlab
npm run release -- --only github,npm
```

`release:github`、`release:gitlab` 和 `release:npm` 用于失败后的单平台恢复。首次 npm 发布不能只运行 `release:npm`：匹配当前 commit 的 tag 必须已经存在于 GitHub 或 GitLab。`--skip-marketplace` 只用于 marketplace 已由另一条受控流程发布的情况。

`package.json` 或本地构建产物中的版本号不代表 npm 已发布；以官方 registry 的回读结果为准。

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
