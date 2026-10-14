# math-workspace integrative 组件

这是组合指南，不是应原样附加到目标项目末尾的 prompt。把 [editor.md](../skills/editor.md) 的工作区规则和 [math-writing.md](../skills/math-writing.md) 的通用数学纪律拆入目标项目既有的写作、迁移、审阅和发布流程；目标项目自己的公理、术语、证明风格、章节模板和 release 规则仍是主导。

## 整合前

1. 读取目标项目的 AI 指令入口、写作样例和 `package.json` scripts。
2. 读取 `editor.md`、`math-writing.md`、已有 `.math-workspace/config.json` 和目标项目的写作样例。已有对象要被引用时，只读取 `reference-map.md` 的相关行；`agent-guide.md` 仅作为当前索引状态的补充卡片。
3. 若项目尚未初始化，先接入 CLI 并运行：

```bash
npm run workspace -- prepare
```

不要自动下载、安装或更新远端 skill；以已审阅的 release/npm/VASMC artifact 为输入，并在目标项目中融合规则。

## 融合优先级

- 把通用规则视为数学严谨性和工具安全性的底线；项目层可以补充对象、公理、术语、路径、命令和更严格的验收门槛。
- 项目层不得静默删除或削弱“不得隐藏假设、不得改变结论强度、不得伪造依赖、不得夸大形式化覆盖”等通用约束。
- 通用 artifact 中的占位命令、路径或命名与项目实际配置不同时，以项目已验证的具体配置为准，但保留通用规则表达的行为目的。
- 两层规则语义相同但措辞重复时，只保留一次，并采用更具体或更严格的表达。
- 两层在数学前提、结论、修改权限或安全边界上真正冲突时，不自动选择一侧；在生成报告中保留冲突并要求人工裁决。
- 生成后的项目 skill 必须保留来源 artifact、版本或 lock hash 的可追踪性，并通过生成差异审阅后提交。

## 必须融入的规则

- 稳定编号：源码保存稳定 `#h-...`，新增对象先写 `#tmp-*`；正文引用只用 `@h-...`、`@h-....title` 或 `@h-....full`，读者编号由工具渲染。
- 定义查询：定义不加 hash、不参与 ref；工具自动扫描标准 `定义（术语）：...` / `Definition (Term): ...`，并在发现概念/术语专页时利用其表格和末级条目建立补充索引。AI 只为查询缺失、非标准定义、别名、中英互查和不可靠边界维护 `.math-workspace/definitions.json`。
- 项目知识：工具按明确文件名或页面主标题识别概念/术语、符号/记号与 summary 专页，不限定附录序号；合并概念与符号的页面保留两类上下文。`.math-workspace/project-analysis.json` / `.math-workspace/project-analysis.md` 是派生摘要，Math Workspace 在内存中按内容变化重建，供 Codex 通过窄范围 MCP 查询核对。
- 汇总布局：新建概念与符号汇总时优先放在同书最后一个附录，沿用实际序号；已有合适页直接复用，可合为一页，并与题解等其他附录按整书结构协调。
- 符号表：`.math-workspace/symbols.json` 只记录项目明确约定且发生语义变化的特殊 LaTeX 记号，不索引通用变量、完整推导公式或一次性符号。
- 依赖图：命题/引理/定理/推论与带 hash、可证明的补充注释之间的显式依赖来自 `@h-...`，权威数据是 `.math-workspace/dependency-graph.json`；普通 `注（...）` 不进入图。AI 或证明器推测出的边必须另存为 suggested 数据。
- 导出：普通 Markdown/PDF 不直接消费 formal 源；先用 `export-md` 或 `export-md-split` 降级 marker/ref，项目级后处理之后再用 `render-pdf`。
- 工具闭环：进入任务或索引可能过期时运行 `prepare`，普通编辑后运行 `finish <file-or-dir>`（它会校验）；仅在直接 `finalize`、执行迁移或独立 release 门禁时另行运行 `verify`。

把以下能力分别放进目标项目相应动作，而不是只贴一个独立 skill：

