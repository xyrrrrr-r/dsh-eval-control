# 从插件市场到评测报告：完整执行文档

> 目标读者：拿到 `dsh-eval-control` 之后，想在自己的机器上**真正跑完一轮 DeepSeek Harness 评测并拿到报告**的人。
> 本文所有命令都在实验机上端到端跑通过，遇到的坑与报错原文一并列出。
>
> 版本基线：`aeval-harbor 0.3.0` · `dsh-eval-control 0.2.6` · DSH CLI `0.2.0-rc.2` · Python `3.12` · Node `24`
> （0.2.3–0.2.5 只有文档变化；**0.2.6 是本文流程最省事的一版**——控制栈那两个独立进程入口自带依赖，
> 见 §2.2。本文命令在 0.2.3、0.2.4、0.2.6 上都原样跑过）
>
> **本文脚本原样跑出来的结果**（实验机 hw-lab，3 个 terminal-bench 任务）：
> `run run-demo sealed: 3 trial(s) recorded, 89 file(s) attested, recompute passed`；
> 报告：试次 3 · **有效分母 3** · 排除率 **0.0%** · 证据覆盖 **3/3** · 红线全通过；
> `aeval recompute` 通过（89 个封存文件）。逐任务 reward：`hello-world 1` /
> `sqlite-db-truncate 1` / `openssl-selfsigned-cert 0`——最后这个 0 是该任务
> verifier 自己的已知断言问题（指纹大小写 `SHA-256` vs `sha256`），与本节接线无关：
> 它同样被正常判分、证据齐全。

---

## 0. 先划清一条界限：装插件 ≠ 跑评测

这是推广时最容易误解的一点，先说清楚：

| 角色 | 是什么 | 缺了它会怎样 |
| --- | --- | --- |
| `dsh-eval-control`（本插件） | DSH 宿主侧的控制插件：变量注入、网关租约（gateway lease）、分支血缘、会话读取 | 沙箱里的 DSH 不受控，评测没有可信绑定 |
| `aeval`（编排器） | 套件/试次调度、沙箱、证据门禁、封存、判分、出报告 | **没有任何评测数字** |

只装插件，DSH 照常能用，但你**拿不到任何评测分数**——因为判分、封存、报告都在 aeval 侧。
下面这套流程 = 两条腿都装上，然后跑出报告。

全过程 8 步：

```
① aeval（PyPI）   ② 控制栈（npm）   ③ 套件（PyPI sdist）   ④ 声明起点（aeval agents --init）
⑤ token 计数器     ⑥ broker spec     ⑦ aeval run            ⑧ 链证据 → 报告
```

---

## 0.1 更快的一条路：`aeval quickstart`（8 步收成一条命令）

**如果你的目标就是"从装完到一份 report.md"，不需要照本文逐步接线**：`aeval quickstart`
把上面 **④–⑧** 一条命令跑完（另含 docker 预检、TLS、计数器、密封复算、判分），
一步一读地在计划里打印出来，`--yes` 才真的执行；**①–③（PyPI 的 aeval、npm 的控制栈、
sdist 的套件）是它开始前必须成立的前提**，它只校验、缺什么就明确拒绝并给 hint。

```bash
aeval quickstart --backend docker          # 只打印计划：一个字节都不写（连 workspace 目录都不建）
aeval quickstart --backend docker --yes    # 执行：证书 / spec / 计数器 / run / 证据链 / 报告 / 复算 / 判分
aeval doctor                               # 跑之前或跑不动时体检：只读，16 项，[ok|warn|fail] + 可复制 hint
```

实验机（hw-lab）实测（来源：实验室验收记录 `tools/lab-e2e/evidence-quickstart-acceptance.md`，
**PASS=19/FAIL=0，6 个用例 A–F**，由验收方用未改动的原始车辆独立复现）：docker 后端退出码 0、产出
`report.md`、末行 `3/3 trial(s) scored`，同一 workspace 重跑幂等；**跑完但一个试次都没判分时
退出码是 6**（不是沉默的成功）。其中用例 F 覆盖**真实用户路径**：把仓库自带、job 钉在 e2b 的
套件交给 quickstart 自己派生成 docker 套件（派生树 provenance 干净、`3/3` 判分）。

本文其余章节仍是权威细节：`quickstart` 不替代它们，只是把它们串起来。要改接线
（换镜像、换网段、换后端声明）就照 §1–§9 手工走，§10 是可直接整段复制的脚本。

⚠️ **e2b 边界**：`--backend e2b` 已接线，但实验机的 e2b 集群不可达，只验证了
"缺什么就明确报什么、绝不伪造 report.md"（同上验收记录，用例 E），**没有**端到端跑通。
要在你自己那套 e2b 上先跑一次，再对用户承诺双后端都能出报告。

---

## 1. 前置条件（逐条自查）

