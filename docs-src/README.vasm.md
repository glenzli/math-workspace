---
vasm:
  alias: math-workspace-readme
  intent: "Introduce Math Workspace as local tooling for long-form mathematical Markdown, structural review, Lean alignment, and publication."
  compile:
    format: informational
    targetLangs: ["en", "zh-CN"]
---

# Math Workspace

![Math Workspace：数学正文、依赖、符号与 Lean 对齐](media/readme/banner.png)

Math Workspace 是一组用于长篇数学写作的本地工具。正文保存在 Markdown 中；CLI 和 Reader 处理稳定标识、引用、命题依赖、符号检查、Lean 对齐记录与发布导出。

> **开发预览。** 当前版本仍在调整命令、配置和生成数据格式。建议在版本控制下使用，并为重要书稿保留备份。

项目以源码为准。生成的索引和报告可以检查、删除并重新生成。结构扫描负责发现引用、标识和依赖问题；数学结论仍由作者、审阅者和所使用的形式化工具确认。

![命题依赖审阅（演示内容已脱敏）](media/readme/dependency-review.png)

## 当前可用

- **稳定标识与引用**：章节、小节、命题类对象、公式、图和表可以使用稳定的 `h-*` 标识；读者编号根据当前结构生成。`finish` 固化 `tmp-*` 临时标识，`verify` 检查断裂引用、残留临时标识和迁移问题。
- **本地 Reader**：提供多卷导航、目录、定义查询、当前页符号、引用回溯、正文刷新和命题关系查看。Reader 只监听 `127.0.0.1`，并且只在包含 `.math-workspace/config.json` 的项目中启用工作区界面。
- **依赖审阅**：读取命题中明确声明的严格依赖，生成上下游关系、章节图和端点报告。普通说明文字不会自动成为依赖边。
- **符号审计**：用户可以显式调用 Codex 检查同形符号及其作用域和含义。结果按内容缓存，作为审阅报告展示，不会自动改写正文，也不进入 `verify` 门禁。
- **Lean 对齐**：配置 Lean 项目后，可以扫描声明 docstring 中的正文锚点，记录 Lake 构建结果，并对照 Lean 直接依赖与正文严格依赖。
- **Codex 上下文**：Reader 中的标记保存文件位置、可用锚点和来源 hash。只读 MCP 工具可以查询标记、命题、有限深度依赖、Lean 状态、项目术语、既有符号审计和校验结果。
- **发布导出**：可以生成合并或分文件 Markdown，也可以调用本机 Pandoc 与 LaTeX 工具链生成 PDF。

![符号审计报告（演示内容已脱敏）](media/readme/symbol-audit-report.png)

## 当前边界

- 配置、Reader 交互和生成数据格式仍可能变化，当前版本适合在可回滚的写作项目中试用。
- `verify` 检查可机械判断的结构一致性。数学正确性、证明完整性和论证质量仍需单独审阅。
- 符号审计和辅助审阅依赖用户显式启动的 Codex，并保持为建议性结果。
- Lean 状态记录锚点、构建和依赖证据。正文与声明之间的语义对应及形式化覆盖范围需要人工确认。
- Reader 不修改 Markdown 正文；用户明确操作后，它可以写入文档阶段、检查点和本机标记等工作区状态。
- PDF 导出依赖本机安装的 Pandoc 和 LaTeX 引擎。
- 早期 VS Code 扩展已冻结在 `legacy/vscode-extension/`，不参与当前构建、发布和支持。

## 接入项目

npm 版本发布后，可在数学写作项目中安装：

```bash
npm install -D math-workspace
npx math-workspace init
npx math-workspace open
```

`init` 创建或补全 `.math-workspace/config.json`，并生成第一次项目索引。`open` 从当前目录向上查找项目根目录，再启动本地 Reader。编辑文件后运行：

```bash
npx math-workspace finish path/to/chapter.md
```

`finish` 会固化目标文件中的临时标识，然后执行校验。`verify` 用于只读的整项目门禁，`doctor` 用于检查项目发现、Reader 产物和可选工具链。

Codex plugin 从公开 marketplace 安装：

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add math-workspace@glenzli-marketplace
```

plugin 自带 CLI 和 Reader 运行时，不要求全局安装 `math-workspace`。安装或更新后新建 Codex 任务。首次接入建议先确认扫描范围和 Reader，再按需要配置项目写作规则或 Lean。完整步骤见[安装与项目适配指南](docs/install.md)。

## 最小语法

新增结构时先使用临时标识：

```markdown
# #tmp-1 基础拓扑

## #tmp-2 紧性

定理 #tmp-3（有限子覆盖判据）：设 \(X\) 为紧空间。

证明：...

由 @tmp-3 可知，每个开覆盖都有有限子覆盖。
```

运行 `finish` 后，`tmp-*` 会转换为稳定标识。正文引用使用 `@h-...`、`@h-....title` 或 `@h-....full`。定义和符号使用各自的查询数据，不参与命题编号。完整语法、迁移、图查询、配置和 PDF 选项见[使用指南](docs/usage.md)。

## 常用命令

```bash
math-workspace init
math-workspace open
math-workspace finish path/to/chapter.md
math-workspace verify
math-workspace doctor
math-workspace mcp

math-workspace export-md book/ --out dist/book.md
math-workspace export-md-split book/ --out dist/public
math-workspace export-pdf book/ --out dist/book.pdf
```

Lean 项目还可以使用 `math-workspace lean scan|coverage|verify|capture|build|dependencies`。命令参数和项目配置见[使用指南](docs/usage.md)。

## 开发

```bash
git clone git@github.com:glenzli/math-workspace.git
cd math-workspace
npm install
npm run build
npm test
```

`npm run build` 同时把编译后的 CLI 和 Reader 放入源码 plugin 的忽略目录，供本地开发安装。公开文档的维护源位于 `docs-src/**/*.vasm.md`。修改后运行 `npm run content:build` 生成中英文文档。维护者用 `npm run release:prepare` 生成待审阅的 npm 包和 marketplace 快照；登录、推送和发布在提交完成后单独执行。完整流程见[发布说明](docs/release.md)。

项目入口：

- [安装与项目适配](docs/install.md)
- [使用指南](docs/usage.md)
- [发布说明](docs/release.md)
- [GitHub](https://github.com/glenzli/math-workspace)
- [GitLab](https://gitlab.com/glenzli/math-workspace)

MIT License。
