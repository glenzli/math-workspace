# math-workspace 写作规则

用于编辑可长期维护的数学或技术 Markdown。保持正文与 LaTeX 自然可读；编号、引用和派生索引交给工具。

## 不可变规则

- 稳定编号：源码保存稳定 `#h-...`，新增对象先写 `#tmp-*`；正文引用只用 `@h-...`、`@h-....title` 或 `@h-....full`，读者编号由工具渲染。
- 定义查询：定义不加 hash、不参与 ref；工具自动扫描标准 `定义（术语）：...` / `Definition (Term): ...`，并在发现概念/术语附录时利用其表格和末级条目建立补充索引。AI 只为查询缺失、非标准定义、别名、中英互查和不可靠边界维护 `.math-workspace/definitions.json`。
- 项目知识：`.math-workspace/project-analysis.json` / `.math-workspace/project-analysis.md` 是工具生成的概念附录、符号附录和 summary 页面摘要；Math Workspace 在内存中按内容变化重建，供 Codex 通过窄范围 MCP 查询核对。
- 符号表：`.math-workspace/symbols.json` 只记录项目明确约定且发生语义变化的特殊 LaTeX 记号，不索引通用变量、完整推导公式或一次性符号。
- 依赖图：命题/引理/定理/推论与带 hash、可证明的补充注释之间的显式依赖来自 `@h-...`，权威数据是 `.math-workspace/dependency-graph.json`；普通 `注（...）` 不进入图。AI 或证明器推测出的边必须另存为 suggested 数据。
- 导出：普通 Markdown/PDF 不直接消费 formal 源；先用 `export-md` 或 `export-md-split` 降级 marker/ref，项目级后处理之后再用 `render-pdf`。
- 工具闭环：进入任务或索引可能过期时运行 `prepare`，普通编辑后运行 `finish <file-or-dir>`（它会校验）；仅在直接 `finalize`、执行迁移或独立 release 门禁时另行运行 `verify`。

* `#h-...` / `#tmp-*` 只写在声明位置；正文引用只写 `@h-...`、`@h-....title` 或 `@h-....full`。不要在行文中写 `命题 #h-...`、`由 #h-...`，也不要手写会变化的显示编号。
* 新对象写 `#tmp-*`，由工具生成正式 hash。已有对象和章/页的 hash 从已读取的原文复制；目标不在当前上下文时，再查 `reference-map.md` 的对应行。
* 定义不加 hash、不参与 ref；普通正文术语也不自动改成 ref。
* 保留原始 Markdown 与 LaTeX；不要转义公式、手工替换显示编号，或直接编辑生成的索引和报告。

## 日常闭环

首次进入任务或索引可能过期时：

```bash
npm run workspace -- prepare
```

先读取目标正文。需要引用当前上下文外的既有对象、章节或页面时，再从 `.math-workspace/reference-map.md` 读取对应行；不要为一次局部编辑加载整张表。只有本次涉及术语、概念附录或符号约定时，再读取 `.math-workspace/project-analysis.md`。

编辑后：

```bash
npm run workspace -- finish path/to/chapter-or-dir
```

`finish` 固化目标范围内的 `tmp-*`，并已执行校验。只有本次确实新增跨文件 `@tmp-*` 引用时才加 `--all`。仅在直接运行 `finalize`、执行迁移，或作为独立 release 门禁时，再单独运行 `verify`。

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
- `注（说明）：...` 默认不加 hash。需要证明、后文引用或稳定锚点的旁支事实才写 `注 #tmp-*（名称）：...`；它不显示“注 x.x”，也不进目录，但会作为补充事实进入显式依赖图。普通注不进入图。例默认不加 hash，只有已经被后文引用时才反向加 hash。

## 习题与解答

- 使用 `习题 #tmp-ex（标题）：题面`；习题独立按章编号。将既有命题转为习题时保留原 hash、引用与 Lean 锚点，但正文依赖的必要命题及证明仍留在主线。
- 题面支持多段、公式、列表和加粗分问，到下一个正式对象或 Markdown 标题结束。独立段落的 `提示：` 和 `解答：` 开始辅助内容，前面留空行；Reader 默认折叠，题面 recall 不含辅助内容。
- 集中题解可放在同书最后一个附录，写 `解答 #tmp-sol（对应 @tmp-ex）：解答内容`，英文为 `Solution #tmp-sol (for @tmp-ex): ...`。题目和每份解答各有独立 ID；解答沿用题号，可用分号补充标题。跨文件临时关联使用 `finish --all`。
- 题解关联与数学依赖分开记录；教学引用不增加主线重要性，但 `graph impact` 仍追踪到题目和解答。Markdown/PDF 导出包含完整提示和解答。
- 习题继续计入默认 Lean 覆盖；题面、相关证明或解答变更均须复核，不因变更对象类型而删除声明或排除覆盖分母。

## 定义、概念页和符号

工具会自动扫描标准 `定义（术语）：...` / `Definition (Term): ...`，并保留合理的跨公式、列表和续接段范围。它还会识别明确命名的概念/术语附录（例如 `appendix-*-concepts.md`、glossary、terminology 或中文概念表），从 `术语 | 定义` 表格与末级概念条目建立补充查询索引。

`.math-workspace/project-analysis.json` / `.math-workspace/project-analysis.md` 是工具生成的项目结构摘要；Math Workspace 按内容变更在内存中重建，供 Codex 通过窄范围 MCP 查询核对。它不是写作源，不应为了“刷新索引”而手工改写。

仅在下列情况维护 `.math-workspace/definitions.json`：非标准行文定义、别名/中英互查、需要固定多段预览，或确定性边界提取不可靠。记录可验证的 `term`、可选 `aliases`、`source` 和 Markdown `content`。不确定“称为 X”“记作 X”等是否应可查询时，在原生 Codex 任务中结合 Math Workspace 查询判断；不要静默修改正文或凭普通术语出现创建条目。

`.math-workspace/symbols.json` 仅记录项目明确约定且语义发生变化的特殊 LaTeX 记号，维护 `source`、闭合的 `pattern` 和 `meaning`。不记录通用变量、整条公式或一次性推导；检测到符号附录也不自动猜测 pattern 或 meaning。

## 结构与审阅

- 从拥有 `.math-workspace/config.json` 的 formal root 运行命令。构建、草稿、上下文和外部工程目录写入 `scan.exclude`。
- 定义查询和符号表默认限制在当前 book；跨 book 引用或查询必须先配置 `lookup.bookDependencies`。
- 改动已有命题类对象或带 hash 补充注释前，按需要运行 `npm run workspace -- graph impact <h-id>` 或 `graph focus <h-id> --depth 2`；显式依赖只来自 `@h-...`，报告会将主线对象与补充注释分开统计，AI 推测边不能写进权威依赖图。
- 旧编号迁移使用 `migrate-text-refs` / `migrate-ids` 的 dry-run 后再 `--apply`。工具不会自动改裸数字或手写章引用；结合上下文改为页面 `@h-...` 或临时 `@chapter:path.md`。

完整命令、PDF 发布和配置字段见项目的 `docs/usage.md`；不要把这些说明复制进写作提示词。
