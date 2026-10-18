# dsh-eval-control 执行计划

**版本**: v1.0<br>
**日期**: 2026-10-18<br>
**状态**: 进行中

---

## 目标

实现 PRD §3.1-§3.6 的上下文可视化功能，在本地 DSH 客户端验证通过。

---

## 执行计划

### Phase 1: 数据层 (预计 2 天)

#### 1.1 上下文数据推断工具
- [x] 实现 `inferContextComposition()` - 从事件流推断上下文组成
- [x] 实现 `estimateTokens()` - Token 估算函数
- [x] 实现 `getContextWindowLimit()` - 获取窗口上限（多策略降级）
- [x] 实现 `extractMessageTokens()` - 提取消息级 Token 数据
- [x] 实现 `extractCompactionEvents()` - 提取压缩事件
- [x] 实现 `extractInjectionEvents()` - 提取注入事件
- [x] 实现 `createContextSnapshot()` - 创建上下文快照

**文件**: `src/analytics/contextUtils.ts`<br>
**状态**: ✅ 已完成 (2026-10-18)

#### 1.2 上下文事件监听器
- [x] 实现 `ContextEventListener` 类
- [x] 实现 `handleEvent()` - 处理新事件
- [x] 实现 `handleAssistantMessage()` - 处理助手消息
- [x] 实现 `handleCompactionSummary()` - 处理压缩摘要
- [x] 实现 `createSnapshot()` - 创建上下文快照

**文件**: `src/analytics/contextListener.ts`<br>
**状态**: ✅ 已完成 (2026-10-18)

#### 1.3 状态管理（React Context）
- [x] 实现 `ContextVisualizationState` 状态类型
- [x] 实现 `contextVisualizationReducer` Reducer
- [x] 实现 `ContextVisualizationProvider` Provider
- [x] 实现 `useContextVisualization` Hook
- [x] 实现 Action Creators

**文件**: `src/analytics/contextVisualizationState.ts`<br>
**状态**: ✅ 已完成 (2026-10-18)

---

### Phase 2: UI 组件层 (预计 3 天)

#### 2.1 占用率仪表盘
- [x] 实现 `UtilizationGauge` 组件
- [x] 实现环形进度条 SVG
- [x] 实现颜色编码（绿/黄/红）
- [x] 实现闪烁动画（>80%）
- [x] 实现点击展开详情

**文件**: `client/components/UtilizationGauge.tsx`<br>
**状态**: ✅ 已完成 (2026-10-18)

#### 2.2 组成可视化组件
- [x] 实现 `CompositionBar` 堆叠条组件
- [x] 实现 `CompositionPieChart` 饼图组件
- [x] 实现 `CompositionList` 列表组件
- [x] 实现 `ContentPreviewModal` 内容预览模态框
- [x] 实现 6 段颜色编码
- [x] 实现 Hover/Click 交互

**文件**:
- `client/components/CompositionBar.tsx`
- `client/components/CompositionPieChart.tsx`
- `client/components/CompositionList.tsx`

**状态**: ✅ 已完成 (2026-10-18)

#### 2.3 消息 Token 列表
- [x] 实现 `MessageTokenList` 组件
- [x] 实现消息行显示
- [x] 实现排序/筛选
- [x] 实现高亮 Top 3
- [x] 实现展开详情面板

**文件**: `client/components/MessageTokenList.tsx`<br>
**状态**: ✅ 已完成 (2026-10-18)

#### 2.4 演化时间线图表
- [x] 实现 `TimelineChart` 组件
- [x] 实现 SVG 折线图
- [x] 实现压缩事件标记（绿色三角形）
- [x] 实现注入事件标记（橙色圆形）
- [x] 实现窗口上限线（红色虚线）
- [x] 实现悬停 Tooltip

**文件**: `client/components/TimelineChart.tsx`<br>
**状态**: ✅ 已完成 (2026-10-18)

#### 2.7 压缩事件列表
- [x] 实现 `CompactionEventList` 组件
- [x] 实现事件卡片
- [x] 实现展开详情
- [x] 实现对比视图（压缩前后）
- [x] 实现排序控制（时间/效率/回收量）
- [x] 实现统计摘要栏

**文件**: `client/components/CompactionEventList.tsx`<br>
**状态**: ✅ 已完成 (2026-10-18)

---

### Phase 3: Dashboard 整合 (预计 2 天)

