# 演示：两段真实录制 + 分镜

两段都是**真实执行、一次连续 `script` 会话录下来的原始字节**，没有拼接、没有补录、
没有事后编辑；两段各自独立，**不存在把一段的输出剪进另一段**的情况。

> **这是什么格式**：两段都是 `script(1)` 的**终端录制**，每段由「typescript（原始字节）」+
> 「timing（时间轴）」两个**文本文件**组成——**不是视频**：双击打不开，系统也不会给它关联播放器。
> macOS 不自带 `scriptreplay`（它属于 util-linux），所以播放请用仓库里自带的零依赖播放器
> [`recording/replay-typescript.py`](recording/replay-typescript.py)（只用 python3 标准库）。

| | 录制 A：主 demo（4 幕） | 录制 B：市场安装（短片） |
| --- | --- | --- |
| 内容 | 装控制栈 → 看 mode → 一条命令 → `report.md` | 装 dsh/pnpm → `dsh plugin add` → 看 mode |
| 文件 | `recording/demo-20261012-134955.*` | `recording/market-install-20261012-140526.*` |
| 实录时长 | 286.8 s（4.78 min） | 15.9 s |
| 30 秒版 | 零依赖播放器 `--divisor 8`：**实测 40 s** | 原速（15.9 s）即可 |

---

## 录制 A：主 demo（4 幕，2026-10-12，hw-lab）

| 产物 | 说明 |
| --- | --- |
| [`recording/demo-20261012-134955.typescript`](recording/demo-20261012-134955.typescript) | 原始终端录制（644790 字节，含 harbor 的进度条刷新） |
| [`recording/demo-20261012-134955.timing`](recording/demo-20261012-134955.timing) | 配套时间轴（2015 段） |
| [`recording/replay-typescript.py`](recording/replay-typescript.py) | 零依赖播放器/校验器（纯标准库，`--divisor` 语义与 `scriptreplay` 相同） |
| [`recording/session.sh`](recording/session.sh) | 录制器按同一组参数生成的会话脚本（命令与终端录制逐条对照一致） |

```bash
# 首选：零依赖（只用 python3 标准库，macOS/Linux 都行）
python3 docs/demo/recording/replay-typescript.py --divisor 8 \
  docs/demo/recording/demo-20261012-134955.timing \
  docs/demo/recording/demo-20261012-134955.typescript
# 原速就去掉 --divisor 8；10 倍速用 --divisor 10。
# 不看回放、只核对"这两个文件配不配对、有没有被截断"：
python3 docs/demo/recording/replay-typescript.py --verify \
  docs/demo/recording/demo-20261012-134955.timing \
  docs/demo/recording/demo-20261012-134955.typescript
```

上面 `--divisor 8` 那条**本机实测 40 s**（理论 286.8 ÷ 8 ≈ 35.9 s，差值来自 2015 段的
逐段调度开销），输出 **644665** 字节、退出码 0。

> **备选是 `scriptreplay`，但它来自 util-linux，macOS 不自带**（本机 `which scriptreplay`
> → **NOT FOUND**）。要用就先装：`brew install util-linux`，再跑
> `"$(brew --prefix util-linux)/bin/scriptreplay" --divisor 8 --timing=<timing> <typescript>`
> （Intel 机器 brew 前缀是 `/usr/local`，Apple Silicon 是 `/opt/homebrew`）。
> **本机没有装 util-linux，所以这条备选路径没有实机验证**——首选那条是实跑过的。

### 完整性：为什么说"录制是好的"

`script(1)` 的产物 = 头行 + timing 覆盖的正文 + 换行 + 尾行。字节账目严丝合缝
（文件长度用 `wc -c` 核过）：

| 终端录制 | 头行 | 正文（= timing 覆盖） | `\n` + 尾行 | 合计 |
| --- | --- | --- | --- | --- |
| A 主 demo | 125 | 644599 | 66 | **644790** ✓ |
| B 短片 | 125 | 6012 | 66 | **6203** ✓ |

