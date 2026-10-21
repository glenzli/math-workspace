---
vasm:
  alias: math-workspace-integrator-guide
  version: "0.1.0"
  intent: "Guide AI agents to merge math-workspace mechanics and mathematical-writing rules into a target project's native workflow."
  compile:
    format: integrative
  integration:
    appliesTo:
      - "vasm:math-workspace-editor-skill"
      - "editor"
      - "skills-src/editor.vasm.md"
      - "skills/editor.md"
      - "vasm:math-workspace-math-writing-skill"
      - "math-writing"
      - "skills-src/math-writing.vasm.md"
      - "skills/math-writing.md"
---

# math-workspace integrative 组件

这是接入与组合指南。先确认工具来源：Codex 插件任务复用当前启用插件的 CLI、Reader 和通用 skills；非 Codex 环境使用明确安装的独立 CLI/npm。目标项目保留自己的公理、术语、证明风格、章节模板、release 规则、配置和审阅记录。

## 整合前

1. 读取目标项目的 AI 指令、写作样例、现有配置和命令入口，确认本轮采用插件还是独立 CLI。
2. 采用 Codex 插件的项目读取当前插件的 `math-writing`、`lean-formalization`、`open-math-workspace` skills，并用同一插件生成 `agent-guide.md`。项目 skill 引用这些规则，只维护项目特化约束；不复制工具包或通用规则，不另加 npm 依赖与旧包同步脚本。
3. 独立 CLI/其他 AI 宿主按需审阅 [editor.md](../skills/editor.md)、[math-writing.md](../skills/math-writing.md) 和 Lean 规则；明确采用 VASMC catalog 时再锁定所需 exports。独立流程不要求安装 Codex。
4. 尚未初始化时，用所选实际 CLI 运行 `init` 与必要的 `prepare`。下文 `math-workspace` 是该入口的简写；复用 Reader 给出的 Node/CLI/工作目录，或已核对来源的项目 wrapper，不硬编码机器缓存版本。

已有对象只读取 `reference-map.md` 的匹配行。不要自动下载或更新远端 skill，不以工具升级覆盖原生项目规则、删除配置或重新 capture 未审阅对象。

## 融合优先级

- 把通用规则视为数学严谨性和工具安全性的底线；项目层可以补充对象、公理、术语、路径、命令和更严格的验收门槛。
- 项目层不得静默删除或削弱“不得隐藏假设、不得改变结论强度、不得伪造依赖、不得夸大形式化覆盖”等通用约束。
- 通用 artifact 中的占位命令、路径或命名与项目实际配置不同时，以项目已验证的具体配置为准，但保留通用规则表达的行为目的。
- 两层规则语义相同但措辞重复时，只保留一次，并采用更具体或更严格的表达。
- 两层在数学前提、结论、修改权限或安全边界上真正冲突时，不自动选择一侧；在生成报告中保留冲突并要求人工裁决。
- 采用 Codex 插件的项目引用当前插件规则，验收时记录实际插件身份与版本；独立 artifact/VASMC 消费者保留来源和 lock hash。项目特化规则的生成差异均须审阅。


## 必须融入的规则

[核心模型](../docs-src/fragments/formal-core-model.vasm.md "@import:inline")

按任务使用以下规则；采用 Codex 插件的项目通过插件和生成指南读取，不把这些通用内容整份内嵌到项目 skill：

- **写作与引用**：新编号对象用 `#tmp-*` 声明，正文只用 `@h-...`；已有 ID 从目标正文或 `reference-map.md` 的相关行复制；通常完成时只运行 `finish`，它会校验。直接 `finalize`、迁移或 release 门禁才另行 `verify`。
- **新增稿件**：把 `create-page` 接入项目原生建章/建稿动作，先确认 `chapter|front-matter|back-matter|continued` 与真实书/卷容器（项目根用 `.`），以 `--dry-run --json` 审阅计划，再用 `--expect-state` 绑定计划；计划过期先重读，项目、类型、标题、容器与目标路径未变即可用新 token 继续。helper 分配路径、顺序和稳定页 ID，不覆盖已有稿件；AI 只续写返回的源文件并对它运行 `finish`。前后文可多篇、标题与文体自定，旧 intro/summary 兼容；出版引用同一 Markdown，不复制稿件；创建本身不修改方案，自动方案重新规划时识别匹配稿件并审阅收录范围。Reader 的“＋”把请求加入输入框而不自动发送。
- **数学文风**：定义不加 hash；说明类注与随文举例不加 hash。完整独立的例、算例和反例可主动添加 hash，不要求已有后文引用；例与反例共用独立的章内编号。有证明、稳定锚点或后文实际引用的旁支事实可写带 hash 的注，作为未编号的补充事实节点；普通注不进入依赖图。
- **项目知识**：工具自动抽标准定义，按明确文件名或页面主标题识别概念/术语与符号/记号专页，不限定附录序号；合并页保留两类上下文。`project-analysis.md` 是按需读取的派生摘要。AI 仅为缺失、别名/双语或不可靠边界维护 definitions override。
- **符号**：只有项目明确新增或改写特殊记号语义时维护经审阅的符号源表；不索引普通变量或整条公式。
- **结构审阅**：依赖图只来自显式 `@h-...`，覆盖主线命题类对象与带 hash 的补充注释；报告分开统计两层。需要时将 `graph impact`、`focus`、`cycles` 或 `matrix` 接入审阅流程。AI/Lean 推测边须单独存放。
- **项目边界**：formal root 配置 `scan.exclude`；跨 book 引用或查询显式配置 `lookup.bookDependencies`。
- **出版元信息**：公共作品信息只维护在项目 `config.json.metadata`，出版方案保存本版覆盖与版本身份；Reader 或同一 CLI 的 `publication save-metadata` 带当前修订号保存。网站与仓库分别维护，作者记录保留 ORCID、机构与别名；不要给每版复制继承值。Reader 新方案自动识别结构化前后文和附录，CLI 用 `matter.automatic`，旧方案主动开启后审阅变化；手动范围与逐项排除仍由作者控制。
- **PDF 发布**：需要出版时，把卷章选择、原编号、前后文与部分发布声明的审阅接入项目流程；同一作品沿用稳定标识，区分作品 DOI 与本版 DOI。手填 DOI 保留未核验来源；Zenodo 先预留再构建，审阅成品与上传差异后上传草稿，最后显式正式发布，保护其他草稿材料。草稿复用，已发布文件通过同一作品的新版本更新。令牌只在服务进程环境中；发布清单、原稿签名与数学/Lean 证据分别判断。