| 项 | 要求 | 自查命令 |
| --- | --- | --- |
| Python | ≥ 3.12 | `python3 -V` |
| Node | ^22.19 或 ≥ 24 | `node -v` |
| Docker | 本机可跑容器（用 docker 后端时） | `docker info` |
| pnpm | 装 DSH 插件需要（`dsh plugin add` 走 pnpm） | `pnpm -v` |
| DSH CLI | 目标版本已装，`dsh` 在 PATH 或已知前缀 | `dsh --version` |
| 模型上游 | OpenAI 兼容端点 + key | `env \| grep DEEPSEEK_API_KEY` |
| 网络 | 能访问 PyPI、npm、模型上游 | `curl -sI https://pypi.org/simple/ \| head -1` |

### 1.1 两个必须提前决断的事

**(a) 任务环境：`e2b` 还是 `docker`？**
实验机用的套件 `suites/tbench-pilot` 默认声明的是 **e2b**（托管沙箱，需要 e2b 账号/额度）：

```yaml
# suites/tbench-pilot/jobs/tbench-m0.yaml
environment:
  type: e2b
```

想在**本机 Docker** 上跑，把这一行改成 `type: docker`（本文后续按 docker 走）——**改完必须提交**（见 §2.5 的出处门禁）。

> 本文的 docker 路径是在 **Linux 主机**上验证的：broker 绑定主机可达 IP，沙箱直接连它。
> 在 Docker Desktop（macOS/Windows）上，容器访问宿主机通常走 `host.docker.internal`，
> 而 `listenHost` 是 broker 的**绑定地址**、不是连接别名，这条路径**未在本文验证**——
> 必要时改用 e2b 后端，或把 broker 放在与沙箱同网的可达主机上。

**(b) 任务镜像能不能拉到？**
套件里每个任务自带 Dockerfile。`suites/tbench-pilot` 的 **3 个示例任务都基于内网镜像仓**：

```
harbor:443/t-bench/base-pilot@sha256:df100e56…
```

不在该内网环境里，`docker build` 会失败。三种处理：
1. 换用你能拉到的任务（自写套件，写法见 aeval 源码仓库的 `docs/guides/writing-a-suite.md`）；
2. 把 `suites/tbench-pilot/images/bases.json` 的映射改到你自己的 `base-pilot` 镜像；
3. 显式给 `--sandbox-image <ref>@sha256:<digest> --sandbox-platform <arch>` 用你自己的镜像。

---

## 2. 安装

