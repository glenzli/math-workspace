---
vasm:
  alias: math-workspace-readme
  intent: "Introduce Math Workspace through its manuscript, Lean review, Codex collaboration, and selected-chapter publication workflows."
  compile:
    format: informational
    targetLangs: ["en", "zh-CN"]
---

# Math Workspace

![Math Workspace Reader：数学正文、稳定引用与书卷导航](https://raw.githubusercontent.com/glenzli/math-workspace/main/media/readme/banner.jpg)

Math Workspace 是面向长篇数学书稿的本地写作与审阅工作区。用 Markdown 维护原稿，在 Reader 中阅读、查定义与符号、核对 Lean，再把选定章节编成一版 PDF。

它既可作为 Codex 插件使用，也提供独立 CLI。正文、前言、后记和未完待续声明都保留在书稿中，日常阅读与出版引用同一份内容。

> **开发预览。** 命令、配置和生成数据格式仍在调整；建议在版本控制下使用。

## 阅读与写作

Reader 提供书、卷、章节导航，当前页目录，定义与符号查询，以及从引用回到原文的定位。正文中的编号由当前结构生成，稳定标识负责让文件重排后的引用仍然指向原对象。

命题关系图保留用于分析的颜色，读取正文明确声明的依赖。符号审计由用户显式启动，作为建议报告展示。结构校验、符号建议与数学正确性分别处理。

- **稳定引用**：章节、小节、命题类对象、公式、图和表可使用稳定标识；`finish` 固化临时标识，`verify` 检查断裂引用和结构问题。
- **数学排版**：窄窗口中的长公式在安全边界折行；复杂公式可显式适配，仍保留原始 LaTeX、编号与源码定位。
- **创作阶段**：初稿、修订中、稳定稿使用统一图标；可记录里程碑和其后的内容变化。

## 正文与 Lean 对照

在同一工作台中并排阅读命题、证明和对应 Lean 声明。可打开完整 Lean 文件，使用语法高亮、搜索、折叠、行号和源码差异检查；已有本地工具链满足条件时，还可以查询类型、定义和证明目标。

锚点、构建结果和 Lean 证据用于核查事实。人工结论、子论断映射、原文与源码范围关联、未解决问题单独保存；材料变化后，旧结论会标记为需要复核。构建成功不自动等于正文与形式化已对齐。

![正文与 Lean 声明并排核对，保留独立的人工审阅状态](https://raw.githubusercontent.com/glenzli/math-workspace/main/media/readme/lean-review.jpg)

## 和 Codex 一起推进

从 Reader 选中文字或公式，可以把原始 Markdown / LaTeX、文件位置与行号加入当前 Codex 输入框，再补充问题并发送。Lean 审阅任务也可以交给 Codex，返回的 AI 候选逐条进入待核对草稿，人工结论仍需审阅者明确保存。

侧栏的 **＋** 用于开始新稿：填写标题，选择正文、前文、后文或未完待续，确认所属书卷和文件位置，再把请求加入 Codex 输入框。共享创建助手负责顺序、稳定页标识与不覆盖检查，AI 接着写正文并完成校验。普通浏览器可复制同一请求。

Codex 返回的 Markdown 文件与行号链接也可通过文件处理器定位到 Reader。面板之间分别保存项目和阅读位置，讨论和审批留在原生会话中。

## 按章节出版，持续增补

在 Reader 的“版本与出版 → PDF 出版”中选择本版的卷和章节，组合封面、前文、目录、正文、后文与未完待续页。正文保留整本书的原编号，范围外引用列出供核对；生成后可预览、下载 PDF，以及查看版次清单与引用信息。

前后文允许多篇、任意标题和文体。例如，“AI 退休寄语”可以作为独立后文，不必改名为“总结”。出版方案直接引用原稿文件，避免在两个地方维护正文。

支持手填作品 DOI 和本版 DOI，也支持明确启动的 Zenodo DOI 预留、草稿上传与正式发布。同一作品可以持续增补章节并保留历史版次；本地查看和构建不会自动触发远端发布。

![审阅本版收录与未收录的章节范围](https://raw.githubusercontent.com/glenzli/math-workspace/main/media/readme/publication.jpg)

以上截图来自专门创建的公开演示书稿。Lean 示例使用本机已安装的工具链；截图不代表其他项目的证明覆盖或人工审核结论。

## 开始使用

### Codex 插件

从公开 marketplace 安装：

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add math-workspace@glenzli-marketplace
```

插件自带 CLI 和 Reader 运行时，不要求另外全局安装 `math-workspace`。安装或更新后新建 Codex 任务，请它为你的写作项目打开 Math Workspace。尚未配置的项目先完成初始化；已有写作规则按需融合。完整步骤见[安装与项目适配指南](docs/install.md)。

### 独立 CLI 与项目依赖

需要脱离 Codex 使用 Reader，或在项目、CI 中锁定工具版本时，可以使用 npm 包：

```bash
npm install -D math-workspace
npx math-workspace init
npx math-workspace open
```

npm 安装的是 registry 已发布版本，更新进度可能与 marketplace 不同；本页介绍当前仓库能力。

`init` 创建或补全 `.math-workspace/config.json` 并生成初始索引。`open` 从当前目录向上发现项目根，再启动只监听 `127.0.0.1` 的本地 Reader。编辑后运行：

```bash
npx math-workspace finish path/to/chapter.md
```

`finish` 固化目标范围内的临时标识并执行校验。`verify` 用作整项目门禁，`doctor` 检查项目发现、Reader 产物与可选工具链。

## 原稿格式

新建页面可以使用 Reader 的 **＋** 或 `create-page`。正文内容使用普通 Markdown；需要稳定引用的结构先写临时标识：

```markdown
# #tmp-1 自然数加法

## #tmp-2 零元

定理 #tmp-3（右零元）：对每个自然数 $n$，都有 $n+0=n$。

证明：由自然数加法在第二个参数上的递归定义可得。
证毕。

由 @tmp-3，可以消去加法右边的零。
```

运行 `finish` 后，临时标识转换为稳定的 `h-*`。正文引用使用 `@h-...`、`@h-....title` 或 `@h-....full`；定义和符号不参与命题编号。

前后文与正文共同保存在项目中，例如：

```text
book/
  front-matter/01-preface.md
  01-addition.md
  02-finite-sums.md
  appendix-a-notation.md
  back-matter/01-ai-retirement-note.md
  to-be-continued.md
```

前后文文件序号控制先后，不作为章号。旧 `intro.md`、`introduction.md` 与 `summary.md` 仍受支持。完整语法、建稿、Lean 审阅及出版配置见[使用指南](docs/usage.md)。

## 当前边界

- `verify` 检查可机械判断的结构一致性；数学正确性、证明完整性和正文与 Lean 的语义对应仍需审阅。
- Reader 不直接改写 Markdown 原稿。明确操作可以保存文档阶段、审阅记录、发布方案与其他工作区状态；创建请求交给原生会话中的 CLI 执行。
- Lean 类型查询和构建证据使用项目已有的本地工具链。可用性取决于工具链、依赖和平台；缺失或过期的证据会明确显示。
- 符号审计与 AI 辅助审阅需要用户显式启动，结果保持为建议。
- PDF 生成依赖本机 Pandoc 和 LaTeX 引擎。DOI 文本、预留 DOI、正式登记与签名原稿是不同状态；Zenodo 操作需要服务进程环境中的令牌与明确授权。
- 早期 VS Code 扩展已冻结在 `legacy/vscode-extension/`，不参与当前构建和支持。

## 开发与分发

```bash
git clone git@github.com:glenzli/math-workspace.git
cd math-workspace
npm install
npm run build
npm test
```

公开文档的维护源位于 `docs-src/**/*.vasm.md`，修改后运行 `npm run content:build`。`npm run release:prepare` 生成并检查待审阅的产物和 marketplace 快照；提交、推送和 npm 发布分别执行。插件分发与独立 npm 包有各自入口，发布流程见[发布说明](docs/release.md)。

- [安装与项目适配](docs/install.md)
- [使用指南](docs/usage.md)
- [发布说明](docs/release.md)
- [GitHub 主仓库](https://github.com/glenzli/math-workspace)
- [GitLab 镜像](https://gitlab.com/glenzli/math-workspace)

MIT License。
