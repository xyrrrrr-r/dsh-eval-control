import { ESTIMATE_PARTS } from './contextEstimate.js';
import { groupFeedback, feedbackSummary } from './feedbackGroups.js';
import type { InjectionHistory } from './injectionHistory.js';
import { eventRef, messageEvidence, stepEvidence, compactionEvidence, spikeInfo, type EvidenceProps } from './evidence.js';
/**
 * Evolution timeline tab (PRD §3.4): the context growth line chart with
 * compaction/injection/retry markers, the window-limit line, hover tooltips,
 * drag-zoom, and legend toggles. Event sequence locates markers between
 * requests, including when timestamps collide.
 */
import { useState } from './react-binding.js';
import { h } from './react-binding.js';
import { formatFull, formatTime, formatTokens } from './format.js';
import { LineChart, type ChartMarker, type LineSeries } from './charts.js';
import { isInjected, stepContextOf, type DashboardData } from './derive.js';
import { dominantOf, mechanismLabel } from './tab-tokens.js';

export function EvolutionTab(props: EvidenceProps & { data: DashboardData; injectionHistory?: InjectionHistory }): unknown {
  const { data } = props;
  const [hidden, setHidden] = useState<string[]>(['surface', 'output']);
  const [estimateSeq,setEstimateSeq]=useState('');
  const [feedbackScope,setFeedbackScope]=useState('top');
  const [xMode, setXMode] = useState<'step' | 'time' | 'turn'>('step');
  const [markerKinds, setMarkerKinds] = useState<Array<ChartMarker['kind']>>(['compaction', 'prune', 'injection', 'feedback', 'spike']);
  const timeline = data.timeline;
  const sessionId = props.evidenceSessionId ?? data.analytics?.teamInput?.sessionId ?? 'current';
  const steps = data.steps;

  if (steps.length === 0 && (timeline?.injections ?? []).length === 0 && (timeline?.compactions ?? []).length === 0) {
    return h('div', { style: emptyStyle }, '暂无演化数据。开始对话后，这里将展示上下文随时间的增长曲线与压缩事件。');
  }

  const contextWindow = data.contextWindow;
  // Keep every request: the last request alone hides compactions within a turn.
  const sampleSteps = props.injectionHistory?.requests ?? steps;
  const markerMessages = props.injectionHistory?.messages ?? timeline?.injections ?? [];
  const compactions = props.injectionHistory?.compactions ?? timeline?.compactions ?? [];
  const axisSteps = sampleSteps;
  const events = [...axisSteps.map(step => ({...step,timeMs:0})), ...steps, ...markerMessages, ...compactions]
    .sort((a, b) => a.seq - b.seq);
  const eventSeqs = [...new Set(events.map((event) => event.seq))];
  const xOf = (seq: number, timeMs: number): number => {
    if (xMode === 'time') return timeMs;
    const index = axisSteps.findIndex((step) => step.seq >= seq);
    const nextIndex = index < 0 ? axisSteps.length : index;
    const previous = axisSteps[nextIndex - 1];
    const next = axisSteps[nextIndex];
    if (xMode === 'step') {
      if (next?.seq === seq) return nextIndex + 1;
      const lo = previous?.seq ?? (eventSeqs[0] ?? seq) - 1;
      const hi = next?.seq ?? (eventSeqs[eventSeqs.length - 1] ?? seq) + 1;
      return nextIndex + (seq - lo) / Math.max(1, hi - lo);
    }
    const turn = next?.turn ?? previous?.turn ?? 1;
    const members = eventSeqs.filter((value) => {
      const request = axisSteps.find((step) => step.seq >= value) ?? axisSteps[axisSteps.length - 1];
      return (request?.turn ?? 1) === turn;
    });
    return turn + Math.max(0, members.indexOf(seq)) / Math.max(1, members.length);
  };
  const estimateStep=sampleSteps.find(step=>String(step.seq)===estimateSeq)??sampleSteps[sampleSteps.length-1];
  const xs = sampleSteps.map((step) => xOf(step.seq, step.timeMs));
  const series: LineSeries[] = [
    {
      key: 'occupancy',
      label: '上下文窗口占用（含缓存读）',
      color: '#4285f4',
      points: sampleSteps.map((step, index) => ({ x: xs[index]!, y: stepContextOf(step) })),
    },
    {
      key: 'surface',
      label: '上下文内容估算 Token',
      color: '#9b59b6',
      points: sampleSteps.map((step, index) => ({ x: xs[index]!, y: step.surfaceTokens })),
    },
    {
      key: 'output',
      label: '输出 Token（服务商）',
      color: '#8a8a8a',
      dashed: true,
      points: sampleSteps.map((step, index) => ({ x: xs[index]!, y: step.outputTokens })),
    },
  ];
  const failures = props.injectionHistory?.toolFailures ?? [];
  const failedSeqs = new Set(failures.map(f=>f.resultSeq));
  const injections = markerMessages.filter(isInjected);
  const feedback = markerMessages.filter((message) => message.kind === 'tool-result');
  const feedbackGroups=groupFeedback(feedback,axisSteps,failedSeqs);
  const visibleFeedbackGroups=feedbackScope==='all'?feedbackGroups:feedbackGroups.slice().sort((a,b)=>b.reduce((sum,row)=>sum+row.tokens,0)-a.reduce((sum,row)=>sum+row.tokens,0)).slice(0,10);
  const spikes = tokenSpikes(markerMessages);
  const detailedCompactions = new Map((timeline?.compactions ?? []).map(row => [row.seq,row]));
  const markers: ChartMarker[] = [];
  {
    for (const rawCompaction of compactions) {
      const compaction = props.injectionHistory ? detailedCompactions.get(rawCompaction.seq) ?? rawCompaction : rawCompaction;
      const markerKind = compaction.kind === 'summary' ? 'compaction' : 'prune';
      if (!markerKinds.includes(markerKind)) continue;
      const x = xOf(compaction.seq, compaction.timeMs);
      if (x === null) continue;
      const kind = compaction.kind === 'summary' ? '摘要压缩' : '历史修剪';
      const turn = compaction.kind === 'summary' && compaction.turn !== null ? `（第 ${compaction.turn} 轮）` : '';
      const before = compaction.beforeTokens === null ? '?' : formatTokens(compaction.beforeTokens);
      const after = compaction.afterTokens === null ? '?' : formatTokens(compaction.afterTokens);
      const reclaimed = compaction.reclaimedTokens === null ? '回收未回填' : `回收 ${formatTokens(compaction.reclaimedTokens)}`;
      const ratio = compaction.reclaimRatio === null ? '' : `，回收比 ${(compaction.reclaimRatio * 100).toFixed(1)}%`;
      markers.push({
        x,
        kind: markerKind,
        onEvidence: props.onEvidence ? () => props.onEvidence?.(compactionEvidence(sessionId, [compaction])) : undefined,
        title: `${kind}${turn} @ ${formatTime(compaction.timeMs)}：${before} → ${after}，${reclaimed}${ratio}`,
      });
    }
  }
  for (const kind of ['injection'] as const) {
    if (!markerKinds.includes(kind)) continue;
    for (const message of injections) {
      const x = xOf(message.seq, message.timeMs);
      if (x === null) continue;
      markers.push({
        x,
        kind,
        onEvidence: props.onEvidence ? () => props.onEvidence?.(messageEvidence(sessionId, message, [message])) : undefined,
        title: `上下文注入（${message.kind} / ${message.sourceKind}）@ ${formatTime(message.timeMs)} · 约 ${formatTokens(message.tokens)} Token`,
      });
    }
  }
  if (markerKinds.includes('feedback')) {
    for(const group of visibleFeedbackGroups) {
      const first=group[0]!;const last=group[group.length-1]!;
      const nextRequest=axisSteps.find(request=>request.seq>last.seq);
      const previousRequest=axisSteps.slice().reverse().find(request=>request.seq<=first.seq);
      const interval=`原始请求事件 ${previousRequest?`#${previousRequest.seq}`:'会话起点'} → ${nextRequest?`#${nextRequest.seq}`:'等待下次请求'}`;
      markers.push({kind:'feedback',x:(xOf(first.seq,first.timeMs)+xOf(last.seq,last.timeMs))/2,title:`${interval} · ${feedbackSummary(group)} · 虚线为本组结果位置的中点，并非单条事件`,onEvidence:props.onEvidence?()=>props.onEvidence?.({title:'请求区间工具回填',conclusion:`${interval} · ${feedbackSummary(group)}`,level:'derived',rule:'按相邻模型请求之间的结果事件聚合；失败结果独立展示，不计入此组。Token 为结果内容估算，并非窗口净增量。',facts:group.map(row=>({label:`#${row.seq} · ${row.toolName??'未知工具'}`,value:`${formatTokens(row.tokens)} Token · callId ${row.callId??'未提供'}`,source:'原始工具结果'})),refs:group.map(row=>eventRef(sessionId,row.seq,'区间工具结果')),notes:['每条结果可通过事件序号检查原始内容。']}):undefined});
    }
    for(const message of feedback.filter(row=>failedSeqs.has(row.seq))) {
      const failure=failures.find(f=>f.resultSeq===message.seq)!;
      markers.push({kind:'feedback',failed:true,x:xOf(message.seq,message.timeMs),title:`失败回填 #${message.seq} · ${failure.name} · ${formatTokens(message.tokens)} Token · ${failure.analysis}`,onEvidence:props.onEvidence?()=>props.onEvidence?.({...messageEvidence(sessionId,message,[message]),toolFailures:[failure],refs:[...(failure.callSeq!==undefined?[{...eventRef(sessionId,failure.callSeq,'失败工具调用'),failed:true}]:[]),{...eventRef(sessionId,message.seq,'错误结果'),failed:true}]}):undefined});
    }
  }
  if (markerKinds.includes('spike')) {
    for (const message of spikes) {
      const x = xOf(message.seq, message.timeMs);
      if (x === null) continue;
      const dominant = dominantOf(message);
      markers.push({
        x,
        kind: 'spike',
        onEvidence: props.onEvidence ? () => {
          const chain=messageEvidence(sessionId,message,markerMessages,true);
          const call=message.callId?props.injectionHistory?.toolCalls?.find(call=>call.callId===message.callId):undefined;
          if(message.kind==='tool-result') {
            chain.facts.push({label:'工具结果与激增的关联',value:`${message.toolName??call?.name??'未知工具'} · callId ${message.callId??'未提供'}`,source:'该激增消息本身就是工具结果；不表示工具调用导致了其他消息激增'});
            if(call)chain.refs.push(eventRef(sessionId,call.seq,'产生该激增结果的工具调用'));
          } else chain.notes.push('该激增来自消息本身，不能仅凭邻近工具调用判定因果关系。');
          props.onEvidence?.(chain);
        } : undefined,
        title: `单条消息 #${message.seq} 约 ${formatTokens(message.tokens)} Token · ${message.kind==='tool-result'?`工具结果关联：${message.toolName??'未知工具'} · callId ${message.callId??'未提供'}`:`消息来源：${mechanismLabel(message)}`} · 主导成分 ${dominant.label} ${dominant.share.toFixed(0)}% · @ ${formatTime(message.timeMs)}`,
      });
    }
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
    h('div', {
      key: 'controls',
      style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
    }, [
      h('span', { key: 'title', style: { fontSize: '13px', fontWeight: 500 } }, '上下文演化'),
      h('div', { key: 'xmode', style: { display: 'inline-flex', border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', borderRadius: '6px', overflow: 'hidden' } }, [
        h('button', {
          key: 'step', type: 'button', onClick: () => setXMode('step'),
          style: xModeButtonStyle(xMode === 'step'),
        }, '按步骤'),
        h('button', {
          key: 'turn', type: 'button', onClick: () => setXMode('turn'),
          style: xModeButtonStyle(xMode === 'turn'),
        }, '按轮次'),
        h('button', {
          key: 'time', type: 'button', onClick: () => setXMode('time'),
          style: xModeButtonStyle(xMode === 'time'),
        }, '按时间'),
      ]),
      h('span', { key: 'hint', style: { fontSize: '11px', opacity: 0.55 } }, `请求样本 ${sampleSteps.length} 条 · ${props.injectionHistory ? '全部事件标记来自原始会话' : '事件标记来自已保留记录'}${contextWindow !== null ? ` · 窗口上限 ${formatFull(contextWindow)}` : ''}`),
      h('span', { key: 'gap', style: { flex: '1 1 8px' } }),
      markerChip('compaction', `摘要压缩 ${compactions.filter((event) => event.kind === 'summary').length}`, 'var(--dsh-eval-green, #30a46c)', markerKinds.includes('compaction'), () => toggleKind(markerKinds, setMarkerKinds, 'compaction')),
      markerChip('prune', `历史修剪 ${compactions.filter((event) => event.kind === 'prune').length}`, '#0891b2', markerKinds.includes('prune'), () => toggleKind(markerKinds, setMarkerKinds, 'prune')),
      markerChip('injection', `上下文注入 ${injections.length}`, 'var(--dsh-eval-orange, #e8791a)', markerKinds.includes('injection'), () => toggleKind(markerKinds, setMarkerKinds, 'injection')),
      markerChip('feedback', `回填 ${visibleFeedbackGroups.length}/${feedbackGroups.length} 组 · 共 ${feedback.length} 次 · 失败 ${feedback.filter(row=>failedSeqs.has(row.seq)).length} 次`, '#64748b', markerKinds.includes('feedback'), () => toggleKind(markerKinds, setMarkerKinds, 'feedback')),
      h('select',{'aria-label':'回填显示范围',value:feedbackScope,onChange:(event:{target:{value:string}})=>setFeedbackScope(event.target.value),style:{font:'inherit',fontSize:11}},[h('option',{value:'top'},'重点回填：Token 最高 10 组'),h('option',{value:'all'},'全部回填区间')]),
      markerChip('spike', `激增 ${spikes.length}`, 'var(--dsh-eval-red, #e5484d)', markerKinds.includes('spike'), () => toggleKind(markerKinds, setMarkerKinds, 'spike')),
    ]),
    h(LineChart, {
      key: xMode,
      series,
      markers,
      onPointEvidence: props.onEvidence ? (index: number) => { const step = sampleSteps[index]; if (step) props.onEvidence?.(stepEvidence(sessionId, step, sampleSteps)); } : undefined,
      limit: contextWindow !== null && !hidden.includes('limit') ? { value: contextWindow, label: `上下文窗口上限 ${formatFull(contextWindow)} Token` } : null,
      height: 360,
      yLabel: 'Token',
      xLabel: xMode === 'step' ? '请求顺序' : xMode === 'turn' ? '轮次' : '时间',
      xTickValues: xMode === 'step' ? axisSteps.map((_,index)=>index+1) : undefined,
      hidden: new Set(hidden),
      onToggle: (key: string) => setHidden((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]),
      formatX: xMode === 'step'
        ? (value: number) => Number.isInteger(value) ? `第 ${value} 次请求` : `第 ${Math.floor(value)}–${Math.ceil(value)} 次请求之间`
        : xMode === 'turn'
          ? (value: number) => `第 ${Math.floor(value)} 轮`
          : (value: number) => formatTime(value),
    }),
    h('section',{key:'estimate-breakdown','aria-label':'上下文估算成分',style:{border:'1px solid #9994',borderRadius:8,padding:12,fontSize:12}},[
      h('strong',{},'上下文内容估算 · 成分与请求参与情况'),
      h('label',{},[' 查看请求 ',h('select',{'aria-label':'选择请求查看估算成分',value:String(estimateStep?.seq??''),onChange:(event:{target:{value:string}})=>setEstimateSeq(event.target.value)},sampleSteps.map((step,index)=>h('option',{key:step.seq,value:String(step.seq)},`第 ${index+1} 次请求 · 原始事件 #${step.seq}`)))]),
      estimateStep?.estimateParts?h('table',{style:{width:'100%',borderCollapse:'collapse'}},[
        h('thead',{},h('tr',{},['成分','估算 Token','请求参与情况','说明'].map(label=>h('th',{style:{textAlign:'left',padding:6}},label)))),
        h('tbody',{},ESTIMATE_PARTS.map(([key,label,status,description])=>h('tr',{key,style:{borderTop:'1px solid #9993'}},[h('td',{},label),h('td',{},formatFull(estimateStep.estimateParts![key])),h('td',{},status),h('td',{},description)]))),
      ]):h('p',{},'成分尚未读取；需从原始历史重建，不从总数反推成分。'),
      estimateStep?h('p',{},`内容估算合计 ${formatFull(estimateStep.surfaceTokens)} Token（包含历史思考） · 服务商输入占用 ${formatFull(stepContextOf(estimateStep))} Token。两者口径不同。`):null,
      h('p',{},'参与情况说明基于消息角色与适配器规则，均非本次请求已发送证明。原始轨迹没有完整序列化请求体时，不能确认各成分实际发送量；实际占用以服务商 usage 为准。工具定义、图片实际计价及协议转换开销不包含在此内容估算合计中。'),
      estimateStep&&props.onEvidence?h('button',{onClick:()=>props.onEvidence?.(stepEvidence(sessionId,estimateStep,sampleSteps))},'查看该请求用量证据'):null,
    ]),
    props.injectionHistory ? h('p', { key: 'coverage', role: 'status', style: {margin:0,fontSize:12} }, `${props.injectionHistory.phase === 'ready' ? '原始会话历史已完整加载（当前可读日志；无法判断是否有被清理的历史）' : props.injectionHistory.phase === 'loading' ? '正在读取原始历史，当前标记尚不完整' : props.injectionHistory.phase === 'partial' ? '历史未读完整，前段无标记不表示没有事件' : `历史读取失败：${props.injectionHistory.error}；当前标记不完整`} · 已解析消息 ${markerMessages.length} 条 · 压缩/修剪 ${compactions.length} 条 · 原始事件范围 ${props.injectionHistory.firstSeq ?? '?'}–${props.injectionHistory.lastSeq ?? '?'}`) : null,
    h('p',{key:'tool-spike-link',style:{margin:0,fontSize:11,opacity:0.75}},`激增 ${spikes.length} 条，其中工具结果 ${spikes.filter(row=>row.kind==='tool-result').length} 条。此比例来自当前已加载消息；工具结果以 callId 关联原始调用，其他消息不按时间邻近推定因果。`),
    h('p', { key: 'basis', style: { margin: 0, fontSize: '11px', opacity: 0.65 } }, '蓝线为每次模型请求的输入占用（含缓存读）；紫线为请求前上下文内容的 Token 估算值。横轴按步骤显示请求顺序，详情中的原始事件 #序号属于另一套编号。事件虚线落在其发生的请求间隔内；聚合回填虚线表示组内位置中点。轮次内保留全部请求。回填按钮分别显示可见组数、全部普通区间组数及原始结果次数；默认仅展示 Token 最高 10 组和全部失败结果，可切换全部区间。上下文注入不含工具结果、助手输出和用户直接输入；工具回填按相邻模型请求区间聚合，失败结果独立标红。消息 Token 为估算值，不等于请求窗口实际增量。历史激增按全部追加消息的前 5 条基线计算；历史修剪/摘要压缩依据原始事件，未保留的前后用量显示未知。'),
    h('div', {
      key: 'legend-markers',
      style: { display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: '11px', opacity: 0.75 },
    }, [
      h('span', { key: 'm0', style: { opacity: 0.6, width: '100%' } }, '标记说明（点击上方芯片可筛选）：'),
      h('span', { key: 'm1', style: { color: 'var(--dsh-eval-green, #30a46c)' } }, '▲ 摘要压缩（绿色）'),
      h('span', { key: 'prune', style: { color: '#0891b2' } }, '■ 历史修剪（青色，独立一行）'),
      h('span', { key: 'm2', style: { color: 'var(--dsh-eval-orange, #e8791a)' } }, '● 上下文注入（橙色）'),
      h('span', { key: 'feedback', style: { color: '#64748b' } }, '● 工具结果回填（灰蓝色）'),
      h('span', { key: 'm3', style: { color: 'var(--dsh-eval-red, #e5484d)' } }, '◆ Token 激增'),
      h('button', { key: 'm4', type: 'button', 'aria-pressed': !hidden.includes('limit'), onClick: () => setHidden((current) => current.includes('limit') ? current.filter((key) => key !== 'limit') : [...current, 'limit']), style: { background: 'transparent', border: 0, cursor: 'pointer', font: 'inherit', color: 'var(--dsh-eval-red, #e5484d)', opacity: hidden.includes('limit') ? 0.4 : 1 } }, '― ― 窗口上限（红色虚线）'),
    ]),
    /* Compaction savings summary */
    (timeline?.compactions?.length ?? 0) > 0 ? h('div', {
      key: 'savings',
      style: {
        border: '1px solid color-mix(in srgb, currentColor 14%, transparent)', borderRadius: '10px',
        padding: '10px 14px', fontSize: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px 20px',
      },
    }, [
      h('span', { key: 't', style: { fontWeight: 600 } }, '上下文回收'),
      h('span', { key: 'count' }, `已记录：摘要压缩 ${compactions.filter((event) => event.kind === 'summary').length} 次 · 历史修剪 ${compactions.filter((event) => event.kind === 'prune').length} 次（每条为一次修剪事件）`),
      h('span', { key: 'reclaimed' }, `回收 ${formatTokens(timeline!.compactionTotals.reclaimedTokens)} Token`),
      h('span', { key: 'elapsed' }, `累计耗时 ${(timeline!.compactionTotals.elapsedMs / 1000).toFixed(1)}s`),
    ]) : null,
  ]);
}

