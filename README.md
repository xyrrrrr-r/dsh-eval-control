# dsh-eval-control

[![源码版本 0.5.0](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/badges/version.svg)](package.json)
[![License Apache-2.0](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/badges/license.svg)](LICENSE)
[![验证环境 DSH 0.2.0-rc.2 / 0.2.1-rc.2 / 0.2.1-rc.3](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/badges/dsh.svg)](#环境要求)
[![Node.js 22.19.x–22.x 或 24+](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/badges/node.svg)](package.json)
[![TypeScript 6.0.3](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/badges/typescript.svg)](package.json)

DSH 轨迹分析与 aeval 评测控制插件。

上下文窗口不知不觉满了，不知道哪条消息吃了大量 Token，子 Agent 之间到底交接了什么，工具报错后找不到原始日志——这些问题现在都能看见。dsh-eval-control 把会话黑盒变成可视化面板：从上下文演化、团队协作关系图到工具错误证据链，一个插件全覆盖。同时提供 aeval 所需的变量注入、预算控制和 fork 血统校验。

```bash
dsh plugin --profile web add dsh-eval-control
```

[快速开始](#快速开始) · [面板演示](#面板演示) · [功能对比](#功能对比) · [面板功能](#面板功能) · [导出与分享](#导出与分享) · [常见问题](#常见问题)

本文对应仓库当前实现，`package.json` 版本为 `0.5.0`。发行包的功能取决于实际安装版本。

## 功能对比

与同类上下文可视化插件相比，本插件额外提供：

| 能力 | 本插件 | 同类插件 |
| --- | :---: | :---: |
| 上下文窗口组成与演化 | ✅ | ✅ |
| 消息 Token 估算与筛选 | ✅ | ✅ |
| 压缩事件可视化 | ✅ | ✅ |
| 区分摘要压缩与历史修剪 | ✅ | ❌ |
| 工具调用分析与错误证据 | ✅ | ❌ |
| Team 多 Agent 协作关系图 | ✅ | ❌ |
| 交互时序与任务板 | ✅ | ❌ |
| 智能告警 + 配置应用 | ✅ | ❌ |
| 证据链（从结论到原始事件） | ✅ | ❌ |
| 会话对比 + 差异报告 | ✅ | ❌ |
| 导出 PDF/Markdown/HTML + 只读分享 | ✅ | ❌ |
| aeval 评测控制集成 | ✅ | ❌ |

## 快速开始

向目标 profile 安装插件：

```bash
dsh plugin --profile web add dsh-eval-control
```

将 `web` 替换为实际使用的 profile。需要固定发行版本时，在包名后追加 `@<version>`。

重启或重新加载该 profile，打开一个会话，在会话顶部选择 **轨迹分析**。对话区的 `aeval 控制` 状态胶囊和侧栏插件详情提供评测控制状态。

<details>
<summary>从源码构建</summary>

在仓库根目录执行：

```bash
npm install
npm run build
npm run typecheck
```

将构建后的本地目录安装到目标 profile：

```bash
dsh plugin --profile web add /absolute/path/to/dsh-eval-control
```

`client/client.js` 是生成产物，前端修改应编辑 `client-src/`，再运行 `npm run build:client`。

</details>

### 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| 完整功能验证环境 | DSH `0.2.0-rc.2`、`0.2.1-rc.2` 与 `0.2.1-rc.3` 的 Web 界面 |
| 宿主依赖 | 满足 `package.json` 中全部 `peerDependencies`；契约类 peer 覆盖 `0.2.0-rc.2` 到 `0.2.1-rc.3` 三个已验证版本 |
| 轨迹分析 | 宿主会话及 projection 服务 |
| 诊断配置应用 | 宿主持久化配置编辑器 `configEditor` |
| 分享链接 | 宿主 HTTP 服务及本地 profile 存储 |

版本不满足时，宿主会在**安装阶段直接拒绝**（`dsh: installation rejected ... nothing was installed`），并且因为市场对 `engines` 与全部宿主 peer 取合取，插件也不会出现在市场搜索结果中——给自己加 `engines.dsh` 只能绕过宿主的加载闸门，绕不过市场过滤。若确需在未验证的宿主版本上试用，可用宿主自带的精确版本豁免：

```bash
dsh plugin --profile <profile> allow-version dsh-eval-control@<version> --dsh-version <host-version> --accept-risk
```

豁免只对"该插件版本 + 该宿主精确版本"这一对生效，不会放宽 `peerDependencies`。

## 面板演示

以下动图由演示数据的关键操作截图合成循环 GIF，不包含真实会话内容。

**上下文演化**：切换步骤 / 轮次、选中压缩事件、适配纵轴范围。

![上下文演化：轮次切换、事件定位与纵轴适配](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/demo/panels/context-evolution.gif)

**团队协作**：主子与子子 Agent 关系、交接方向筛选、消息原文、轨迹证据和共享任务板。

![团队协作关系图、交互时序、消息证据与任务板（合成数据）](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/demo/panels/team-collaboration.gif)

<details>
<summary>总览诊断与消息 Token</summary>

查看窗口占用和右侧告警，展开诊断建议，切换消息台账与注入筛选。

![总览告警与消息 Token 筛选](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/demo/panels/overview-messages.gif)

</details>

<details>
<summary>压缩替换详情与聚合事件</summary>

展开摘要压缩，查看替换手段、历史内容与检查点的对应关系，以及聚合后的历史修剪和注入来源。

![压缩替换关系、替换手段和事件聚合](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/demo/panels/compression-injection.gif)

</details>

<details>
<summary>工具分布与失败证据</summary>

查看工具调用及错误分布、放大图表，再打开失败标红、错误原文和规则原因分析。

![工具调用分布、缩放和失败原因证据](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/demo/panels/tools-team.gif)

</details>

<details>
<summary>会话对比与差异报告</summary>

比较两次运行，查看资源消耗雷达图、原始值与差异报告。

![会话对比、雷达图和差异报告](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/demo/panels/session-comparison.gif)

</details>

<details>
<summary>报告导出与分享选项</summary>

切换报告格式，查看只读分享的有效期与访问权限选项。此演示未创建分享链接。

![报告导出格式与只读分享配置](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/demo/panels/export-share.gif)

</details>

动图的演示数据和更新方法见 [录制说明](docs/demo/panels/README.md)。

## 面板功能

| Tab | 可以查看或执行的操作 |
| --- | --- |
| 总览 | 上下文窗口占用、组成拆解、会话摘要；右侧集中展示智能告警、规则设置和可折叠诊断数据 |
| 上下文演化 | 按步骤、轮次或时间查看输入占用、上下文内容估算 Token 和输出 Token；区分摘要压缩、历史修剪、注入与激增 |
| 消息 Token | 默认全部历史，可选最近 N 条或事件范围；角色、Token 范围、排序与高消耗消息定位 |
| 压缩与注入 | 事件聚合、压缩前后对比、替换关系、替换手段、注入来源和内容节选 |
| 工具分布 | 调用次数、显式错误、分布图与调用明细；失败标红、规则原因分析及原生工具卡片定位 |
| Team 活动 | 主子 Agent 协作关系图、交互时序、成员分工与活动泳道、任务板和消息交接；支持筛选与证据跳转 |
| 对比分析 | 选择 2–4 个会话，生成资源消耗对比、上下文折线、雷达图、差异报告与建议 |

顶部关键指标卡可打开计算口径与事件证据；其他 Tab 可通过 **总览诊断** 返回诊断中心。各面板的详细交互说明见 [面板详细说明](docs/panel-details.md)。

### 证据链：从结论回到原始事件

点击顶部指标卡、告警中的 **查看证据链**，或消息表中的 ⚡ / 🔻，会在右侧打开统一证据抽屉。演化图选中标记、压缩、注入、工具明细、Team 成员与对比指标均有对应入口。

抽屉显示结论、规则、实际计算输入、样本与分母、证据等级和数据质量提示。点击关联事件，按 `sessionId + seq` 读取宿主原始持久事件，并可折叠查看前后事件、检查 JSON 或下载记录。当前会话且宿主支持时可打开原生工具卡片，跨会话时使用原始事件查看器。

窗口占用证据额外展示"未缓存输入 + 缓存读取 = 请求占用"的实际数值公式；每个输入分别关联事件与原始字段。突增同时展示基线中位数、相邻消息体积差、主导成分和时间间隔，各数值分别标明来源。

引用和投影均有保留上限；缺失、读取失败或未记录的耗时起止会明确提示，不会用相邻事件代替。关闭抽屉保留原 Tab 的筛选和缩放。

![窗口占用公式、原始用量来源和相邻事件核查（演示数据）](https://raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/demo/panels/evidence-chain.gif)

实现和数据约定见 [证据链设计](docs/evidence-chain.md)。

## 智能告警

告警与诊断集中在 **总览右侧的诊断中心**，提供未处理、已处理、已忽略及严重级别筛选。

| 告警 | 默认触发条件 |
| --- | --- |
| 上下文满载 | 窗口占用超过 80% |
| 频繁压缩 | 摘要压缩超过 5 次 / 千输入 Token |
| 高错误率 | 工具显式错误率超过 10% |
| Token 浪费 | 同一参数调用最长连续重复超过 3 次 |
| 长间隔 | 存在至少一个 ≥30 秒的长间隔段 |

在 **规则设置** 中修改阈值或启停规则。上下文满载、频繁压缩告警支持 **查看并调整配置** 或 **直接应用推荐配置**，写入通过宿主配置编辑器完成，包含并发变更检查、配置校验和回读确认。

**预设中的配置修改对新建会话生效，现有会话保留原预设版本。** AI 模型诊断暂时停用；现有规则告警、错误文本分析、证据链和配置建议继续可用。

## 会话对比与差异报告

打开 **对比分析**，勾选 2–4 个会话，点击 **开始对比**。查看 Token 条形对比、上下文演化折线和多维雷达图。

系统默认高亮相对差异最大的一项。差异报告给出 Token 消耗、摘要压缩频率、工具错误率和模型耗时的最低值，缺失数据标为不可用，不按零参与排名。勾选 **归一化显示** 后，上下文曲线按窗口占用率与请求进度对齐。

雷达图使用资源消耗比例（当前会话原始值 / 所选会话该项最大值），至少三个指标在所有所选会话中均可用时才绘图。雷达面积不代表任务能力或完成质量。

## 导出与分享

### 报告导出

点击面板顶部 **导出**，选择模板、标题和格式。

| 格式 | 说明 |
| --- | --- |
| PDF | 本地生成 A4 报告，支持中文、表格、图表、分页和页码 |
| Markdown | 可编辑文本报告，包含指标、分析和图表数据样本 |
| JSON | 原始投影、告警及已选对比快照 |
| PNG | 当前 Tab 的首个可用 SVG 图表 |
| HTML | 离线只读报告，无外部资源依赖 |

| 模板 | 内容 |
| --- | --- |
| 简洁版 | 关键指标与图表 |
| 详细版 | 指标明细、事件、图表和告警分析 |
| 团队版 | 关键指标、图表、多会话对比与建议 |
| 自定义 | 自选章节，可保存配置到当前浏览器 |

### 只读分享

点击顶部 **分享**，选择报告模板，设置有效期（7 天 / 30 天 / 永久）和访问权限（公开或密码保护）。

分享快照保存在当前宿主 profile 的 `trajectory-shares/` 目录。宿主停止期间链接不可用，重启同一 profile 后可继续访问。`127.0.0.1` / `localhost` 链接仅本机可用；团队访问需从可达地址的宿主页面生成链接。

分享报告不包含原始消息正文、工具参数或替换内容节选。当前最多保留 100 份分享，每份 HTML 不超过 2 MB。密码以随机 salt + scrypt 存储。

## 数据口径与隐私

| 数据 | 口径 |
| --- | --- |
| 顶部及对比中的 Token 消耗 | 未缓存输入 + 输出，不等于计费金额 |
| 上下文窗口占用 | 请求输入占用，包含缓存读 |
| 上下文内容估算 Token | 启发式估算，`CHARS_PER_TOKEN = 4`，与 `dsh-token-meter` 镜像算法一致 |
| 压缩频率 | 摘要压缩次数 / 千输入 Token；历史修剪单独统计 |
| 工具错误率 | 已观察到的显式工具错误 / 已知工具结果数；缺失结果不算成功 |
| 雷达及最低值排名 | 所选会话内的资源表现；比较时应同时考虑任务规模、模型与完成质量 |

本插件的分析与分享数据保存在本地，不上传到外部服务。内容节选、复制和导出可能包含原会话中已保留的路径或正文，分享前应核对所选导出内容。诊断中的配置应用由用户显式触发，会持久化修改对应宿主配置。

## aeval 评测控制

本插件同时提供 aeval 评测控制能力（变量注入、步骤与 Token 预算、fork 血统校验和 bundle descriptor），编排、评分与评测报告由 aeval 完成。默认以 `standalone` 状态运行，不影响普通轨迹分析；接入完整控制栈后启用评测控制。

详细配置、行配置示例和自检方法见 [aeval 评测控制文档](docs/aeval-control.md)。

## 开发与验证

```bash
npm install
npm run build          # 组合中立运行时、编译宿主、打包独立入口及前端
npm run typecheck      # 宿主与前端类型检查
npm test               # 构建与完整测试流程
```

仅修改面板时：

```bash
npm run typecheck:client
npm run build:client
node --test test/client_*.test.mjs
```

<details>
<summary>项目结构</summary>

| 目录或文件 | 职责 |
| --- | --- |
| `client-src/` | 面板、图表、诊断配置操作、对比、报告与分享 UI |
| `client/client.js` | esbuild 生成的浏览器入口 |
| `client-src/teamActivity.ts`、`client-src/teamCollaboration.tsx` | 协作事件重建、关系图与交互时序 |
| `src/analytics/` | 轨迹指标与上下文时间线投影 |
| `src/analytics_entry.ts` | 分析服务入口 |
| `src/diagnostic_config.ts` | 可验证的压缩配置读取与应用 |
| `src/report_share.ts` | 分享快照存储、有效期、密码与只读路由 |
| `src/index.ts`、`src/sandbox_entry.ts` | aeval 控制与 transport 入口 |
| `cordis.patch.yml` | 默认组合包挂载声明 |
| `test/` | 宿主、前端、配置、报告及分享测试 |

</details>

## 常见问题

**安装后没有"轨迹分析"？**

检查 profile 是否正确、插件是否启用、peer 版本是否满足。重建前端后重新加载页面；重建宿主代码后确认服务已重新加载。

**装了之后会影响 DSH 性能吗？**

本插件的分析基于宿主提交的事件投影，不拦截模型调用，不改变宿主运行策略。图表和指标在需要时按需计算，关闭面板后不持续消耗资源。

**为什么控制状态是 standalone？**

当前没有评测控制配置。这是正常的普通分析模式；需要跑受控评测时再接入完整控制栈。

**数据会上传到外部吗？**

不会。所有分析数据、报告快照和分享文件均保存在本地宿主 profile 中。分享链接仅在宿主运行期间可用，且不包含原始消息正文和工具参数。

**为什么"压缩次数"和"压缩频率"看起来不同？**

先核对是否包含历史修剪，以及分母是否为输入 Token。时间线区分摘要压缩与历史修剪；告警和对比的频率采用摘要压缩口径。

**为什么两条 Token 曲线不同？**

窗口占用包含缓存读，上下文内容估算包括历史思考、工具参数等保留内容，且与实际请求序列化和模型分词不同；顶部消耗采用未缓存输入加输出。可在演化页按请求查看估算成分与参与情况。

**为什么配置应用成功后，当前会话还没变化？**

检查界面中的生效范围。Agent 预设修改用于新建会话，已经运行的会话保留原预设版本。

**差异报告在哪里下载？**

在对比 Tab 完成"开始对比"，再到顶部"导出"选择团队版和 PDF、Markdown 或 HTML。

**为什么同事打不开分享链接？**

检查链接是否为本机地址、宿主是否运行、有效期及密码。团队访问需要可达的宿主地址。

## 更多文档

- [面板详细说明](docs/panel-details.md) — 各面板的详细交互、缩放操作和数据边界
- [aeval 评测控制](docs/aeval-control.md) — 完整控制栈配置、行配置示例和自检方法
- [市场安装到评测报告](docs/MARKET-TO-REPORT.md)
- [证据链设计与数据约定](docs/evidence-chain.md)
- [面板动图录制说明](docs/demo/panels/README.md)
- [变更记录](CHANGELOG.md)

文档链接相对仓库根目录；从 npm 页面阅读时，可进入 [GitHub 仓库](https://github.com/xyrrrrr-r/dsh-eval-control) 查看完整文档。

## License

[Apache-2.0](LICENSE)
