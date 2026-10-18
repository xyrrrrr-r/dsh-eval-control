# dsh-eval-control 轨迹分析面板升级 — 细化实施方案 v2

**版本**: v2.0
**日期**: 2026-10-18
**状态**: 执行中
**关联**: [PRD-v1.0.md](./PRD-v1.0.md)（全部功能）、[tech-design-context-visualization.md](./tech-design-context-visualization.md)、[tech-design-remaining-features.md](./tech-design-remaining-features.md)、[dsh-api-verification.md](./dsh-api-verification.md)

---

## 0. 相对初版技术方案的关键修正

初版方案（上述三份文档）假设 DSH API 不提供上下文数据、需要"从事件流全量推断"。本轮对
DSH Desktop 2.0.14-beta.1（dsh 0.1.7-rc.1）宿主代码的二次验证发现了**三个此前未知的内置投影**，
显著提高了数据真实性，方案据此修正：

| 发现 | 来源 | 影响 |
|---|---|---|
| `contextPressure` 投影：`{ contextWindow?, pressureTokens?, projectedTokens? }` | `@deepseek-ai/dsh-token-meter`（宿主内置） | §3.1 占用率从"推断"升级为**真实值**：窗口上限来自 `request/context` 事件，占用为 provider 上报的 prompt 侧压力 + surface 投影 |
| `contextBreakdown` 投影：`{ systemTokens, toolsTokens, messageTokens }` | 同上 | §3.2 组成拆解获得**真实的三分类**底账（启发式定价与宿主 token-meter 完全同算法） |
| `tokenUsage` 投影：`{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }` | 同上 | 累计用量真实值 |
| `conversation.view` 插槽标准 props 含 `useProjection` + `useSessions` + `sessionId` | `dsh-cordis-client-runner` 插槽契约 | 视图无需自建数据通道；跨会话读取经 `ctx.sessions.using()` + `refreshProjections()`（现有 `readMemberSummary` 已验证此路径） |
| `assistant/message` 事件携带 `usage`（inputTokens/outputTokens/cacheRead/cacheWrite） | `@deepseek-ai/dsh-session` 事件契约 | §3.3 消息级 Token、§3.4 演化时间线可直接按步骤序列取**真实 usage**，inputTokens 即该步上下文规模 |

仍需本插件自算的数据（宿主不提供）：注入事件分类与规模（启发式估算）、压缩前后对比（shadow
价格推导）、六分类组成（宿主只给三类）、工具调用分布。这些全部放入新投影 `contextTimeline`，
在宿主侧折叠（能看到完整事件内容，且不向客户端泄露正文——只输出聚合计数）。

**被废弃的初版方案内容**：
- `client/components/*.tsx` 草稿（9 个文件）：无法被 DSH 客户端模块加载器加载（客户端半区只加
  载 `client/client.js` 一个经典脚本），且项目无 react/@types/react 依赖、不在 tsconfig include
  内、从未通过类型检查。其设计被吸收进新实现。
- `src/analytics/contextListener.ts`、`contextVisualizationState.ts`：监听器/Redux 模式与 DSH
  投影框架（纯折叠 + wire view）不符，且 Redux/Web Worker 在插件客户端环境不可用。其类型设计
  被吸收进 `contextTimeline` 投影与客户端类型。
- `client/client.js` 中 `createContextDashboardView`（死代码，从未注册）。

## 1. 总体架构