/** Toggle one marker class in the filter set. */
function toggleKind(
  current: Array<ChartMarker['kind']>,
  setKinds: (value: Array<ChartMarker['kind']>) => void,
  kind: ChartMarker['kind'],
): void {
  setKinds(current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]);
}

/** Token spikes over the message ledger — same heuristic as the tokens tab
 * (≥3× the median of the previous 5 messages, ≥1000 absolute). */
function tokenSpikes(messages: DashboardData['messages']): DashboardData['messages'] {
  const ordered = messages.slice().sort((a,b)=>a.seq-b.seq);
  return ordered.filter((message,index) => spikeInfo(ordered.slice(Math.max(0,index-5),index+1), message.seq) !== null);
}

/** A filter chip for the marker classes. */
function markerChip(kind: ChartMarker['kind'], label: string, color: string, active: boolean, onToggle: () => void): unknown {
  return h('button', {
    key: `mk-${kind}`,
    type: 'button',
    onClick: onToggle,
    title: `显示/隐藏 ${label.replace(/ \d+$/, '')}标记`,
    'aria-pressed': active,
    style: {
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '1px 9px', borderRadius: '999px', font: 'inherit', fontSize: '11px',
      cursor: 'pointer', color: 'inherit',
      border: `1px solid ${active ? color : 'color-mix(in srgb, currentColor 18%, transparent)'}`,
      background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
      opacity: active ? 1 : 0.45,
    },
  }, [
    h('span', { key: 'shape', style: { color } }, kind === 'compaction' ? '▲' : kind === 'prune' ? '■' : kind === 'injection' ? '●' : '◆'),
    h('span', { key: 'label' }, label),
  ]);
}

function xModeButtonStyle(active: boolean): Record<string, unknown> {
  return {
    background: active ? 'color-mix(in srgb, currentColor 12%, transparent)' : 'transparent',
    border: 'none', padding: '2px 10px', font: 'inherit', fontSize: '11.5px', cursor: 'pointer', color: 'inherit',
  };
}

const emptyStyle = {
  textAlign: 'center', padding: '48px 20px', opacity: 0.55, fontSize: '13px',
} as const;
