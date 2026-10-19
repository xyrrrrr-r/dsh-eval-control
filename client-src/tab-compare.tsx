import { EvidenceButton } from './evidencePanel.js';
import { aggregateEvidence, uniqueEvidenceRefs, type EvidenceChain, type EvidenceProps } from './evidence.js';
/** PRD 3.8: explicit 2–4 session comparison, read-only projection borrows. */
import { h, useEffect, useRef, useState } from './react-binding.js';
import { LineChart } from './charts.js';
import { formatDateTime, formatFull, formatMs } from './format.js';
import { readSessionProjections } from './team.js';
import type { ContextTimeline, SessionStats, TrajectoryAnalytics, ViewProps } from './types.js';

export interface LoadedSession {
  id: string; title: string; analytics: TrajectoryAnalytics | null;
  timeline: ContextTimeline | null; stats: SessionStats | null; error?: string | undefined;
}
export const COMPARE_COLORS = ['#4285f4', '#e67e22', '#9b59b6', '#218250'];
export const COMPARE_METRICS = [
  { key: 'tokens', label: 'Token 总消耗', format: formatFull, value: (s: LoadedSession) => s.analytics && s.stats ? s.analytics.inputTokens + s.stats.decodeTokens : null },
  { key: 'frequency', label: '摘要压缩频率（次/千输入 Token）', format: (v: number) => v.toFixed(3), value: (s: LoadedSession) => {
    const metric = s.analytics?.metricResults?.find((m) => m.metricId === 'context.compaction_frequency_per_1k_input_tokens');
    return metric?.status === 'available' && typeof metric.value === 'number' ? metric.value : null;
  } },
  { key: 'errors', label: '工具错误率', format: (v: number) => `${(v * 100).toFixed(1)}%`, value: (s: LoadedSession) => s.analytics && s.analytics.toolCalls > 0 ? s.analytics.toolErrors / s.analytics.toolCalls : null },
  { key: 'time', label: '模型耗时', format: formatMs, value: (s: LoadedSession) => s.stats && s.stats.llmMs > 0 ? s.stats.llmMs : null },
];
export function compareFacts(sessions: LoadedSession[]) {
  return COMPARE_METRICS.map((metric) => {
    const values = sessions.map((session) => ({session, value: metric.value(session)})).filter((item): item is {session: LoadedSession; value:number} => item.value !== null && Number.isFinite(item.value));
    const max = Math.max(0, ...values.map((item) => item.value));
    const min = values.length ? Math.min(...values.map((item) => item.value)) : null;
    return {metric, values, max, min, spread: values.length >= 2 && max > 0 && min !== null ? (max - min) / max : 0, winners: values.length >= 2 ? values.filter((item) => item.value === min).map((item) => item.session) : []};
  });
}
export function comparisonSummary(sessions: LoadedSession[]): string[] {
  return compareFacts(sessions).map((fact) => fact.winners.length ? `${fact.metric.label}最低：${fact.winners.map((session) => session.title).join('、')}（${fact.metric.format(fact.min!)}${fact.winners.length > 1 ? '，并列' : ''}）；可比数据 ${fact.values.length}/${sessions.length}。` : `${fact.metric.label}：可比数据不足。`);
}
export function extractSessionRows(snapshot: unknown): Array<{id:string;title:string;updatedAt:number|null;running:boolean}> {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const {ids, byId} = snapshot as {ids?:unknown;byId?:Record<string, {displayTitle?:string;updatedAt?:number;blank?:boolean;running?:boolean}>};
  if (!Array.isArray(ids) || !byId) return [];
  return ids.filter((id):id is string => typeof id==='string' && !!byId[id] && !byId[id]!.blank).map((id)=>({id,title:byId[id]!.displayTitle || '未命名会话',updatedAt:byId[id]!.updatedAt ?? null,running:byId[id]!.running === true})).sort((a,b)=>(b.updatedAt??0)-(a.updatedAt??0));
}
export function CompareTab(props: EvidenceProps & {
  useSessions: ViewProps['useSessions']; sessionId:string|null;
  sessions: {using?:unknown;refreshProjections?:unknown}|null; current:LoadedSession|null;
  onResult?: (sessions:LoadedSession[])=>void;
}): unknown {
  const [selected,setSelected] = useState<string[]>(props.current ? [props.current.id] : []);
  const [loaded,setLoaded] = useState<LoadedSession[]>([]);
  const [phase,setPhase] = useState('idle');
  const [query,setQuery] = useState('');
  const [highlight,setHighlight] = useState('');
  const [normalized,setNormalized] = useState(false);
  const [hidden,setHidden] = useState<string[]>([]);
  const [practices,setPractices] = useState(false);
  const generation = useRef(0);
  useEffect(()=>()=>{generation.current++;},[]);
  const snapshot = typeof props.useSessions === 'function' ? props.useSessions((value:unknown)=>value) : null;
  const rows = extractSessionRows(snapshot);
  if (props.current && !rows.some((row)=>row.id===props.current!.id)) rows.unshift({id:props.current.id,title:'当前会话',updatedAt:null,running:false});
  const start = async () => {
    const revision=++generation.current;
    if (selected.length<2 || selected.length>4) return;
    setPhase('loading'); setLoaded([]); props.onResult?.([]);
    const result = await Promise.all(selected.map(async(id):Promise<LoadedSession>=>{
      if (id===props.current?.id) return props.current;
      try {
        if (!props.sessions) throw new Error('会话服务不可用');
        const data=await readSessionProjections(props.sessions as never,id,['trajectoryAnalytics','contextTimeline','sessionStats']);
        return {id,title:rows.find((row)=>row.id===id)?.title??id,analytics:data?.trajectoryAnalytics as TrajectoryAnalytics??null,timeline:data?.contextTimeline as ContextTimeline??null,stats:data?.sessionStats as SessionStats??null,error:!data?.trajectoryAnalytics ? '数据不可用：会话投影缺失或读取失败' : undefined};
      } catch(error) { return {id,title:rows.find((row)=>row.id===id)?.title??id,analytics:null,timeline:null,stats:null,error:`数据不可用：${String(error)}`}; }
    }));
    if (generation.current!==revision) return;
    setLoaded(result);setPhase('ready');setHighlight('');setHidden([]);props.onResult?.(result);
  };
  const facts=compareFacts(loaded);
  const biggest=facts.slice().sort((a,b)=>b.spread-a.spread)[0];
  const focused=highlight||biggest?.metric.key;
  const shown=loaded.filter((session)=>!hidden.includes(session.id));
  return h('div',{style:{display:'grid',gap:14}},[
    h('h3',{key:'title',style:{margin:0}},'会话对比分析'),
    h('div',{key:'picker',style:panel},[
      h('label',{key:'search'},['选择 2–4 个会话 ',h('input',{type:'search','aria-label':'搜索对比会话',value:query,onChange:(event:{target:{value:string}})=>setQuery(event.target.value),placeholder:'按标题或 ID 搜索'})]),
      h('div',{key:'rows',style:{maxHeight:220,overflow:'auto'}},rows.filter((row)=>`${row.title} ${row.id}`.toLowerCase().includes(query.toLowerCase())).map((row)=>h('label',{key:row.id,style:{display:'flex',gap:10,padding:8,borderBottom:'1px solid #9993'}},[
        h('input',{type:'checkbox',checked:selected.includes(row.id),disabled:phase==='loading'||(!selected.includes(row.id)&&selected.length>=4),onChange:()=>setSelected((ids)=>ids.includes(row.id)?ids.filter((id)=>id!==row.id):[...ids,row.id])}),
        h('span',{style:{minWidth:0,overflowWrap:'anywhere'}},`${row.title}${row.id===props.sessionId?'（当前）':''} · ${row.running?'运行中':'历史会话'} · ${row.updatedAt?formatDateTime(row.updatedAt):'时间未知'}`),
      ]))),
      rows.length===0 ? h('p',{},'暂无可选会话，数据不可用。') : null,
      h('div',{key:'start',style:{display:'flex',gap:12,alignItems:'center',marginTop:8}},[
        h('button',{onClick:()=>void start(),disabled:selected.length<2||selected.length>4||phase==='loading'},phase==='loading'?'读取会话投影中…':'开始对比'),h('span',{},`已选 ${selected.length}/4；仅在开始对比后读取数据`),
      ]),
    ]),
    phase==='ready' && selected.join(',')!==loaded.map((session)=>session.id).join(',') ? h('p',{key:'stale',role:'status'},'会话选择已改变；当前结果保留上次快照，请点击“开始对比”更新。') : null,
    phase==='ready' ? h('div',{key:'results',style:{display:'grid',gap:14}},[
      h('div',{key:'summaries',style:{display:'flex',flexWrap:'wrap',gap:10}},loaded.map((session,index)=>h('div',{key:session.id,style:{...panel,flex:'1 1 220px',borderTop:`3px solid ${COMPARE_COLORS[index]}`,overflowWrap:'anywhere'}},[
        h('strong',{},session.title),h('div',{},session.id),
        h('div',{},session.error??`轮次 ${session.analytics?.turnsEnded??'—'} · 步骤 ${session.analytics?.stepsEnded??'—'} · 模型 ${session.timeline?.model??'未知'}`),
      ]))),
      h(EvidenceButton,{...props,chain:()=>comparisonEvidence(loaded,focused??'tokens'),label:'查看差异结论证据链'}),
      h('small',{key:'accounting'},'Token 总消耗口径：未缓存输入 + 输出；上下文曲线额外包含缓存读，不等同于计费金额。'),
      h('label',{key:'normalize'},[h('input',{type:'checkbox',checked:normalized,onChange:()=>setNormalized((value)=>!value)}),'归一化显示（Token 按最大值比例；上下文按窗口占用、请求进度对齐）']),
      biggest && biggest.spread>0 ? h('div',{key:'difference'},`差异最大：${biggest.metric.label}，相对差异 ${(biggest.spread*100).toFixed(1)}%（最大值与最小值之差 / 最大值）`) : null,
      h('div',{key:'metrics',style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:10}},facts.map((fact)=>h('section',{key:fact.metric.key,style:{...panel,border:focused===fact.metric.key?'2px solid #4285f4':'1px solid #9994'}},[
        h('button',{onClick:()=>setHighlight(fact.metric.key),'aria-pressed':focused===fact.metric.key},fact.metric.label),
        ...loaded.map((session,index)=>{const value=fact.metric.value(session);return h('div',{key:session.id,style:{marginTop:8}},[
          h('div',{},`${session.title} · ${value===null?'数据不可用':fact.metric.format(value)}${fact.winners.some((winner)=>winner.id===session.id)?' ★ 最低':''}`),
          h(EvidenceButton,{...props,chain:()=>comparisonEvidence([session],fact.metric.key),label:`查看 ${session.title} ${fact.metric.label} 证据`}),
          value!==null ? h('div',{role:'img','aria-label':`${session.title} ${fact.metric.label} ${fact.metric.format(value)}`,style:{height:10,width:`${fact.max>0?value/fact.max*100:0}%`,background:COMPARE_COLORS[index],minWidth:value>0?2:0}}) : null,
          normalized&&value!==null ? h('small',{},`相对最大值 ${fact.max>0?(value/fact.max*100).toFixed(1):'0'}%`) : null,
        ]);}),
      ]))),
      h('section',{key:'context',style:panel},[
        h('h4',{},'上下文演化对比'),
        h(LineChart,{key:String(normalized),eventLanes:false,hidden:new Set(hidden),onToggle:(id:string)=>setHidden((ids)=>ids.includes(id)?ids.filter((item)=>item!==id):[...ids,id]),scaleMax:normalized?100:(Math.max(0,...loaded.map((session)=>session.timeline?.contextWindow??0))||undefined),formatX:(value:number)=>normalized?`${value.toFixed(0)}%`:`#${Math.round(value)}`,height:360,yLabel:normalized?'窗口占用 %':'上下文 Token',xLabel:normalized?'请求进度 %':'请求序号',series:loaded.filter((session)=>!normalized||!!session.timeline?.contextWindow).map((session)=>({key:session.id,label:session.title,color:COMPARE_COLORS[loaded.indexOf(session)]!,points:(session.timeline?.steps??[]).map((step,index,steps)=>({x:normalized?(steps.length>1?index/(steps.length-1)*100:0):index+1,y:(step.inputTokens+(step.cacheReadTokens??0))*(normalized?100/session.timeline!.contextWindow!:1)}))}))}),
        normalized && shown.some((session)=>!session.timeline?.contextWindow) ? h('p',{},'缺少窗口上限的会话无法归一化，已从折线中排除；不按 0 处理。') : null,
        h('small',{},'横轴对齐请求顺序，反映同次运行内演化，不代表相同任务阶段。'),
      ]),
      h(RadarChart,{...props,key:'radar',sessions:loaded,highlight:focused}),
      h('section',{key:'report',style:panel},[
        h('h4',{},'差异报告'),...comparisonSummary(loaded).map((line,index)=>h('p',{key:index},line)),
        h('button',{onClick:()=>setPractices((value)=>!value),'aria-expanded':practices},'最佳实践'),
        practices ? h('div',{},[
          h('p',{},'先确保任务、输入规模、模型和完成质量可比，再复用低消耗会话的工具选择与压缩策略。Token 少、压缩少或耗时短不能单独证明质量更好。'),
          ...facts.filter((fact)=>fact.winners.length===1).map((fact)=>h('p',{key:fact.metric.key},`检查「${fact.winners[0]!.title}」在${fact.metric.label}上的配置与执行轨迹；仅对同类任务进行复现实验。`)),
        ]) : null,
      ]),
    ]) : h('p',{key:'empty'},phase==='loading'?'正在读取所选会话…':'选择至少两个会话后点击“开始对比”，生成图表和差异报告。'),
  ]);
}
/** Ratio scaling preserves magnitude; zero stays at the true origin. */
export function radarRatio(value:number, maximum:number):number {
  return maximum > 0 ? Math.max(0,Math.min(1,value/maximum)) : 0;
}
export function RadarChart(props:EvidenceProps & {sessions:LoadedSession[];highlight?:string}): unknown {
  const [detail,setDetail]=useState<string|null>(null);
  const facts=compareFacts(props.sessions).filter((fact)=>fact.values.length===props.sessions.length);
  if (facts.length<3) return h('section',{style:panel},'多维雷达图：至少需要三个所有会话均可用的指标，当前数据不足。');
  const point=(index:number,radius:number):[number,number]=>{const angle=-Math.PI/2+index/facts.length*Math.PI*2;return [320+Math.cos(angle)*radius,175+Math.sin(angle)*radius];};
  const label=(session:LoadedSession,fact:(typeof facts)[number])=>`${session.title} · ${fact.metric.label}：${fact.metric.format(fact.metric.value(session)!)}，占本轴最大值 ${(radarRatio(fact.metric.value(session)!,fact.max)*100).toFixed(1)}%`;
  return h('section',{style:panel},[
    h('h4',{},'多维资源消耗（越靠近中心，数值越小）'),
    h('div',{style:{display:'flex',gap:12,flexWrap:'wrap'}},props.sessions.map((session,index)=>h('span',{key:session.id,style:{color:COMPARE_COLORS[index]}},`● ${session.title}`))),
    h('svg',{viewBox:'0 0 640 360',role:'img','aria-label':'多会话资源消耗比例雷达图',style:{display:'block',width:'100%',maxWidth:680,margin:'0 auto'}},[
      ...[.25,.5,.75,1].map((ratio)=>h('g',{key:ratio},[
        h('polygon',{points:facts.map((_,index)=>point(index,105*ratio).join(',')).join(' '),fill:'none',stroke:'#9995'}),
        h('text',{x:325+74*ratio,y:171-74*ratio,fontSize:10,fill:'currentColor',opacity:.65},`${ratio*100}%`),
      ])),
      ...facts.map((fact,index)=>{const [x,y]=point(index,148);return h('g',{key:fact.metric.key},[
        h('line',{x1:320,y1:175,x2:point(index,105)[0],y2:point(index,105)[1],stroke:props.highlight===fact.metric.key?'#4285f4':'#9996'}),
        h('text',{x,y,textAnchor:x>330?'start':x<310?'end':'middle',fontSize:12,fill:props.highlight===fact.metric.key?'#4285f4':'currentColor'},[
          h('tspan',{x,dy:0},fact.metric.label.split('（')[0]),
          h('tspan',{x,dy:16,fontSize:10,opacity:.7},fact.max===0?'全部为 0':`100% = ${fact.metric.format(fact.max)}`),
        ]),
      ]);}),
      ...props.sessions.map((session,index)=>h('polygon',{key:session.id,points:facts.map((fact,axis)=>point(axis,105*radarRatio(fact.metric.value(session)!,fact.max)).join(',')).join(' '),fill:COMPARE_COLORS[index],fillOpacity:.08,stroke:COMPARE_COLORS[index],strokeWidth:2,pointerEvents:'none'})),
      ...props.sessions.flatMap((session,index)=>facts.map((fact,axis)=>{const [cx,cy]=point(axis,105*radarRatio(fact.metric.value(session)!,fact.max));return h('circle',{key:`${session.id}:${fact.metric.key}`,cx,cy,r:5,fill:COMPARE_COLORS[index],stroke:'var(--dsh-eval-surface,Canvas)',strokeWidth:1,tabIndex:0,role:'button','aria-label':label(session,fact),onClick:()=>props.onEvidence?.(comparisonEvidence([session],fact.metric.key)),onKeyDown:(event:{key:string;preventDefault:()=>void})=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();props.onEvidence?.(comparisonEvidence([session],fact.metric.key));}},onMouseEnter:()=>setDetail(label(session,fact)),onFocus:()=>setDetail(label(session,fact)),onBlur:()=>setDetail(null)},h('title',{},label(session,fact)));})),
    ]),
    h('div',{role:'status',style:{minHeight:24,fontSize:12}},detail??'悬停或聚焦顶点查看原始值与比例；重叠顶点可在下表核对。'),
    h('small',{},'每轴半径 = 原始值 / 所选会话该项最大值，中心 0%，外圈 100%；全部为零时均位于中心。各轴单位不同，不能比较跨轴数值或用面积评判任务质量。'),
    h('div',{style:{overflowX:'auto',marginTop:10}},h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:12}},[
      h('thead',{},h('tr',{},[h('th',{style:{textAlign:'left',padding:8}},'指标 / 原始值'),...props.sessions.map((session,index)=>h('th',{key:session.id,style:{textAlign:'left',padding:8,color:COMPARE_COLORS[index]}},session.title))])),
      h('tbody',{},facts.map((fact)=>h('tr',{key:fact.metric.key,style:{borderTop:'1px solid #9993',background:props.highlight===fact.metric.key?'#4285f414':undefined}},[
        h('th',{style:{textAlign:'left',padding:8,fontWeight:400}},fact.metric.label),
        ...props.sessions.map((session)=>h('td',{key:session.id,style:{padding:8}},`${fact.metric.format(fact.metric.value(session)!)}（${(radarRatio(fact.metric.value(session)!,fact.max)*100).toFixed(1)}%）`)),
      ]))),
    ])),
  ]);
}
const panel={border:'1px solid #9994',borderRadius:10,padding:12,minWidth:0} as const;