## 可融合的最小片段

```text
先确定工具来源：Codex 插件任务复用当前插件 CLI/Reader/通用 skills；独立环境使用已选 CLI/npm。项目只维护特化规则、配置与审阅记录，不因 Codex 接入复制工具包或通用规则。
进入任务或索引可能过期时运行所选入口的 prepare，并读取目标原文。需要当前上下文外的既有对象时，再从 .math-workspace/reference-map.md 读取匹配行。
新增章节、前后文或未完待续页时，先用项目已验证入口的 create-page --dry-run --json 检查类型、真实书/卷容器和路径，再以计划 stateToken 创建；保留 helper 分配的稳定页 ID，写正文后 finish 该文件。多篇前后文标题自定，出版引用同一 Markdown，自动方案重新规划后审阅收录范围。Reader 提供确切 Node/CLI/工作目录时直接复用，不为示例静默改项目脚本或替换原生 AI 规则。
新小节、命题、引理、定理、推论、公式、图、表和需要锚定的旁支事实用 #tmp-* 声明；正文引用只用 @h-... / @h-....title / @h-....full，不手写显示编号。
定义不加 hash。概念与符号汇总新建时优先放在同书最后一个附录，沿用实际序号；已有合适页直接复用，可合为一页。工具按明确文件名或页面主标题识别专页，不限定附录序号；不要因普通文本编辑重写 definitions.json。只有查询缺失、别名/双语或边界不可靠时才维护 override。特殊符号只有语义明确变化时才维护 symbols.json。
编辑后运行所选入口的 finish <file-or-dir>，保持 Markdown 和 LaTeX 原样；只有直接 finalize、迁移或 release 门禁才另行运行 verify。
```

## 人工源与派生数据

- 可人工维护：`.math-workspace/config.json`、必要时的 `definitions.json` 与 `symbols.json`。
- 工具派生：`agent-guide.md`、`reference-map.md`、`workspace-index.json`、`project-analysis.*`、依赖图和报告。可读，不作为手工源。
- 发布方案通过 Reader 或 CLI 显式保存；构建产物、清单和服务绑定记录由工具维护。查看、规划和本地构建不自动执行外部预留、上传或正式发布。
- Math Workspace 在本地读取正文，按内容变化重建索引与项目知识。Reader 可在正文选区或公式弹窗中，将所选源码与来源位置明确加入当前原生会话输入框；多段内容可分次选择、分次引用，引用不会自动发送消息，打开或翻页也不会自动添加正文。它不会主动写源文档，也不维护第二套对话。

## 完成标准

- 工具来源已明确；采用 Codex 插件的项目动态引用插件规则，项目原生指令只保留特化约束，独立环境使用其已选 CLI。
- 既有 CLI/脚本入口可达；建稿通过 `create-page` 的计划与创建闭环，Reader 交接复用实际入口。不要为接入规则静默改写项目指令或安装全局 CLI。
- `prepare`、`finish`、`verify` 可运行；新 ID 能稳定生成，断裂引用会被发现。
- 明确命名的概念/术语与符号/记号专页会在 `project-analysis.md` 中被识别，合并页保留两类上下文；没有时不要求人工制造汇总页。
- 定义和符号不参与 theorem-like 编号；跨 book 边界被显式配置。
- 只有明确采用独立 artifact/VASMC 分发的消费者才锁定所需 catalog exports，并审阅 checksum 与生成差异；Codex 插件项目不默认增加这层依赖。

完整迁移、PDF 和发布流程见 Math Workspace 的[使用指南](https://github.com/glenzli/math-workspace/blob/main/docs/usage.md)与[发布说明](https://github.com/glenzli/math-workspace/blob/main/docs/release.md)。
