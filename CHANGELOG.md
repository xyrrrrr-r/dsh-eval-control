# Changelog

本文件记录 dsh-eval-control 的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

**0.x 实验期政策**：0.x 阶段的 minor 版本允许包含破坏性变更（配置
schema、bundle descriptor 格式、bin 协议），每次都会在下方
`Changed`/`Removed` 中显式列出并附迁移说明；patch 版本只含修复。
1.0.0 起严格遵循 SemVer。

## [Unreleased]

## [0.3.0] - 2026-10-19

**轨迹分析面板全量落地（宿主投影 `contextTimeline` + 客户端多视图），并补齐统一诊断中心、多会话对比与报告分享。**

### Added（本轮功能完善）

- 总览右侧统一诊断中心，合并告警入口，提供规则设置、原始诊断数据和压缩策略配置应用。
- 压缩/修剪详情增加替换关系与手段说明，聚合连续历史修剪和同一显示秒内的注入事件。
- 完成 2–4 会话对比、资源比例雷达图、差异报告和建议；雷达使用原始值 / 本轴最大值，零值位于中心。
- 对比与演化图共用框选缩放、Shift 平移、纵轴适配和重置；移除滚轮缩放，图例显隐保留缩放范围。
- 增加 PDF、多种报告模板及支持密码、有效期和撤销的只读分享；团队模板可下载差异报告。
- 重写 README，并保存旧版接线文档。
- 新增宿主依赖遵循运行时兼容范围与开发期精确版本分离的发布约定。

### Added（PRD-v1.0 轨迹分析面板全量升级）

- **宿主投影 `contextTimeline`**（`src/analytics/contextTimeline.ts`）：对会话
  事件流的纯折叠，输出（均经 zod strict wire schema、全部有界）：
  - 7 段上下文表面组成（系统提示/对话消息/工具定义/工具结果/文件内容/压缩
    摘要/其他），估算算法与 dsh-token-meter 完全一致（CHARS_PER_TOKEN=4、
    块开销 4）；**每段附有界内容节选**（`segments[]`：每段 ≤24 节点、每节点
    200 字符预览 + callId 定位符，stateVersion 2），供组成明细表
    「查看内容/复制/在 Trajectory 定位」使用；
  - 消息级 Token 台账 `injections[≤64]`（kind/sourceKind/tokens/turn，助手
    追加也入账，客户端按 PRD §3.5 过滤"注入"）；
  - 步骤采样 `steps[≤256]`（表面估算 + 服务商 usage，**含 cacheReadTokens**）；
  - 压缩事件 `compactions[≤32]`（摘要/修剪分类、前后 Token、回收量与回收比、
    由 `compaction/start→end` 计算的耗时；arm/backfill 配对处理 surface-replace）；
  - 工具 Top-20 与 `toolNameByCallId[≤512]`。