### 2.1 aeval（编排器）

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install aeval-harbor        # 需要 ≥ 0.3.0
python3 -c "import importlib.metadata as m; print(m.version('aeval-harbor'))"   # 确认版本
```

> `aeval` 的发布名是 `aeval-harbor`，命令与包名都是 `aeval`。**没有 `aeval --version` 这个选项**，查版本用上面这条。

### 2.2 控制栈：两条路线，选一条

broker 跑在**宿主**上、是一个独立的 Node 进程，它必须自己解析得到 `@deepseek-ai/*`。
路线 A 在工作区装一份；路线 B 直接用插件市场装的那份。

> **从 0.2.6 起，路线 B 不需要任何额外步骤。** aeval 当独立进程跑的两个入口
> （`dist/broker_main.js` 模型 broker、`dist/session_reader.js` 会话读取器）已构建成
> **自带依赖**的 bundle，所以 `dsh plugin add` 装完就是完整控制栈：`controlRoot` 直接写
> `~/.dsh/profiles/<profile>/node_modules/dsh-eval-control` 即可。
> 下面"补依赖"那一节只对 **≤0.2.5** 有意义——那几版把 13 个 `@deepseek-ai/*` 全留给了
> DSH 宿主（正确的 peer 设计），而独立进程解析不到。进程内加载的 `dist/index.js` /
> `dist/sandbox_entry.js` 至今仍然只用宿主 peer，插件在 DSH 里的行为没有变。

**路线 A（默认，最稳）：在工作区装一份**

```bash
npm install dsh-eval-control@0.2.6        # → ./node_modules/dsh-eval-control
```

spec 的 `controlRoot` 指 `./node_modules/dsh-eval-control`。这份自带全部 `@deepseek-ai/*`
依赖，与 DSH 怎么装无关——**机器上没装 DSH 时，这是唯一可行的路线**。

**路线 B：就用插件市场装的那份**

为什么默认不行：`dsh plugin add` 走 pnpm，只装 `dependencies`（就一个
`@agentclientprotocol/sdk`），另外 13 个 `@deepseek-ai/*` 是 peer，设计上由 **DSH 宿主
进程**提供——插件在 DSH 里工作正常，安装时那句 `Issues with peer dependencies found`
是预期现象。但 broker 是独立进程，解析不到就启动失败：

```
ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-llm'
  imported from .../node_modules/dsh-eval-control/dist/broker_main.js
```

dist 里真实 import 的只有 **8 个包**（不是 13 个），补它们就够：

```
dsh-llm · dsh-session · schemastery · dsh-session-persistence
dsh-session-persistence-jsonl · dsh-scope · cordis · dsh-tools
```

三种补法任选其一（`$PROFILE` = 你装插件的那个 profile 目录；下例宿主版本为 `0.2.0-rc.2`，
按 `dsh --version` 换成你的——peer 窗口是 `>=0.2.0-0 <0.3.0-0`）：

**B1 用 pnpm 加成真依赖**（联网一次，最正规；后续插件操作不会清掉它）

```bash
PROFILE=~/.dsh/profiles/<profile>
cd "$PROFILE"
pnpm add @deepseek-ai/dsh-llm@0.2.0-rc.2 @deepseek-ai/dsh-session@0.2.0-rc.2 \
  @deepseek-ai/schemastery@3.18.4 @deepseek-ai/dsh-session-persistence@0.2.0-rc.2 \
  @deepseek-ai/dsh-session-persistence-jsonl@0.2.0-rc.2 @deepseek-ai/dsh-scope@0.2.0-rc.2 \
  @deepseek-ai/dsh-tools@0.2.0-rc.2 @deepseek-ai/cordis@4.0.4
```

**B2 零网络：从 DSH 安装软链**（DSH 安装里这些包本来就是 npm-flat 装好的，软链后
Node 按 realpath 解析，传递依赖仍在原地齐）

```bash
DSHD=<dsh 安装前缀>/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
mkdir -p "$PROFILE/node_modules/@deepseek-ai"
for p in dsh-llm dsh-session schemastery dsh-session-persistence \
         dsh-session-persistence-jsonl dsh-scope dsh-tools cordis; do
  ln -sfn "$DSHD/$p" "$PROFILE/node_modules/@deepseek-ai/$p"
done
```

> **B2 不持久，实测结论**：软链能立即生效，但它在 pnpm 眼里是 *extraneous* 目录。
> 只要插件管理器再动一次这个 profile（装/升/换插件都会跑 `pnpm install`），
> `dsh-eval-control` 与那 8 条软链会被一并清掉——实测在 profile 副本上
> `rm -rf node_modules && pnpm install` 之后两者皆无。**要长期稳定就用 B1**（进 lockfile）；
> B2 只适合"这次先跑起来"。

**B3 把市场那份的 dist 放进 DSH 安装**（aeval 每轮本来就会往那里部署控制栈，路径是它认的）

```bash
D=<dsh 安装前缀>/lib/node_modules/@deepseek-ai/dsh/node_modules/aeval-control
cp -a "$PROFILE/node_modules/dsh-eval-control/dist/." "$D/dist/"
# controlRoot 写 "$D"
```

> **B3 不要在 macOS 桌面版上用**：那要往 `.app` 包里写文件，而桌面版是签名的
> （`TeamIdentifier=UM3Z9G5DNH`），改动 sealed resource 有破坏签名的风险。桌面版走 B1/B2。

补完后 `controlRoot` 就写市场那份的落点 `$PROFILE/node_modules/dsh-eval-control`，其余照本文走。

**实测（B1 的效果）**：`controlRoot` 直指市场那份、工作区一个 npm 包都没装——

```
run run-demo sealed: 3 trial(s) recorded, 89 file(s) attested, recompute passed
报告：试次 3 · 有效分母 3 · 排除率 0.0% · 通过 2 · 失败 1
```

会话读取器同样不需要工作区那份：aeval 会自己从 DSH profile 里找到
`~/.dsh/profiles/<profile>/node_modules/dsh-eval-control/dist/session_reader.js`。
这条在 **macOS + 桌面版**上也实测过：`resolve_session_reader()` 无 env、工作区无任何
npm 包，直接解析到
`~/.dsh-beta/profiles/desktop/node_modules/dsh-eval-control/dist/session_reader.js`。

**桌面版（Electron）三点差异**（实测于 macOS + DSH Desktop Beta）：

1. DSH home 是 `~/.dsh-beta`，profile 叫 `desktop`，落点
   `~/.dsh-beta/profiles/desktop/node_modules/`（在 `.app` 包**外**，装插件本身不碰签名）。
2. **`desktop` profile 由 app 独占**：CLI 会拒绝——`profile "desktop" is managed
   exclusively by the Electron application`。所以装插件只能在 app 的市场里点；
   而 B1 那 8 条依赖得你自己进 profile 目录 `pnpm add`（桌面版自带的 `@deepseek-ai/*`
   是 **`0.1.7-rc.1`**，版本要按它钉，别照本文的 `0.2.0-rc.2`）。
3. 桌面版宿主的包版本可能比 CLI 更旧，所以**路线 B 的版本一定要跟宿主对齐**；
   混代会出现插件与宿主各持一份 `dsh-session` 的情况。

**代价**：B1/B2 会改 DSH 管的 profile（B1 往 `package.json`/`pnpm-lock.yaml` 里加依赖，
`dsh plugin` 操作看得见；B2 只是临时目录，见上面的不持久警告）；B3 往 DSH 安装目录写东西
（aeval 每轮也写那里，但 macOS 桌面版别用）。

### 2.3 如果你还要在 DSH 里用这个插件（市场安装）

```bash
pnpm -v                              # 没有 pnpm 会直接报：dsh: pnpm was not found
dsh plugin --profile web add dsh-eval-control@0.2.6
dsh plugin --profile web list        # 确认装上了
```

两个实测要点：

- **`--profile` 是必填项**（连 `--help` 都要带）。
- **不带版本号只会拿到"最新一个已满 1 天的版本"**——这是 pnpm ≥11 的供应链策略
  `minimumReleaseAge`（默认 `1440` 分钟），**不是市场目录滞后、也不是 registry/缓存问题**
  （[pnpm 文档](https://pnpm.io/supply-chain-security)）。实测 2026-10-11：npm `latest`
  已是 `0.2.6` 时，一个**全新 profile** 不带版本解析到 `0.2.2`；2026-10-12 复测解析到
  `0.2.3`（当时 0.2.4/0.2.5/0.2.6 发布都不到 24 小时、0.2.3 刚好超过）；
  同一台机器上 `pnpm add dsh-eval-control --config.minimumReleaseAge=0` 与
  `pnpm add dsh-eval-control@0.2.6` 都拿到 `0.2.6`。**所以务必显式写版本**
  （或在 profile 的 `pnpm-workspace.yaml` 里设 `minimumReleaseAge: 0`），
  并用下面这条确认落点版本：

```bash
node -p "require('./node_modules/dsh-eval-control/package.json').version"          # 工作区这份
node -p "require(require.resolve('dsh-eval-control/package.json',{paths:['<profile>/node_modules']})).version"  # 市场那份
```

**它什么时候"启动"**：插件本身不是常驻服务，DSH 以该 profile 启动时生效
（`dsh --profile web …`，profile 的 `package.json` 里 `dsh.profile.bundles` 列出本包）。
**评测路径上不需要你手动启停插件**：`aeval run` 会为每个试次在宿主侧拉起 broker，
再把控制栈投递进沙箱。

### 2.4 套件：wheel 不带 `suites/`，从 sdist 取

`aeval-harbor` 的 **wheel 里没有 `suites/`**（只有 `_templates/agents/*`），套件在 **sdist** 里。用 PyPI 的稳定 source 地址：

```bash
curl -sLO https://files.pythonhosted.org/packages/source/a/aeval-harbor/aeval_harbor-0.3.0.tar.gz
tar xzf aeval_harbor-0.3.0.tar.gz --strip-components=1 aeval_harbor-0.3.0/suites
rm -f aeval_harbor-0.3.0.tar.gz
ls suites/            # aeval-intel  _base  deepagent-budget  deepagent-hello  e2e-hello  sbench-pilot  tbench-pilot
```

### 2.5 出处门禁：套件目录必须是**干净的提交**

aeval 拒绝跑「有未提交/未跟踪/被忽略文件」的套件目录（防篡改）。所以取到套件、以及**之后每次改套件**（比如 §1.1 的 docker 改动）都要提交：

```bash
git init -q suites
git -C suites config user.email you@example.com
git -C suites config user.name you
git -C suites config commit.gpgsign false
git -C suites add -A -f
git -C suites commit -q -m "suites from sdist"
```

### 2.6 声明起点

```bash
aeval agents --init --agents-dir agents
aeval agents --agents-dir agents        # 期望：1 agent declaration(s) agree with their adapter classes.
```

`--init` 写出 **3 个文件**：`agents/_base/agent.base.yaml`（公共基座）、`agents/dsh.yaml`（DSH 适配器声明）、`agents/_runtime/images.yaml`（运行时→镜像表）。
**运行时表不用设环境变量**：它默认就是 `<agents-dir>/_runtime/images.yaml`（想放别处才用 `AEVAL_RUNTIME_IMAGES`）。

然后按你的沙箱改 `agents/dsh.yaml` 里的 launch kwargs——**至少这三项**（写成什么值取决于你的机器）：

```yaml
launch:
  default:
    override_setup_timeout_sec: 900
    kwargs:
      install_prefix: /opt/dsh     # 你的 DSH 安装前缀（沙箱里 dsh 所在处）
      npm_cache: /root/.npm        # 沙箱内 npm 缓存目录（加速、避免离线失败）
      run_timeout_sec: 900         # 单试次超时
```

> 改声明文件之后**不用重跑 `aeval agents`**：`aeval agents --agents-dir agents` 只做一致性检查。

---

## 3. 起可信 token 计数器（不能省）

只要 spec 里设了 `limits.maxTokens`，**就必须**给一个可信的输入 token 计数源。这是硬规则：

```
# 不给计数器时 broker 直接拒绝启动（退出码 3）
BrokerConfigError: aeval-model-broker: limits.maxTokens requires a trusted tokenCount source
```

计数器的契约只有一条：**永不少算**。套件里自带参考实现（用请求体字节长度作上界，字节级分词器下 `tokens ≤ bytes` 恒成立）：

```bash
python3 suites/tbench-pilot/tools/token_count.py --host 127.0.0.1 --port 8791 &
curl -s -X POST http://127.0.0.1:8791/tokens/count --data-binary '{"x":1}'
# 非法体也应答（说明服务活着）：{"error": "body must be JSON"}
```

> **真实事故**：早期 pilot 把 `tokenCount` 指向一个固定返回 `{"inputTokens": 64}` 的离线桩，
> 真 prompt 远大于 64，于是每个试次都在派发后的自查里被判 `AEVAL_TOKEN_BOUND_VIOLATED`，
> 租约 fail-closed，整轮全灭。**指向会少算的计数器比没有计数器更糟。**

---

## 4. broker spec

spec 是 aeval 交给 broker 的全部接线。最小可用形状（docker 后端）：

```json
{
  "controlRoot": "/abs/path/to/node_modules/dsh-eval-control",
  "listenHost": "10.0.0.12",
  "listenPort": 8447,
  "listenTls": {"cert": "/abs/path/gateway.crt", "key": "/abs/path/gateway.key"},
  "controlCa": "/abs/path/ca.crt",
  "upstream": {
    "provider": "deepseek",
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKeyEnv": "DEEPSEEK_API_KEY",
    "model": "deepseek-chat"
  },
  "identity": {"provider": "deepseek", "model": "deepseek-chat"},
  "limits": {"maxSteps": 60, "maxTokens": 2000000},
  "maxOutputTokens": 16384,
  "tokenCount": {"endpoint": "http://127.0.0.1:8791/tokens/count", "margin": 8}
}
```

### 4.1 逐字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `controlRoot` | ✅ | 控制包根目录；broker 入口取 `<controlRoot>/dist`。**指 §2.2 的 npm 那份** |
| `listenHost` | docker 后端必填 | broker 监听地址。**沙箱要能连到的宿主机 IP**（不要写 `127.0.0.1`，见 §4.2） |
| `listenPort` | ✅ | 固定端口（会写进摘要，不能等监听到了才知道） |
| `listenTls` | 非 loopback 必填 | `{cert,key}` PEM 路径。非 loopback 监听**强制** TLS |
| `controlCa` | TLS 时必填 | 签发 broker 证书的 CA，会被投递进沙箱供其信任 |
| `upstream.provider` / `.baseUrl` / `.model` / `.apiKeyEnv` | ✅ | 上游路由四件套；**缺一个都起不来** |
| `upstream.protocol` | ❌ | `chat_completions`（默认）/ `responses` |
| `identity` | ✅ | 网关身份，须与 `upstream` 路由一致 |
| `limits.maxSteps` / `.maxTokens` | ✅ | 硬预算；`maxTokens` 需要 `tokenCount` |
| `maxOutputTokens` | ✅ | 单次回复上限 |
| `tokenCount` | `maxTokens` 时必填 | `{endpoint, margin}`，`margin` 为安全余量 |
| `auxiliaryPolicy` | ❌ | 辅助模型调用（`compaction`/`session-title`）默认**拒绝**；要放行就 `{"compaction":"allow"}` |

密钥**只以环境变量名出现**（`apiKeyEnv`），spec 里不写密钥值。

### 4.2 三个实测坑（都会让整轮 0 分，但退出码仍是 0）

1. **`upstream` 只写 `apiKeyEnv`** →
   `broker config upstream.model: invalid identifier ''`。四个字段都要写。
2. **`maxTokens` 没配 `tokenCount`** →
   `limits.maxTokens requires a trusted tokenCount source`（§3）。
3. **docker 后端仍用 loopback** → 沙箱里的 DSH 连不上 broker，报：
   ```
   aeval-broker-transport ... TypeError: fetch failed
   Error: connect ECONNREFUSED 127.0.0.1:8447
   llm-deepseek: no API key for provider route "deepseek-official" ... code: MISSING_CREDENTIAL
   ```
   随后整轮被排除：`the trial's agent exposes no DSH session`。
   原因：沙箱是**容器**，`127.0.0.1` 指向它自己。必须给 `listenHost` = 宿主机可达 IP + `listenTls` + `controlCa`。

### 4.3 自签证书与 CA

```bash
HOST_IP=$(hostname -I | awk '{print $1}')        # broker 要监听的宿主机 IP

openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout ca.key -out ca.crt -subj "/CN=aeval-eval-ca"

openssl req -newkey rsa:2048 -nodes -keyout gateway.key -out gateway.csr \
  -subj "/CN=$HOST_IP" -addext "subjectAltName=IP:$HOST_IP,DNS:localhost"

openssl x509 -req -in gateway.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out gateway.crt -days 365 -copy_extensions copy

openssl x509 -in gateway.crt -noout -subject -ext subjectAltName   # 确认 SAN 里有你的 IP
```

`listenTls.cert/key` 用 `gateway.crt/key`，`controlCa` 用 `ca.crt`。

---

## 5. 跑一轮

```bash
export DEEPSEEK_API_KEY=<你的 key>          # 宿主侧导出，broker 要用
export AEVAL_BROKER_JSON=$PWD/broker.json

aeval run --suite suites/tbench-pilot \
          --run-dir runs/demo \
          --store   runs/demo.sqlite3 \
          --agents-dir agents \
          --harbor-cli harbor
```

- **run_id = `run-` + run 目录名** → 本例 `run-demo`。
- aeval 自己组合 Harbor job 并委托 Harbor 执行，`--plugin aeval.hooks:AevalPlugin` 是自动带的。
- `--sandbox-image <ref>@sha256:<digest> --sandbox-platform <arch>`：钉镜像（配对被拒、或要固定镜像时用）。
- `--accept-unmetered-budget`：接受无硬预算（**会放弃预算保证**，仅在明确不需要时用）。
- 想提高可信度：把 `suites/tbench-pilot/jobs/tbench-m0.yaml` 的 `n_attempts` 调大（如 3），出报告时用 `--k 3`。

**看结论要看的不是退出码**，而是这行：

```
run run-demo sealed: 3 trial(s) recorded, 89 file(s) attested, recompute passed
```

没有任何排除时，就只打印这一行。**一旦有试次被排除**，后面会多打印黄字两行（这就是"本轮不可信"的信号）：

```
  excluded 3 trial(s): infra_invalid
  0/3 trial(s) scored (exclusion rate 100.0%) — the cause of each is in
  .../runs/demo/aeval_run_summary.json under trials[*].infra_invalid_reasons
```

**被测用例全被排除时退出码依然是 `0`**（接线故障不是用例失败）。所以：
不要只看退出码，看有没有那两行黄字，以及报告里的**有效分母 / 排除率**。

---

## 6. 拿到报告

报告渲染时从 **`<store 所在目录>/trials/`** 读逐试次证据，所以要先把这个目录链好（一个试次一个条目）：

```bash
mkdir -p runs/trials
for t in runs/demo/harbor/*/*/; do
  [ -f "$t/collection_manifest.json" ] && ln -sfn "$PWD/$t" "runs/trials/$(basename "$t")"
