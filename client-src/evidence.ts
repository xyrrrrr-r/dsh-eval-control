import type { ToolFailure } from './toolErrors.js';
/** Evidence snapshots are computed from the same inputs as the displayed fact. */
import type { ContextTimeline, MetricResult, TrajectoryAnalytics } from './types.js';
import { formatMs, formatTokens } from './format.js';
import { METRIC_LABELS } from './metricLabels.js';
export interface EvidenceRef { sessionId: string; seq: number; role: string; failed?: boolean }
export interface CalculationField {
  label: string;
  path: string;
  value: number | null;
  eventType: string;
  ref?: EvidenceRef;
}
export interface ContextCalculation {
  fields: CalculationField[];
  occupancy: number | null;
  window: number | null;
  ratio: number | null;
}
export interface EvidenceChain {
  diagnosisScope?: 'overview';
  overviewSnapshot?: unknown;
  toolFailures?: ToolFailure[];
  contextCalculation?: ContextCalculation;
  title: string; conclusion: string; rule: string;
  level: 'observed' | 'derived' | 'inferred';
  facts: Array<{ label: string; value: string; source: string }>;
  refs: EvidenceRef[]; notes: string[];
}
export interface EvidenceProps { onEvidence?: (chain: EvidenceChain) => void; evidenceSessionId?: string }
type Message = ContextTimeline['injections'][number];
export const eventRef = (sessionId: string, seq: number, role: string): EvidenceRef => ({sessionId, seq, role});
export function uniqueEvidenceRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const map = new Map<string, EvidenceRef>();
  for (const ref of refs) {
    if (!ref.sessionId || !Number.isSafeInteger(ref.seq) || ref.seq < 0) continue;
    const key = JSON.stringify([ref.sessionId, ref.seq]);
    const previous = map.get(key);
    if (previous && ref.failed) previous.failed = true;
    if (previous) previous.role = [...new Set([...previous.role.split(' / '), ...ref.role.split(' / ')])].join(' / ');
    else map.set(key, {...ref});
  }
  return [...map.values()];
}
export function metricEvidence(metric: MetricResult): EvidenceChain {
  return {title: METRIC_LABELS[metric.metricId] ?? metric.metricId,
    conclusion: JSON.stringify(metric.value) ?? '无可用数值', level: metric.evidenceLevel ?? 'inferred',
    rule: `${METRIC_RULES[metric.metricId] ?? '按宿主指标契约计算；关联事件用于核对实际输入，当前界面不推断未记录的中间值。'} 指标契约 ${metric.metricId} · v${metric.contractVersion ?? '未知'} · 对象 ${metric.subjectId}`,
    facts: [{label:'状态',value:metric.status ?? '未记录',source:'指标投影'}, {label:'样本数',value:String(metric.sampleCount ?? '未知'),source:'指标投影'},
      ...(metric.denominator !== undefined ? [{label:'分母',value:String(metric.denominator),source:'指标投影'}] : [])],
    refs: uniqueEvidenceRefs((metric.evidenceRefs ?? []).map(ref => ({...ref,role:'指标计算依据'}))),
    notes: ['关联引用为投影保留的有界证据，不保证包含累计统计的全部原始事件。', ...(metric.qualityRefs ?? []).map(code => `数据质量：${code}`),
      ...(metric.evidenceRefs?.length ? [] : ['此指标未提供事件引用，无法定位原始依据。'])]};
}
/** Shared by the message ledger and evolution markers; retained-window baseline only. */
export function spikeInfo(messages: Message[], seq: number): {median:number; ratio:number; baseline:Message[]} | null {
  const ordered = messages.slice().sort((a,b)=>a.seq-b.seq);
  const index = ordered.findIndex(message=>message.seq===seq);
  if(index<0) return null;
  const baseline=ordered.slice(Math.max(0,index-5),index);
  if(baseline.length<3) return null;
  const values=baseline.map(message=>message.tokens).sort((a,b)=>a-b);
  const median=values[Math.floor(values.length/2)]!;
  const current=ordered[index]!;
  return current.tokens>=1000 && current.tokens>=median*3 ? {median,ratio:median>0?current.tokens/median:Infinity,baseline} : null;
}
export function messageEvidence(sessionId:string, message:Message, messages:Message[], anomaly=false):EvidenceChain {
  const ordered=messages.slice().sort((a,b)=>a.seq-b.seq);
  const previous=ordered[ordered.findIndex(item=>item.seq===message.seq)-1];
  const spike=anomaly?spikeInfo(messages,message.seq):null;
  const components=[['文本',message.textTokens],['工具调用',message.toolCallTokens],['文件/图像',message.fileTokens]] as const;
  const componentTotal=components.reduce((sum,[,value])=>sum+value,0);
  const dominant=components.slice().sort((a,b)=>b[1]-a[1])[0]!;
  const facts:EvidenceChain['facts']=[{label:'消息内容估算 Token',value:formatTokens(message.tokens),source:'消息内容估算（非服务商输出用量）'},
    {label:'主导成分',value:`${dominant[0]} ${componentTotal>0?(dominant[1]/componentTotal*100).toFixed(1):0}%（${formatTokens(dominant[1])}）`,source:'消息成分估算（分母为文本、工具调用、文件/图像之和）'},
    {label:'模型输出用量',value:message.outputTokens===null||message.outputTokens===undefined?'未记录':formatTokens(message.outputTokens),source:'同一消息记录中的服务商 usage'}];
  if(previous) {
    facts.push({label:`#${previous.seq} → #${message.seq} 消息体积差`,value:`${message.tokens-previous.tokens} Token`,source:'两条已保留消息的表面估算值之差；不是上下文净增量'});
    facts.push({label:'相邻消息时间间隔',value:message.timeMs>=previous.timeMs?formatMs(message.timeMs-previous.timeMs):'时间倒序，无法计算',source:`已保留消息 #${previous.seq} 与 #${message.seq} 的时间戳；不代表生成耗时`});
  }
  if(spike) facts.push({label:'检测基线',value:`${spike.baseline.length} 条消息中位数 ${formatTokens(spike.median)} · ${Number.isFinite(spike.ratio)?spike.ratio.toFixed(1)+'×':'基线为 0'}`,source:'按事件顺序的前 5 条已保留消息（至少 3 条）'});
  return {title:`${spike?'突增':'消息'} #${message.seq}`,conclusion:`${message.kind} · ${formatTokens(message.tokens)} Token`,level:'derived',
    rule:anomaly?'单条消息 ≥ 1,000 Token 且 ≥ 前 5 条消息中位数的 3 倍；至少 3 条基线样本。':'消息体积和成分来自表面内容估算；模型输出用量独立展示。',facts,
    refs:uniqueEvidenceRefs([eventRef(sessionId,message.seq,'当前消息'),...(spike?.baseline??(previous?[previous]:[])).map(item=>eventRef(sessionId,item.seq,spike?'突增基线':'相邻已保留消息'))]),
    notes:['仅使用已保留消息，不保证事件序号连续。时间相邻不构成因果关系。',...(anomaly&&!spike?['当前保留窗口不足以复现突增规则，不能确认该异常。']:[])]};
}
export function stepEvidence(sessionId:string, step:ContextTimeline['steps'][number], steps:ContextTimeline['steps']):EvidenceChain {
  const index=steps.findIndex(item=>item.seq===step.seq); const previous=steps[index-1];
  const occupancy=step.inputTokens+(step.cacheReadTokens??0);
  return {title:`请求 #${step.seq}`,conclusion:`上下文占用 ${formatTokens(occupancy)} Token`,level:'derived',rule:'上下文占用 = 未缓存输入 + 缓存读取；输出与表面估算分别展示。',
    facts:[{label:'未缓存输入',value:formatTokens(step.inputTokens),source:'服务商 usage'},{label:'缓存读取',value:step.cacheReadTokens===null?'未记录（曲线按 0 回退）':formatTokens(step.cacheReadTokens),source:'服务商 usage'},
      {label:'输出',value:formatTokens(step.outputTokens),source:'服务商 usage'},{label:'表面内容',value:formatTokens(step.surfaceTokens),source:'请求前表面估算'},
      ...(previous?[{label:`相对请求 #${previous.seq}`,value:`${occupancy-previous.inputTokens-(previous.cacheReadTokens??0)} Token`,source:'请求占用之差，不直接归因于区间内某个事件'}]:[])],
    refs:[eventRef(sessionId,step.seq,'当前请求用量'),...(previous?[eventRef(sessionId,previous.seq,'前次请求用量')]:[])],notes:['请求样本序号与图中请求序数不同；此处使用原始事件序号。']};
}
export function compactionEvidence(sessionId:string, events:ContextTimeline['compactions']):EvidenceChain {
  const refs=events.flatMap(event=>[...(event.evidenceRefs ?? []).map(ref=>eventRef(sessionId,ref.seq,ref.role)),eventRef(sessionId,event.seq,event.kind==='summary'?'摘要压缩':'历史修剪'),
    ...(event.detail?.before.nodes.filter(node=>node.changed).map(node=>eventRef(sessionId,node.seq,'被替换消息'))??[]),
    ...(event.detail?.after?.nodes.filter(node=>node.changed).map(node=>eventRef(sessionId,node.seq,'替代消息 / 替换操作'))??[])]);
  return {title:events.length===1?`压缩事件 #${events[0]!.seq}`:`压缩证据 · ${events.length} 次`,conclusion:`已保留回收量 ${formatTokens(events.reduce((sum,event)=>sum+(event.reclaimedTokens??0),0))} Token`,level:'derived',
    rule:'每次回收量来自压缩前后表面估算值；展示聚合不表示同一宿主事务。',
    facts:events.flatMap(event=>[{label:`#${event.seq}`,value:`${event.beforeTokens??'未知'} → ${event.afterTokens??'未知'} Token`,source:event.detail?.algorithm??'无历史快照'}, {label:'压缩耗时',value:event.elapsedMs === null || event.elapsedMs === undefined ? '未记录' : formatMs(event.elapsedMs),source:'匹配 compaction/start 与 compaction/end 时间戳'}]),refs:uniqueEvidenceRefs(refs),
    notes:[...(events.some(event=>!event.evidenceRefs?.length)?['旧投影未记录生命周期引用；刷新投影后可追溯开始、替换与结束事件。']:[]),'历史快照有界；缺失或截断时无法列出全部被替换消息。',...(events.some(event=>event.reclaimedTokens===null)?['部分回收量未回填，合计仅包含已知值。']:[])]};
}
export function aggregateEvidence(sessionId:string, title:string, analytics:TrajectoryAnalytics|null, timeline:ContextTimeline|null, kind:'tokens'|'tools'|'errors'|'frequency'|'time'|'context'):EvidenceChain {
  if (kind === 'context') return contextOccupancyEvidence(sessionId, title, timeline);
  const metricId={tokens:'',tools:'',errors:'tool.failure_rate',frequency:'context.compaction_frequency_per_1k_input_tokens',time:'',context:'context.input_window_utilization'}[kind];
  const metrics=analytics?.metricResults?.filter(item=>item.metricId===metricId)??[];
  if(metrics.length) {
    const metric=metrics.find(item=>item.subjectId===sessionId)??metrics[metrics.length-1]!;
    return {...metricEvidence(metric),title};
  }
  const steps=timeline?.steps??[];
  const events=analytics?.recentEvents??[];
  const refs=(kind==='tokens'||kind==='time')?steps.map(step=>eventRef(sessionId,step.seq,'请求用量样本')):events.filter(event=>event.type==='tool/call'||event.type==='tool/result').map(event=>eventRef(sessionId,event.seq,event.type));
  const facts:EvidenceChain['facts']=kind==='tools'||kind==='errors'?[{label:'调用 / 显式错误',value:`${analytics?.toolCalls??'未知'} / ${analytics?.toolErrors??'未知'}`,source:'会话累计投影'}]:[{label:'未缓存输入累计',value:String(analytics?.inputTokens??'未知'),source:'会话累计投影'}, {label:'已保留请求用量样本',value:String(steps.length),source:'有界上下文投影'}];
  return {title,conclusion:'查看计算口径与关联原始事件',level:'derived',rule:kind==='tokens'?'总 Token = 累计未缓存输入 + 累计输出；不包含缓存读取。':kind==='time'?'模型耗时来自 sessionStats.llmMs；用量消息仅用于定位相关请求，不是耗时起止证据。':'调用与显式错误来自 tool/call 和 tool/result；不能将结果缺失当成成功。',facts,refs,
    notes:['累计统计与有界关联列表覆盖范围不同；以下并非完整计算样本。',...(kind==='time'?['当前投影没有提供累计模型耗时的完整起止引用，无法从这些引用重算耗时。']:[])]};
}
export function toolEvidence(sessionId:string, name:string, analytics:TrajectoryAnalytics|null, timeline:ContextTimeline|null, failures?:ToolFailure[]):EvidenceChain {
  const tool=timeline?.tools.find(item=>item.name===name);
  const calls=(analytics?.recentEvents??[]).filter(event=>event.type==='tool/call'&&event.label===name);
  const callIds=new Set(calls.map(event=>event.callId).filter(Boolean));
  const results=(analytics?.recentEvents??[]).filter(event=>event.type==='tool/result'&&!!event.callId&&callIds.has(event.callId));
  const metrics=(analytics?.metricResults??[]).filter(metric=>metric.metricId==='tool.call_elapsed_ms'&&callIds.has(metric.subjectId));
  const matched=failures?.filter(item=>item.name===name);
  return {toolFailures:matched ?? [],title:`工具 ${name}`,conclusion:`调用 ${tool?.calls??'未知'} 次 · 显式错误 ${tool?.errors??'未知'} 次`,level:'derived',rule:'当前工具累计计数；错误率 = 显式错误 / 调用数。关联结果按 callId 匹配。',
    facts:[{label:'已保留调用 / 结果',value:`${calls.length} / ${results.length}`,source:'最近事件窗口，不是全部调用历史'}],
    refs:uniqueEvidenceRefs([...(matched??[]).flatMap(failure=>[...(failure.callSeq!==undefined?[{...eventRef(sessionId,failure.callSeq,'失败工具调用'),failed:true}]:[]),{...eventRef(sessionId,failure.resultSeq,'错误结果'),failed:true}]),...calls.map(event=>eventRef(sessionId,event.seq,'工具调用')), ...results.map(event=>eventRef(sessionId,event.seq,'匹配调用结果')), ...metrics.flatMap(metric=>(metric.evidenceRefs ?? []).map(ref=>({...ref,role:'调用耗时起止'})))]),
    notes:['未匹配的结果不会视作成功；窗口外调用和错误需查阅完整日志。']};
}
const METRIC_RULES:Record<string,string>={
  'tool.failure_rate':'分子：去重且错误标记已知的失败结果；分母：去重且错误标记已知的全部结果。重复结果和缺失标记会降低证据完整性。',
  'context.compaction_frequency_per_1k_input_tokens':'摘要压缩周期数 / 未缓存输入 Token × 1,000；历史修剪不计入摘要压缩次数。',
  'model.long_gap_segments':'按事实事件时间戳检测 ≥30 秒间隔，并扣除可归因的工具、审批和压缩区间；未归因部分是推断。',
  'tool.repeat_loop':'按规范化调用摘要识别连续重复调用；重复不等于无效调用，业务合理性需要核对原始参数。',
  'tool.call_elapsed_ms':'同一 callId 的调用与结果事件时间差；缺失配对或重复结果时不能确认完整耗时。',
  'context.input_window_utilization':'请求未缓存输入 + 缓存读取，再除以该请求对应的上下文窗口上限。',
};
export function alertEvidence(sessionId:string, id:string, title:string, detail:string, analytics:TrajectoryAnalytics|null, timeline:ContextTimeline|null, observed:number|null, threshold:number):EvidenceChain {
  const metricId:Record<string,string>={'frequent-compaction':'context.compaction_frequency_per_1k_input_tokens','high-error-rate':'tool.failure_rate','token-waste':'tool.repeat_loop','long-gaps':'model.long_gap_segments'};
  const metric=(analytics?.metricResults??[]).find(item=>item.metricId===metricId[id]);
  const chain=metric?metricEvidence(metric):aggregateEvidence(sessionId,title,analytics,timeline,id==='context-overload'?'context':'tools');
  return {...chain,title,conclusion:detail,rule:`告警规则 ${id}；触发条件以当前规则设置为准。 ${chain.rule}`,facts:[
    {label:'告警检测值',value:observed===null?'数据不可用':String(observed),source:'与告警计算使用同一输入快照'},
    {label:'阈值',value:String(threshold),source:'用户规则设置（严格超过阈值触发；重复调用规则比较最大连续长度）'},...chain.facts],
    notes:[...chain.notes,...(!metric&&id!=='context-overload'?['该告警的契约指标缺失，无法提供完整检测证据。']:[])]};
}
export function dropEvidence(sessionId:string, message:Message, messages:Message[], compactions:ContextTimeline['compactions']):EvidenceChain {
  const ordered=messages.slice().sort((a,b)=>a.seq-b.seq);
  const previous=ordered[ordered.findIndex(item=>item.seq===message.seq)-1];
  const matches=previous?compactions.filter(event=>event.seq>previous.seq&&event.seq<=message.seq):[];
  return {title:`上下文骤降 #${message.seq}`,conclusion:previous?`${previous.cumulativeTokens} → ${message.cumulativeTokens} Token`:'缺少前次消息，无法重算',level:matches.length?'derived':'inferred',
    rule:'相邻已保留消息的累计表面估算下降 ≥1,000 Token；区间内压缩事件作为相关证据，不将净下降直接等同于压缩回收总量。',
    facts:[{label:'区间内已保留压缩 / 修剪',value:String(matches.length),source:'按事件序号匹配；不按时间相邻猜测'}],
    refs:uniqueEvidenceRefs([...(previous?[eventRef(sessionId,previous.seq,'下降前消息')]:[]),eventRef(sessionId,message.seq,'下降后消息'),...compactionEvidence(sessionId,matches).refs]),
    notes:['净下降还受区间内新增消息影响，可能小于压缩回收量。',...(matches.length?[]:['未匹配到压缩事件，不能确认下降原因。'])]};
}