- **客户端「轨迹分析」面板**（源码 `client-src/` 16 模块，esbuild 生成
  `client/client.js`，React 晚绑定）：
  - 总览：环形占用仪表盘（>80% 脉冲）、组成堆叠条+饼图（点击过滤）、
    **组成明细表（PRD §3.2：类型/Token/占比/操作四列，按 Token 或类型排序；
    「查看内容」弹模态框展示该段有界节选（按时间顺序，标注轮次；被截断的
    工具调用以「含工具调用：xx」标记保留；Esc/×/关闭）；节内条目按 callId
    提供「在 Trajectory 定位 · <工具名>」跳转——跳到该消息发出的工具调用行
    （正文行紧邻其上），工具结果与其发出者助手消息可定位，用户/系统/摘要类
    节点宿主无定位 API；「复制」带成功/失败反馈；饼图扇区点击定位并高亮
    对应行）**、指标卡×6；
  - 上下文演化（PRD §3.4 对齐）：**上下文窗口占用（含缓存读）为蓝色实线**、
    表面估算（紫）与输出（灰虚线）为参考线、**窗口上限红色虚线**；
    标记按 PRD 形状/颜色：**压缩=绿色三角形+绿色竖线**（Hover 显示前后值/回收/
    回收比/轮次）、**注入=橙色圆形+橙色贯通竖线**（虚线、低透明度，与压缩同形
    可辨；Hover 显示来源与规模）、
    **Token 激增=红色菱形**（Hover 显示原因：机制+主导成分；与消息 Tab 同一
    启发式）；标记形状放大（三角 14px 高/圆 r5.5/菱形 16px）并带 Canvas 描边，
    **两遍渲染**（先全部竖线、再全部形状），保证形状不被后画的竖线遮盖；
    **交互层**：悬停标记高亮该标记、其余淡化到 30%；>3 个重叠标记聚合为
    气泡（「8 条压缩」，点击弹出成员列表 + 「放大此区间」）；tooltip 跟随
    鼠标并在靠近右/下边界时翻转；**滚轮缩放**（以指针为锚点）+ **拖拽平移**
    + 双击重置；**标记筛选芯片**（压缩/注入/激增 各自显隐）；X 轴支持
    **按轮次**（每轮末样本）/按步骤/按时间，Y 轴 Token；拖拽框选缩放 + 重置、
    图例点击显隐线条、悬停十字线数值提示；
  - 消息 Token（PRD §3.3 全量）：列表含角色图标（👤🤖🔧⚙️🛠️）、摘要
    （前 50 字符）、输入/输出/累计 Token 三列与时间戳；筛选支持按角色、
    仅注入、Token 范围（最小–最大）；排序支持时间/轮次/输入/输出/累计；
    Top 3 消耗红色高亮（👑）、异常突增黄色高亮（⚡，≥3× 前 5 条中位数
    且 ≥1K）、累计上下文骤降黄色高亮（🔻，累计较上一条降 ≥1K，压缩/修剪
    回收所致；详情面板给出 回收量/幅度 并附「查看压缩事件 →」联动跳转
    压缩与注入 Tab）；展开详情含完整内容（有界 1000 字符）、Token 分布
    （文本/工具调用/文件，比例条）、关联调用（工具名 + callId +
    「在 Trajectory 定位」跳转）、模型输出 Token（服务商上报）与
    占当前表面百分比；**「🔍 原因总结」面板**（可收起）把 Top3 / 突增 /
    突降逐条归因：Top3 与突增按 Token 构成推导主导机制（工具输出体积大/
    大参数工具调用/长文本推理/注入内容，附主导成分占比与突增倍数），
    突降直接匹配到窗口内的压缩/修剪事件（类型、轮次、前后值、回收量、
    回收比）；组内给出紧凑角色计数聚合（助手 11 · 工具 1），**整行或
    #序号均可点击**定位到对应消息行并展开（序号带下划线/加粗交互提示），
    「查看压缩事件」为绿框按钮样式；面板顶部**双饼图**按 Token 占比呈现消息构成
    （按角色：用户/助手/工具结果/系统/开发者；按成分：文本/工具调用/
    文件图片，图例含百分比与绝对值）；**一行摘要**（Top3 合计与占比、
    突增条数/累计/占比、突降条数与回收量）；三张**卡片式区块**按严重程度
    着色（Top3 红 / 突增浅黄 / 突降浅绿），突增默认只列前 5 条（按 Token
    降序），「展开全部」按轮次分组（第 N 轮 · M 条），条目改为
    **标签式**（机制/主导成分/突增倍数 chip，冗余长句移除）；
  - 压缩与注入：事件卡片（前后对比条、回收比、耗时）、注入 vs 直接输入分类；
  - 工具分布：横条图 + 错误叠加 + 明细；
  - Team 活动：成员×指标聚合（沿用原 chip 语义）；
  - 对比分析：2-4 会话选择器、8 指标对比卡（最优★标记）、差异报告文本；
  - 智能告警：5 规则（满载/频繁压缩/高错误率/Token 浪费/长间隔）、阈值
    localStorage 持久化 + 即时重算、忽略/已处理、铃铛聚合；
  - 导出：Markdown / JSON 快照 / PNG（SVG→canvas 2x）/ **独立单文件 HTML
    报告**（分享链接的本地等价，见偏差说明）；
  - 详细数据区：消息列表/事件列表（在 Trajectory 定位）/指标明细/数据质量。
- 构建管线：`tsconfig.client.json`（strict + exactOptionalPropertyTypes）与
  `scripts/build-client.mjs`；`npm run build/typecheck` 纳入 client 检查与打包。

### Changed

- `client/client.js` 由手写脚本变为**生成产物**（`@generated` 头注释）；修改 UI
  一律改 `client-src/` 后 `npm run build:client`。
- "当前窗口占用"语义修正：取最后一步 `inputTokens + cacheReadTokens`（服务商
  的 inputTokens 为未缓存部分），而非累计未缓存输入/窗口。
- 指标卡"输入 Token"重标为"输入 Token（未缓存）"（成本语义），趋势用含缓存值。