```
┌─ 宿主半区（TypeScript → tsc → dist/，cordis.patch.yml 组合 dsh-trajectory-analytics 行）
│
│  ├─ trajectoryAnalytics   现有投影，不动（30+ 指标 / turnTrend / recentEvents / teamInput）
│  └─ contextTimeline       新增投影（本方案核心数据层）
│       ├─ surface 六分类组成折叠（系统/对话/工具结果/工具定义/文件/压缩摘要/其他）
│       ├─ steps[]  每个带 usage 的 assistant 请求一步快照（演化时间线 + 消息级 Token）
│       ├─ injections[]  注入事件（user/tool-result/system/developer，来源分类 + 估算 Token）
│       ├─ compactions[]  压缩事件（前/后/回收量/回收率/耗时，shadow 价格推导）
│       ├─ tools[]  工具调用分布（按名称：调用数/错误数/估算 Token）
│       └─ contextWindow  窗口上限（request/context 事件，最近值）
│
└─ 客户端半区（client-src/ TypeScript → esbuild IIFE → client/client.js）
   │  约束：factory(require) 只同步 require('react')（模块加载器种子表 + 现有测试契约）
   │  手法：React 晚绑定（bind(require('react'))），TSX 以 jsxFactory=h 编译，无 react 类型依赖
   │
   └─ 轨迹分析 view（conversation.view 插槽，id=dsh-trajectory-analytics，order=20）
       ├─ 顶部状态栏：占用率徽章 | 会话时长 | 导出/分享菜单 | 告警铃铛
       ├─ 关键指标卡片行（6 卡 + 趋势箭头）
       ├─ 可视化区 Tab：总览 | 上下文演化 | Token 趋势 | 压缩与注入 | 工具分布 | Team 活动 | 对比分析
       ├─ 详细数据区（可折叠，默认展开）：消息列表 | 事件列表 | 指标明细（迁移现有全部内容）
       └─ 智能告警：规则引擎（客户端）+ 阈值配置（localStorage）
```

## 2. 数据映射（PRD → 数据源）

| PRD 需求 | 主数据源 | 备用/交叉源 | 真实性标注 |
|---|---|---|---|
| §3.1 占用率仪表盘 | `contextPressure.projectedTokens / contextWindow` | `contextTimeline.surface.totalTokens` | 真实（宿主） |
| §3.2 组成拆解 | `contextTimeline.surface`（6 类） | `contextBreakdown`（3 类，交叉校验） | 估算（与宿主同算法） |
| §3.3 消息级 Token | `contextTimeline.steps[]`（usage）+ `injections[]`（消息台账：角色/摘要/输入输出累计/Token 分布/callId） | `tokenUsage`（累计） | 输入/Token 分布=估算，输出 Token=真实（usage） |
| §3.4 演化时间线 | `contextTimeline.steps[].inputTokens` 序列 | — | 真实 |
| §3.4 压缩/注入标记 | `contextTimeline.compactions/injections` | `trajectoryAnalytics` 计数 | 压缩真实 / 注入估算 |
| §3.5 压缩事件详情 | `contextTimeline.compactions[]`（shadow 价格） | — | 推导 |
| §3.5 注入事件详情 | `contextTimeline.injections[]` | — | 估算 |
| §3.6 关键指标 | `sessionStats` + `trajectoryAnalytics` + `contextTimeline` | — | 真实 |
| §3.7 告警规则 5 条 | 上述全部（客户端规则引擎） | — | 真实 |
| §3.8 对比分析 | `useSessions`（会话列表）+ `sessions.using()` 读各会话 `trajectoryAnalytics` + `contextTimeline` | — | 真实（有界截断标注） |
| §3.9 导出 | 客户端 Blob / SVG→Canvas | — | — |

## 3. 宿主侧设计：`contextTimeline` 投影

**文件**: `src/analytics/contextTimeline.ts`（新），注册于 `src/analytics_entry.ts`。

### 3.1 状态与折叠

- **Token 估算器**：复制 `dsh-token-meter` 的固定启发式（`CHARS_PER_TOKEN=4`、
  `BLOCK_OVERHEAD=4`；text/reasoning、tool-call、file/image 结构、system 消息、tools schema 各自
  的定价公式）。同算法保证与宿主 `contextBreakdown` 数字一致，可交叉校验。
- **Surface 折叠**：维护 `nodes: Array<{seq, kind, textTokens, fileTokens, turn?, step?}>`
  （model-visible 顺序）。append 追加；`surfaceOp.replace` 用 shadow 价格协议（`compaction/summary`
  /`compaction/prune` 紧邻前置事件声明被替换区间的价格）替换区间，替换产生的新节点归类为
  `compactionSummary`。状态有界：`nodes` 是当前 surface（随压缩收缩，天然有界）。
- **步骤快照**：`assistant/message` 带 `usage` 时，先记录 `steps[]`（用**折叠该事件之前**的
  surface 总量——与 token-meter 相同的锚定语义：usage 锚定其请求所见 surface），再折叠事件。
  `steps[]` 保留最近 256 条。
