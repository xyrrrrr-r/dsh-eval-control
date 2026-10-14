#!/usr/bin/env bash
# 演示录制器：把「装控制栈 → 看到 mode → 一条命令 → report.md」这一串**真实命令**
# 录成可回放的终端会话（asciinema .cast，或 util-linux/BSD 的 typescript + timing）。
# 回放：typescript 那路用本仓库自带的 `recording/replay-typescript.py`（零依赖、任何平台）；
# util-linux 的 `scriptreplay` **macOS 不自带**，别把播放端也当成自适应的。
#
# 为什么需要它：本机（macOS）与实验机（hw-lab）都没有 asciinema / ffmpeg / agg，
# 两处只有 `/usr/bin/script`。这个脚本是"能产出成品的唯一被允许路径"——
# 它只录制**真实执行**的输出，不做任何拼接或事后编辑（见 STORYBOARD.md）。
#
# 用法：
#   docs/demo/record-demo.sh                        # 完整 4 幕（默认 INSTALL_MODE=dsh）
#   docs/demo/record-demo.sh --segment plan         # 只录第 1-3 幕（不写盘，最便宜）
#   docs/demo/record-demo.sh --segment market       # 独立短片：市场安装（npm i -g + dsh plugin add）
#   docs/demo/record-demo.sh --self-test            # 只验证录制管线（录一条只读命令）
#   INSTALL_MODE=npm docs/demo/record-demo.sh       # 没有 dsh/pnpm 的机器（如 hw-lab）
#   docs/demo/record-demo.sh --print-session        # 只打印会录的会话，不录制
#
# 环境变量：
#   OUT_DIR       产物目录（默认 <docs/demo>/out）
#   INSTALL_MODE  dsh（dsh plugin add）| npm（npm install 控制栈）；默认 dsh
#   PKG_VERSION   与 INSTALL_MODE=npm 搭配，默认 0.2.6
#   PROFILE       dsh 模式的 DSH profile 名，默认 web
#   DEMO_DSH_HOME market 片段的 DSH_HOME（默认 <docs/demo>/dsh-home；绝不指向用户默认 profile）
#   CONTROL_DIR   npm 模式的安装目录，默认 control-stack
#   BACKEND       docker | e2b，默认 docker
#   SUITE         传给 quickstart 的 --suite（留空则用 quickstart 选的默认套件）
#   AGENTS_DIR    传给 quickstart 的 --agents-dir（留空则不传）
#   WORKSPACE     传给 quickstart 的 --workspace，默认 aeval-quickstart
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${OUT_DIR:-$HERE/out}"
INSTALL_MODE="${INSTALL_MODE:-dsh}"
PKG_VERSION="${PKG_VERSION:-0.2.6}"
PROFILE="${PROFILE:-web}"
DEMO_DSH_HOME="${DEMO_DSH_HOME:-$HERE/dsh-home}"
CONTROL_DIR="${CONTROL_DIR:-control-stack}"
BACKEND="${BACKEND:-docker}"
SUITE="${SUITE:-}"
AGENTS_DIR="${AGENTS_DIR:-}"
WORKSPACE="${WORKSPACE:-aeval-quickstart}"
SEGMENT="${SEGMENT:-all}"
SELF_TEST=0
PRINT_SESSION=0

while [ $# -gt 0 ]; do
  case "$1" in
    --segment) SEGMENT="${2:?--segment needs a value}"; shift 2 ;;
    --self-test) SELF_TEST=1; shift ;;
    --print-session) PRINT_SESSION=1; shift ;;
    --out) OUT_DIR="${2:?--out needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "record-demo: unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v script >/dev/null 2>&1 || {
  echo "record-demo: no \`script\` on PATH and no asciinema — cannot record here." >&2
  echo "             install util-linux (Linux) or use a machine that has asciinema." >&2
  exit 3
}

mkdir -p "$OUT_DIR"

# --- 被录制的会话：每条命令都先打印再执行，录不到伪造的输出 -------------------
QS_EXTRA=""
[ -n "$SUITE" ] && QS_EXTRA="$QS_EXTRA --suite $SUITE"
[ -n "$AGENTS_DIR" ] && QS_EXTRA="$QS_EXTRA --agents-dir $AGENTS_DIR"
QS_EXTRA="$QS_EXTRA --workspace $WORKSPACE"
VERSION_CMD="node -p \"require('./node_modules/dsh-eval-control/package.json').version\""