### Deviations（PRD 明示偏差）

- 分享链接现由宿主 HTTP 路由提供本地持久化只读快照，支持有效期、密码和撤销；本机地址仅本机可达。
- 用户显式应用建议时，可通过宿主配置编辑器持久化压缩策略；预设修改对新建会话生效，其他建议提供手动配置路径。
- 组成/消息 Token 为估算（服务商不提供消息级精确值），UI 标注"估算"；
  实测估算 161.9K vs 真实含缓存 130.9K（超估约 23%，字符法固有偏差）。

### Maintenance（既有测试的最小适配，断言未动）

- `test/client_chip.test.ts`：fake React 补 `useMemo/useRef/useCallback`（游标
  协议）；`textOf/findButtons` 支持函数型组件（`element.type(element.props)`，
  与 React 渲染语义等价）。全量 206/206 绿。

## [0.2.8] - 2026-10-18

**修复超长会话把会话级聚合指标逐出 wire 视图。** hw-lab 真实评测会话的引擎间偏移
检查（同一会话分别过 aeval Python 归约与本插件 TS 折叠）发现：当会话的
`(metricId, subjectId)` 组合超过 64 条时，`recentMetricResults` 的 LRU 截断会先逐出
聚合行 —— 它们在 `recomputeSessionResults` 中最先 upsert，永远落在尾部切片之外，
导致客户端摘要卡（工具错误率、数据质量、轮次结束原因等）在长会话上全部丢数。
对 9 个真实 trial 会话的量化验证：修复前保留行 455/455 全等但 3 个 60 步会话丢失
全部聚合行；修复后保留行 503/503 全等、聚合行全量保留，被逐出的只剩文档化的
每主体明细行（`step_to_first_chunk` / `call_elapsed` / `stream_span`）。

### Fixed

- **压缩回收量系统性低估**（实现 PRD §3.3 突降检测时暴露）：`afterTokens` 旧实现取
  "未过滤的 surface 总量 − 落地节点"，等价于把回填值算成落地节点自身价格。第 8 轮
  摘要压缩实际 164,362 → 111,092（回收 53,270 / 32.4%），旧实现记 4,715；会话总回收
  记录 17.8K，实际 175.7K（漏报约 158K）。修正为
  `afterTokens = 移除被遮蔽区间后的 surface 总量 + 落地节点`。受影响面：压缩卡片前后
  对比/回收比、总览"回收"指标卡、导出 MD/JSON/HTML 与对比报告；修正后与消息台账的
  累计骤降（🔻）独立互证一致。
- `upsertResult` 现在把 `subjectId === sessionId` 的会话级聚合行豁免出 LRU 窗口
  （每族至多一条，界限仍有界），明细行维持最近 64 条。
- wire schema（`projection.ts`）的 `metricResults` / `recentMetricResults` 上限从
  硬编码 64 改为 `MAX_METRIC_RESULTS + TRAJECTORY_METRIC_IDS.length`（64 明细 +
  每族一条聚合）；此前豁免让长会话结果数超过 64，zod 校验直接拒绝投影，轨迹视图
  报"历史加载失败"。指标族清单以 `TRaJECTORY_METRIC_IDS` 运行时数组导出，并带
  编译期穷尽性断言（新增族必须同步数组，否则 tsc 失败）。
- 契约文档 §8 更新了 `metricResults` 的有界语义描述。

## [0.2.7] - 2026-10-17

**协议 v3 落地：单会话折叠引擎拆分 + Team 跨会话聚合 + 轨迹分析视图。** 本版把
`foldLifecycleMetrics`（单会话、每次事件从状态全量重算）与 `foldTeamMetrics(root, children)`
（跨会话：成员忙碌、并发峰值、完成墙钟、分支首活动、任务阻塞）拆成两个纯函数，
aeval 与插件两侧逐字节对齐；并新增面向普通用户的"轨迹分析"会话视图。

### Added

- `src/analytics/team.ts`：`TeamSessionInput` / `teamInputFromFoldState` /
  `foldTeamMetrics` / `combineFoldStates`（对齐路径）/ `combineTeamViews`（线上路径）。
  子会话折叠排除仅根会话可得的指标（成员扇出、成员空闲等），根会话对未观测子会话
  给出 `member_session_not_observed` / `child_session_not_observed` 覆盖码。