- **写作与引用**：新编号对象用 `#tmp-*` 声明，正文只用 `@h-...`；已有 ID 从目标正文或 `reference-map.md` 的相关行复制；通常完成时只运行 `finish`，它会校验。直接 `finalize`、迁移或 release 门禁才另行 `verify`。
- **数学文风**：定义不加 hash；说明类注与普通例默认不加 hash；有证明、稳定锚点或后文实际引用时才为注/例添加 hash。带 hash 的注是未编号的补充事实节点，普通注不进入依赖图。
- **项目知识**：工具自动抽标准定义，按明确文件名或页面主标题识别概念/术语与符号/记号专页，不限定附录序号；合并页保留两类上下文。`project-analysis.md` 是按需读取的派生摘要。AI 仅为缺失、别名/双语或不可靠边界维护 definitions override。
- **符号**：只有项目明确新增或改写特殊记号语义时维护经审阅的符号源表；不索引普通变量或整条公式。
- **结构审阅**：依赖图只来自显式 `@h-...`，覆盖主线命题类对象与带 hash 的补充注释；报告分开统计两层。需要时将 `graph impact`、`focus`、`cycles` 或 `matrix` 接入审阅流程。AI/Lean 推测边须单独存放。
- **项目边界**：formal root 配置 `scan.exclude`；跨 book 引用或查询显式配置 `lookup.bookDependencies`。
- **PDF 发布**：需要出版时，把卷章选择、原编号、前后文与部分发布声明的审阅接入项目流程；同一作品沿用稳定标识，区分作品 DOI 与本版 DOI。手填 DOI 保留未核验来源；Zenodo 先预留再构建，审阅成品与上传差异后上传草稿，最后显式正式发布，保护其他草稿材料。草稿复用，已发布文件通过同一作品的新版本更新。令牌只在服务进程环境中；发布清单、原稿签名与数学/Lean 证据分别判断。

## 可融合的最小片段

```text
进入任务或索引可能过期时运行 npm run workspace -- prepare，并读取目标原文。需要当前上下文外的既有对象时，再从 .math-workspace/reference-map.md 读取匹配行。
新小节、命题、引理、定理、推论、公式、图、表和需要锚定的旁支事实用 #tmp-* 声明；正文引用只用 @h-... / @h-....title / @h-....full，不手写显示编号。
定义不加 hash。概念与符号汇总新建时优先放在同书最后一个附录，沿用实际序号；已有合适页直接复用，可合为一页。工具按明确文件名或页面主标题识别专页，不限定附录序号；不要因普通文本编辑重写 definitions.json。只有查询缺失、别名/双语或边界不可靠时才维护 override。特殊符号只有语义明确变化时才维护 symbols.json。
编辑后运行 npm run workspace -- finish <file-or-dir>，保持 Markdown 和 LaTeX 原样；只有直接 finalize、迁移或 release 门禁才另行运行 verify。
```

## 人工源与派生数据

- 可人工维护：`.math-workspace/config.json`、必要时的 `definitions.json` 与 `symbols.json`。
- 工具派生：`agent-guide.md`、`reference-map.md`、`workspace-index.json`、`project-analysis.*`、依赖图和报告。可读，不作为手工源。
- 发布方案通过 Reader 或 CLI 显式保存；构建产物、清单和服务绑定记录由工具维护。查看、规划和本地构建不自动执行外部预留、上传或正式发布。
- Math Workspace 在本地读取正文，按内容变化重建索引与项目知识。Reader 可在正文选区或公式弹窗中，将所选源码与来源位置明确加入当前原生会话输入框；多段内容可分次选择、分次引用，引用不会自动发送消息，打开或翻页也不会自动添加正文。它不会主动写源文档，也不维护第二套对话。

## 完成标准

- 目标项目原生 AI 指令已吸收上述规则，不是简单堆叠外来 prompt。
- `prepare`、`finish`、`verify` 可运行；新 ID 能稳定生成，断裂引用会被发现。
- 明确命名的概念/术语与符号/记号专页会在 `project-analysis.md` 中被识别，合并页保留两类上下文；没有时不要求人工制造汇总页。
- 定义和符号不参与 theorem-like 编号；跨 book 边界被显式配置。
- VASMC 消费者锁定 `editor`、`math-writing` 与 `integrator` catalog exports；release/vendored 升级经过 checksum、生成差异与融合规则审阅。

完整迁移、PDF 和发布流程见 `docs/usage.md` 与 `docs/release.md`。
