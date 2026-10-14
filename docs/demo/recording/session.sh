#!/usr/bin/env bash
# 由 record-demo.sh 生成：演示会话本体。每条命令都是真的。
set -uo pipefail
say() { printf '\n=== %s ===\n' "$*"; }
run() { printf '$ %s\n' "$*"; "$@"; }
say "1/4 装控制栈：npm install dsh-eval-control@0.2.6（这条路线不需要 DSH）"
mkdir -p "/root/e2e/accept/demo/control-stack" && cd "/root/e2e/accept/demo/control-stack"
run npm install --silent dsh-eval-control@0.2.6
echo "(装好版本：$(node -p "require('./node_modules/dsh-eval-control/package.json').version"))"

say "2/4 看 mode：装完默认 standalone（设计，不是故障）"
run ./node_modules/.bin/aeval-dsh-control-selfcheck

say "3/4 一条命令：先看计划（一个字节都不写）"
run aeval quickstart --backend docker --suite /root/e2e/accept/demo/docker-suites/tbench-pilot-docker --agents-dir /root/e2e/accept/aeval/agents --workspace /root/e2e/accept/demo/ws --dry-run

say "4/4 真跑：证书 / broker / 计数器 / run / 证据链 / 报告 / 复算 / 判分"
run aeval quickstart --backend docker --suite /root/e2e/accept/demo/docker-suites/tbench-pilot-docker --agents-dir /root/e2e/accept/aeval/agents --workspace /root/e2e/accept/demo/ws --yes
echo
say "报告开头（判断成败看 <valid>/<total> trial(s) scored，不是退出码）"
run sed -n '1,12p' "/root/e2e/accept/demo/ws/report.md"