done
ls runs/trials | wc -l        # 应等于试次数
```

> 不链这一步的典型症状：报告里 **`证据覆盖 0/N`**、轨迹指标整节缺失（报告会写明是哪一种缺失）。
> 所以规范布局是——**sqlite 与 `trials/` 同级**：

```
$WS/
├── node_modules/dsh-eval-control/   控制栈（npm 装）
├── agents/                          声明（aeval agents --init）
├── suites/                          套件（sdist + git 提交）
├── broker.json                      broker spec
└── runs/
    ├── demo/                        --run-dir（harbor 产物在 demo/harbor/…）
    ├── demo.sqlite3                 --store（与 trials/ 同级）
    └── trials/                      报告读这里
```

> 读取端接受**三种布局**：`<store 同级>/trials`（上面这种）、`<store 同级>/runs/trials`
> （`aeval quickstart` 写的那套，它的 store 在 `<ws>/run.sqlite3`）与 `<store 同级>/run/trials`
> （`aeval doctor --run-dir <ws>/run` 提示操作者建的那种）。前两者**曾经不一致**，
> 导致报告读到 0 个试次、整块轨迹度量标"不可用"；修好后的前后对照见
> `tools/lab-e2e/evidence-trajectory-coverage.md`（该目录不在本包内）。

三个命令 + 一个复核：

```bash
aeval report     run-demo --store runs/demo.sqlite3 --k 1 > report.md   # Markdown 报告
aeval dashboard  run-demo --store runs/demo.sqlite3 --k 1 > dashboard.html
aeval trajectory run-demo --store runs/demo.sqlite3 --out panels/
aeval recompute  runs/demo                                              # 独立复核封存（不信任渲染器）
```

`recompute` 是**复核入口**：它自己重算一遍并比对封存，报告有没有被动过看它。

---

## 7. 怎么读这份报告

| 报告里的位置 | 含义 | 判断标准 |
| --- | --- | --- |
| 试次 / 有效分母 | 总试次 vs 真正参与判分的 | 有效分母 ≪ 总数 ⇒ 先修接线，别读分数 |
| 判定分布 · 排除明细 | `cannot_judge` / `infra_invalid` 各多少 | **排除率 > 5% 报告会自己警告**；100% = 本轮不可用 |
| 通过 / 失败 | 判分结果 | 与 `harbor/*/result.json` 的 reward 可交叉核对 |
| 终判来源分解 | 谁把谁否决了（如 `tbench-trajectory@v1` 否决 `tbench-outcome@v1` 的 pass） | 通过数少于 reward 数**通常是这类守卫否决**，不是回归 |
| 轨迹采集 · 证据覆盖 | 逐试次证据是否齐 | 应 `N/N`；为 0 时报告会写明是"试次目录缺失（三种子串：一个候选布局都没有／链接指向的目录不存在／发布目录为空）/ 目录里没有 collection_manifest / 清单的 trial_id 对不上 / 轨迹文件不可读"哪一种，先按 §6 查链证据 |
| 首 token 时延 / 单次通过成本 | 账本里原本就没有这两个量 | 显示"不可用"是**真实状态**（ATIF step 无 `first_token_ms`、`final_metrics.total_cost_usd` 为 `null`），不是这次没算 |
| 红线状态 | 硬约束检查 | 「全通过」才是可对外引用的前提 |
| 封存 / `recompute` | 证据是否被改过 | `recompute passed` |

产物（都在 run 目录）：`aeval_run_summary.json`（run 摘要、排除项）、`run_manifest.json`（身份 + `runtime_lock_digest` + `seal_digest`）、`attestation.json`（逐文件 sha256）、`harbor/*/result.json`（上游 verifier 口径）。

---

## 8. 排障表（报错原文 → 含义 → 处置）

| 报错原文（节选） | 含义 | 处置 |
| --- | --- | --- |
| `official DSH session reader not found` | 会话读取器没找到 | 装控制栈（§2.2）；或设 `AEVAL_DSH_CONTROL_ROOT` 指向控制包 |
| `Cannot find package '@deepseek-ai/dsh-llm'` + `ERR_MODULE_NOT_FOUND` | `controlRoot` 那份没有依赖（pnpm 市场副本没有 peer） | 用 npm 装的那份（§2.2） |
| `broker config upstream.model: invalid identifier ''` | `upstream` 缺字段 | 补齐 `provider/baseUrl/model/apiKeyEnv` |
| `limits.maxTokens requires a trusted tokenCount source` | 硬预算没计数器 | 起 `token_count.py` + 写 `tokenCount`（§3） |
| `broker exited before readiness (code 2): ... upstream API key is not set` | 宿主没导出 key（沙箱里会伪装成 `MISSING_CREDENTIAL`） | `export DEEPSEEK_API_KEY=…` 后再跑 |
| `ECONNREFUSED 127.0.0.1:8447` / `the trial's agent exposes no DSH session` | 沙箱连不到 broker | docker 后端必须 `listenHost`=宿主机 IP + `listenTls` + `controlCa`（§4.2） |
| `carries no controlDist and no controlRoot with a built dist/` | spec 没指明控制包 | 写 `controlRoot`（≥0.3.0 会自动取 `<controlRoot>/dist`） |
| `no agent declaration for 'dsh' under …/agents — declare it in agents/dsh.yaml` | 没有声明 | `aeval agents --init --agents-dir agents` |
| 套件仓库「有未提交/未跟踪文件」 | 出处门禁 | `git -C suites add -A && git -C suites commit` |
| 报告 `证据覆盖 0/N` | 已发布证据没被读到：`trials/` 没链、链断了、缺 `collection_manifest`、或清单的 `trial_id` 对不上 | 见 §6 的链接循环；报告会写明是上面哪一种 |
| 日志里 `Collect hook ... exited with code 127: ... aeval-collect` | **独立缺陷**：沙箱侧的采集钩子不存在（写在套件 `task.toml` 的 verifier 行，但不是任何已发布的可执行文件） | 忽略；它**不是**排除原因，也**不是**"证据覆盖 0/N"的原因（后者是读取端路径不一致，已修） |
| `0/3 trial(s) scored (exclusion rate 100.0%)` | 全被排除，本轮不可用 | 读 `aeval_run_summary.json` 的 `trials[*].infra_invalid_reasons`，对照本表 |