`--verify` 会从 timing 逐段重建正文并**逐字节**比对：两对都输出
`OK: timing reconstructs the body byte for byte`（两对均本机实跑，退出码 0）。
反向也验过——故意交叉两对文件（timing A + typescript B）→ 退出码 **1** +
`FAIL: timing covers 644599 bytes but the body is 6012 — the pair does not belong together`；
喂 `.cast` → 退出码 **1** + 提示改用 `asciinema play`。所以"能通过校验"不是空话。

> **已知局限（播放端）**：`script(1)` **不记录终端尺寸**，所以回放本身无法还原宽度。
> 录制时的宽度可以**离线量出来**：单次重绘宽度（`\r` 之间的片段）最大值**恰为 80 列**
> （出现 501 次），故当时终端是 **80 列**宽——依据与"325 是错的"见下面「GIF」一节。
> 即便如此，回放仍不知道尺寸，宽度不同时 harbor 进度条重绘**可能错行**。
> 回放是**逐字节复现当时的输出**，不是重跑一遍。

### 这一次执行真的跑了什么（时间轴由 timing 文件累计推得）

| 时间 | 幕 | 录到的命令 | 录到的关键输出 |
| --- | --- | --- | --- |
| 0.0 → 79.4 s | 1/4 装控制栈 | `npm install --silent dsh-eval-control@0.2.6` | `(装好版本：0.2.6)` |
| 79.4 s | 2/4 看 mode | `./node_modules/.bin/aeval-dsh-control-selfcheck` | `dsh-eval-control self-check — mode: standalone` + `hint:` |
| 79.4 → 79.8 s | 3/4 先看计划 | `aeval quickstart --backend docker --suite … --agents-dir … --workspace … --dry-run` | **10 步**计划（本次 agents 已声明、套件已就绪，故没有 `agents-init`/派生步骤）+ `nothing was written — re-run with --yes to carry this out` |
| 79.8 → 286.8 s | 4/4 真跑 | 同上去掉 `--dry-run`、加 `--yes` | 证书 → spec → 计数器 → run → 证据链 → report → 复算 → 判分；末行 **`3/3 trial(s) scored`** |
| 286.8 s | 报告开头 | `sed -n '1,12p' …/ws/report.md` | 试次 3、有效分母 3、通过 2 失败 1、`pass@1：0.6667`、排除率 `0.0%` |

同一次执行的环境事实（录制外的留证）：套件 git `HEAD=ca6600d`、工作树 `clean`；
`--dry-run` 之后 workspace 目录仍不存在；真跑退出码 0。

### 录制 A 没有包含什么

- **第 1 幕是 npm 路线，不是 `dsh plugin add`**（当时实验室还没有 dsh/pnpm）；市场安装那条路
  由**录制 B** 单独补上，两段互不拼接。
- **Web 状态胶囊不在终端录制里**：那是浏览器界面，终端录制录不到。录制里"看到 mode"用的是
  selfcheck（同一件事的机器可读形态）。
- **e2b 后端不在终端录制里**：实验室 e2b 集群不可达。
- 终端录制里没有出现那条已被修复的死变量 hint：已 grep 确认 **0 次**；产品文案里现在也不存在这个名字。
- 终端录制拍于**轨迹证据覆盖修复之前**：那次 run 的 `report.md` 里"轨迹采集"块仍是 `0/3`（读取端
  路径不一致，见 README 的「轨迹证据：已修 / 仍未修 / 仍不可用」）。录制里只取了报告**前 12 行**
  （不含该块），所以 README 里修复后的 `3/3` 与这段终端录制不矛盾；要复核 `3/3` 请看
  `tools/lab-e2e/evidence-trajectory-coverage.md`，不是这段终端录制。

---

## 录制 B：市场安装（2026-10-12，hw-lab）

| 产物 | 说明 |
| --- | --- |
| [`recording/market-install-20261012-140526.typescript`](recording/market-install-20261012-140526.typescript) | 原始终端录制（6203 字节） |
| [`recording/market-install-20261012-140526.timing`](recording/market-install-20261012-140526.timing) | 配套时间轴（**212 段**） |
| [`recording/session-market.sh`](recording/session-market.sh) | 被录的那份会话脚本 |