- **注入事件**：append 型 `user/message`（按 `source.kind` 区分直输/注入：`'user'` 为直输，其余
  kind 为注入并记录 kind 名）、非替换 `tool/result`、非空 `system/message`、`developer/message`。
  记录 `{seq, timeMs, kind, sourceKind?, toolName?, tokens, turn?}`，保留最近 64 条 + 累计标量。
- **压缩事件**：`compaction/summary` 时挂起（记录 beforeTokens=当时 surface 总量、
  shadowedTokenCount、区间）；紧随的 surface replace 落地时回填 afterTokens，配对
  `compaction/start`/`compaction/end` 计算耗时。保留最近 32 条 + 累计标量。
- **工具分布**：`tool/call` 计数（名称聚合计数表，Top 20），`tool/result` 错误归并到
  callId→名称的配对（有界映射）。
- **窗口上限**：`request/context` 事件最近值（可为空 → 客户端回落 128K 默认并标注）。

### 3.2 Wire 视图（客户端可见）

```typescript
interface ContextTimelineView {
  contextWindow: number | null;
  surface: {
    totalTokens: number;          // surface 总量（不含工具定义）
    systemPrompt: number;
    conversation: number;         // user + assistant 文本
    toolResults: number;
    toolDefinitions: number;      // request/header tools schema
    fileContents: number;         // file/image 结构 token
    compactionSummary: number;
    other: number;                // developer 等
  };
  steps: Array<{                  // 有界 256
    turn: number; step: number; seq: number; timeMs: number;
    inputTokens: number; outputTokens: number;
    cacheReadTokens?: number; cacheWriteTokens?: number;
    surfaceTokens: number;        // 该步请求所见 surface 估算
  }>;
  injections: Array<{             // 有界 64
    seq: number; timeMs: number;
    kind: 'user' | 'tool-result' | 'system' | 'developer';
    sourceKind: string;           // 'user' = 直输；其余为注入来源 kind
    toolName?: string;
    tokens: number;               // 估算
    turn?: number;
  }>;
  injectionTotals: { count: number; tokens: number };
  compactions: Array<{            // 有界 32
    seq: number; timeMs: number; compactionId: string;
    beforeTokens: number | null; afterTokens: number | null;
    reclaimedTokens: number; reclaimRatio: number | null;
    elapsedMs: number | null; turn?: number;
  }>;
  compactionTotals: { count: number; reclaimedTokens: number; elapsedMs: number };
  tools: Array<{ name: string; calls: number; errors: number }>;  // Top 20
}
```

`stateVersion: 1`，zod strict schema 校验（持久化投影缓存要求）。

### 3.3 与 `trajectoryAnalytics` 的关系

互不替代：`trajectoryAnalytics` 保持原样（测试精确钉死其契约），`contextTimeline` 是并列的新
投影。两者都在 `analytics_entry.ts` 注册，同一行 `dsh-trajectory-analytics` 组合。

## 4. 客户端侧设计

### 4.1 构建管线（新）

```
client-src/*.tsx,*.ts  ─esbuild(bundle, iife, jsx=transform, jsxFactory=h, minify=false)→  client/client.js
```

- `scripts/build-client.mjs`（新）：esbuild 打包，输出带 `@generated` 头注释。
- `client/client.js` 从手写源码变为**生成产物**（git 内保留产物以维持 market 安装即用）。
- `package.json`：`build:client` script，挂入 `build` 链；`files` 不变（client 目录已包含）。
- `tsconfig.client.json`（新）：类型检查 client-src（`noEmit`，include client-src；`types: []`
  不引 node）。`typecheck` 同时跑两个 project。

### 4.2 React 晚绑定（关键手法）

```typescript
// client-src/react-binding.ts
export interface ReactLike { /* createElement/useState/useEffect/useMemo/useRef/useCallback/Fragment 结构类型 */ }
let R: ReactLike;
export function bindReact(r: ReactLike) { R = r; }
export function h(type: any, props?: any, ...children: any[]) { return R.createElement(type, props, ...children); }
export const { useState, useEffect, useMemo, useRef, useCallback, Fragment } = ...; // 经 R 转发
```