- `client/client.js` 轨迹分析视图：摘要卡片、按轮次趋势、Team 协作区（成员行 +
  分支首活动）、指标明细表（状态/值/质量码/证据引用）、数据质量、最近事件。
- 协议 v3 契约文档 `docs/trajectory-metrics-contract.md` §8 与
  `docs/aeval-dsh-metric-mapping.md` §10。
- 同步 aeval `a576dcd` 的 7 个轨迹契约 fixtures（新增 first-token-basic、
  repeat-recovery-basic、team-subtree-basic）。

### Changed

- `MetricValue` 放宽为 `number | Record<string, number | string[] | boolean>`
  （新增 5 个跨会话指标 + 布尔质量位），`metricValueSchema` 同步。
- 客户端模块 `inject` 扩为 `['slots', 'locale', 'remote', 'remote.pluginInventory',
  'remote.pluginManager', 'sessions']`：0.2 宿主把服务与 remote 通道都关在 inject
  后面，缺声明的插件在 web 客户端里拿不到 `ctx.remote.pluginInventory`。
- 成员会话读取改为 `sessions.refreshProjections(memberId)`（`session.projections`
  RPC，不激活 Agent）+ `sessions.using()` 借共享投影 store：子智能体会话的 agent 绑定
  open 可能永不 settle，直读 store 才能稳定拿到基线。

### Fixed

- `src/analytics_entry.ts` 默认导出从裸函数改为完整定义对象
  （`{ name, inject, usage, Config, apply }`）：cordis 插件加载器的
  `unwrapExports` 做 `exports.default ?? exports`，裸函数默认导出会丢弃具名导出，
  导致宿主报 `cannot get property "sessionProjections" without inject`。

## [0.2.6] - 2026-10-11

**修掉"市场安装的控制栈不能独立跑"这个根因。** 此前 `dsh plugin add` 装进 profile 的副本
无法被 aeval 使用：aeval 把 `dist/broker_main.js`（模型 broker）与 `dist/session_reader.js`
（会话读取器）当**独立 Node 进程**执行，而本包把 `@deepseek-ai/*` 声明为 peer（这是正确的
设计——插件被 DSH 宿主进程内加载时必须用宿主那份，`SessionId` / `scopeOf` 是运行时值），
pnpm 又只装 `dependencies`，于是那两个进程 `ERR_MODULE_NOT_FOUND: Cannot find package
'@deepseek-ai/dsh-llm'`，试次以"模型 broker 起不来"被整轮排除。

### Changed

- **两个独立进程入口改为自带依赖的 bundle**（新增 `scripts/bundle-standalone.mjs`，作为
  构建链最后一步）：`dist/broker_main.js` 15.8 KiB → 246.3 KiB、`dist/session_reader.js`
  8.5 KiB → 617.2 KiB，各自内联全部 import，运行时不再解析任何裸包（node 内建除外）。
  进程隔离的进程持有私有副本正是对的；`dist/index.js` 与 `dist/sandbox_entry.js` 保持原样、
  继续 import 宿主 peer，所以插件在 DSH 内仍与宿主共享实例。
  npm tarball 101 kB → 288 kB。
- **`test` 脚本在最后一步重新 bundle**：原先它末尾又一次 `pull-neutral`，会把 bundle 覆盖
  回原始文件，而 `prepublishOnly = build && test`，发布物就会静默退回旧行为。

### Added

- 两条新的打包不变量测试（`test/packaging.test.ts`）：「aeval 当独立进程跑的入口运行时不再
  解析任何裸包」与「进程内入口仍引用宿主 peer（不得出现私有副本）」。
- `test/neutral-shims.test.ts`：`broker_main` 不再要求 `dist/` 与兄弟构建逐字节相同——改为
  守卫真正的源 `vendor/neutral/broker_main.js` 不漂移，并保留 `src/*.d.ts` 与其余 neutral
  模块的逐字节比对。

### 实测

- **隔离副本**（只有 `dist/` + `cordis.patch.yml` + `package.json`，无任何 `node_modules`）：
  broker 按 aeval 的就绪契约启动、写出 token 文件、干净停止（退出码 0）；读取器正常加载。
- **hw-lab 全链路**：`dsh plugin --profile market26 add dsh-eval-control-0.2.6.tgz`（pnpm
  路径，profile 内 `@deepseek-ai` 依赖 **0** 个）→ `controlRoot` 直指那份、工作区不装任何
  npm 包 → `run run-demo sealed: 3 trial(s) recorded, 89 file(s) attested, recompute passed`，
  有效分母 3/3、排除率 0.0%。runtime lock digest 随之变为
  `467f20a3f59be97360893ddac0398121d6a61e0aa0fd4b04f9bc803a9686ec2a`（控制栈文件变了）。
