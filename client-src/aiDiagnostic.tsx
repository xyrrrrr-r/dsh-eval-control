import {overviewHistoryEvidence} from './overviewDiagnosis.js';
import { EvidenceEventCard,describeEvidenceEvent,type EventDescription } from './evidenceEventCard.js';
import { collectFailureGroups, selectFailureGroups, type FailureGroup } from './diagnosticEvidence.js';
import {h,useEffect,useRef,useState} from './react-binding.js';
import type {ConfigurationConnection} from './configuration.js';
import type {EvidenceChain,EvidenceRef} from './evidence.js';
import type {SessionsService} from './types.js';
import {readEvidenceEvents} from './evidencePanel.js';
export interface DiagnosisResult {text:string;provider:string;model:string;usage:unknown;createdAt:number;inputCharacters:number;mode?:string;elapsedMs?:number;reasoningEffort?:string}
interface Route {provider:string;name:string;models:Array<{id:string;name:string}>;error:string}
/** Minimize and redact the exact preview sent to the selected model. */
export function redactDiagnostic(value:unknown):string {
  const secret=/^(authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|private[-_]?key|password|secret|credential)$/i;
  const json=JSON.stringify(value,(key,item)=>secret.test(key)?'[已脱敏]':item,2)??'';
  return json.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[私钥已脱敏]').replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [已脱敏]').replace(/\bsk-[A-Za-z0-9_-]{12,}/g,'[已脱敏]').replace(/([?&](?:token|api_key|access_token)=)[^&\s"\\]+/gi,'$1[已脱敏]');
}
// AI 诊断暂时停用：保留实现，统一隐藏总览与证据链中的入口。
// 恢复时将下方返回值改为 h(AiDiagnosisImplementation, props)，并恢复服务注册。
export function AiDiagnosis(props:Parameters<typeof AiDiagnosisImplementation>[0]) {
  void props;
  return null;
}
function AiDiagnosisImplementation(props:{connection?:ConfigurationConnection|undefined;sessions?:SessionsService|undefined;chain:EvidenceChain;label?:string;currentSessionId?:string|undefined;inspectCall?:((id:string)=>void)|undefined;onSelectRef?:((ref:EvidenceRef)=>void)|undefined}) {
  const [mode,setMode]=useState('quick');
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [routes,setRoutes]=useState<Route[]>([]),[route,setRoute]=useState(''),[model,setModel]=useState('');
  const [preparedGroups,setPreparedGroups]=useState<FailureGroup[]>([]);
  const [allGroupCount,setAllGroupCount]=useState(0);
  const [descriptions,setDescriptions]=useState<Record<string,EventDescription>>({});
  const [preparedRefs,setPreparedRefs]=useState<EvidenceRef[]>([]);
  const [preview,setPreview]=useState(''),[result,setResult]=useState<DiagnosisResult|null>(null);
  const pending=useRef<{id:string;controller:AbortController}|null>(null);
  const alive=useRef(true);
  const rpc=async(method:string,args:Record<string,unknown>,signal:AbortSignal)=>{
    if(!props.connection)throw Error('AI 诊断服务未连接，请更新并重启宿主插件');
    const response=await props.connection.rpc.call('/api',`trajectoryAiDiagnostic/${method}`,{args},signal);
    if(!response.ok)throw Error(response.error?.message??'模型诊断失败');return response.value;
  };
  const cancel=()=>{const task=pending.current;if(task){task.controller.abort();void rpc('cancel',{id:task.id},AbortSignal.timeout(5000)).catch(()=>{});pending.current=null;}setBusy(false);};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;const task=pending.current;if(task){task.controller.abort();void rpc('cancel',{id:task.id},AbortSignal.timeout(5000)).catch(()=>{});}};},[]);
  const prepare=async()=>{
    setOpen(true);setBusy(true);setError('');setResult(null);
    const task={id:crypto.randomUUID(),controller:new AbortController()};pending.current=task;
    try {
      const source=props.chain;const raw:unknown[]=[];const cards:Record<string,EventDescription>={};const notes:string[]=[];
      const sessions=new Map<string,EvidenceRef>();for(const ref of source.refs)if(!sessions.has(ref.sessionId))sessions.set(ref.sessionId,ref);
      const histories=await Promise.all([...sessions.values()].slice(0,3).map(async ref=>{
        try{return {sessionId:ref.sessionId,events:await readEvidenceEvents(props.sessions,ref,task.controller.signal,true)};}
        catch(e){if(task.controller.signal.aborted)throw e;notes.push(`${ref.sessionId} 全历史读取失败，不判断该会话恢复状态`);return {sessionId:ref.sessionId,events:[]};}
      }));
      const allGroups=histories.flatMap(history=>collectFailureGroups(history.events,history.sessionId));
      const overview=source.diagnosisScope==='overview';
      const comprehensive=overview?histories.map(history=>overviewHistoryEvidence(history.events,history.sessionId,allGroups,source.overviewSnapshot)):[];
      const groups=selectFailureGroups(allGroups,source,overview?1:mode==='quick'?2:5);
      const groupedRefs=overview?comprehensive.flatMap(item=>item.refs):[...(source.toolFailures?.length?source.refs.filter(ref=>ref.failed):[]),...groups.flatMap(group=>group.refs)];
      const refs=[...new Map((groupedRefs.length?groupedRefs:source.refs).map(ref=>[`${ref.sessionId}:${ref.seq}`,ref])).values()].slice(0,overview?20:mode==='quick'?12:30);
      for(const ref of refs){
        task.controller.signal.throwIfAborted();
        const history=histories.find(history=>history.sessionId===ref.sessionId);
        let event=history?.events.find(event=>event.seq===ref.seq);
        if(!event)try{event=(await readEvidenceEvents(props.sessions,ref,task.controller.signal)).find(event=>event.seq===ref.seq);}catch(e){if(task.controller.signal.aborted)throw e;notes.push(`${ref.sessionId} #${ref.seq} 原始事件读取失败`);}
        if(event)cards[`${ref.sessionId}:${ref.seq}`]=describeEvidenceEvent(event,history?.events??[event]);
        const text=redactDiagnostic(event);const cap=mode==='quick'?700:900;
        raw.push({sessionId:ref.sessionId,seq:ref.seq,role:ref.role,event:text.slice(0,cap),truncated:text.length>cap});
      }
      const evidence=redactDiagnostic({scope:source.diagnosisScope??'tool',overviewSnapshot:source.overviewSnapshot,wholeChainSummary:comprehensive.map(item=>item.summary),title:source.title,conclusion:source.conclusion,rule:source.rule,facts:source.facts.slice(0,mode==='quick'?6:20),problemGroups:groups,notes:[...source.notes,...notes,'恢复仅由同工具同参数后续显式成功支持；未观察到恢复不等于故障持续。失败调用耗时不等于任务净延迟。'],coverage:{historySessions:histories.map(h=>({sessionId:h.sessionId,eventCount:h.events.length})),allFailureGroups:allGroups.length,allFailures:allGroups.reduce((sum,g)=>sum+g.failureCount,0),selectedGroups:groups.length,selected:refs.length,description:overview?'综合主会话全链路指标，原始证据跨任务进展、上下文、等待、工具、Team 选取；无法独立验收产物':'完整可读日志识别问题，按问题优先选取证据；只对展示的问题生成判断，不代表已分析全部异常'},raw});
      if(evidence.length>45000)throw Error('证据预览过大，请选择单次失败进行诊断');
      const choices=await rpc('models',{},task.controller.signal) as Route[];
      if(alive.current&&pending.current===task){setDescriptions(cards);setPreview(evidence);setPreparedRefs([...new Map([...refs,...groups.flatMap(group=>group.refs),...((source.overviewSnapshot as {metrics?:Array<{metricId:string;refs?:EvidenceRef[]}>}|undefined)?.metrics??[]).flatMap(metric=>(metric.refs??[]).map(ref=>({...ref,role:`${metric.metricId} 指标关联（发送指标摘要，未必包含事件正文）`})))].map(ref=>[`${ref.sessionId}:${ref.seq}`,ref])).values()]);setPreparedGroups(groups);setAllGroupCount(allGroups.length);setRoutes(choices);const first=choices.find(r=>r.models.length);setRoute(first?.provider??'');setModel(first?.models[0]?.id??'');if(!first)setError('宿主没有可用模型，请先在 DSH 模型设置中配置提供商。');}
    }catch(e){if(alive.current&&!task.controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}
    finally{if(alive.current&&pending.current===task){pending.current=null;setBusy(false);}}
  };
  const run=async()=>{
    setBusy(true);setError('');setResult(null);
    const task={id:crypto.randomUUID(),controller:new AbortController()};pending.current=task;
    const timeout=setTimeout(()=>{task.controller.abort();void rpc('cancel',{id:task.id},AbortSignal.timeout(5000)).catch(()=>{});},95000);
    try{const value=await rpc('run',{id:task.id,provider:route,model,evidence:preview,mode},task.controller.signal) as DiagnosisResult;if(alive.current&&pending.current===task)setResult(value);}
    catch(e){if(alive.current&&pending.current===task)setError(task.controller.signal.aborted?'诊断已取消或超时，可重试':e instanceof Error?e.message:String(e));}
    finally{clearTimeout(timeout);if(alive.current&&pending.current===task){pending.current=null;setBusy(false);}}
  };
  return h('section',{'aria-label':'AI 深度诊断',style:{margin:'10px 0',padding:10,border:'1px solid #9994',borderRadius:8}},[
    h('button',{disabled:busy,onClick:prepare},open?'重新准备 AI 诊断':props.label??'AI 快速判断'),
    open?h('div',{},[
      h('p',{},'点击开始后，会将下方证据预览发送给所选模型提供商，可能产生模型费用。仅分析，不执行工具或修改配置。'),
      h('label',{},['诊断模式 ',h('select',{'aria-label':'AI 诊断模式',disabled:busy,value:mode,onChange:(e:{target:{value:string}})=>{setMode(e.target.value);setPreview('');setResult(null);}},[h('option',{value:'quick'},'快速判断（默认）'),h('option',{value:'detail'},'详细分析')])]),
      h('p',{},mode==='quick'?(props.chain.diagnosisScope==='overview'?'综合任务进展、上下文、消耗、延迟、工具与 Team 六个维度，给出整体状态、主要瓶颈和下一步。':'优先分析真实失败及恢复记录，给出问题、影响、恢复状态和下一步。模型支持时关闭思考；切换模式后需重新准备证据。'):'详细分析使用更完整的关联证据，耗时较长。'),
      preparedGroups.length?h('details',{},[h('summary',{},`${props.chain.diagnosisScope==='overview'?'工具维度证据（综合诊断的一部分）':'本次重点问题'} ${preparedGroups.length} / ${allGroupCount} 组`),...preparedGroups.map(g=>h('p',{},`${g.tool} · 失败 ${g.failureCount} 次 · ${g.status==='recovered'?'已观察到成功重试':g.status==='mixed'?'部分已恢复':'未观察到同参数成功重试'} · ${g.error.slice(0,160)}`))]):null,
      h('label',{},['提供商 ',h('select',{'aria-label':'诊断模型提供商',disabled:busy,value:route,onChange:(e:{target:{value:string}})=>{setRoute(e.target.value);setModel(routes.find(r=>r.provider===e.target.value)?.models[0]?.id??'');}},routes.map(r=>h('option',{value:r.provider},`${r.name}${r.error?'（不可用）':''}`)))]),
      h('label',{},['模型 ',h('select',{'aria-label':'诊断模型',disabled:busy,value:model,onChange:(e:{target:{value:string}})=>setModel(e.target.value)},(routes.find(r=>r.provider===route)?.models??[]).map(m=>h('option',{value:m.id},m.name)))]),
      h('details',{},[h('summary',{},`查看并编辑发送内容（${preview.length} 字符）`),h('textarea',{'aria-label':'AI 诊断证据预览',disabled:busy,value:preview,onChange:(e:{target:{value:string}})=>setPreview(e.target.value),style:{width:'100%',height:200,boxSizing:'border-box'}})]),
      h('button',{disabled:busy||!model||!preview,onClick:run},mode==='quick'?(props.chain.diagnosisScope==='overview'?'开始综合判断':'开始快速判断'):'开始详细分析'),busy?h('button',{onClick:cancel},'取消'):null,
      busy?h('p',{role:'status'},'正在准备证据或执行模型诊断…'):null,
      error?h('p',{role:'alert'},error):null,
      result?h('article',{},[h('strong',{},'AI 分析结果 · 模型推断，需结合证据核实'),h('p',{},`${result.provider} / ${result.model} · ${new Date(result.createdAt).toLocaleString()} · ${(result.elapsedMs??0)/1000}s · 思考 ${result.reasoningEffort??'默认'} · 输入 ${result.inputCharacters} 字符`),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},result.text),h('section',{'aria-label':'调用与重试证据'},[h('strong',{},props.chain.diagnosisScope==='overview'?'全链路证据':'调用与重试关系'),...(preparedGroups.length&&props.chain.diagnosisScope!=='overview'?preparedGroups.map(group=>({title:`${group.tool} · ${group.failureCount} 次失败 · ${group.status==='recovered'?'已恢复':group.status==='mixed'?'部分恢复':'未确认恢复'}`,refs:group.refs.filter(ref=>preparedRefs.some(item=>item.sessionId===ref.sessionId&&item.seq===ref.seq))})):[{title:'关联原始事件',refs:preparedRefs}]).map((group,groupIndex)=>h('article',{key:groupIndex,style:{borderTop:'1px solid #9994',marginTop:10,paddingTop:8}},[h('strong',{},group.title),...group.refs.map((ref,index)=>h('div',{key:`${ref.sessionId}:${ref.seq}`},[index>0&&props.chain.diagnosisScope!=='overview'?h('small',{},ref.role.includes('成功')?'↓ 后续成功（是否同参数见标注）':'↓ 同组关联事件'):null,h(EvidenceEventCard,{refInfo:ref,description:descriptions[`${ref.sessionId}:${ref.seq}`],currentSessionId:props.currentSessionId,inspectCall:props.inspectCall,onSelect:props.onSelectRef})]))]))]),h('details',{},[h('summary',{},'模型用量'),h('small',{},`服务商用量：${result.usage?JSON.stringify(result.usage):'未上报'}；配置调整请使用现有配置建议与审阅入口。`)])]):null,
    ]):null,
  ]);
}
