import { EvidenceEventCard } from './evidenceEventCard.js';
import { AiDiagnosis } from './aiDiagnostic.js';
import type { ConfigurationConnection } from './configuration.js';
import { h, useEffect, useRef, useState } from './react-binding.js';
import type { CalculationField, ContextCalculation, EvidenceChain, EvidenceProps, EvidenceRef } from './evidence.js';
import { uniqueEvidenceRefs } from './evidence.js';
import type { SessionsService } from './types.js';
import { formatDateTime, formatFull } from './format.js';

export function EvidenceButton(props: EvidenceProps & { chain: () => EvidenceChain; label?: string }): unknown {
  return props.onEvidence ? h('button', {type:'button', onClick:()=>props.onEvidence?.(props.chain()), style:{font:'inherit',fontSize:12,cursor:'pointer'}, 'aria-label':props.label??'查看证据链'},props.label??'查看证据链') : null;
}
export interface RawEvent { seq:number; time:number; type:string; [key:string]:unknown }
interface EvidenceBinding {
  eventSource?: { getSnapshot:()=>{entries: Array<{type:string;event:RawEvent}>;hasMore:boolean} };
  session?: { loadThrough?:(seq:number)=>Promise<void> };
}
/** Cancellation must also release a retained session while history/ready is pending. */
function abortable<T>(operation:Promise<T> | undefined, signal?:AbortSignal):Promise<T | undefined> {
  if(!signal)return Promise.resolve(operation);
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason ?? new DOMException('Aborted','AbortError'));
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(operation).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
/** Reads durable host events only; projection previews are never presented as raw events. */
export async function readEvidenceEvents(sessions:SessionsService|undefined, ref:EvidenceRef, signal?:AbortSignal, fullHistory=false):Promise<RawEvent[]> {
  if(!sessions?.using) throw Error('会话服务不可用；可下载日志后按事件序号查找。');
  if(!ref.sessionId || !Number.isSafeInteger(ref.seq) || ref.seq<0) throw Error('无效的事件引用');
  return await sessions.using(ref.sessionId,{source:'dsh-eval-control-analytics',signal},async(reference)=>{
    const held=reference as {ready?:Promise<unknown>;binding?:EvidenceBinding};
    await abortable(held.ready,signal);
    signal?.throwIfAborted();
    const binding=held.binding;
    if(!binding?.eventSource) throw Error('当前宿主未提供原始事件源。');
    if(binding.session?.loadThrough) await abortable(binding.session.loadThrough(fullHistory?0:ref.seq),signal);
    signal?.throwIfAborted();
    const entries=binding.eventSource.getSnapshot().entries.filter(entry=>entry.type==='event').map(entry=>entry.event);
    const index=entries.findIndex(event=>event.seq===ref.seq);
    if(index<0) throw Error(`原始事件 #${ref.seq} 不在可读取日志中，可能已被清理或当前权限不可读；不会用相邻事件代替。`);
    if(fullHistory && binding.eventSource.getSnapshot().hasMore)throw Error('原始历史未读完整，不能判断全程重试与恢复');
    return fullHistory?entries:entries.slice(Math.max(0,index-3),index+4);
  }) as RawEvent[];
}
/** Compare only fields bound to this exact source event, never nearby rows. */
export function calculationFieldChecks(fields: CalculationField[], sessionId: string, event: RawEvent): Array<{field: CalculationField; actual: unknown; status: string}> {
  return fields.filter(field => field.ref?.sessionId === sessionId && field.ref.seq === event.seq).map(field => {
    let actual: unknown = event;
    for (const key of field.path.split('.')) actual = actual !== null && typeof actual === 'object' ? (actual as Record<string, unknown>)[key] : undefined;
    const status = event.type !== field.eventType ? '事件类型不符' : actual === undefined || actual === null
      ? '原始字段未记录' : field.value === null ? '快照未记录此值' : actual === field.value ? '与计算输入一致' : '与计算快照不一致';
    return {field, actual, status};
  });
}