- `npm test` 193/193 通过。

## [0.2.5] - 2026-10-11

文档修正版本：**控制栈代码与 0.2.3/0.2.4 完全相同**（`git diff v0.2.3 HEAD -- src/ client/`
为空，只动文档与清单）。补上"不改控制栈、直接用插件市场那份也能跑"的第二条路线。

### Added

- **执行文档 §2.2 增加「路线 B：就用插件市场装的那份」**：写清默认失败的真实原因
  （pnpm 只装 `dependencies`，13 个 `@deepseek-ai/*` peer 由 DSH 宿主进程提供，而 broker
  是独立进程），给出 dist 真正 import 的 **8 个包**清单，以及三种补法——`pnpm add` 成真
  依赖、零网络地从 DSH 安装软链、把 dist 放进 DSH 安装。三种补法都实测可加载；其中第一种
  端到端跑通：`controlRoot` 直指市场那份、工作区一个 npm 包都没装，3 个试次全部进入判分、
  封存 `recompute passed`；会话读取器也由 aeval 自己从 DSH profile 发现，无需工作区副本。
- README 同段落改为"两条路线选一条"，补上路线 B 的实测结果与代价（改了 DSH 管的 profile
  或 DSH 安装目录）。

### Changed

- README 里写死的版本标识 `v0.2.2` → `v0.2.5`；示例命令版本号统一到 0.2.5。
## [0.2.4] - 2026-10-11

文档与实测修正版本：**源码零改动**，插件行为、配置 schema、bundle descriptor
格式均未变。补上同事端从安装到出报告的完整执行文档，并修掉 README 里一段
"照做必然失败"的最短路径（给的 spec 缺三项必填、且把市场安装副本当成可用控制栈）。

### Added