- 入口：`window.__ModuleLoader__.load({ id: 'dsh-eval-control', factory(require) { bindReact(require('react')); return createPlugin(); } })`
- 模块顶层不触碰 React（只有函数体内的 `h()` 调用）→ IIFE 在浏览器脚本加载时零 React 依赖。
- TSX 以 `"jsx": "react", "jsxFactory": "h"` 编译 → `<div x={1}/>` 变为 `h('div', {x:1})`。
- 现有测试契约完全兼容（单脚本、factory 只 require('react')）。

### 4.3 视图布局（PRD §3.6 逐项落地）

```
┌─ StatusBar: [占用率环形徽章][模式][会话时长]        [导出▾][分享▾][🔔告警N]
├─ MetricCardsRow: 输入Token | 输出Token | 工具调用 | 错误率 | 压缩频率 | 重试   （趋势箭头）
├─ TabBar: 总览 | 上下文演化 | Token 趋势 | 压缩与注入 | 工具分布 | Team 活动 | 对比分析
├─ TabContent（每 Tab 详见下）
└─ 详细数据区（CollapsibleDetailPanel，默认展开）:
   ├─ 消息列表（摘要 20 行 + "查看全部"切到 Token 趋势 Tab）
   ├─ 事件列表（压缩/注入卡片置顶 + 最近事件流）
   └─ 指标明细（指标表 + 轮次趋势 + 数据质量 —— 迁移现有全部内容）
```

Tab 内容：
1. **总览**（默认）：占用率仪表盘（SVG 环形，绿/黄/红，>80% 脉冲动画）+ 组成堆叠条（6 段，
   hover 预览，点击选中联动表格行）+ 组成饼图（SVG，点击扇区高亮）+ 组成详表（排序/复制）+
   告警面板（规则列表/忽略/标记处理）+ Team 摘要行 + 最近事件预览。
2. **上下文演化**：TimelineChart——X 轴步骤序，Y 轴 Token；蓝色实线（steps[].inputTokens，
   真实上下文规模）、surface 估算虚线、红色窗口上限虚线、绿色三角（压缩）、橙色圆（注入）、
   红色菱形（Token 激增：环比 >50%）；拖拽框选缩放 + 重置；图例点击显隐；hover tooltip。
3. **Token 趋势**：每步 input/output 柱状趋势 + **消息 Token 列表**（序号/角色/摘要/输入/输出/
   累计/时间；排序：Token 数|时间；筛选：角色|Token 范围；Top3 红色高亮；异常突增黄色高亮；
   行展开详情：该步 surface 组成 mini 条 + 关联事件）。
4. **压缩与注入**：压缩事件卡片（图标/时间/前→后/回收率/触发/耗时；点击展开：前后组成对比、
   被压缩内容摘要描述）+ 注入事件列表（来源 kind/估算 Token/时间；筛选 by kind）+ 统计摘要栏。
5. **工具分布**：按名称柱状图（调用数，错误叠加色）+ 表格（名称/调用/错误/错误率/排序）。
6. **Team 活动**：现有 team 聚合 UI 原样迁移（成员/活跃/并发峰值/完成墙钟/分支首活动）。
7. **对比分析**：会话选择器（useSessions 列表，多选 2-4，含当前会话；显示标题/更新时间）→
   并排指标柱状对比（输入/输出 Token、轮次、工具调用、错误率、压缩数、时长）→ 归一化开关 →
   差异报告（各维度最优会话 + 最佳实践建议）。

### 4.4 智能告警（PRD §3.7）

客户端规则引擎，每次投影更新后评估：

| 规则 | 条件（默认阈值，可配置） | 级别 | 建议 |
|---|---|---|---|
| 上下文满载 | 占用率 > 80% | 🔴 严重 | 启用更激进的压缩策略 / 清理会话 |
| 频繁压缩 | 压缩频率 > 5 次/千输入 Token | 🟡 警告 | 减少工具定义数量 / 增大窗口 |
| 高错误率 | 工具错误率 > 10% | 🔴 严重 | 检查工具参数格式 |
| Token 浪费 | 重复调用 > 3 组 | 💡 建议 | 启用结果缓存 |
| 长间隔 | ≥30s 间隔段 > 2 | 💡 建议 | 检查工具响应时间 |