SESSION="$OUT_DIR/session.sh"
# 本机 npm 的全局 bin 目录（npm i -g 装出来的 pnpm/dsh 落在这里；不一定在 PATH 上）
NPM_BIN="$(npm prefix -g 2>/dev/null)/bin"
{
  cat <<'SH'
#!/usr/bin/env bash
# 由 record-demo.sh 生成：演示会话本体。每条命令都是真的。
set -uo pipefail
say() { printf '\n=== %s ===\n' "$*"; }
run() { printf '$ %s\n' "$*"; "$@"; }
SH
  if [ "$SELF_TEST" = 1 ]; then
    cat <<'SH'
say "自检：录制管线（只读命令，不碰 docker / 额度）"
run aeval doctor --no-probe
echo "(退出码 $? —— 有 fail 时非 0 是预期行为)"
say "如果你在回放里看到上面这些 [ok|warn|fail] 行，录制管线是通的"
SH
  elif [ "$SEGMENT" = "market" ]; then
    cat <<SH
say "市场安装：社区用户真正会做的那条路（先把工具装上）"
run export PATH=$NPM_BIN:\$PATH
run npm i -g --allow-scripts=pnpm,@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs pnpm @deepseek-ai/dsh
run pnpm --version
run dsh --version

say "指定自己的 DSH_HOME（默认是 ~/.dsh —— 这里绝不碰它）"
run export DSH_HOME=$DEMO_DSH_HOME

say "一键安装插件到 profile: $PROFILE（DSH 会在首次使用时初始化该 profile）"
run dsh plugin --profile $PROFILE add dsh-eval-control

say "安装结果：包装进了 profile（下面这行读的就是 profile 里的那份）"
run node -p "require('$DEMO_DSH_HOME/profiles/$PROFILE/node_modules/dsh-eval-control/package.json').version"

say "profile 默认 autoInstallPeers: false，插件声明的 peer 不会跟着装 —— 补上，否则插件加载不了"
run cd $DEMO_DSH_HOME/profiles/$PROFILE
run pnpm config set auto-install-peers true --location project
run pnpm install --no-frozen-lockfile

say "装完默认 standalone（设计，不是故障）"
run ./node_modules/.bin/aeval-dsh-control-selfcheck
SH
  else
    if [ "$INSTALL_MODE" = "npm" ]; then
      cat <<SH
say "1/4 装控制栈：npm install dsh-eval-control@$PKG_VERSION（这条路线不需要 DSH）"
mkdir -p "$CONTROL_DIR" && cd "$CONTROL_DIR"
run npm install --silent dsh-eval-control@$PKG_VERSION
echo "(装好版本：\$($VERSION_CMD))"

say "2/4 看 mode：装完默认 standalone（设计，不是故障）"
run ./node_modules/.bin/aeval-dsh-control-selfcheck
SH
    else
      cat <<SH
say "1/4 装插件（DSH profile: $PROFILE）"
run dsh plugin --profile $PROFILE add dsh-eval-control

say "2/4 看 mode：装完默认 standalone（设计，不是故障）"
run aeval-dsh-control-selfcheck
SH
    fi
    if [ "$SEGMENT" = all ] || [ "$SEGMENT" = plan ]; then
      cat <<SH

say "3/4 一条命令：先看计划（一个字节都不写）"
run aeval quickstart --backend $BACKEND$QS_EXTRA --dry-run
SH
    fi
    if [ "$SEGMENT" = all ]; then
      cat <<SH

say "4/4 真跑：证书 / broker / 计数器 / run / 证据链 / 报告 / 复算 / 判分"
run aeval quickstart --backend $BACKEND$QS_EXTRA --yes
echo
say "报告开头（判断成败看 <valid>/<total> trial(s) scored，不是退出码）"
run sed -n '1,12p' "$WORKSPACE/report.md"
SH
    fi
  fi
} > "$SESSION"
chmod +x "$SESSION"

if [ "$PRINT_SESSION" = 1 ]; then
  cat "$SESSION"
  exit 0
fi

# --- 录制：asciinema 优先，否则用 script（util-linux 与 BSD 参数不同） --------
[ "$SEGMENT" = "market" ] && PREFIX="market-install" || PREFIX="demo"
STAMP="$(date +%Y%m%d-%H%M%S)"
if command -v asciinema >/dev/null 2>&1; then
  CAST="$OUT_DIR/$PREFIX-$STAMP.cast"
  echo "record-demo: asciinema → $CAST"
  asciinema rec --overwrite --command "bash $SESSION" "$CAST"
  echo "record-demo: done. 回放：asciinema play $CAST"
else
  TS="$OUT_DIR/$PREFIX-$STAMP.typescript"
  TIMING="$OUT_DIR/$PREFIX-$STAMP.timing"
  echo "record-demo: script → $TS (timing: $TIMING)"
  case "$(uname -s)" in
    Darwin)
      # BSD script: script [-q] file [command ...]
      script -q "$TS" bash "$SESSION"
      ;;
    *)
      # util-linux: the timing flag is -T (<2.28 / BSD-style `-t file` is the
      # deprecated alias and rejects a detached value, so probe before use).
      if script --help 2>&1 | grep -q -- '-T, --log-timing'; then
        script -q -T "$TIMING" -c "bash $SESSION" "$TS"
      else
        script -q -c "bash $SESSION" "$TS"
        : > "$TIMING"
      fi
      ;;
  esac
  # A recorder without a pty writes a 0-byte file and reports success; never
  # let an empty artifact pass for a recording.
  [ -s "$TS" ] || { echo "record-demo: recording is empty ($TS) — no pty available?" >&2; exit 4; }
  echo "record-demo: done. 回放：python3 $HERE/recording/replay-typescript.py $TIMING $TS"
  echo "record-demo:       30 秒版：python3 $HERE/recording/replay-typescript.py --divisor 8 $TIMING $TS"
  echo "record-demo:       （scriptreplay 属 util-linux，macOS 不自带；播放器是本仓库自带的，零依赖）"
fi

echo "record-demo: session script kept at $SESSION (reproducible without the recorder)"
