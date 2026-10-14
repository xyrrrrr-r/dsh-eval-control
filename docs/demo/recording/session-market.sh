#!/usr/bin/env bash
# 由 record-demo.sh 生成：演示会话本体。每条命令都是真的。
set -uo pipefail
say() { printf '\n=== %s ===\n' "$*"; }
run() { printf '$ %s\n' "$*"; "$@"; }
say "市场安装：社区用户真正会做的那条路（先把工具装上）"
run export PATH=/root/e2e/tools/node-v24.20.0-linux-arm64/bin:$PATH
run npm i -g --allow-scripts=pnpm,@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs pnpm @deepseek-ai/dsh
run pnpm --version
run dsh --version

say "指定自己的 DSH_HOME（默认是 ~/.dsh —— 这里绝不碰它）"
run export DSH_HOME=/root/e2e/accept/demo/dsh-home

say "一键安装插件到 profile: web（DSH 会在首次使用时初始化该 profile）"
run dsh plugin --profile web add dsh-eval-control

say "安装结果：包装进了 profile（下面这行读的就是 profile 里的那份）"
run node -p "require('/root/e2e/accept/demo/dsh-home/profiles/web/node_modules/dsh-eval-control/package.json').version"

say "profile 默认 autoInstallPeers: false，插件声明的 peer 不会跟着装 —— 补上，否则插件加载不了"
run cd /root/e2e/accept/demo/dsh-home/profiles/web
run pnpm config set auto-install-peers true --location project
run pnpm install --no-frozen-lockfile

say "装完默认 standalone（设计，不是故障）"
run ./node_modules/.bin/aeval-dsh-control-selfcheck