- 阈值配置面板（总览 Tab 告警区"设置"入口），localStorage 持久化。
- 告警状态：激活/忽略/已处理，localStorage 持久化；按级别排序；筛选（全部/未处理/按级别）。
- "应用建议"：与 PRD §5.4 只读原则一致，展示**可复制的配置建议**而非自动修改宿主配置。
- 无告警显示"✅ 一切正常"；过多时按级别折叠只显示最严重 + 计数。

### 4.5 导出与分享（PRD §3.9）

导出菜单（状态栏）：
- **Markdown 报告**：模板（简洁/详细/团队），关键指标 + 组成 + 压缩/注入 + 告警 + 对比（若在
  对比 Tab 触发）。Blob 下载。
- **JSON 数据**：当前全部投影数据快照。Blob 下载。
- **PNG 图表**：当前 Tab 的 SVG 序列化 → Canvas → 下载。
- **独立 HTML 报告**（分享语义）：自包含单文件（内联全部数据 + 渲染脚本），收件人浏览器直接
  打开即为只读视图——本地只读插件无法托管分享链接服务，此为实现"分享只读视图"的本地等价物，
  偏差在 UI 与文档中明示。
- 复制 Markdown 到剪贴板（navigator.clipboard，降级 textarea+execCommand）。
- 失败重试：导出为异步函数 + catch → 错误 toast + 重试按钮。

### 4.6 性能与健壮性

- 投影侧有界（steps 256 / injections 64 / compactions 32 / tools 20）。
- 客户端 `useMemo` 派生（组成占比、告警评估、排序视图）；排序/筛选状态本地。
- 虚拟滚动：消息列表 >100 行时窗口化（自实现，无第三方依赖）。
- 所有宿主数据缺失路径显示"暂无数据/宿主未提供"，绝不伪造。
- 现有测试断言的内容（标题/最近事件/Team/指标明细/数据质量/在 Trajectory 定位按钮）全部保留
  在默认渲染可见区域。

## 5. 测试与验证

### 5.1 现有测试（必须全绿）

- `test/client_chip.test.ts`：加载真实 `client/client.js`（生成产物），断言 3 个插槽注册与
  视图默认渲染文本。允许的最小适配：fake React 补 `useMemo/useRef/useCallback`（若新视图用到）。
- 其余 13 个测试文件不涉及本次改动面（host 侧只新增文件 + analytics_entry 加一行注册）。

### 5.2 本地 DSH 客户端验证（不重启正在使用的 Desktop 应用）

基础设施（`.verify/`，已有且经验证）：
1. probe profile：`~/.verify/dsh-home/profiles/probe`，`node_modules/dsh-eval-control` symlink
   到本仓库 → 构建产物即刻生效。
2. 启动：`DSH_HOME=.verify/dsh-home node "$APP/node_modules/@deepseek-ai/dsh/lib/bin.js" --profile probe --no-open --port 4399`（托管后台任务）。
3. **会话回放**：拷贝 2-3 个真实历史会话（`~/.dsh-beta/sessions/...` 的 session.v4.jsonl.zstd）
   到 probe home 的对应 sessions 目录 → 宿主加载既有日志，投影完整折叠，无需模型调用即得真实
   数据（含压缩事件——真实会话中有）。
4. **UI 断言**：Chrome（CDP 9333）打开页面 → `window.__DSH_BOOT__` 确认客户端模块图含
   dsh-eval-control → 切换到轨迹分析 view → DOM 断言（各 Tab 标题/图表节点/数据行）+ 截图。
5. 验证完成 kill 后台 host。

### 5.3 验收清单（对齐 PRD 里程碑）

2026-10-18 在本地 DSH 客户端（Desktop Beta 0.1.7-rc.1 宿主 + probe profile 回放
真实会话）逐项验证通过，证据：`.verify/shots/*.png` 截图 + CDP DOM 断言。

