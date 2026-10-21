---
vasm:
  alias: math-workspace-editor-skill
  version: "0.1.0"
  intent: "Executable AI writing rules for math-workspace projects."
  compile:
    format: executable
    targetLangs: ["zh-CN"]
---

# math-workspace 写作规则

用于编辑可长期维护的数学或技术 Markdown。保持正文与 LaTeX 自然可读；编号、引用和派生索引交给工具。

## 不可变规则

[核心模型](../docs-src/fragments/formal-core-model.vasm.md "@import:inline")

- `#h-...` / `#tmp-*` 只写在声明位置；正文引用只写 `@h-...`、`@h-....title` 或 `@h-....full`。不要在行文中写 `命题 #h-...`、`由 #h-...`，也不要手写会变化的显示编号。
- 新对象写 `#tmp-*`，由工具生成正式 hash。已有对象和章/页的 hash 从已读取的原文复制；目标不在当前上下文时，再查 `reference-map.md` 的对应行。
- 定义不加 hash、不参与 ref；普通正文术语也不自动改成 ref。
- 保留原始 Markdown 与 LaTeX；不要转义公式、手工替换显示编号，或直接编辑生成的索引和报告。

## 日常闭环

在 Codex 插件任务中使用当前启用插件自带的 CLI、Reader 和通用 skills，不向目标项目复制运行时或通用规则，也不另建工具包同步流程；独立使用时使用明确安装的 Math Workspace CLI/npm。下文 `math-workspace` 代表所选实际入口。复用 Reader 提供的 Node/CLI 与工作目录，或已核对来源的项目 wrapper；不要为套用示例另装一份工具、改写项目脚本或替换原生规则。项目配置、Lean 契约、构建证据与人工审阅记录保留。

首次进入任务或索引可能过期时：

```bash
math-workspace prepare
```

先读取目标正文。需要引用当前上下文外的既有对象、章节或页面时，再从 `.math-workspace/reference-map.md` 读取对应行；不要为一次局部编辑加载整张表。只有本次涉及术语、概念附录或符号约定时，再读取 `.math-workspace/project-analysis.md`。

编辑后：

```bash
math-workspace finish path/to/chapter-or-dir
```

`finish` 固化目标范围内的 `tmp-*`，并已执行校验。只有本次确实新增跨文件 `@tmp-*` 引用时才加 `--all`。仅在直接运行 `finalize`、执行迁移，或作为独立 release 门禁时，再单独运行 `verify`。

## 新增稿件

- 先读取项目原生写作规则并检查已有稿件，确认类型与所属容器。`chapter` 是正文章节；`front-matter`、`back-matter` 是书或卷两端的独立 Markdown，允许多篇任意标题；`continued` 是独立的未完待续页。角色由位置决定，不限定文体；“AI 退休寄语”通常放后文，无需改名为“结语”。旧 `intro.md`、`introduction.md` 与 `summary.md` 继续兼容，不为采用新格式搬动旧稿。
- 使用同一 CLI 的 `create-page --kind chapter|front-matter|back-matter|continued --container <项目相对书或卷目录，根为 .> --title <标题>`；先加 `--dry-run --json` 检查计划，再按计划创建。除固定文件名的 `continued` 外，可加 `--slug` 指定文件名词干。容器用真实路径，不从书名猜测。Reader 的“＋”也使用这个 helper，只把创建请求加入会话输入框；仍需用户发送。
- helper 分配路径、顺序和稳定页 ID，并拒绝覆盖已有稿件。复用计划的 `stateToken` 作为 `--expect-state`；过期就重新只读规划，项目、类型、标题、容器和目标路径均未变时用新 token 继续，目标变化或已存在时先核对差异或复用原稿。不要手写章号或 hash，不要绕过已有文件另造副本。沿返回的 `filePath` 写正文，保留已创建的页 ID，然后对该文件运行 `finish`。
- 日常阅读与出版只维护这一份 Markdown。创建不会自动将稿件加入出版方案；需要出版时显式用 `frontMatter[].file`、`backMatter[].file` 或 `continued.file` 引用同一原稿，不把正文复制到方案的手填字段。

## 声明与引用

```markdown
## #tmp-1 谱半径与谱隙

命题 #tmp-2（特征值边界）：如果一个有向算子网络满足 ...
定理 #tmp-3（稳定性）：由 @tmp-2 可得 ...

公式 #tmp-4：
$$
\rho(T)<1
$$
```

- 页面需要被引用时，把 hash 放在文件唯一最高级标题；它在预览中隐藏，不产生小节号。
- 小节只编号和跳转，不提供 recall。命题、引理、定理、推论的 recall 在 `证明` / `Proof` 前停止。
- 公式、图、表有独立编号；公式 marker 放在 display math 前，hash 不写入公式内部。
- `注（说明）：...` 默认不加 hash。需要证明、后文引用或稳定锚点的旁支事实才写 `注 #tmp-*（名称）：...`；它不显示“注 x.x”，也不进目录，但会作为补充事实进入显式依赖图。普通注不进入图。
- 完整独立的例、算例和反例可以主动使用 `例 #tmp-*` / `Example #tmp-*`、`反例 #tmp-*` / `Counterexample #tmp-*`，不要求已有后文引用；随文举例仍写普通正文。例与反例共用独立的章内计数，不占命题编号。预览保留多段、公式、列表、代码块及推导或证明，到下一个正式对象、Markdown 标题或分隔线结束；用 `---` 分隔例后普通正文。
- 图注与独立图片段落用空行分开，相邻放在图后或图前；Reader/PDF 保持该顺序并将两者成组。同一幅图的静态与交互版本共用一个图号。