/** Cross-session references retain their owner; zero and missing values are distinct. */
export function comparisonEvidence(sessions:LoadedSession[], key:string):EvidenceChain {
  const metric=COMPARE_METRICS.find(item=>item.key===key) ?? COMPARE_METRICS[0]!;
  const kind=({tokens:'tokens',frequency:'frequency',errors:'tools',time:'time'} as const)[metric.key as 'tokens'|'frequency'|'errors'|'time'];
  const sources=sessions.map(session=>aggregateEvidence(session.id,session.title,session.analytics,session.timeline,kind));
  return {title:`对比依据 · ${metric.label}`,conclusion:sessions.map(session=>`${session.title}：${metric.value(session)===null?'数据不可用':metric.format(metric.value(session)!)}`).join('；'),level:'derived',
    rule:metric.key==='errors'?'对比工具错误率 = 显式错误数 / 调用数；与诊断契约的「已知结果错误率」分母不同。':metric.key==='tokens'?'总消耗 = 未缓存输入 + 输出；不含缓存读取。':metric.key==='frequency'?'沿用各会话摘要压缩频率契约。':'耗时读取各会话 sessionStats.llmMs。',
    facts:sessions.flatMap(session=>[{label:session.title,value:metric.value(session)===null?'数据不可用':metric.format(metric.value(session)!),source:`会话 ${session.id} 的对比快照`}, ...(metric.key==='errors'?[{label:'显式错误 / 调用',value:`${session.analytics?.toolErrors??'未知'} / ${session.analytics?.toolCalls??'未知'}`,source:session.id}]:[])]),
    refs:uniqueEvidenceRefs(sources.flatMap(source=>source.refs)),notes:['不同运行不一定具有相同任务阶段、输入规模或质量；最低消耗不等于最佳质量。', ...sources.flatMap((source,index)=>source.notes.map(note=>`${sessions[index]!.title}：${note}`))]};
}
