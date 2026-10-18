/** Metric display vocabulary and value formatting (ported + extended). */

export const METRIC_LABELS: Record<string, string> = {
  'tool.call_elapsed_ms': '工具调用耗时',
  'tool.failure_rate': '工具显式错误率',
  'tool.repeat_loop': '重复调用循环',
  'tool.error_recovery': '错误恢复',
  'tool.repeat_overhead': '重复调用开销',
  'compaction.summary_cycles': '摘要压缩周期',
  'compaction.elapsed_ms': '压缩耗时',
  'compaction.shadowed_tokens': '摘要覆盖 Token',
  'compaction.prune_passes': '历史修剪批次',
  'compaction.reclaimed_tokens_per_call_token': '回收比例',
  'context.compaction_frequency_per_1k_input_tokens': '压缩频率',
  'context.compaction_time_share': '压缩时间占比',
  'context.input_window_utilization': '输入窗口占用',
  'model.step_to_first_chunk_ms': '步骤首块延迟',
  'model.stream_span_ms': '流式输出跨度',
  'model.retry_recovery': '模型重试恢复',
  'model.long_gap_segments': '长间隔段',
  'planning.todo_snapshot_change': 'Todo 快照变更',
  'planning.rewrite_after_completion': '完成后重写',
  'coordination.inbox_insert_to_message_event_ms': '收件箱入队到浮出',
  'coordination.inbox_tool_overlap_share': '等待期工具重叠',
  'coordination.team_delivery_ms': 'Team 消息投递',
  'coordination.delegation_depth': '委派深度',
  'coordination.fan_out_width': '成员扇出',
  'coordination.member_idle_ms': '成员空闲(不可得)',
  'coordination.member_busy_ms': '成员忙碌时长',
  'coordination.active_members_now': '当前活跃成员',
  'coordination.peak_concurrent_members': '并发峰值成员',
  'coordination.team_completion_wall_ms': 'Team 完成墙钟',
  'coordination.branch_first_activity_ms': '分支首活动延迟',
  'coordination.task_blocked_duration': '任务阻塞时长',
  'coordination.team_path_critical_segments': '关键依赖路径',
  'outcome.turn_reason_mix': '轮次结束原因',
  'outcome.turn_completion_evidence': '轮次完成证据',
  'data_quality.trajectory_coverage': '数据质量覆盖',
};

export function formatMetricValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (Array.isArray(item)) return `${key}:[${item.slice(0, 4).join(', ')}${item.length > 4 ? ', …' : ''}]`;
      return `${key}:${typeof item === 'number' && !Number.isInteger(item) ? item.toFixed(3) : String(item)}`;
    });
    return parts.join(' · ');
  }
  return String(value);
}