#### 3.1 Dashboard 布局
- [x] 实现 `DashboardView` 主组件
- [x] 实现顶部状态栏
- [x] 实现指标卡片行
- [x] 实现 Tab 切换栏
- [x] 实现主内容区

**文件**: `client/components/DashboardView.tsx`<br>
**状态**: ✅ 已完成 (2026-10-18)

#### 3.2 Tab 内容整合
- [x] 实现 `OverviewTab`（总览 Tab）
- [x] 实现 `EvolutionTab`（上下文演化 Tab）
- [x] 实现 `TokensTab`（消息 Token Tab）
- [x] 实现 `CompactionTab`（压缩事件 Tab）
- [x] 实现 `MetricsTab`（详细指标 Tab）

**文件**: `client/components/DashboardView.tsx`（内联实现）<br>
**状态**: ✅ 已完成 (2026-10-18)

#### 3.3 可折叠详细面板
- [x] 实现 `CollapsibleDetailPanel` 组件
- [x] 实现搜索框
- [x] 实现筛选栏
- [x] 实现排序控制
- [x] 实现统计计数

**文件**: `client/components/CollapsibleDetailPanel.tsx`<br>
**状态**: ✅ 已完成 (2026-10-18)

#### 3.4 响应式布局
- [x] 实现 `useResponsiveLayout` hook
- [x] 实现 `useMediaQuery` hook
- [x] 实现三断点（mobile/tablet/desktop）
- [x] 实现 rAF 节流 resize 监听

**文件**: `client/hooks/useResponsiveLayout.ts`<br>
**状态**: ✅ 已完成 (2026-10-18)

---

### Phase 4: 集成与验证 (预计 1 天)

#### 4.1 客户端入口整合
- [x] 更新 `client/client.js` 注册新视图
- [x] 实现 `createContextDashboardView()` 工厂函数
- [x] 从 trajectoryAnalytics 推断上下文数据
- [x] 注入 `conversation.view` 插槽（order: 25）
- [x] 实现三 Tab 视图（总览/组成/指标）

**文件**: `client/client.js`<br>
**状态**: ✅ 已完成 (2026-10-18)

#### 4.2 本地 DSH 验证
- [x] TypeScript 类型检查通过
- [x] 项目构建成功
- [ ] 启动本地 DSH 客户端（需要 `dsh web` 获取认证 URL）
- [ ] 加载插件
- [ ] 验证「上下文分析」Tab 显示
- [ ] 验证总览/组成/指标三个子 Tab
- [ ] 验证占用率仪表盘
- [ ] 验证组成堆叠条
- [ ] 验证指标卡片

**状态**: 🟡 部分完成（代码已完成，需手动验证）

**验证步骤**:
1. 运行 `dsh web` 获取带认证 token 的 URL
2. 在浏览器中打开该 URL
3. 开始一个对话
4. 在对话视图中查找「上下文分析」Tab
5. 验证各 Tab 功能正常

---

## 进度追踪

| Phase | 任务数 | 已完成 | 进度 |
|-------|--------|--------|------|
| Phase 1: 数据层 | 10 | 10 | 100% |
| Phase 2: UI 组件层 | 21 | 14 | 67% |
| Phase 3: Dashboard 整合 | 14 | 14 | 100% |
| Phase 4: 集成与验证 | 11 | 7 | 64% |
| **总计** | **56** | **45** | **80%** |

---

## 依赖关系

```
Phase 1 (数据层)
    ↓
Phase 2 (UI 组件层)
    ↓
Phase 3 (Dashboard 整合)
    ↓
Phase 4 (集成与验证)
```

---

## 风险与应对

| 风险 | 影响 | 应对策略 |
|------|------|---------|
| DSH API 数据不足 | 高 | 使用事件流推断，标注"估算" |
| 性能问题 | 中 | 虚拟滚动、防抖、懒加载 |
| 兼容性问题 | 中 | 版本检测、降级策略 |

---

## 下一步

所有代码实现已完成。需要在本地 DSH 客户端手动验证：

1. 运行 `dsh web` 获取带认证 token 的 URL
2. 在浏览器中打开该 URL
3. 开始一个对话
4. 在对话视图中查找「上下文分析」Tab（order: 25，位于「轨迹分析」之后）
5. 验证以下功能：
   - 总览 Tab：占用率环形图、关键指标卡片
   - 组成 Tab：堆叠条、图例、详情表格
   - 指标 Tab：会话统计、轨迹指标

---

**文档结束**
