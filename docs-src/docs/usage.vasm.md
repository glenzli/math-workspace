---
vasm:
  alias: math-workspace-usage
  intent: "Document math-workspace syntax, command workflow, configuration, graph, migration, and chapter-subset PDF publication."
  compile:
    format: informational
    targetLangs: ["en", "zh-CN"]
---

# Usage

这份文档说明 `math-workspace` 的源码语法和常用命令流程。

最简流程：

1. 在原本需要人工维护编号的位置写稳定 marker。
2. 在正文中使用 `@h-...` 引用。
3. 由 CLI 生成 hash ID、预览缓存和报告。

## 核心模型

[核心模型](../fragments/formal-core-model.vasm.md "@import:inline")

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

首次接入项目并生成上下文：

```bash
npm run workspace -- init
npm run workspace -- open
```

`open` 会从当前目录向上查找 `.math-workspace/config.json`。需要单独刷新索引时仍可运行 `prepare`；检查安装、项目发现和可选工具链时运行 `doctor`。

编辑文件或目录后，固化临时 ID 并刷新报告：

```bash
npm run workspace -- finish path/to/chapter-or-dir
```

`finish` 已执行校验。只有直接使用 `finalize`、执行迁移，或需要独立 release 门禁时，再运行：

```bash
npm run workspace -- verify
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

下例的 `math-workspace` 代表当前安装的 CLI 入口；项目已有 `workspace` script 时也可用 `npm run workspace --`。以 `paths` 或 `help-ai` 查看随包规则和文档的位置。Reader 交接提供确切的 Node、CLI 路径和工作目录时，直接复用；不要求项目额外安装全局命令或修改脚本。

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
npm run workspace -- open /path/to/project
```

也可以在项目内的任意子目录运行 `open`。不传项目路径且当前目录不在已初始化项目中时，会打开本机项目启动台。底层 `serve` 命令保留给需要明确控制启动行为的脚本：

```bash
npm run workspace -- serve
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

Math Workspace 可作为独立本地客户端运行，也可通过 Codex MCP 打开。MCP 可启动或复用本机工作区，也提供命题、严格依赖、Lean 对齐与只读校验查询。支持 MCP 插件扩展的桌面端还可从全局侧边栏打开 Math Workspace，或在当前会话旁打开 Reader 面板；两个入口复用同一 Reader，不维护第二套渲染器或 Codex 对话实现。

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

AI 规则不再放在单独的 public doc 中。目标项目应直接读取随包发布的 AI artifacts：

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

如果目标项目使用 VASMC，使用 catalog 锁定工作区、数学写作与融合 artifact；Lean 项目再锁定 Lean artifact：

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

CLI 可打印当前安装中的关键路径：

```bash
npm run workspace -- paths
```

不要自动拉取远端 skill，也不要把 integrator 原样追加到目标 prompt 末尾。应先审阅 artifact，再把规则融合到目标项目已有的 `AGENTS.md`、写作 skill、风格指南或 release 指令中。

## 迁移流程

试运行文字编号引用迁移：

```bash
npm run workspace -- migrate-text-refs path/to/chapter-or-volume
```

应用文字编号引用迁移：

```bash
npm run workspace -- migrate-text-refs --apply path/to/chapter-or-volume
```

试运行旧 ID 迁移：

```bash
npm run workspace -- migrate-ids path/to/chapter-or-volume
```

应用旧 ID 迁移：

```bash
npm run workspace -- migrate-ids --apply path/to/chapter-or-volume
```

## 依赖图

生成依赖图摘要：

```bash
npm run workspace -- graph summary
```

查看某个命题类对象或带 hash 补充注释的局部图：

```bash
npm run workspace -- graph focus <h-id> --depth 2
```

查看下游影响范围：

```bash
npm run workspace -- graph impact <h-id>
```

查看上游依赖：

```bash
npm run workspace -- graph upstream <h-id>
```

汇总章节层面的依赖流：

```bash
npm run workspace -- graph matrix chapter
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
npm run workspace -- lean scan
npm run workspace -- lean coverage
npm run workspace -- lean verify
npm run workspace -- lean capture
npm run workspace -- lean build [--project <key>]
npm run workspace -- lean dependencies
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

需要逐步发布同一部书时，在 Reader 的“版本与出版 → PDF 出版”新建或继续已有方案。选择本版的卷和章节，填写书名、作者、版本与 DOI，配置封面、前文、目录和后文。前后文各可添加多个条目，在项目稿件列表中选择已有 Markdown，保留作者自己的标题。先审阅收录范围、未收录页、实际引用稿件与跨范围引用，再生成、预览和下载实际 PDF；Zenodo 的草稿上传与正式发布是之后分别启动的动作。

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

出版方案明确引用的全书前后文会排到对应位置；仅在章节列表中勾选的卷内前后文仍按所属卷顺序排版。同一文件被前文、后文或声明中的一个条目引用后，不会在正文重复输出；同一文件重复用于多个条目或角色时，需要先在方案中消除歧义。审阅页列出实际文件路径及内容，原稿或图片变化后需重新审阅。

### 最小方案与本地构建

从拥有 `.math-workspace/config.json` 的项目根运行。将实际章节路径填入 `publication.json`；只需一个作者和至少一章即可建立方案，前后文为可选项：

```json
{
  "id": "book",
  "workId": "my-book",
  "title": "My Book",
  "subtitle": "Volume I",
  "version": "0.1.0",
  "authors": [{ "name": "Author Name" }],
  "language": "zh-CN",
  "chapters": ["book/vol-i/01-foundations.md", "book/vol-i/02-main-results.md"],
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

构建依赖本机 Pandoc 与 LaTeX 引擎，默认使用 `xelatex`；中文出版方案未指定 `pdf.documentClass` 时使用 `ctexart`，需要本机 TeX 发行版提供 CTeX 和中文字体。显式文档类与英文默认保持原设置。`inspect` 显示工具是否可用。工具缺失时可先保存和审阅方案，安装完成后再生成 PDF。

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

1. 显式预留 DOI，创建或复用该方案已绑定的草稿。
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

## Markdown 与单次 PDF 导出

先把 formal 源导出为普通 Markdown，再交给其他发布流程处理：

```bash
npm run workspace -- export-md path/to/book --out dist/book.md
```

导出时保留源目录结构：

```bash
npm run workspace -- export-md-split path/to/book --out dist/public
```

使用本机 Pandoc/LaTeX 引擎从 formal 源直接导出 PDF：

```bash
npm run workspace -- export-pdf path/to/book --out dist/book.pdf
```

渲染已经处理好的普通 Markdown：

```bash
npm run workspace -- render-pdf dist/book.md --out dist/book.pdf
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

PDF 选项放在 `.math-workspace/config.json` 的 `pdf` 字段中：

```json
{
  "language": "zh-CN",
  "pdf": {
    "title": "书名",
    "subtitle": "卷 I：基础",
    "author": "Author Name",
    "date": "Revised 2026-06-26",
    "titlePage": true,
    "metadataPage": true,
    "license": "CC BY 4.0",
    "repository": "https://example.com/project",
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

本仓库不捆绑 Pandoc 或 LaTeX 发行版。如果本地缺少 PDF 引擎，先交付
`export-md` 中间稿，等本机引擎安装完成后再运行 PDF 渲染。
