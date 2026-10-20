# aeval 评测控制

本插件同时提供 aeval 评测控制能力，用于把试次配置与实际运行绑定。面板导出的分析报告与 aeval 的正式判分报告用途不同。

## 功能概览

评测控制包含：

- **实验变量注入**：通过 `aeval-broker-transport` 行注入变量
- **步骤与 Token 预算**：控制评测运行的资源消耗
- **fork 血统校验**：确保评测会话的来源可追溯
- **bundle descriptor**：描述控制栈的组成和依赖

## 默认组合包

默认组合包挂载两行：

| 行 ID | 职责 |
| --- | --- |
| `aeval-broker-transport` | 可选评测 transport；缺少控制配置时以 standalone 状态运行，不重定向模型调用 |
| `dsh-trajectory-analytics` | 注册轨迹分析投影、诊断配置和报告分享服务 |

`standalone` 表示评测控制尚未接入，不影响普通轨迹分析。完整评测控制还需要 `aeval-eval-control` 行，且 transport 必须排在控制行之前。

## 配置来源

配置来源支持完整内联配置、`controlConfigPath` 指向的 JSON 文件，或空行配置配合 `AEVAL_CONTROL_CONFIG` 环境变量。

以下为完整控制栈的行配置示意，JSON 文件应由评测运行方提供：

```yaml
- insert:
    - id: aeval-broker-transport
      name: 'dsh-eval-control/dist/sandbox_entry.js'
      config:
        controlConfigPath: '/absolute/path/control-config.json'
    - id: aeval-eval-control
      name: 'dsh-eval-control/dist/index.js'
      config:
        controlConfigPath: '/absolute/path/control-config.json'
```

已有默认 transport 行时，应按行 ID 覆盖它的配置，再插入控制行。aeval runner 会为评测试次生成对应 patch 并部署控制栈。

## 自检

在本包已构建的目录中执行自检：

```bash
node dist/selfcheck.js
node dist/selfcheck.js --config /absolute/path/control-config.json --json
```

## 命令

本包还提供以下命令，供评测采集与控制流程使用：

- `aeval-dsh-session-reader`：读取 DSH 会话数据
- `aeval-dsh-session-stub`：会话存根
- `aeval-model-broker`：模型调用代理

## 中立运行时

中立控制运行时优先取自 `AEVAL_CONTROL_DIST`，其次是同级 `../aeval/control/dist`，最后回退到仓库内 `vendor/neutral/`。更新 vendored 产物使用 `npm run vendor:neutral`，需要先准备中立运行时构建输出。