export function ContextCalculationView(props: {calculation: ContextCalculation; onSelect: (ref: EvidenceRef) => void}): unknown {
  const {fields, occupancy, window, ratio} = props.calculation;
  const input = fields[0]?.value ?? null;
  const cache = fields[1]?.value ?? null;
  const number = (value: number | null) => value === null ? '未知' : formatFull(value);
  return h('section', {'aria-label':'窗口占用计算依据', style:{border:'1px solid #4285f466',borderRadius:8,padding:12,margin:'12px 0',background:'#4285f408'}}, [
    h('h4', {style:{margin:'0 0 8px'}}, '计算依据'),
    h('table', {style:{width:'100%',fontSize:12,borderCollapse:'collapse'}}, h('tbody', {}, fields.map(field => h('tr', {key:field.path,style:{borderBottom:'1px solid #9993'}}, [
      h('th', {style:{textAlign:'left',padding:'8px 4px',fontWeight:500}}, field.label),
      h('td', {style:{padding:'8px 4px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}, field.value === null && field.ref && field.path === 'data.usage.cacheReadTokens' ? '未上报 · 按 0 回退' : number(field.value)),
      h('td', {style:{padding:'8px 4px',overflowWrap:'anywhere'}}, [
        field.ref ? h('button', {type:'button',onClick:()=>props.onSelect(field.ref!), 'aria-label':`查看${field.label}来源 #${field.ref.seq}`}, `#${field.ref.seq} · ${field.ref.role}`) : h('span', {}, '来源事件未记录'),
        h('code', {style:{display:'block',fontSize:11,opacity:.7,marginTop:3}}, field.path),
      ]),
    ])))),
    h('div', {style:{marginTop:10,fontVariantNumeric:'tabular-nums'},'aria-label':'请求占用求和'}, occupancy === null ? '缺少请求用量，无法核验求和' : `${number(input)} + ${cache === null ? '0（缓存读取未上报，回退）' : number(cache)} = ${number(occupancy)} Token`),
    h('strong', {style:{display:'block',fontSize:16,marginTop:6},'aria-label':'窗口占用率公式'}, occupancy === null || window === null || ratio === null ? '占用率：缺少计算输入，无法完整核验' : `${number(occupancy)} ÷ ${number(window)} × 100% = ${(ratio * 100).toFixed(1)}%`),
    h('small', {style:{display:'block',marginTop:6,opacity:.7}}, '点击来源可核对原始字段；回复正文与输出 Token 不参与本次占用率计算。'),
  ]);
}

export function EvidencePanel(props:{connection?:ConfigurationConnection|undefined;chain:EvidenceChain; sessions?:SessionsService; currentSessionId:string; inspectCall?: (callId:string)=>void; onClose:()=>void}):unknown {
  const [page,setPage]=useState(0);
  const [target,setTarget]=useState<EvidenceRef|null>(null);
  const [raw,setRaw]=useState<{phase:string;events:RawEvent[];error?:string}>({phase:'idle',events:[]});
  const [query,setQuery]=useState('');
  const [selectedSeq,setSelectedSeq]=useState<number|null>(null);
  const closeRef=useRef<HTMLButtonElement|null>(null);
  const rootRef=useRef<HTMLElement|null>(null);
  const rawRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const previous=typeof document!=='undefined'?document.activeElement as HTMLElement:null;
    closeRef.current?.focus();
    return ()=>{if(previous?.isConnected)previous.focus();};
  },[]);
  useEffect(()=>{
    if(!target)return;
    const controller=new AbortController(); let live=true;
    setRaw({phase:'loading',events:[]}); setSelectedSeq(target.seq);
    const timeout=setTimeout(()=>{controller.abort();if(live)setRaw({phase:'error',events:[],error:'读取超时，请重试。'});},15000);
    void readEvidenceEvents(props.sessions,target,controller.signal).then(events=>{if(live&&!controller.signal.aborted)setRaw({phase:'ready',events});},error=>{if(live&&!controller.signal.aborted)setRaw({phase:'error',events:[],error:String(error instanceof Error?error.message:error)});}).finally(()=>clearTimeout(timeout));
    return ()=>{live=false;clearTimeout(timeout);controller.abort();};
  },[target,props.sessions]);
  useEffect(()=>{if(raw.phase==='ready')rawRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[raw.phase]);
  const refs=uniqueEvidenceRefs(props.chain.refs);
  const filtered=refs.filter(ref=>`${ref.sessionId} #${ref.seq} ${ref.role}`.toLowerCase().includes(query.toLowerCase()));
  const selected=raw.events.find(event=>event.seq===selectedSeq);
  const checks = selected && target ? calculationFieldChecks(props.chain.contextCalculation?.fields ?? [], target.sessionId, selected) : [];
  const callId=selected&&typeof selected.data==='object'&&selected.data!==null?((selected.data as {callId?:unknown;message?:{toolCallId?:unknown}}).callId??(selected.data as {message?:{toolCallId?:unknown}}).message?.toolCallId):undefined;
  const rawJson=selected?JSON.stringify(selected,null,2):'';
  const download=()=>{if(!selected)return;const url=URL.createObjectURL(new Blob([rawJson],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`event-${selected.seq}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const trap=(event:{key:string;shiftKey:boolean;preventDefault:()=>void})=>{
    if(event.key==='Escape'){event.preventDefault();props.onClose();return;}
    if(event.key!=='Tab')return;
    const controls=rootRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href],[tabindex="0"]');
    if(!controls?.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  return h('div',{style:{position:'fixed',inset:0,background:'#0004',zIndex:1200},onClick:props.onClose},h('aside',{
    role:'dialog','aria-modal':true,'aria-label':'证据链',ref:rootRef as unknown as string,onClick:(event:{stopPropagation:()=>void})=>event.stopPropagation(),onKeyDown:trap,
    style:{position:'absolute',right:0,top:0,bottom:0,width:'min(720px, 100%)',boxSizing:'border-box',overflowY:'auto',padding:20,background:'var(--dsh-eval-surface, Canvas)',color:'CanvasText',boxShadow:'-4px 0 24px #0003',fontSize:13,lineHeight:1.6},
  },[
    h('div',{key:'header',style:{position:'sticky',top:-20,zIndex:1,padding:'12px 0',background:'var(--dsh-eval-surface, Canvas)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}},[h('h3',{style:{margin:0}},props.chain.title),h('button',{ref:closeRef as unknown as string,type:'button',onClick:props.onClose},'关闭证据链')]),
    h('p',{key:'conclusion'},props.chain.conclusion),
    h(AiDiagnosis,{key:'ai',connection:props.connection,sessions:props.sessions,currentSessionId:props.currentSessionId,inspectCall:props.inspectCall?(id:string)=>{props.onClose();props.inspectCall?.(id);}:undefined,chain:props.chain,onSelectRef:(ref:EvidenceRef)=>setTarget({...ref})}),
    h('div',{key:'level'},`证据等级：${{observed:'原始观测',derived:'计算结果',inferred:'推断'}[props.chain.level]} · 打开时的数据快照`),
    h('p',{key:'rule'},props.chain.rule),
    props.chain.contextCalculation ? h(ContextCalculationView, {key:'calculation',calculation:props.chain.contextCalculation,onSelect:(ref:EvidenceRef)=>setTarget({...ref})}) : null,
    h('dl',{key:'facts'},props.chain.facts.flatMap((fact,index)=>[h('dt',{key:`l${index}`,style:{fontWeight:600,marginTop:10}},fact.label),h('dd',{key:`v${index}`,style:{marginLeft:0,overflowWrap:'anywhere'}},[fact.value,h('small',{style:{display:'block',opacity:.65}},fact.source)])])),
    h('ul',{key:'notes',style:{paddingLeft:20}},props.chain.notes.map((note,index)=>h('li',{key:index},note))),
    h('section',{key:'tool-errors','aria-label':'工具错误原因分析'},(props.chain.toolFailures??[]).map(failure=>h('article',{key:failure.resultSeq,style:{border:'1px solid #e5484d',borderRadius:8,padding:12,margin:'10px 0'}},[h('strong',{style:{color:'var(--dsh-eval-red, #e5484d)'}},`失败调用 · ${failure.name} · ${failure.callId}`),h('p',{},`原始观测：tool/result #${failure.resultSeq} 的 isError = true`),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:180,overflowY:'auto'}},failure.excerpt||'未提供错误文本'),h('p',{},`原因分析（基于错误文本的规则推断）：${failure.analysis}`),h(AiDiagnosis,{label:'AI 诊断这次失败',connection:props.connection,sessions:props.sessions,currentSessionId:props.currentSessionId,inspectCall:props.inspectCall?(id:string)=>{props.onClose();props.inspectCall?.(id);}:undefined,chain:{title:`工具失败 ${failure.name}`,conclusion:`${failure.callId} · 错误结果 #${failure.resultSeq}`,rule:'原始 tool/result isError = true；原因需分析调用参数与返回结果。',level:'observed',facts:[],notes:['原始结果文本和调用参数将按需读取，预览后选择模型开始。'],refs:props.chain.refs.filter(ref=>ref.seq===failure.callSeq||ref.seq===failure.resultSeq)},onSelectRef:(ref:EvidenceRef)=>setTarget({...ref})}),h('button',{onClick:()=>setTarget({sessionId:props.chain.refs.find(ref=>ref.seq===failure.resultSeq)?.sessionId??props.currentSessionId,seq:failure.resultSeq,role:'错误结果'})},'查看原始错误结果')]))),
    h('h4',{key:'refs'},props.chain.contextCalculation ? `计算来源 · ${refs.length} 个事件` : `关联事件 · ${refs.length} 条已保留引用`),
    !props.chain.contextCalculation ? h('input',{key:'search',type:'search','aria-label':'搜索证据事件',placeholder:'搜索序号、会话或事件角色',value:query,onChange:(event:{target:{value:string}})=>{setQuery(event.target.value);setPage(0);},style:{width:'100%',boxSizing:'border-box'}}) : null,
    refs.length===0?h('p',{key:'empty',role:'status'},'没有可定位的事件引用；不能据此宣称结论已验证。'):null,
    h('ol',{key:'events',style:{paddingLeft:0,listStyle:'none'}},filtered.slice(page*20,page*20+20).map(ref=>h('li',{key:JSON.stringify([ref.sessionId,ref.seq]),style:{color:ref.failed?'var(--dsh-eval-red, #e5484d)':undefined,padding:'8px 0',borderBottom:'1px solid #9994',overflowWrap:'anywhere'}},[
      h(EvidenceEventCard,{refInfo:ref,sessions:props.sessions,currentSessionId:props.currentSessionId,inspectCall:props.inspectCall?(id:string)=>{props.onClose();props.inspectCall?.(id);}:undefined,onSelect:(ref:EvidenceRef)=>setTarget({...ref})}),
    ]))),
    filtered.length>20?h('div',{key:'pages'},[h('button',{disabled:page===0,onClick:()=>setPage(value=>value-1)},'上一页'),` ${page+1} / ${Math.ceil(filtered.length/20)} `,h('button',{disabled:(page+1)*20>=filtered.length,onClick:()=>setPage(value=>value+1)},'下一页')]):null,
    target?h('section',{key:'raw',ref:rawRef as unknown as string,'aria-label':'原始轨迹',style:{marginTop:16,borderTop:'2px solid #4285f4',paddingTop:12}},[
      h('h4',{},`原始轨迹 · ${target.sessionId} · #${target.seq}`),
      raw.phase==='loading'?h('p',{role:'status'},'读取原始事件与相邻记录中…'):null,
      raw.phase==='error'?h('div',{role:'alert'},[raw.error,h('button',{onClick:()=>setTarget({...target})},'重试')]):null,
      raw.phase==='ready'?h('div',{},[
        h('p',{},checks.length ? '目标事件直接读取自宿主持久事件源；下方字段核对说明它如何参与本次计算。' : '当前事件直接读取自宿主持久事件源；附近记录仅用于辅助核查。'),
        h('div',{'aria-label':'目标原始事件',style:{padding:8,color:(raw.events.find(event=>event.seq===target.seq)?.data as any)?.message?.isError===true?'#e5484d':undefined,background:'#4285f426'}}, `#${target.seq} · ${raw.events.find(event=>event.seq===target.seq)?.type ?? ''} · ${formatDateTime(raw.events.find(event=>event.seq===target.seq)?.time ?? 0)}`),
        checks.length ? h('section',{'aria-label':'参与计算的原始字段',style:{padding:'8px 0'}},[
          h('strong',{},'参与计算的原始字段'),
          ...checks.map(({field,actual,status})=>h('div',{key:field.path,style:{padding:'6px 0',borderBottom:'1px solid #9993'}},[
            h('code',{},field.path), h('div',{},`${field.label}：${typeof actual === 'number' ? formatFull(actual) : actual === undefined || actual === null ? '未记录' : JSON.stringify(actual)} · ${status}`),
            status==='与计算快照不一致'||status==='事件类型不符'?h('small',{role:'alert'},`计算快照为 ${field.value ?? '未记录'}；请检查投影与原始事件来源。`):null,
          ])),
        ]):null,
        h('details',{'aria-label':'附近轨迹',key:`neighbors-${target.sessionId}-${target.seq}`,style:{margin:'10px 0'}},[
          h('summary',{style:{cursor:'pointer'}},`查看附近轨迹（${Math.max(0,raw.events.length-1)} 条，仅辅助核查）`),
          h('small',{},'相邻事件不自动成为该指标的计算依据；点击行可检查原始内容。'),
          h('table',{style:{width:'100%',fontSize:12,marginTop:8}},h('tbody',{},raw.events.map(event=>h('tr',{key:event.seq,'data-evidence-target':event.seq===target.seq,style:{background:event.seq===target.seq?'#4285f426':undefined}},[
            h('td',{},h('button',{'aria-pressed':selectedSeq===event.seq,onClick:()=>setSelectedSeq(event.seq)},`#${event.seq}`)),h('td',{},event.type),h('td',{},formatDateTime(event.time)),
          ])))),
        ]),
        selectedSeq !== target.seq ? h('p',{role:'status'},`正在查看附近事件 #${selectedSeq}；本次定位的计算来源仍为 #${target.seq}。`) : null,
        h('pre',{'aria-label':'原始事件 JSON',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:360,overflowY:'auto',padding:12,background:'#9991'}},rawJson.slice(0,100000)),
        rawJson.length>100000?h('small',{},'JSON 显示已截断；下载可获取本条完整原始事件。'):null,
        h('button',{onClick:download},'下载本条原始事件'),
        typeof callId==='string'&&target.sessionId===props.currentSessionId&&props.inspectCall?h('button',{onClick:()=>{props.onClose();props.inspectCall?.(callId);}},'在宿主 Trajectory 定位工具调用'):null,
      ]):null,
      h('a',{href:`/api/session.export?sessionId=${encodeURIComponent(target.sessionId)}&includeDescendants=false`,download:true},'下载该会话完整日志'),
    ]):null,
  ]));
}