- **端到端执行文档 [`docs/MARKET-TO-REPORT.md`](https://github.com/xyrrrrr-r/dsh-eval-control/blob/main/docs/MARKET-TO-REPORT.md)**：从
  aeval 与控制栈安装、套件获取、可信 token 计数器、broker spec，一路到出报告，
  全部命令在真机（Linux/aarch64 + Docker 后端）上端到端跑通——3 个 terminal-bench
  任务全部进入判分（有效分母 3/3、排除率 0.0%）、证据覆盖 3/3、封存
  `recompute passed`（89 个封存文件）。附逐条实测报错原文的排障表，以及可整段
  复制的脚本。

### Fixed

- **README「装了插件之后：真正跑一次评测」给出的 spec 跑不起来**：示例 `upstream`
  只写了 `apiKeyEnv`（实测被拒：`broker config upstream.model: invalid identifier ''`）、
  设了 `limits.maxTokens` 却没有 `tokenCount`（实测被拒：`limits.maxTokens requires
  a trusted tokenCount source`）、docker 后端沿用 loopback（沙箱侧
  `TypeError: fetch failed` / `connect ECONNREFUSED 127.0.0.1:8447`，最终表现为
  `the trial's agent exposes no DSH session`）。现改为实测可用的完整形状，并补上
  token 计数器、`listenHost`/`listenTls`/`controlCa`、以及 `trials/` 证据链接三步。
- **README 关于"市场式安装位置"的说法会误导**：`dsh plugin add` 走 pnpm 严格布局，
  `@deepseek-ai/dsh-*` 这些 peer 由 DSH 宿主提供，profile 里那份**没有这些依赖**
  （实测 `.pnpm/` 下 0 个 `deepseek` 包），**不能**当作 aeval 的 `controlRoot`
  （实测 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-llm' imported
  from .../dist/broker_main.js`）。现已写明两条安装路径的分工：DSH 内用插件走
  `dsh plugin add`，让 aeval 跑评测另装一份 `npm install` 的控制栈。
- **README 的实测结论改为可复核的措辞**：原文写"3 个试次全部 reward=1"（那是更早
  一次 run 的结果）；现按本文档对应的 run 记为"3 个试次全部进入判分（有效分母
  3/3、排除率 0.0%）、证据覆盖 3/3"。

## [0.2.3] - 2026-10-11

文档与依赖声明版本：补上"装完插件之后评测怎么才算真的跑起来"的实测步骤，
并把 devDependencies 升到 DSH 0.2.0-rc.2 宿主、移除已停用的 `dsh-sdk-client`
peer。插件行为、配置 schema 与 bundle descriptor 格式均未改动，源码零改动。

### Changed

- **devDependencies 升到 DSH 0.2.0-rc.2**：`@deepseek-ai/dsh*` 由
  `0.1.7-alpha.1` 进位到 `0.2.0-rc.2`，`@deepseek-ai/cordis` 4.0.3 → 4.0.4、
  `@deepseek-ai/schemastery` 3.18.3 → 3.18.4；`package-lock.json` 随之重算，
  四个依赖字段与 `package.json` 逐一核对一致。
- **移除 `@deepseek-ai/dsh-sdk-client` peer 声明**：0.2.0 元包已不再依赖它，
  继续声明等于要求宿主提供一个不存在的包。其余 peer 窗口沿用 0.2.1 放宽后的
  写法，未再改动。

### Added

- **README 补「装了插件之后：真正跑一次评测」一节**：说清插件不是评测
  （standalone 模式什么都不挂，套件、试次、证据门、封存、报告都是 aeval 的
  职责），给出实测步骤——需要 aeval ≥ 0.3.0，`aeval agents --init` 写声明、
  最小 broker spec 只需 `controlRoot` 一处（`brokerJs`/`controlDist`/会话读取器
  都由它推导）、宿主导出上游 key、`aeval run` 后 `aeval report`。附一张失败形态
  表，逐条对应实测原文，含"宿主少 key 会在沙箱里伪装成 `MISSING_CREDENTIAL`"
  这类会把人带偏的症状。

## [0.2.2] - 2026-10-10

客户端修复版本：Web 状态胶囊补上 `locale` 依赖声明，文案注册不再依赖该服务
恰好已就绪。插件行为、配置 schema 与 bundle descriptor 均未改动。

### Fixed

- **Web 状态胶囊漏声明 `locale` 依赖**：`client/client.js` 调用
  `ctx.locale.register` / `ctx.locale.bind`，但模块的 `inject` 只声明了
  `slots`，只能靠存在性守卫兜底——`locale` 服务不在时字典不会注册、胶囊文案
  退化成原始 key，且 loader 不会为它等待。现按官方 client 插件的写法（
  `ui-schedule`、`ui-layout`、`ui-approval`、`ui-trajectory` 等一律把 `locale`
  写进 `inject`）声明该依赖，随之移除那两处守卫。只影响 Web 状态胶囊的文案
  注册，宿主侧行为与 bundle descriptor 均未改动。

## [0.2.1] - 2026-10-09

宿主兼容性修复版本：peer 窗口放行整条 0.2 线（含 0.2.0 的预发布），本包在
0.2.0-rc.2 这类宿主上不再因 peer 范围不匹配而被跳过整个 bundle。插件行为、
配置 schema 与 bundle descriptor 格式均未改动。

### Changed

- **仓库迁移至 GitHub**：托管地址由 GitCode 的
  `open_kunpeng_agentic_infra/dsh-eval-control` 改为 GitHub，`package.json` 与
  下方链接引用同步更新；源码、测试与全部历史提交完整保留。迁移时对**全部历史**
  做了清洗：开发过程记录（含其归档前后的两个仓库内路径）连同其中的本机绝对路径与
  内部编号一并剔除，提交邮箱改为 GitHub noreply（署名保留）。因此本仓库的提交
  SHA 与 GitCode 上的历史不再对应，从旧历史 cherry-pick 会冲突；0.2.0 这条即
  如此摘入。

### Fixed

- **peer 窗口静默排除宿主预发布版本**：`@deepseek-ai/dsh*` 原先写作
  `>=0.1.7-alpha.1 <0.2.0`。node-semver 只在范围里存在**同一
  major.minor.patch 元组上带预发布标签的比较符**时才放行该预发布版本，而
  `<0.2.0` 的上界不带预发布标签，于是 `0.2.0-rc.2`（桌面端内置的宿主）与
  `0.1.8-alpha.*` 都被静默排除，宿主据 peer 范围**跳过整个 bundle**（仅
  stderr 提示），表现上就像插件没装上。窗口改为按元组分段：
  `>=0.1.7-alpha.1 <0.1.8-0 || >=0.1.8-alpha.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0`，
  即"0.1.7 起至 0.2 线全部版本（含各自元组的预发布）"；`package.json` 与
  `package-lock.json` 同步。`test/packaging.test.ts` 对发布面的断言（范围必须
  带 `^`/`~`/`>=`、harness peer 必须同时留在 `devDependencies`、`devDependencies`
  保持精确 pin）不受影响，无需改动。宿主出现 0.2.1 及以上 minor 的预发布时，
  需再补一条对应元组的分支。

- **独立 clone 无法构建运行面**：`scripts/pull-neutral.mjs` 原先只认同级
  `../aeval/control/dist`（或 `$AEVAL_CONTROL_DIST`），取不到就打一行提示并
  **以 0 退出**；而 `dist/` 在 `.gitignore` 里、`src/config.ts` 又已在瘦身时移除，
  于是单独 clone 本仓库拿不到 `dist/config.js`，4 条 selfcheck 用例以
  `ERR_MODULE_NOT_FOUND` 失败——README 承诺的"`npm test` 全绿是提交前提"对外部
  贡献者并不成立。现在取用顺序为 `$AEVAL_CONTROL_DIST` → 同级 checkout → 仓库内
  `vendor/neutral/`（8 个模块的 `.js` 与 `.d.ts`，与同级构建逐字节一致），三者皆缺
  才报错退出；`npm run vendor:neutral` 把同级构建同步进 vendor，并拒绝在没有同级
  checkout 时把回退副本复制给自己。`test/neutral-shims.test.ts` 新增完整性用例，
  防止 vendor 被逐个删空后仍"看起来能构建"。

## [0.2.0] - 2026-10-08

发布面版本：让本包作为 DSH 插件可被收录、可被独立安装，且装完不炸。
**aeval 的运行链路未变**：`deploy_control_stack` 依旧自己写 patch 与内联
配置，插件行为、descriptor 格式与 `configDigest` 计算方式均未改动。

### Added

- **可发布的 Cordis bundle**：`package.json` 声明 `dsh.bundle.patch`，仓库
  新增 `cordis.patch.yml`，`files` 白名单补齐补丁/locale/icon/client，
  `exports` 暴露 `./client`、`./package.json`、`./cordis.patch.yml`、
  `./locale/*.json`（并保留 `./dist/*`、`./src/*` 直通以免砍掉既有子路径）。
  已用真实 DSH 的 profile loader 验证：bundle 解析成功、peer 预检通过、
  补丁被加载且无跳过。

- **standalone 激活路径**（`src/sandbox_entry.ts`）：`controlConfigPath`
  改为可选。没有任何配置（无内联配置、无引用、无 `AEVAL_CONTROL_CONFIG`）
  时不再抛错，而是发布 `evalControlStatus` 服务、打一条通知并**什么都不挂载**
  ——模型调用不被重定向，控制行因缺少 `evalBroker` 保持未激活。**配置一旦
  提供，fail-closed 语义原样保留**：配置文件读不到、broker 不可达仍然拒绝安装。

- **配置引用形态**（`src/control_config_source.ts`）：行配置可以是内联完整
  配置、`{ controlConfigPath }` 引用，或在空配置时回退到
  `AEVAL_CONTROL_CONFIG`。内联路径逐字节透传，`configDigest` 不变。

- **自检命令** `aeval-dsh-control-selfcheck`（第 4 个 bin）：只读检查 Node
  版本、配置解析与摘要、run 绑定、job token（0600/归属/64-hex）、session
  root、descriptor 目录可写性与 broker `/info` 可达性；支持 `--json`，
  未配置时报 standalone 并以 0 退出，不打印 token。

- **Web 只读状态胶囊**（`client/client.js` + `dsh.client`）：在
  `conversation.composer.dock` 显示控制行是否挂载及其 fiber 阶段，数据来自
  宿主 `pluginInventory/list` Remote；该 Remote 缺席时如实显示"宿主通道不可用"，
  不做任何状态修改。

- **展示元数据**：`locale/en.json`、`locale/zh.json`（`meta.title` /
  `meta.description`）与顶层 `icon.svg`，已用真实 `readPluginMeta` 验证三者在
  不激活插件的情况下均可解析。

### Changed

- **发布面 peer 范围与构建期 pin 分离**：`@deepseek-ai/*` 从 `dependencies`
  移入 `peerDependencies`（范围为 `>=0.1.7-alpha.1 <0.2.0`、`cordis ^4.0.3`、
  `schemastery ^3.18.3`），精确 pin 保留在 `devDependencies` 作为构建记录，
  `@agentclientprotocol/sdk` 仍为普通依赖。profile 不再被塞入第二份 Harness。
- **内部资料归档**：`docs/TESTS/P0-3-host-broker.md` → `docs/internal/P0-3-host-broker.md`
  （内容按历史原样保留，仅修正其中一条指向 aeval 文档的相对路径）。该目录为开发
  过程记录，不作为接口说明，也不随 npm 包分发。

### Fixed

- **README 里的坏链**：README 链接的 `docs/TESTS/P0-3-host-broker.md` 对读者不可达
  ——`docs/` 不在 npm 包的 `files` 白名单里。现改为自足的 `npm test` 说明，并链接
  aeval 侧的三份使用者指南（写套件、接 agent、指标语义）。运行方式本身没有变化。

### 已知限制

- aeval 部署路径仍按 `@deepseek-ai/dsh-*@0.1.7-alpha.1` 的片构建与锁定；
  `peerDependencies` 的范围只描述**本包可被加载**的宿主版本窗口
  （`>=0.1.7-alpha.1 <0.2.0`），不改变 aeval 侧的锁定纪律。跨窗口升级仍需
  与 aeval 同步验证。
- Node 要求 `^22.19.0 || >=24.0.0`。

## [0.1.0] - 2026-10-08

首个公开版本（experimental）。

### Added

- **Cordis 控制插件** `dsh-eval-control`（inject: `llm` / `tools` /
  `sessions` / `evalBroker`）：会话启动时一次性注入全部实验事实。
- **EvalControlConfig**：run 绑定四元组（run_id / job_config_hash /
  config_file_sha256 / runtime_lock_digest）互相锁死；配置按原样
  （as-authored）参与 configDigest，宿主组合的配置与沙箱内解析的配置
  逐字段比对，不一致即失败。
- **实验变量注入**：provider / model / reasoningEffort / maxSteps /
  maxTokens / tools allow-deny。
- **网关租约预算**：BrokerAdapter + 宿主 broker（`startHostBroker`）；
  job token 鉴权；辅助调用策略（`refuseAuxiliaryCalls` 总开关 +
  `auxiliaryPolicy` 按用途显式放行，默认拒绝）；租约关闭即拒绝安装
  broker transport；调度/拒绝记录可审计。
- **fork 血统校验**：parentSessionId / parentTrialId / forkStep 显式
  验证，跨会话记忆类评测的可信基底。
- **bundle descriptor**：schema v2 证据归属写入；owner finalize 终态
  锁存（完成证据经官方 flush barrier 落盘后才可发布）。
- **沙箱侧入口** `sandbox_entry`：在被沙箱化的 DSH profile 内安装
  broker transport，把实验 provider 的每次模型调用路由到宿主 broker。
- **独立 bin**：`aeval-dsh-session-reader`（官方 JSONL persistence
  读取）、`aeval-dsh-session-stub`（桩会话创建）、`aeval-model-broker`
  （宿主 broker）。路径安全纪律：拒绝符号链接祖先、限定 allowed
  base、64KB 请求上限、类型化错误码。
- **pull-neutral 构建**：broker 集群的中立源码真身在 aeval 仓库
  `control/`（aeval-control）；构建时组合其 dist，独立 clone 用已提交
  的 shim/dist 保持可构建，新鲜度测试保证字节一致。
- token 上限、上游 chat-completions 适配、停止原因推导。

### Fixed

- 测试 fixture 在 macOS 下因 `/var → /private/var` 符号链接被 bundle
  写入器安全防护拒绝的问题（与其余测试文件同一 `realpathSync`
  约定对齐）。

### 已知限制

- 依赖 `@deepseek-ai/dsh-*` 固定 `0.1.7-alpha.1`（与 aeval 的 DSH
  适配器、官方 session 格式对齐）；升级需与 aeval 同步验证。
- Node 要求 `^22.19.0 || >=24.0.0`。

[Unreleased]: https://github.com/xyrrrrr-r/dsh-eval-control/compare/v0.2.6...HEAD
[0.2.6]: https://github.com/xyrrrrr-r/dsh-eval-control/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/xyrrrrr-r/dsh-eval-control/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/xyrrrrr-r/dsh-eval-control/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/xyrrrrr-r/dsh-eval-control/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/xyrrrrr-r/dsh-eval-control/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/xyrrrrr-r/dsh-eval-control/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xyrrrrr-r/dsh-eval-control/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xyrrrrr-r/dsh-eval-control/releases/tag/v0.1.0