```bash
# 播放器同上（首选零依赖；见 §录制 A 的字节账目与已知局限）
python3 docs/demo/recording/replay-typescript.py \
  docs/demo/recording/market-install-20261012-140526.timing \
  docs/demo/recording/market-install-20261012-140526.typescript
# 15.9 s，原速即可；`--verify` 同样适用于这一对
```

> 备选仍是 util-linux 的 `scriptreplay`（macOS 不自带，需 `brew install util-linux`）。

### 这一次执行真的跑了什么（15.9 s）

1. `export PATH=<npm 全局 bin>:$PATH` —— 这台机器的 npm 前缀
   （`/root/e2e/tools/node-v24.20.0-linux-arm64`）不在 PATH 上，`npm i -g` 装出来的
   命令默认**不可执行**。
2. `npm i -g --allow-scripts=… pnpm @deepseek-ai/dsh` → `added 540 packages`，
   `pnpm --version` → **12.11.2**，`dsh --version` → **0.2.0-rc.2**（npm 11.19.0）。
   `--allow-scripts` 用的是 npm 自己给出的清单：默认策略会拦掉 `pnpm` 的 install script。
3. `export DSH_HOME=<demo 目录>` —— 全程不碰默认 `~/.dsh`。
4. `dsh plugin --profile web add dsh-eval-control`（终端录制里就是这条**裸包名**命令；
   因为它会解析到 0.2.3，README ① 现在建议显式写 `@0.2.6`）→ 录到
   `dsh: initialized profile web at …/dsh-home/profiles/web` 与 `+ dsh-eval-control 0.2.3`。
5. 读回 profile 里的那份：`0.2.3`。
6. profile 默认 `autoInstallPeers: false`，插件声明的 peer 不跟着装 → 补上
   （`pnpm config set auto-install-peers true --location project` + `pnpm install`，
   录到 `Packages: +532` 与 pnpm 的 `ERR_PNPM_IGNORED_BUILDS` 提示）。
7. `./node_modules/.bin/aeval-dsh-control-selfcheck` →
   **`dsh-eval-control self-check — mode: standalone`** + 3 行 `[ok]` + `hint:`。

### 录制 B 的边界（必须说准）

- **终端录制看不到 Web 胶囊**（那是浏览器界面）。这一段只能证明
  **"安装命令真的把包装进了 profile"**（profile 初始化日志 + 依赖行 + 从 profile 的
  `node_modules` 读回版本号），**不能**声称演示了插件页点击或胶囊渲染。
- 这一段证明的是**安装动作**；胶囊/插件页的实机链路仍按 A2（task-3）的证据口径描述。

### 录制 B 顺带测出的两个真实缺口（都不是本仓库能修的）