- [x] P0：占用率仪表盘（真实窗口上限 + 颜色编码 + >80% 脉冲）
- [x] P0：组成拆解（6 段堆叠条 + 饼图 + **明细表（类型/Token/占比/操作列，按 Token/类型排序）+ 内容预览模态框（有界节选、复制、Esc/×/关闭）+ 每行复制 + 饼图扇区点击定位高亮明细行**）
- [x] P0：消息级 Token（**§3.3 全量**：角色图标/摘要 50 字/输入·输出·累计三列/时间戳；
  筛选=角色+仅注入+Token 范围；排序=时间/轮次/输入/输出/累计；Top3 红色高亮 👑；
  异常突增黄色高亮 ⚡（≥3× 前 5 条中位数且 ≥1K）；展开详情=完整内容（有界 1000 字符）+
  Token 分布（文本/工具调用/文件比例条）+ 关联调用（callId + 在 Trajectory 定位跳转）+
  模型输出 Token（usage 真实值）+ 占当前表面 %；**「原因总结」面板**（可收起）：
  Top3/突增按 Token 构成归因（工具输出体积/大参数工具调用/长文本推理/注入，附主导成分
  占比与突增倍数）、突降匹配窗口内压缩/修剪事件（类型/轮次/前后值/回收/回收比）、组内
  聚合（紧凑角色计数：助手 11 · 工具 1）、**双饼图**（消息构成按角色 / 按成分的 Token 占比 +
  百分比与绝对值图例）、一行摘要（Top3/突增/突降 数量+累计+占比）、三张按严重程度着色
  的卡片（红/浅黄/浅绿）、突增默认前 5 条 + 「展开全部」按轮次分组、标签式条目
  （机制/成分/倍数 chip）、整行或 #序号点击定位展开对应行、压缩事件跳转为按钮样式，证据
  `.verify/shots/16-tokens-tab-full.png`、`.verify/shots/18-cause-summary.png`）
- [x] P1：演化时间线（PRD §3.4：占用蓝实线/上限红虚线/压缩绿三角+绿竖线/注入橙圆+橙竖线/
  激增红菱形含原因 hover/标记筛选芯片/按轮次·步骤·时间三种 X 轴/滚轮缩放+拖拽平移+双击重置/
  悬停标记高亮其余淡化 30%/重叠标记聚合气泡+成员列表/tooltip 跟随鼠标并边界翻转/图例显隐/hover 数值）
- [x] P1：压缩/注入事件（卡片/前后对比/回收率/注入分类）
- [x] P1：Dashboard 重构（状态栏/卡片/Tab/详细数据区/响应式）
- [x] P2：智能告警（5 规则/阈值配置/忽略/处理）
- [x] P2：对比分析（2-4 会话/图表/差异报告）
- [x] P2：导出分享（Markdown/JSON/PNG/独立 HTML）

回放数据集（`~/.dsh-beta` 真实历史会话拷贝进 probe home）：

| 会话 | 特征 | 验证要点 |
|---|---|---|
| `5f8b39e9`（1.8MB / 97 步 / 10 轮） | 2 次摘要压缩 + 7 次历史修剪，qwen3.8-max | 压缩卡片前后对比/回收率/耗时、演化标记 ▲×9、组成含"压缩摘要"段 |
| `8283c8f4`（0.6MB / 100 步） | 无压缩，deepseek-v4.1-flash | 基线路径、组成含"系统提示"段、无告警噪音 |
| `dd2b78e1`（3 次压缩） | 对比候选 | 对比分析 Tab 的第二数据源 |

实测交叉验证：占用率 49.9%（130.9K/262,144）与该会话最后一步
`inputTokens + cacheReadTokens`（1,887+129,024）**逐字节吻合**；压缩 9 次 =
2 摘要 + 7 修剪，与原始日志 `compaction/summary|prune` 事件计数一致。

### 5.4 实施中发现并修正的三个数据语义问题