/** Field bindings show how the response's usage proves the preceding request occupancy. */
export function contextOccupancyEvidence(sessionId: string, title: string, timeline: ContextTimeline | null): EvidenceChain {
  const step = timeline?.steps?.[timeline.steps.length - 1];
  const window = typeof timeline?.contextWindow === 'number' && timeline.contextWindow > 0 ? timeline.contextWindow : null;
  const usageRef = step ? eventRef(sessionId, step.seq, '本次请求输入用量（分子）') : undefined;
  const windowRef = timeline?.contextWindowSeq !== undefined && timeline.contextWindowSeq !== null
    ? eventRef(sessionId, timeline.contextWindowSeq, '窗口上限（分母）') : undefined;
  const input = step?.inputTokens ?? null;
  const cache = step?.cacheReadTokens ?? null;
  const occupancy = input !== null ? input + (cache ?? 0) : null;
  const ratio = occupancy !== null && window !== null ? occupancy / window : null;
  const fields: CalculationField[] = [
    {label: '未缓存输入', path: 'data.usage.inputTokens', value: input, eventType: 'assistant/message', ...(usageRef ? {ref: usageRef} : {})},
    {label: '缓存读取', path: 'data.usage.cacheReadTokens', value: cache, eventType: 'assistant/message', ...(usageRef ? {ref: usageRef} : {})},
    {label: '窗口上限', path: 'data.contextWindow', value: window, eventType: 'request/context', ...(windowRef ? {ref: windowRef} : {})},
  ];
  return {
    title, conclusion: ratio === null ? '请求占用率无法完整核验' : `窗口占用 ${(ratio * 100).toFixed(1)}%`, level: 'derived',
    rule: '请求上下文占用 = 未缓存输入 + 缓存读取；占用率 = 请求上下文占用 ÷ 窗口上限。',
    contextCalculation: {fields, occupancy, window, ratio}, facts: [],
    refs: [usageRef, windowRef].filter((ref): ref is EvidenceRef => ref !== undefined),
    notes: [
      ...(step ? [`#${step.seq} 是 assistant/message：其中的 usage 记录生成这条回复所用请求的输入用量；回复正文和输出 Token 不计入上述分子。`] : ['缺少请求用量样本；面板可能回退到表面估算，当前无法据此验证实际请求占用。']),
      ...(step && cache === null ? ['服务商未上报缓存读取，面板按 0 回退；这不等于原始记录已确认缓存读取为 0。'] : []),
      ...(window === null ? ['窗口上限未记录，无法计算占用率。'] : []),
      ...(window !== null && !windowRef ? ['窗口上限数值已知，但旧投影没有保存它的来源事件；不会用用量事件代替窗口配置来源。'] : []),
    ],
  };
}
