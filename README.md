# dsh-eval-control

[![npm version](https://img.shields.io/npm/v/dsh-eval-control?logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-eval-control)
[![npm downloads](https://img.shields.io/npm/dm/dsh-eval-control)](https://www.npmjs.com/package/dsh-eval-control)
[![license](https://img.shields.io/npm/l/dsh-eval-control)](LICENSE)
[![dsh-plugin topic](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![dshfind](https://dshfind.com/api/badge/xyrrrrr-r/dsh-eval-control?metric=downloads)](https://dshfind.com/zh/plugins)

**aeval 的宿主侧 DSH 评测控制插件**：把一次评测试次所需的全部实验事实——
变量、预算、血统、证据归属——一次性注入 DSH agent 进程，并密封成可校验的
bundle descriptor。

Host-side Cordis control plugin for [aeval](https://github.com/xyrrrrr-r/aeval):
one-shot config injection for experiment variables, gateway-lease budgets,
fork lineage, and bundle descriptors.（experimental · v0.2.6 · Apache-2.0）

---

## 30 秒选路

| 你想要的 | 一条命令 | 跑完你会看到 |
| --- | --- | --- |
| **① 让 DSH 变得可控**（装插件） | `dsh plugin --profile web add dsh-eval-control@0.2.6` | 侧栏「插件」页出现本组合包；对话区出现只读胶囊 `◆ aeval 控制 · standalone` |
| **② 真的产出一份评测报告**（跑评测） | `aeval quickstart --backend docker --yes` | `report.md` + `<valid>/<total> trial(s) scored` |

> ① 那一列的"会出现"属于 **GUI 渲染层**：宿主数据层是实机验证过的，**图形界面里的可见性/点击没有实机截图**
> ——见 §① 的「这条链路的实机证据到哪为止」。

> 🎬 **想先看它跑起来什么样**：两段真实录制（都是实验机实跑，**未做任何拼接**）——
> [主 demo 4 幕](docs/demo/recording/demo-20261012-134955.typescript)（4.78 min、
> `3/3 trial(s) scored`，`scriptreplay --divisor 8` 约 36 秒看完）与
> [市场安装短片](docs/demo/recording/market-install-20261012-140526.typescript)（15.9 s，
> `dsh plugin add` → `mode: standalone`）。分镜、回放命令与两段各自的边界见
> [docs/demo/STORYBOARD.md](docs/demo/STORYBOARD.md)。

> ### 装完就是 `standalone` —— 这是设计，不是故障
>
> 全新 profile 上装完插件，DSH 只组合出一行 `aeval-broker-transport`（`config: {}`），
> 它 settled `active`。**不挂控制栈、不重定向任何模型调用**——装插件不会破坏一个普通
> profile，它只是让 DSH 变得**可被评测**。
>
> 所以「装了没反应」是正常的：插件只负责控制与证据归属，**分数和报告在 aeval 侧**
> （[§0 先划清这条界限](docs/MARKET-TO-REPORT.md)）。当前处于哪个 mode、下一步做什么，
> 胶囊和 `aeval doctor` 都会直接告诉你。

---

## ① 装插件：一眼看懂当前 mode 与下一步

```bash
dsh plugin --profile web add dsh-eval-control@0.2.6   # 显式钉版本，原因见下
```

> **为什么要写 `@0.2.6`**：这是 pnpm ≥11 的**供应链策略**，与 registry、缓存、DSH 都无关。
> pnpm 的 `minimumReleaseAge` 默认 **1440 分钟（1 天）**：发布不满 1 天的版本**不会被解析**，
> 所以裸包名只会拿到"最新一个已满 1 天的版本"（[pnpm 文档](https://pnpm.io/supply-chain-security)）。
> 实测（2026-10-12，官方 registry）：0.2.4 / 0.2.5 / 0.2.6 发布都不到 24 小时（22–23 h）、
> 0.2.3 刚好超过（26.6 h）⇒ 裸包名解析到 **0.2.3**；同一台机器上
> `pnpm add dsh-eval-control --config.minimumReleaseAge=0` 与
> `pnpm add dsh-eval-control@0.2.6` 都拿到 **0.2.6**。这也正是
> [MARKET-TO-REPORT §2.3](docs/MARKET-TO-REPORT.md) 在 10-11 观测到"全新 profile 装到 0.2.2"
> 的同一个原因（当时 0.2.3 还不满一天）。**结论：显式钉版本**，或在你自己 profile 的
> `pnpm-workspace.yaml` 里设 `minimumReleaseAge: 0`。
> 装到 0.2.3/0.2.4 那份**没有内嵌依赖**，独立进程入口会 `ERR_MODULE_NOT_FOUND`。

> **同一台机器上另外两个实测坑**（2026-10-12 实录，短片见
> [docs/demo/STORYBOARD.md](docs/demo/STORYBOARD.md) 的「录制 B」）：
> ① `npm i -g pnpm @deepseek-ai/dsh` 装出来的命令可能不在 PATH 上（npm 全局前缀是自定义目录时），
> 且 npm ≥11 默认拦 install script，要按它自己打印的清单加 `--allow-scripts=…`；
> ② profile 默认 `autoInstallPeers: false`，插件声明的 peer 不跟着装 —— 在**没有 DSH 宿主**
> 的裸 profile 里直接跑插件会 `ERR_MODULE_NOT_FOUND`（宿主环境里 peer 由宿主提供，不受影响）。

装完看两个地方，**它们读的是同一份宿主数据**（`pluginInventory/list` 的 live 行 +
`pluginManager/listBundles` 的组合包记录），不会互相矛盾：

- **对话区输入框上方的状态胶囊**（`◆ aeval 控制 · <mode>`）：点开显示当前 mode、
  下一步指引、以及宿主报告的异常；
- **侧栏「插件」页 → 本组合包详情**：同一个面板（`plugins.detail.section`）。

> **这条链路的实机证据到哪为止**：**宿主数据层是实机验证过的** —— 真 host + scratch profile 上跑
> `pluginInventory/list` 与 `pluginManager/listBundles()`，peer 失配时组合包确实答
> `error.code = incompatible-version`；`window.__DSH_BOOT__` 的模块图也证明 **client half 确实被挂载**。
> **只有 Desktop GUI 的渲染/点击这一层没有实机截图**："胶囊可见、点开显示 mode、插件页显示异常标签"
> 本会话验证不了（写不了 `~/.dsh-beta/profiles/desktop`、无浏览器自动化）。
> 所以本节与首屏表格里的"会出现/点开"写的是**装完应该看到什么**以及它读的那份数据，
> **不是已截图的 GUI 结果**。

### 模式（mode）一览

| 胶囊显示 | 含义 | 下一步 |
| --- | --- | --- |
| `mode: active` | 控制栈已挂载：run 绑定 / 预算 / descriptor 生效 | 什么都不用做，去跑评测（②） |
| `mode: standalone` | 只挂了 transport 行，没有控制配置；模型调用不被改写 | 胶囊里直接给出两条任选其一（见下） |
| `mode: failed` / `not-mounted` / `unknown` | host 半区加载失败 / 本 profile 没组合本插件 / 行阶段不可判定 | 胶囊分别指向 host 日志、插件页、重新读取阶段 |

`standalone` 时把控制栈挂上（**任选一条**）：

```bash
export AEVAL_CONTROL_CONFIG=/abs/path/control-config.json   # 无需改 patch，重启 profile 后生效
```

```yaml
# 或：profile 的 cordis.patch.yml，按 id 覆盖 transport 行的 config（两行）
- id: aeval-broker-transport
  config: { controlConfigPath: '/abs/path/control-config.json' }
```

> 完整控制栈（含 `aeval-eval-control` 控制行）由 aeval runner 写出的 patch 插入；
> 本 bundle 的默认 patch 只插 transport 行。

### 胶囊/插件页都没有本插件？

**peer 版本窗口不匹配时，DSH 会跳过整个 bundle**（只在 stderr 留一行
`dsh: skipping profile bundle "dsh-eval-control": …`），客户端半区因此**根本不会挂载**——
胶囊不会出现，这不是 bug。原因在侧栏「插件」页读的那份数据里：该组合包带
`error.code = incompatible-version` 与未满足的 `peers` 异常标签。**胶囊不会替你报告
peer 失配**（它那时还不存在），插件页才会。

### 机器可读的同一件事

```bash
aeval-dsh-control-selfcheck              # 只读；--json 出机器可读报告
aeval doctor --broker-json broker.json   # 16 项体检，其中 dsh-profile 项核对 peer 窗口
```

`aeval-dsh-control-selfcheck` 的真实输出（本机，未配置控制栈）：

```text
dsh-eval-control self-check — mode: standalone
  [ok] node            v22.21.0
  [ok] session-reader  /…/dsh-eval-control/dist/session_reader.js
  [ok] config          none — standalone (nothing is mounted, no model call is redirected)
  hint: set --config <path> or AEVAL_CONTROL_CONFIG to check a configured deployment
```

---

## ② 跑一次评测：一条命令 → `report.md`

```bash
# 准备（一次）：aeval + 一份编译好的控制栈 + 宿主侧 key
uv venv --python 3.12 && source .venv/bin/activate
uv pip install aeval-harbor
export DEEPSEEK_API_KEY=...          # broker 跑在宿主，不在沙箱里
# 编译好的控制栈用 ① 装到 DSH profile 的那份即可；机器上没装 DSH 时，
# 在工作区 npm install dsh-eval-control@0.2.6 再指给 controlRoot

# 跑：证书、broker spec、可信 token 计数器、run、证据软链、报告、复算、判分全部在一条命令里
aeval quickstart --backend docker --yes
```

要求：Python ≥ 3.12、本机 docker daemon 可达、宿主导出上游 key、一份能定位到的
编译控制栈。定位不到时 quickstart 直接拒绝并给 hint，不会静默降级。

### 先看它要做什么（一个字节都不写）

```text
$ aeval quickstart --backend docker
quickstart plan — backend=docker
  workspace  aeval-quickstart
  suite      …/suites/tbench-pilot
  agents-dir agents
steps:
   1. agents-init     write the starter declarations into agents
   2. docker-preflight probe the local docker daemon
   …
   6. broker-spec     write the broker spec
   7. run             run the suite end to end (harbor + the aeval plugin)
   …
  12. verdict         score the run with aeval's own reliability metric
nothing was written — re-run with --yes to carry this out
```

（实测：不带 `--yes` 时 workspace 目录都不会被创建；`--dry-run` 同理。）

> 上面这份是**全新机器**上的计划（所以第 1 步是 `agents-init`、套件还要派生，共 12 步）；
> [演示录像](docs/demo/recording/demo-20261012-134955.typescript) 里 agents 已声明、套件已就绪，
> 计划是 **10 步**（`docker-preflight` → … → `verdict`）。
> 计划按**工作区当前状态**裁剪：已完成的写操作（`agents-init`、TLS、计数器、broker spec、
> `run`）不再列出；仍需**检查或复用**的步骤（`docker-preflight`、套件派生的复用）会列出，
> 并在 `note:` 里说明是复用而不是重跑（已跑完的工作区再计划是 7 步）。这是幂等设计的一部分。

### 真实跑一轮（实验机 hw-lab，3 任务 × 1 尝试）

> 本节数字来自实验室验收记录 `tools/lab-e2e/evidence-quickstart-acceptance.md`
> （该目录不在本包内）：**PASS=19 / FAIL=0（6 个用例 A–F）**，由验收方用**未改动的原始车辆**
> 在独立目录复现，不是实现者的自述。其中用例 F 走的正是**真实用户路径**：把仓库自带、
> job 钉在 e2b 的套件交给 quickstart 自己派生成 docker 套件 —— 派生树 provenance 干净
> （已提交、工作树为空）、`3/3 trial(s) scored`。

退出码 0、`report.md` 生成、末行 `3/3 trial(s) scored`；同一 workspace 重跑是幂等的
（不重跑、直接重现报告）。**判成败看 `<valid>/<total> trial(s) scored`，不要看退出码**：
同一份验收里，不给上游 key 时 quickstart 退出码是 **6**（非 0）并留下真实的
`aeval_run_summary.json`（`0/3 trial(s) scored`）——"跑完了但一个试次都没判分"被当成失败，
而不是沉默的成功。

```bash
aeval doctor    # 跑之前/跑不动时先体检：只读，什么都不写
```

`aeval doctor` 是 16 项固定顺序检查，每行 `[ok|warn|fail] <id> <detail>`，非 ok 后面跟
**可复制**的 `hint:`；任一 `fail` 时退出码非 0；`--json` 出 `aeval-doctor/1` 机器可读报告。
装了控制栈的机器上的真实输出（退出码 0，节选）：

```text
$ aeval doctor --broker-json broker.json --agents-dir agents
aeval doctor — mode: active
  [ok] node               v24.20.0 (requires ^22.19.0 || >=24.0.0)
  [ok] control-dist       /…/dsh-eval-control/dist (broker_main.js, session_reader.js)
  [ok] control-deps       10 direct package(s) present
  [ok] broker-spec        …/broker.json (provider=deepseek, model=deepseek-chat, apiKeyEnv=DEEPSEEK_API_KEY)
  [ok] upstream-key       DEEPSEEK_API_KEY is exported on the host (35 chars)
  [warn] token-endpoint     probe skipped (--no-probe): http://127.0.0.1:8791/tokens/count
  [ok] listen-tls         listenHost=… with TLS (…) and CA (…)
  [ok] cert-san           SAN covers listenHost=…
  [ok] dsh-profile        /…/profiles/web/node_modules/@deepseek-ai/dsh @ 0.2.0-rc.2 (peer …)
  [ok] agents-declaration 3 declaration(s) under agents: deepagent, dsh, fakeagent
  …
```

`dsh-profile` 那一项就是「DSH 里装的本包版本是否落在 peer 窗口内」，装没装控制栈都能查；
报告头部的 `mode: active|standalone` 与插件侧用的是同一套叫法。
（上面样例走的是**手工路线**，`8791` 来自那份 `broker.json`；`aeval quickstart` 默认用 `8792`。）

> **演示已真实录制**：[docs/demo/STORYBOARD.md](docs/demo/STORYBOARD.md)
> —— 2026-10-12 在实验机 hw-lab 上实录 4.78 min（**未做任何拼接**）：
> [原始录制](docs/demo/recording/demo-20261012-134955.typescript) +
> [timing](docs/demo/recording/demo-20261012-134955.timing)。30 秒版就是倍速回放
> （只改速度，不改内容）：
>
> ```bash
> scriptreplay --divisor 8 --timing=docs/demo/recording/demo-20261012-134955.timing \
>              docs/demo/recording/demo-20261012-134955.typescript
> ```

### `--backend e2b` 的边界（必须说准）

`--backend e2b` 已接线，但实验室的 e2b 集群**不可达**（Nomad job 部署失败，零容器），
所以验收里**只验证了「缺什么就明确报什么、绝不伪造 `report.md`」，没有真跑通**
（同上：`tools/lab-e2e/evidence-quickstart-acceptance.md`，用例 E，`exit=3` +
`E2B_API_KEY is not exported …` + 无 `report.md`）。
要承诺双后端都能出报告，得先在你自己的 e2b 上跑一次。

### 轨迹证据：已修 / 仍未修 / 仍不可用（如实记录）

- **覆盖数已修**：报告现在读得到已发布的试次证据 —— 证据覆盖 `0/3` → **`3/3`**，
  总 Token **275,194**（输入 267,236 · 输出 7,958 · 缓存 252,032）、工具调用 **23 次**，
  那一次报告里**不再出现"试次目录缺失"**（出现 **0** 次；真缺目录 / 发布目录为空时这个原因
  仍会照常出现，见下面失败形态表）。真因是**读取端与写入端的 trials 路径不一致**：
  报告找 `<store 同级>/trials`，quickstart 建在 `<ws>/runs/trials`；现在三种布局都认
  （第三种 `<ws>/run/trials` 是 `aeval doctor` 提示操作者建的那种）。
  前后对照、6 个互不相同的原因串（`_missing_evidence_reason()` 的 5 个分支 + 读取器的
  `… unreadable at …`，逐字见下面失败形态表）、以及 `aeval doctor` 的 `evidence-trials`
  假警（`[fail] … will show 0/N` → `[ok] 3 trial dir(s) with a manifest`）一并见
  `tools/lab-e2e/evidence-trajectory-coverage.md`（该目录不在本包内）。
- **仍未修（独立缺陷，与本条无关）**：沙箱侧的采集钩子 `aeval-collect` 不存在（它写在套件
  `task.toml` 的 verifier 行，却不是任何已发布的可执行文件），所以日志里那条
  `Collect hook ... exited with code 127: ... aeval-collect` **仍会照常出现**。
  **它不是上面那次 `0/3` 的原因**——那次修的是「报告看错了地方」，不是「采集没做」。
- **仍不可用（账本里真的没有这两个量，不是没算）**：**首 token 时延**（ATIF step 里没有
  `first_token_ms`）与**单次通过成本**（`final_metrics.total_cost_usd` 为 `null`）。
  报告里这两项显示"不可用"是**真实状态**；修复后它们若变成有值，说明在编数字。

> **完整执行文档：[docs/MARKET-TO-REPORT.md](docs/MARKET-TO-REPORT.md)**
> ——前置条件、任务镜像、证书、排障表、可整段复制的脚本（§10）都在那里。
> 想手工接线、逐步看清楚每一环，看下面的「快速开始」。

---

## 快速开始（手工接线，8 步）

`aeval quickstart` 把下面 **④–⑧** 一条命令跑完（另含 docker 预检、TLS、
token 计数器、密封复算、判分等步骤）；**①–③ 是它开始前必须成立的前提**——
它只**校验**（缺了就明确拒绝并给 hint），并不替你装 PyPI 包 / npm 包 / sdist。
每一环都仍是可单独读、可单独跑的命令。
只有在你要改接线（换镜像、换设备、换后端）时才需要手工走。可整段复制的脚本见
[MARKET-TO-REPORT §10](docs/MARKET-TO-REPORT.md)。

```
① aeval（PyPI）   ② 控制栈（npm）   ③ 套件（PyPI sdist）   ④ 声明起点（aeval agents --init）
⑤ token 计数器     ⑥ broker spec     ⑦ aeval run            ⑧ 链证据 → 报告
```

<details>
<summary><b>展开：8 步逐条命令 + 三条"不能更省"的实测拒绝 + 失败形态表</b></summary>

`aeval run` 的 DSH flavor 通过 `deploy_control_stack` 把编译后的 `dist/` 部署进沙箱的
DSH 安装树，并注入自己生成的 patch（transport 在前、控制插件在后）。这条链路不读本包的
`cordis.patch.yml`，行为不受本包发布面影响。

**0.2.6 起，市场装的那份可以直接用**——**前提是那份真的装到了 0.2.6**：裸包名在实验机上
解析到 0.2.3（`pnpm view`/`npm view` 都报 latest=0.2.6，清缓存后仍复现，原因未定位），
0.2.3/0.2.4 那份没有内嵌依赖；请用
`dsh plugin --profile web add dsh-eval-control@0.2.6` 钉住版本（见 ①）。控制栈里被 aeval
当独立进程跑的两个入口
（`dist/broker_main.js` 模型 broker、`dist/session_reader.js` 会话读取器）已构建成
**自带依赖**的 bundle，所以装到 0.2.6 后 `dsh plugin add` 就是完整的控制栈，不用再在工作区装一份。

为什么以前不行：aeval 把这两个文件当独立 Node 进程执行，它们得自己解析
`@deepseek-ai/*`；而 pnpm 只装 `dependencies`（就一个 `@agentclientprotocol/sdk`），
13 个 `@deepseek-ai/*` 是 peer、留给 **DSH 宿主进程**提供——插件在 DSH 里工作正常，
独立进程则 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-llm'`，
该试次以"模型 broker 起不来"被整轮排除。现在这两份是进程隔离的，内联自己的副本
**正是对的**；而进程内加载的 `dist/index.js` / `dist/sandbox_entry.js` 仍然只用宿主
peer（`SessionId`、`scopeOf` 是运行时值，拿第二份会把插件踢出宿主的 realm）。

- **路线 A**：在工作区 `npm install dsh-eval-control@0.2.6` 一份，`controlRoot` 指它。
  与 DSH 怎么装无关；**机器上没装 DSH 时这是唯一可行的路线**。
- **路线 B**：`dsh plugin add` 装到 profile 里，`controlRoot` 直接写
  `~/.dsh/profiles/<profile>/node_modules/dsh-eval-control`，无需任何额外步骤。
  **≤0.2.5 的版本才需要补 8 个依赖**，补法见
  [执行文档 §2.2](docs/MARKET-TO-REPORT.md)。

两条路都实测过：`controlRoot` 直指市场那份、工作区一个 npm 包都没装，3 个试次**全部
进入判分**、封存 `recompute passed`；会话读取器也由 aeval 自己从 DSH profile 里找到。

以下步骤走路线 A，并在 `hw-lab` 上实测通过：pip 安装的 aeval + `npm install` 的控制栈，
3 个试次**全部进入判分**（有效分母 3/3、排除率 0.0%）、封存
`recompute passed`（89 个封存文件）。

> **需要 aeval ≥ 0.3.0**：`--init`、`controlRoot` 一处推导、以及"自动找到 DSH
> profile 里装的本包"都是 0.3.0 才有的。更早的版本（含 PyPI 上同为 0.2.0 的
> 那一版）必须显式给 `controlDist`，并把会话读取器路径用
> `AEVAL_DSH_CONTROL_ROOT` 或声明的 `session_reader` 指出来。

```bash
# 1. aeval（要求 Python ≥3.12；装到哪都行，旁边不需要本包的源码）
uv venv --python 3.12 && source .venv/bin/activate
uv pip install aeval-harbor

# 2. 控制栈：工作区装一份（也可以直接用 dsh plugin add 装的那份，见上；前提是装到 0.2.6）
npm install dsh-eval-control@0.2.6

# 3. 声明：装出来的 aeval 旁边没有 agents/，这条命令从包内写出起点
aeval agents --init --agents-dir agents   # _base/ + _runtime/images.yaml + dsh.yaml
aeval agents --agents-dir agents          # 应打印：1 agent declaration(s) agree ...

# 4. 可信 token 计数器：spec 设了 maxTokens 就必须有，否则 broker 拒绝启动
#    （参考实现：套件自带 suites/tbench-pilot/tools/token_count.py，契约是"永不少算"）
python3 suites/tbench-pilot/tools/token_count.py --host 127.0.0.1 --port 8791 &

# 5. spec：只有 controlRoot 一处指向本包；上游四件套 / 计数器 / TLS 都别省
cat > broker.json <<'JSON'
{
  "controlRoot": "/abs/path/to/node_modules/dsh-eval-control",
  "listenHost": "10.0.0.12",
  "listenPort": 8447,
  "listenTls": {"cert": "/abs/path/gateway.crt", "key": "/abs/path/gateway.key"},
  "controlCa": "/abs/path/ca.crt",
  "upstream": {"provider": "deepseek", "baseUrl": "https://api.deepseek.com/v1",
               "apiKeyEnv": "DEEPSEEK_API_KEY", "model": "deepseek-chat"},
  "identity": {"model": "deepseek-chat", "provider": "deepseek"},
  "limits": {"maxSteps": 60, "maxTokens": 2000000},
  "maxOutputTokens": 16384,
  "tokenCount": {"endpoint": "http://127.0.0.1:8791/tokens/count", "margin": 8}
}
JSON

# 6. 上游 key 在宿主侧（broker 跑在宿主，不是沙箱里）
export DEEPSEEK_API_KEY=...

# 7. 跑 + 链证据 + 出报告
export AEVAL_BROKER_JSON=$PWD/broker.json
aeval run --suite <套件目录> --run-dir runs/1 --store runs/1.sqlite3 \
          --agents-dir agents --harbor-cli harbor
mkdir -p runs/trials
for t in runs/1/harbor/*/*/; do [ -f "$t/collection_manifest.json" ] && \
  ln -sfn "$PWD/$t" "runs/trials/$(basename "$t")"; done
aeval report run-1 --store runs/1.sqlite3 --k 1
```

**指向本包只需要一处**：spec 的 `controlRoot`（含 `dist/broker_main.js` 的目录）。
`brokerJs` 与 `controlDist` 都由它推导，会话读取器也从它、或从 DSH profile 的安装
位置自动找到。显式写 `controlDist` 仍然优先，用于构建产物放在包外的场景。

**为什么上面的 spec 不能更省**（三条都是实测拒绝，不是建议）：

- `upstream` 少写字段 → `broker config upstream.model: invalid identifier ''`
  （`provider` / `baseUrl` / `model` / `apiKeyEnv` 四个都要）；
- 设了 `limits.maxTokens` 却没 `tokenCount` →
  `limits.maxTokens requires a trusted tokenCount source`（broker 退出码 3）；
- docker 沙箱里连 loopback → 沙箱侧 `TypeError: fetch failed` /
  `connect ECONNREFUSED 127.0.0.1:8447`，最终表现为
  `the trial's agent exposes no DSH session`。容器里的 `127.0.0.1` 是它自己，
  所以 `listenHost` 必须是**沙箱能连到的宿主机 IP**，非 loopback 监听强制 TLS。

**失败形态**（全部为实测原文，逐条对应一次真实排障）：

| 症状 | 原因 |
| --- | --- |
| `DshRunError: official DSH session reader not found` | aeval 找不到本包。设 `AEVAL_DSH_CONTROL_ROOT`、在 agent 声明的 launch kwargs 写 `session_reader`，或在 spec 里给 `controlRoot` 任一处即可 |
| `BootstrapError: … carries no controlDist and no controlRoot with a built dist/` | 既没 `controlDist` 也没编译好的 `controlRoot`。此时试次会跑成"有计量之名、无计量之实"，所以拒绝而不是降级 |
| broker 起不来，报 `upstream API key is not set` | 宿主没导出 `upstream.apiKeyEnv` 指的那个变量。**后续症状会伪装**：该试次被标 infra-invalid → 控制栈静默跳过 → 沙箱里只看到 `MISSING_CREDENTIAL`，与真正原因毫无相似之处。看 `aeval_run_summary.json` 的 `trials[*].infra_invalid_reasons` |
| `Cannot find package '@deepseek-ai/dsh-llm'` + `ERR_MODULE_NOT_FOUND` | `controlRoot` 那份没有依赖（`dsh plugin add` 的市场副本不给 peer）→ 换成 `npm install` 的那份（本文第 2 步） |
| `limits.maxTokens requires a trusted tokenCount source` | 硬预算没计数器 → 起 `token_count.py` 并在 spec 里写 `tokenCount`（本文第 4/5 步） |
| `connect ECONNREFUSED 127.0.0.1:8447`，随后 `the trial's agent exposes no DSH session` | 沙箱连不到 broker → `listenHost` 给沙箱可达的宿主机 IP，配 `listenTls` + `controlCa` |
| `no agent declaration for 'dsh' under …/agents — declare it in agents/dsh.yaml` | 还没 `aeval agents --init`，或 `--agents-dir` 指错 |
| 报告里"证据覆盖 0/N" | 已发布的试次证据没被读到。报告会写明是这 6 种里的哪一种（逐字）：`试次目录缺失`、`试次目录缺失（链接指向的试次目录不存在）`、`试次目录缺失（已发布的链接目录里没有任何条目）`、`试次目录无 collection_manifest（采集钩子 aeval-collect 未实现）`、`试次目录里没有与本试次匹配的 collection_manifest（清单的 trial_id 对不上）`，以及定位到目录但轨迹读不出时的读取器原文（`… unreadable at …`）。它接受三种布局：`<store 同级>/trials`、`<store 同级>/runs/trials`（`aeval quickstart` 用后者，见上面第 7 步）与 `<store 同级>/run/trials`（`aeval doctor` 提示的那种） |

**跑了但全被排除时，退出码仍是 `0`**（接线故障不算用例失败）。所以判断成败看
`run … sealed:` 之后那行 `<valid>/<total> trial(s) scored`——分母才是试次数；
排除率超标报告会自己警告。`aeval quickstart` 把这条契约收紧成：`valid == 0` 直接
退出码 6。

</details>

---

## 它解决什么问题

评测一个 DSH agent，靠手改配置跑会话是不可信的：参数没绑定、预算没封顶、
fork 出来的会话认不了亲、证据说不清归属。本插件把这些全部变成**声明式、
一次性、可校验**的：

- 评测开始时注入完整实验配置（`EvalControlConfig`），配置摘要（`configDigest`）
  与运行时锁（`runtime_lock_digest`）互相绑定——事后任何人无法辩称"当时参数不一样"；
- 所有模型调用经由宿主 broker 走网关租约：预算封顶、辅助调用按策略拒绝
  （`refuseAuxiliaryCalls` / `auxiliaryPolicy`），租约关闭即拒绝安装；
- fork 血统（`parentSessionId` / `parentTrialId` / `forkStep`）显式校验，
  跨会话记忆类评测才有可信基底；
- 会话记录经官方 JSONL persistence 读取，路径安全检查（拒绝符号链接、
  限定 allowed base、64KB 请求上限、类型化错误码）。

## 组成

| 模块 | 职责 |
|---|---|
| `index.ts`（Cordis 插件 `dsh-eval-control`） | 绑定配置、注入实验变量、写 bundle descriptor、`finalize` 终态锁存 |
| `sandbox_entry.ts` | 沙箱侧入口：安装 broker transport，把实验 provider 的每次模型调用路由到宿主 broker；对已关闭租约拒绝安装 |
| `variable_inject.ts` | 实验身份注入（provider / model / reasoning effort / agent options） |
| `gateway_lease.ts` · `host_broker.ts` | 网关租约（job token、调度/拒绝记录）与宿主 broker |
| `fork.ts` | fork 血统校验与会话元数据 |
| `bundle_writer.ts` | bundle descriptor（证据归属，schema 版本化） |
| `session_reader.ts` / `session_stub.ts` | 官方会话读取 / 桩会话创建（独立 bin，供 aeval 采集侧调用） |
| `token_bound.ts` · `upstream.ts` · `stop_reason.ts` | 输入 token 上限、上游 chat-completions 适配、停止原因推导 |
| `control_config_source.ts` · `control_status.ts` | 配置来源解析（内联 / `controlConfigPath` / `AEVAL_CONTROL_CONFIG`）与 `evalControlStatus` 状态服务 |
| `selfcheck.ts` | 自检命令：只读核对配置、token、路径与 broker `/info`；输出 `mode: standalone|active` |
| `client/client.js` | Web 只读诊断：对话区状态胶囊 + 侧栏「插件」页的组合包区块，读宿主 `pluginInventory/list` 与 `pluginManager/listBundles` |

独立命令（`package.json` bin）：`aeval-dsh-session-reader`、`aeval-dsh-session-stub`、
`aeval-model-broker`、`aeval-dsh-control-selfcheck`。

## 配置（EvalControlConfig）

```jsonc
{
  "run": {                        // 运行绑定：四元组互相锁死
    "run_id": "run-tbench-offline-1",
    "job_config_hash": "…",
    "config_file_sha256": "…",
    "runtime_lock_digest": "…"
  },
  "trialId": "trial-0",
  "sessionId": "…",
  "sessionRoot": "/…",            // 绝对路径、无符号链接，越界即拒
  "provider": "…", "model": "…", "reasoningEffort": "…",
  "maxSteps": 32, "maxTokens": 8192,
  "tools": { "allow": ["…"], "deny": ["…"] },
  "lineage": { "parentSessionId": "…", "parentTrialId": "…", "forkStep": 3 },
  "bundlePath": "/…/bundle.json",
  "gatewayUrl": "http://127.0.0.1:…",   // 宿主 broker
  "jobTokenFile": "/…/job-token",
  "refuseAuxiliaryCalls": true,          // 辅助调用默认拒绝
  "auxiliaryPolicy": { "…": "allow" }    // 按用途显式放行（优先于总开关）
}
```

配置按原样（as-authored）参与摘要计算，宿主组合的配置与沙箱内解析的配置
逐字段比对——**两边不一致即失败**，不做静默兼容。

除内联配置外，行配置还接受两种等价形态（解析结果与内联逐字段一致，
`configDigest` 不变）：`{ "controlConfigPath": "/abs/config.json" }` 指向
owner 写出的配置文件；或整行为空 `{}` 且设置 `AEVAL_CONTROL_CONFIG`。
两者都没有时进入 **standalone**：不挂载任何东西、不重定向模型调用，
只发布 `evalControlStatus` 状态——安装插件不会破坏一个普通 profile。

## 安装

### 作为 aeval 的控制栈（沙箱内）

`aeval run` 的 DSH flavor 通过 `deploy_control_stack` 把编译后的 `dist/`
部署进沙箱的 DSH 安装树，并注入自己生成的 patch（transport 在前、控制插件
在后）。这条链路不读本包的 `cordis.patch.yml`，行为不受本包发布面影响。

### 作为 DSH 插件（普通 profile）

```bash
dsh plugin --profile web add dsh-eval-control@0.2.6
```

也可以走 [1024 商店的插件页](https://deepseek1024.com/plugins/xyrrrrr-r/dsh-eval-control) 的追踪安装器——`dsh1024 plugin …` 就是官方
`dsh plugin …` 换了名字，参数原样转发，额外记录一条匿名安装结果用于该店的安装量排名：

```bash
npm install -g dsh1024 && dsh1024 plugin --profile web add dsh-eval-control@0.2.6
```

目录收录：本包已在 [1024 商店](https://deepseek1024.com/plugins/xyrrrrr-r/dsh-eval-control) 的 `dev` 分类下；
仓库带有 [`dsh-plugin` 主题](https://github.com/topics/dsh-plugin)，[dshfind](https://dshfind.com/zh/plugins)
会在每日主题同步后自动索引，顶部 dshfind 徽章在收录前显示 `not listed` 属正常，收录后自动有值。

```bash
npm install dsh-eval-control    # Node ^22.19 || >=24；含编译产物、类型 shim 与四个 bin 命令
aeval-dsh-control-selfcheck --config /abs/path/control-config.json   # 只读自检；加 --json 出机器可读报告
```

变更见 [CHANGELOG](CHANGELOG.md)；语义化版本（0.x 实验期：minor 版本可能含破坏性
变更，均在 CHANGELOG 显式列出）。

## 构建与测试

从源码构建（要求 Node `^22.19.0 || >=24.0.0`）：

```bash
npm install
npm run build     # pull-neutral + tsc：从 aeval/control 组合部署产物
npm test          # build + 测试编译 + node --test
```

`scripts/pull-neutral.mjs` 说明：broker 集群的**中立源码真身在 aeval 仓库的
`control/`（aeval-control）**——它从本包字节一致地抽出，供所有 agent 控制栈
共享。构建时若存在同级 `../aeval/control/dist`（或 `AEVAL_CONTROL_DIST` 指向），
则把中立运行时的 `.js` 组合进本包 `dist/`、`.d.ts` 落回 `src/`；若不存在
（独立 clone），已提交的 shim 与 dist 保证**独立可构建**，新鲜度测试会在
同级仓库存在时重新校验字节一致。

## aeval 如何消费本包

- `aeval run` 的 DSH flavor 通过 `deploy_control_stack` 把编译后的 `dist/`
  部署进沙箱的 DSH 安装树（`sandbox_entry` 在前、控制插件在后挂载）；
- 采集侧的官方 session reader 按以下顺序发现：`node_modules/dsh-eval-control/dist/session_reader.js`
  → 环境变量 `AEVAL_DSH_SESSION_READER`（配合 `AEVAL_DSH_CONTROL_ROOT`）；
  找不到就报错拒跑，绝不静默降级；
- 会话记录读取结果进入采集清单，与运行时锁一起被证据门逐一 sha256 校验。

## 与 aeval 的关系

```
aeval (Python)                     评测编排 · 判分 · 密封 · 报告
├── control/  (aeval-control)      agent 中立控制面：host broker + gateway lease
└── agents/dsh/                    DSH 适配器：部署并消费 ↓
dsh-eval-control (本包, TypeScript) DSH 形态控制插件：变量注入 · 血统 · descriptor
```

本包只保留 DSH 特有部分；一切 agent 通用的控制面逻辑归 aeval-control，
避免两份实现漂移。

## 测试

`test/` 覆盖：配置解析与摘要、变量注入、fork 血统、证据/bundle 写入、
session reader/stub 的路径安全拒绝、中立 shim 新鲜度、环境回归，以及发布面
自身的守卫（bundle 声明与补丁文件、`files`/`exports` 白名单、locale/icon、
peer 范围与构建期 pin 的分离、selfcheck 作为真实进程跑、standalone 与
fail-closed 两条路径，以及 Web 状态胶囊/插件页区块的渲染与只读性）。
`npm test` 全绿是提交前提。

```bash
npm test    # build + 测试编译 + node --test，全部用例
```

构建单元由中立运行时（`aeval/control`）组合而成，取用顺序是 `$AEVAL_CONTROL_DIST`
→ 同级 `../aeval/control/dist` → 仓库内的 `vendor/neutral/`。`dist/` 本身不入库，
所以 `vendor/neutral/` 正是**独立 clone 也能构建并跑全绿**的那一份；只有同级
checkout 存在时，`src/` 里的类型 shim 才会被真实构建刷新。中立产物变化后同步一次：

```bash
npm run vendor:neutral    # 需同级 ../aeval/control 已 npm run build
```

想接入自己的 agent、写自己的评测套件，或弄清报告里每个指标的含义，见 aeval 的
使用者指南：[写一个评测套件](https://github.com/xyrrrrr-r/aeval/blob/main/docs/guides/writing-a-suite.md) ·
[接入一个新的 agent](https://github.com/xyrrrrr-r/aeval/blob/main/docs/guides/adding-an-agent.md) ·
[指标语义与判分规则](https://github.com/xyrrrrr-r/aeval/blob/main/docs/guides/metric-semantics.md)。

## 发布

```bash
npm login       # 一次性；开了 2FA 的账号按提示输入 OTP（或使用 automation token）
npm publish     # prepublishOnly 会先自动 build + 全量测试，任何失败即中止
```

发布面的两条约定：

- `@deepseek-ai/*` 通过 `peerDependencies` 给出宿主版本窗口
  （`>=0.1.7-alpha.1 <0.1.8-0 || >=0.1.8-alpha.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0`、
  `cordis ^4.0.3`、`schemastery ^3.18.3`），精确 pin 留在 `devDependencies`
  作为构建记录——profile 因此复用宿主自己的那一份 Harness，而不是再装一套；
  peer 范围不满足时 DSH 会**跳过整个 bundle**（仅 stderr 提示），所以改范围
  必须真装一次验证。
- 写窗口时注意预发布规则：node-semver 只在范围里存在**同一
  `major.minor.patch` 元组上带预发布标签的比较符**时才放行该预发布版本。
  `<0.2.0` 这类上界不带预发布标签，因此静默排除 `0.2.0-rc.2`——宿主会跳过
  整个 bundle，看起来像插件没装。窗口按元组分段正是为此：`0.1.7` 与 `0.1.8`
  段各自放行自己的预发布，`0.2.x` 段用 `>=0.2.0-0 <0.3.0-0` 放行 **0.2.0 自己的预发布**
  （如 `0.2.0-rc.1`）与整条 0.2 稳定线；**同一条 0.2 线里 `0.2.1` 及以上的预发布**
  （如 `0.2.1-rc.1`、`0.2.5-rc.1`）**不会命中**，需再补一条对应元组的分支；
  `0.3.0` 及以上属于另一条线（上界 `<0.3.0-0` 已排除）。判据可复现
  （在包根目录跑；`semver` 不在本包声明里，是 dev 依赖的传递依赖 hoist 上来的，换依赖树可能就没有——解析不到时用 `require("./node_modules/semver")`）：

  ```bash
  node -e 'const s=require("semver"),R=process.argv[1];
    for(const v of ["0.1.7-alpha.1","0.2.0-rc.1","0.2.1-rc.1","0.2.5-rc.1","0.2.5","0.2.0","0.3.0-rc.1","0.3.0","0.1.9"])
      console.log(v.padEnd(14), s.satisfies(v,R)?"MATCH":"no match")' \
    '>=0.1.7-alpha.1 <0.1.8-0 || >=0.1.8-alpha.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0'
  # 输出（2026-10-13 实测）：0.1.7-alpha.1 MATCH · 0.2.0-rc.1 MATCH · 0.2.1-rc.1 no match
  #   0.2.5-rc.1 no match · 0.2.5 MATCH · 0.2.0 MATCH · 0.3.0-rc.1 no match · 0.3.0 no match · 0.1.9 MATCH
  ```
- 收录进插件市场时，静态审查只读 `package.json` 的 `dsh.bundle.patch` 与
  同 revision 的补丁文件；npm 上 latest manifest 声明 `dsh.bundle` 才会
  出现安装命令。本包两者都已具备。

## License

Apache-2.0，见 [LICENSE](LICENSE)。