1. **`usage.inputTokens` 是"未缓存输入"**。真实会话（qwen3.8-max 网关）的
   每步 inputTokens 在 77K↔592 之间剧烈震荡——`cacheReadTokens` 才是被缓存
   命中的部分，**模型真实看到的上下文 = inputTokens + cacheReadTokens**
   （与 `totalTokens` 自洽）。据此：
   - 环形仪表盘/状态栏徽章/告警的"当前窗口占用"取最后一步
     `inputTokens + cacheReadTokens`（PRD §3.1 的"当前占用"语义）；
   - 演化 Tab 的服务商输入曲线同样含缓存读（标为"含缓存读"）；
   - 指标卡"输入 Token（未缓存）"保留累计未缓存值（成本语义），趋势箭头
     用含缓存值；
   - 对比 Tab 的"窗口占用峰值"取 max(含缓存输入/窗口)。
   修正前基线会话显示 123%（累计未缓存/窗口）、压缩会话被钳到 150%——均为
   误导值；修正后分别为 66.1%、49.9%，与请求报文自洽。
2. **环上文本与弧形解耦**：RingGauge 的弧形按 [0,1] 钳制（>100% 画满圈），
   但中心文本显示真实百分比（如 123%），不再互相矛盾。
3. **压缩 `afterTokens` 取错快照（实施 §3.3 突降检测时暴露）**：旧实现
   用"未过滤的 surface 总量 − 落地节点"回填 `afterTokens`，等价于把回填值
   算成落地节点自身的价格——回收量被系统性低估（第 8 轮摘要压缩实际
   164,362 → 111,092（−53,270，32.4%），旧实现记 4,715；会话总回收
   17.8K，实为 175.7K，漏报约 158K）。正确口径：`afterTokens` =
   **被遮蔽区间移除后的 surface 总量 + 落地节点**。修正后压缩卡片/指标卡/
   导出报告/对比报告的回收与回收比全部与消息台账的累计骤降独立互证
   （第 8 轮：卡片 53,270 vs 台账 164.4K→111.4K = 111,092+273 自身）。

## 6. 风险与取舍（更新）

| 风险 | 应对 |
|---|---|
| 分享链接需服务端托管 | 以独立 HTML 报告实现本地等价，UI/文档明示偏差 |
| "应用建议"自动改配置 vs PRD §5.4 只读 | 展示可复制建议文本，不修改宿主配置 |
| 注入/组成 Token 为估算 | 与宿主 token-meter 同算法；UI 标注"估算"；与 contextBreakdown 交叉校验展示。实测偏差：估算 161.9K vs 真实（含缓存读）130.9K，超估约 23%（字符法对结构化 JSON 内容的固有偏差，方向偏保守） |
| `inputTokens` 缓存语义（服务商差异） | 当前占用/演化曲线统一取 `inputTokens + cacheReadTokens`；未缓存累计单列（成本语义）。无 cacheReadTokens 字段的服务商自动退化为裸 inputTokens |
| client/client.js 变为生成产物 | 头注释标记 + 构建脚本 + README 说明；market 安装仍即用 |
| useProjection 键缺失（旧宿主） | 全部可选链 + 占位符，绝不崩溃 |
| Desktop Beta 宿主（0.1.7-rc.1）与本仓库 devDeps（0.2.0-rc.2）版本差 | probe profile 用 `plugin allow-version` 豁免加载；实测投影 contract 兼容（`ProjectionDefinition`/`register`/wire 序列化均工作）；正式升级宿主后豁免可移除 |

## 7. 已实现的 PRD 偏差清单（明示）

1. **分享链接 → 独立 HTML 报告**（PRD §3.9）：本地只读插件无法托管分享 URL；
   导出的单文件 HTML 内联全部数据与图表，双击即开，作为"分享只读视图"的
   本地等价物。导出菜单第五项（复制 Markdown）走剪贴板。
2. **"应用建议" → 可复制配置文本**（PRD §5.4 只读边界）：告警卡展示建议文案 +
   `# profile cordis.patch.yml 示例` 代码块 + 复制按钮，用户自行粘贴修改，
   插件不写宿主配置。
3. **组成/消息 Token 为估算**：宿主不落盘每消息精确 token（服务商只给请求级
   usage），估算算法与 dsh-token-meter 完全一致（CHARS_PER_TOKEN=4 +
   块开销 4），UI 全部标注"估算"；占用率/演化曲线的服务商输入则是**精确值**
   （含缓存读）。
4. **虚拟滚动**：实现为"消息/事件列表各取最近 64 条 + 明示截断"，而非完整
   虚拟化（投影侧有界输出，列表天然有限）。

---

**文档结束**