---

## 9. 常见变体

**换模型 / 换上游**：只改 spec 的 `upstream`（四件套）与 `identity`，保持两者一致。
DeepSeek 的 Responses 线加 `"protocol": "responses"`，`baseUrl` 用 `https://api.deepseek.com`。

**多试次更可信**：job 文件 `n_attempts: 3` → `aeval report … --k 3`（`k` 由命令行给，套件里那个 `k` 不影响报告数字）。

**多 run 聚合**：`--store` 可重复，聚合**同一套件**的多个 run；`run_id` 必须被其中某个 store 记录。

**换套件**：套件是目录（`suite.yaml` + `jobs/` + `tasks/` + `graders/`…），写法见 aeval 源码仓库的 `docs/guides/writing-a-suite.md`；先读 `suite.yaml` 与 `jobs/*.yaml` 看它声明了什么。
（`aeval explain` 渲染器在 0.3.0 上有一个 `NameError` 缺陷——凡声明了族/引擎的套件都会抛
`NameError: name 'case' is not defined`（`aeval/suite_loader/loader.py:517` 引用了不存在的名字）。
它与本流程无关，暂以读套件目录代替。）

---

## 10. 附：可直接复制的完整脚本

```bash
#!/bin/bash
set -euo pipefail
WS=$PWD
AEVAL=".venv/bin/aeval"
HOST_IP=$(hostname -I | awk '{print $1}')   # Linux；macOS 用 ipconfig getifaddr en0

# 1) aeval
uv venv --python 3.12 .venv && source .venv/bin/activate
uv pip install aeval-harbor

# 2) 控制栈（npm 那份供 broker 用）
npm install dsh-eval-control@0.2.6 --no-audit --no-fund

# 3) 套件（sdist）+ 出处门禁
curl -sLO https://files.pythonhosted.org/packages/source/a/aeval-harbor/aeval_harbor-0.3.0.tar.gz
tar xzf aeval_harbor-0.3.0.tar.gz --strip-components=1 aeval_harbor-0.3.0/suites
rm -f aeval_harbor-0.3.0.tar.gz
git init -q suites && git -C suites config user.email you@example.com \
  && git -C suites config user.name you && git -C suites config commit.gpgsign false
git -C suites add -A -f && git -C suites commit -q -m "suites from sdist"

# 4) 声明起点（记得按你的沙箱改 agents/dsh.yaml 的 install_prefix / npm_cache）
$AEVAL agents --init --agents-dir agents
$AEVAL agents --agents-dir agents

# 5) 本机 docker：改环境并提交（用 e2b 则跳过）
#    这里把 launch kwargs 写在 job 文件的 agent 条目上，等价于改 agents/dsh.yaml（§2.6）
python3 - suites/tbench-pilot/jobs/tbench-m0.yaml <<'PY'
import sys, yaml
p = sys.argv[1]; d = yaml.safe_load(open(p))
d.setdefault("environment", {})["type"] = "docker"
for a in d.get("agents") or []:
    kw = a.setdefault("kwargs", {})
    kw["install_prefix"] = "/opt/dsh"; kw["npm_cache"] = "/root/.npm"; kw["run_timeout_sec"] = 900
yaml.safe_dump(d, open(p, "w"), sort_keys=False)
PY
git -C suites commit -q -a -m "docker backend"

# 6) token 计数器 + 证书
python3 suites/tbench-pilot/tools/token_count.py --host 127.0.0.1 --port 8791 &
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout ca.key -out ca.crt -subj "/CN=aeval-eval-ca"
openssl req -newkey rsa:2048 -nodes -keyout gateway.key -out gateway.csr \
  -subj "/CN=$HOST_IP" -addext "subjectAltName=IP:$HOST_IP,DNS:localhost"
openssl x509 -req -in gateway.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out gateway.crt -days 365 -copy_extensions copy

# 7) spec
cat > broker.json <<JSON
{
  "controlRoot": "$WS/node_modules/dsh-eval-control",
  "listenHost": "$HOST_IP",
  "listenPort": 8447,
  "listenTls": {"cert": "$WS/gateway.crt", "key": "$WS/gateway.key"},
  "controlCa": "$WS/ca.crt",
  "upstream": {"provider": "deepseek", "baseUrl": "https://api.deepseek.com/v1",
               "apiKeyEnv": "DEEPSEEK_API_KEY", "model": "deepseek-chat"},
  "identity": {"provider": "deepseek", "model": "deepseek-chat"},
  "limits": {"maxSteps": 60, "maxTokens": 2000000},
  "maxOutputTokens": 16384,
  "tokenCount": {"endpoint": "http://127.0.0.1:8791/tokens/count", "margin": 8}
}
JSON

# 8) 跑 + 出报告
export DEEPSEEK_API_KEY=<你的 key>
export AEVAL_BROKER_JSON=$WS/broker.json
$AEVAL run --suite suites/tbench-pilot --run-dir runs/demo --store runs/demo.sqlite3 \
           --agents-dir agents --harbor-cli harbor

mkdir -p runs/trials
for t in runs/demo/harbor/*/*/; do
  [ -f "$t/collection_manifest.json" ] && ln -sfn "$WS/$t" "runs/trials/$(basename "$t")"
done
$AEVAL report     run-demo --store runs/demo.sqlite3 --k 1 > report.md
$AEVAL dashboard  run-demo --store runs/demo.sqlite3 --k 1 > dashboard.html
$AEVAL recompute  runs/demo
```
