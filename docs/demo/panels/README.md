# README 面板动图

录制日期：2026-10-19。使用 `demo.ts` 中的合成 projection 渲染当前 `client-src` 面板组件，未连接真实宿主、未读取真实会话。演示原始事件采用当前宿主结构，包含请求用量、消息追加与替换、工具失败、Team 成员/任务、主子与子子消息及送达回执。外围采用独立浅色演示页，宿主主题下的外观可能不同。

八组 GIF 覆盖证据链与七个 Tab，以及导出和分享配置入口。共 30 帧，每帧停留 2.2 秒，1280 × 720，无限循环；它们是浏览器实际操作的关键状态截图合成，不是连续视频。分享片段仅展示选项，没有生成链接，也没有应用诊断推荐配置。

## 更新

在仓库根目录准备依赖，并在临时目录安装演示所需 React（不修改项目依赖）：

```bash
npm install
npm install --prefix /tmp/dsh-demo-runtime --no-save --ignore-scripts react@18.3.1 react-dom@18.3.1
PANEL_DEMO_RUNTIME=/tmp/dsh-demo-runtime/node_modules node scripts/build-panel-demo.mjs /tmp/dsh-panel-demo
python3 -m http.server 4400 --bind 127.0.0.1 --directory /tmp/dsh-panel-demo
```

浏览器打开 `http://127.0.0.1:4400/`，操作并保存 PNG；合成脚本按比例缩放、居中留白到 1280 × 720，不裁掉超高画面的底部。截图文件名由 [`scripts/build-panel-gifs.py`](../../../scripts/build-panel-gifs.py) 的 `GROUPS` 定义：

| 前缀 | 顺序 |
| --- | --- |
| evidence | 窗口占用计算公式、定位原始请求用量、展开相邻事件 |
| overview | 总览、展开上下文告警、消息 Token、仅注入 |
| evolution | 按步骤、按轮次、选中摘要压缩、适配数据纵轴 |
| events | 事件列表、展开摘要压缩、滚动至替换对比、展开修剪组、展开注入来源 |
| tools | 工具分布、放大、失败标红与错误原因证据 |
| team | 协作关系全景、子 Agent 连线筛选、交接原文、轨迹证据、共享任务板 |
| compare | 从 02 开始：对比结果、查看比例雷达图、差异报告与最佳实践 |
| export | 导出面板、切换格式、分享面板 |

安装 Pillow 后合成，并检查每组所有帧的文字、当前 Tab、交互状态和内容完整性：

```bash
python3 -m pip install Pillow
python3 scripts/build-panel-gifs.py /path/to/captured-frames
```

原始 PNG 和临时构建目录不入库。刷新录制时同步更新本文件日期；新增 UI 文案或调整组件后，应重新录制对应组，避免仅修改动图说明。

仅更新证据链动图时可执行：

```bash
python3 scripts/build-panel-gifs.py /path/to/evidence-frames --only evidence-chain
```