1. **装到的是 0.2.3，不是最新的 0.2.6 —— 原因已定位为 pnpm 的供应链策略**
   （**与 DSH、registry、缓存都无关**）：pnpm ≥11 的 `minimumReleaseAge`
   **默认 1440 分钟**，发布不满 1 天的版本不会被解析
   （[pnpm 文档](https://pnpm.io/supply-chain-security)）。录片当天
   0.2.4/0.2.5/0.2.6 发布都不到 24 小时（22–23 h），0.2.3 刚好超过（26.6 h），
   所以裸包名落到 0.2.3；同一台机器上的 A/B：
   `pnpm add dsh-eval-control` → 0.2.3、
   `pnpm add dsh-eval-control --config.minimumReleaseAge=0` → **0.2.6**、
   `pnpm add dsh-eval-control@0.2.6` → **0.2.6**。
   ⇒ **出路：显式钉版本**（README ① 与 MARKET §2.3 已按这条写）。
2. **`autoInstallPeers: false` 让插件装完也加载不了**：补 peer 之前 selfcheck 直接
   `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'`
   （插件把这个包声明为 peer，profile 不会自动装）。

---

## GIF（渲染产物，不是新录制）

| 文件 | 大小 | 尺寸 | 时长 | 来源 |
| --- | --- | --- | --- | --- |
| [`recording/demo-30s.gif`](recording/demo-30s.gif) | 2,033,985 字节（2.03 MB） | 790×694 | 8 倍速 ≈36 s | 录制 A 的 typescript + timing |
| [`recording/market-install.gif`](recording/market-install.gif) | 578,570 字节（0.58 MB） | 790×694 | 15.9 s 原速 | 录制 B 的 typescript + timing |

**定性**：GIF 是**渲染产物**，真相源仍是上面那对 `script(1)` 录制（四个哈希见文首）。
GIF **不能替代逐字节校验**——要证明"文件没坏"看 `--verify`，GIF 只负责"能直接看一眼"。
两个文件是用 `cp` 从生成处搬进来的，**未重新渲染**（重渲染会得到不同字节，
也就无法再用下面那套判据复用同一批字节）。

### 渲染命令（实跑过的那组）

```bash
# 1) typescript + timing → asciinema v2 .cast
python3 tools/lab-e2e/typescript-to-cast.py \
    dsh-eval-control/docs/demo/recording/demo-20261012-134955.timing \
    dsh-eval-control/docs/demo/recording/demo-20261012-134955.typescript \
    -o demo-20261012-134955.cast --width 80 --height 30

# 2) agg（asciinema 官方渲染器，v1.9.0 静态二进制）→ GIF
./agg --font-family "Menlo,Hiragino Sans GB" --theme monokai \
      --speed 8 --idle-time-limit 1 demo-20261012-134955.cast demo-30s.gif
# 市场那段：--speed 1
```

`agg` 是 **15 MB 的静态二进制，没有提交进仓库**（复现时下到临时目录即可）。

### 两个坑（都实测过，而且**都不报错**）

**1. 终端宽度 = 80 列 —— 是量出来的，不是猜的**

`script(1)` 不记录尺寸，只能离线量。**朴素量法会得到 325 列，那是错的**：真实终端把长行
**折行**了，离线分析又把折行后的内容拼回一条"逻辑行"（那条 325 字符的行是 pytest 输出里的
`where ... = 'Subject: O = DevOps Team...'`）。正确量法是看**单次重绘宽度**（`\r` 之间的片段），
因为一次重绘就是"此刻屏幕上这一行"：

```text
demo   单次重绘宽度 top: 74(1474 次) 55(717) 80(501) 60(262) 67(212) …
       最大值 80   ← 顶到 80 就再没超过
market 最大值 78
```

最大值**恰为 80**，所以取 80 列；GIF 也是按 `--width 80 --height 30` 渲染的。

**2. `agg` 在 macOS 上认不出 `PingFang SC` —— 会静默渲染成缺字方块**

它不报错、退出码 0、GIF 照样生成，**只是中文全变成豆腐块**。判据（可复现、**不需要看图**）：
把同一个含中文的小 cast 渲染两次，一次字体写 `Menlo,PingFang SC`，一次写一个根本不存在的
`Menlo,NoSuchFontZZZ`；**两次输出逐字节相同 ⇒ 那个字体名根本没被解析到**。

| 字体名 | agg 是否认得 |
| --- | --- |
| `PingFang SC` / `PingFang` | **不认**（输出与"不存在字体"基线逐字节相同） |
| `Arial Unicode MS` / `Noto Sans CJK SC` | 不认 |
| **`Hiragino Sans GB`** | **认得**（最终采用） |
| `Heiti SC` / `STHeiti` / `Songti SC` / `Hiragino Sans` / `Apple SD Gothic Neo` | 认得 |

并且验证了"认得"是真的提供了字形，而不是碰巧变了字节：
`Menlo,Courier`（无 CJK）→ 2535 字节（＝缺字基线）；
`Menlo,Hiragino Sans GB` → 3038 字节；
`Menlo,Heiti SC` → 2876 字节（与前两者都不同）。

**为什么必须用判据而不是比大小**：字体写错的那版 GIF 是 2,014,433 字节，正确版是 2,033,985
字节——**只差约 1%，肉眼比大小看不出来**。

> **没有目视确认**：作者与交付者当前都**无法读图**，所以这里只写可判定的
> "字体被解析到、CJK 字形确实由该字体提供"，**不写**"画面好看/排版正确"这类结论。

### 一条既有的发布面限制（GIF 因此在 npmjs 上不显示）

`package.json` 的 `files` 白名单是
`['dist','src','client','locale','icon.svg','cordis.patch.yml','README.md','CHANGELOG.md','LICENSE']`
—— **`docs/` 不发布**。于是：好处是这 2.6 MB 的 GIF（以及 651 KB 的终端录制）**不会**让
`npm install` 变大；代价是 **npm 只发布白名单内的文件，README 里指向 `docs/` 的相对链接在
npmjs 上解析不到**（既有问题，不是这次引入的，GIF 只是又一处）。

README 里因此用**相对链接**而不是绝对 GitHub 链接：相对链接在仓库/GitHub 上天然有效，而绝对
`raw.githubusercontent.com` 链接**现在会 404**——这两个 GIF 还没提交推送，本次核对实测
`raw.githubusercontent.com/xyrrrrr-r/dsh-eval-control/main/docs/demo/recording/demo-30s.gif`
→ **HTTP 404**。要让 GIF 在 npmjs 上也显示，得二选一（都属于发布面决定）：把 `docs/` 加进
`files`，或改用绝对 GitHub 链接**并先把资源推送上去**。

---

## 可复现的录制方式

```bash
# 录制 A：有 DSH CLI 的机器 = dsh plugin add；没有 dsh/pnpm 的机器 = npm 路线（本次）
INSTALL_MODE=npm OUT_DIR=… SUITE=<docker 套件> AGENTS_DIR=<agents> WORKSPACE=<新 workspace> \
  docs/demo/record-demo.sh
# 录制 B：市场安装短片
DEMO_DSH_HOME=<自己的 DSH_HOME> OUT_DIR=… docs/demo/record-demo.sh --segment market
```

`record-demo.sh` 只录制真实执行的输出：按 `asciinema`（有则用）→ `script`
（util-linux/BSD 自动适配）选**录制器**，产物落 `OUT_DIR/`，被录的会话留在
`OUT_DIR/session.sh`；录制器写不出非空文件时报错退出，不拿空产物冒充成功。

> **注意自适应的只是录制端。** 产出的 typescript/timing 是跨平台文本，但**播放端需要播放器**：
> macOS 没有 util-linux 的 `scriptreplay`，这正是"拿到的 `.typescript` 双击打不开、照文档又
> 播不了"的根因。播放请用 `docs/demo/recording/replay-typescript.py`（零依赖，见文首说明）。

## 实验机资源使用（照 Lead 的授权条件）

- **两段录制都持锁执行**（`tools/lab-e2e/lab-run.sh`，等 aeval-core 让出 `eval.lock` 后进入）；
  工作目录 `/root/e2e/accept/demo/`（自建），未触碰 `/root/.dsh`、`/root/e2e/lab-current`、
  `/root/e2e/runs`、`/root/e2e/gateway`。
- 录制 A 的真实 quickstart **只跑了一轮**（3 试次）；计划幕用 `--dry-run`（零成本）。
- 录制 B 期间为定位"为什么会装到 0.2.3"做了 3 次一次性探测（各自独立的临时 DSH_HOME，
  跑完即弃），这几次**没带锁**——它们不碰 docker、不碰 API、不碰 broker。录制本身带了锁。
- 录制 B 在实验机上留下**持久改动**：`npm i -g` 装了 `pnpm@12.11.2` 与
  `@deepseek-ai/dsh@0.2.0-rc.2`（约 540 个包，落在 npm 全局前缀
  `/root/e2e/tools/node-v24.20.0-linux-arm64`，该目录不在默认 PATH 上）+
  pnpm store `/root/.local/share/pnpm/store/v11` + 一个演示 profile
  `/root/e2e/accept/demo/dsh-home`（534 个包）。
