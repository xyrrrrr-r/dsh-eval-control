# 演示：两段真实录制 + 分镜

两段都是**真实执行、一次连续 `script` 会话录下来的原始字节**，没有拼接、没有补录、
没有事后编辑；两段各自独立，**不存在把一段的输出剪进另一段**的情况。

| | 录制 A：主 demo（4 幕） | 录制 B：市场安装（短片） |
| --- | --- | --- |
| 内容 | 装控制栈 → 看 mode → 一条命令 → `report.md` | 装 dsh/pnpm → `dsh plugin add` → 看 mode |
| 文件 | `recording/demo-20261012-134955.*` | `recording/market-install-20261012-140526.*` |
| 实录时长 | 286.8 s（4.78 min） | 15.9 s |
| 30 秒版 | `scriptreplay --divisor 8` ≈ 36 s | 原速即可 |

---

## 录制 A：主 demo（4 幕，2026-10-12，hw-lab）

| 产物 | 说明 |
| --- | --- |
| [`recording/demo-20261012-134955.typescript`](recording/demo-20261012-134955.typescript) | 原始终端录制（644 KB，含 harbor 的进度条刷新） |
| [`recording/demo-20261012-134955.timing`](recording/demo-20261012-134955.timing) | 配套时间轴（2015 段） |
| [`recording/session.sh`](recording/session.sh) | 录制器按同一组参数生成的会话脚本（命令与录像逐条对照一致） |

```bash
# 原速
scriptreplay --timing=docs/demo/recording/demo-20261012-134955.timing \
             docs/demo/recording/demo-20261012-134955.typescript
# 30 秒版：8 倍速 ≈ 36 s，10 倍速 ≈ 29 s（divisor = 倍速）
scriptreplay --divisor 8 --timing=docs/demo/recording/demo-20261012-134955.timing \
             docs/demo/recording/demo-20261012-134955.typescript
```

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
- **Web 状态胶囊不在录像里**：那是浏览器界面，终端录制录不到。录像里"看到 mode"用的是
  selfcheck（同一件事的机器可读形态）。
- **e2b 后端不在录像里**：实验室 e2b 集群不可达。
- 录像里没有出现那条已被修复的死变量 hint：已 grep 确认 **0 次**；产品文案里现在也不存在这个名字。
- 录像拍于**轨迹证据覆盖修复之前**：那次 run 的 `report.md` 里"轨迹采集"块仍是 `0/3`（读取端
  路径不一致，见 README 的「轨迹证据：已修 / 仍未修 / 仍不可用」）。录像只取了报告**前 12 行**
  （不含该块），所以 README 里修复后的 `3/3` 与这段录像不矛盾；要复核 `3/3` 请看
  `tools/lab-e2e/evidence-trajectory-coverage.md`，不是这段录像。

---

## 录制 B：市场安装（2026-10-12，hw-lab）

| 产物 | 说明 |
| --- | --- |
| [`recording/market-install-20261012-140526.typescript`](recording/market-install-20261012-140526.typescript) | 原始终端录制（6.2 KB） |
| [`recording/market-install-20261012-140526.timing`](recording/market-install-20261012-140526.timing) | 配套时间轴（26 段） |
| [`recording/session-market.sh`](recording/session-market.sh) | 被录的那份会话脚本 |

```bash
scriptreplay --timing=docs/demo/recording/market-install-20261012-140526.timing \
             docs/demo/recording/market-install-20261012-140526.typescript
```

### 这一次执行真的跑了什么（15.9 s）

1. `export PATH=<npm 全局 bin>:$PATH` —— 这台机器的 npm 前缀
   （`/root/e2e/tools/node-v24.20.0-linux-arm64`）不在 PATH 上，`npm i -g` 装出来的
   命令默认**不可执行**。
2. `npm i -g --allow-scripts=… pnpm @deepseek-ai/dsh` → `added 540 packages`，
   `pnpm --version` → **12.11.2**，`dsh --version` → **0.2.0-rc.2**（npm 11.19.0）。
   `--allow-scripts` 用的是 npm 自己给出的清单：默认策略会拦掉 `pnpm` 的 install script。
3. `export DSH_HOME=<demo 目录>` —— 全程不碰默认 `~/.dsh`。
4. `dsh plugin --profile web add dsh-eval-control`（录像里就是这条**裸包名**命令；
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

## 可复现的录制方式

```bash
# 录制 A：有 DSH CLI 的机器 = dsh plugin add；没有 dsh/pnpm 的机器 = npm 路线（本次）
INSTALL_MODE=npm OUT_DIR=… SUITE=<docker 套件> AGENTS_DIR=<agents> WORKSPACE=<新 workspace> \
  docs/demo/record-demo.sh
# 录制 B：市场安装短片
DEMO_DSH_HOME=<自己的 DSH_HOME> OUT_DIR=… docs/demo/record-demo.sh --segment market
```

`record-demo.sh` 只录制真实执行的输出：按 `asciinema`（有则用）→ `script`
（util-linux/BSD 自动适配）选录制器，产物落 `OUT_DIR/`，被录的会话留在
`OUT_DIR/session.sh`；录制器写不出非空文件时报错退出，不拿空产物冒充成功。

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