## 习题与解答

- 使用 `习题 #tmp-ex（标题）：题面`；习题独立按章编号。将既有命题转为习题时保留原 hash、引用与 Lean 锚点，但正文依赖的必要命题及证明仍留在主线。
- 题面支持多段、公式、列表和加粗分问，到下一个正式对象或 Markdown 标题结束。独立段落的 `提示：` 和 `解答：` 开始辅助内容，前面留空行；Reader 默认折叠，题面 recall 不含辅助内容。
- 集中题解可放在同书书末的题解附录，与概念、符号汇总的先后按整书结构安排。写 `解答 #tmp-sol（对应 @tmp-ex）：解答内容`，英文为 `Solution #tmp-sol (for @tmp-ex): ...`。题目和每份解答各有独立 ID；解答沿用题号，可用分号补充标题。跨文件临时关联使用 `finish --all`。
- 题解关联与数学依赖分开记录；教学引用不增加主线重要性，但 `graph impact` 仍追踪到题目和解答。Markdown/PDF 导出包含完整提示和解答。
- 习题继续计入默认 Lean 覆盖；题面、相关证明或解答变更均须复核，不因变更对象类型而删除声明或排除覆盖分母。

## 定义、概念页和符号

工具会自动扫描标准 `定义（术语）：...` / `Definition (Term): ...`，并保留合理的跨公式、列表和续接段范围。它还会按明确的文件名或页面主标题识别概念/术语与符号/记号专页（例如 `appendix-*-concepts.md`、glossary、terminology 或中文概念表），不限定附录序号；从概念页的 `术语 | 定义` 表格与末级概念条目建立补充查询索引，合并概念与符号的页面保留两类上下文。

新建概念与符号汇总时，优先放在同书最后一个附录，沿用整书实际序号；可合为一页。已有合适页面时直接复用，不为识别而改名、移动或重排其他附录。

`.math-workspace/project-analysis.json` / `.math-workspace/project-analysis.md` 是工具生成的项目结构摘要；Math Workspace 按内容变更在内存中重建，供 Codex 通过窄范围 MCP 查询核对。它不是写作源，不应为了“刷新索引”而手工改写。

仅在下列情况维护 `.math-workspace/definitions.json`：非标准行文定义、别名/中英互查、需要固定多段预览，或确定性边界提取不可靠。记录可验证的 `term`、可选 `aliases`、`source` 和 Markdown `content`。不确定“称为 X”“记作 X”等是否应可查询时，在原生 Codex 任务中结合 Math Workspace 查询判断；不要静默修改正文或凭普通术语出现创建条目。

`.math-workspace/symbols.json` 仅记录项目明确约定且语义发生变化的特殊 LaTeX 记号，维护 `source`、闭合的 `pattern` 和 `meaning`。不记录通用变量、整条公式或一次性推导；检测到符号附录也不自动猜测 pattern 或 meaning。

## 结构与审阅

- 从拥有 `.math-workspace/config.json` 的 formal root 运行命令。构建、草稿、上下文和外部工程目录写入 `scan.exclude`。
- 定义查询和符号表默认限制在当前 book；跨 book 引用或查询必须先配置 `lookup.bookDependencies`。
- 改动已有命题类对象或带 hash 补充注释前，按需要运行 `math-workspace graph impact <h-id>` 或 `graph focus <h-id> --depth 2`；显式依赖只来自 `@h-...`，报告会将主线对象与补充注释分开统计，AI 推测边不能写进权威依赖图。
- 旧编号迁移使用 `migrate-text-refs` / `migrate-ids` 的 dry-run 后再 `--apply`。工具不会自动改裸数字或手写章引用；结合上下文改为页面 `@h-...` 或临时 `@chapter:path.md`。

## PDF 发布

- 按用户确认的卷章范围保存发布方案，保留原编号，审阅未收录章节、跨范围引用、前后文、目录和部分发布的“未完待续”声明。同一作品逐版增补时沿用稳定的作品标识与发布方案，区分作品 DOI 和本版 DOI。
- 手填 DOI 必须保留来源说明；填写不代表已登记或已核验。Zenodo 使用“预留 DOI → 构建含 DOI 的最终 PDF → 审阅成品及上传差异 → 上传草稿 → 显式正式发布”，保护草稿中未归属本流程的材料；编辑未发布版复用草稿，已发布文件更新须显式创建同一作品的新版本并保留旧版。
- 查看、规划和本地构建不隐式调用发布服务。外部预留、上传及发布分别遵守用户授权；令牌仅放在服务进程环境中，不写入方案、正文或浏览器。
- 发布清单绑定源输入和产物摘要，不证明数学正确性，也不替代原稿签名、验签或 Lean 证据。正文变化后重新规划、构建和审阅，不沿用过期成品的批准。

完整参数查看所选 CLI 的 `--help`；PDF 发布和配置字段见 [Math Workspace 使用指南](https://github.com/glenzli/math-workspace/blob/main/docs/usage.md)，不要求目标项目复制公开文档或把它们内嵌到写作规则。
