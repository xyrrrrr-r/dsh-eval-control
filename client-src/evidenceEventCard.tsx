import {h,useEffect,useState} from './react-binding.js';
import {formatDateTime} from './format.js';
import type {EvidenceRef} from './evidence.js';
import type {SessionsService} from './types.js';
import {readEvidenceEvents,type RawEvent} from './evidencePanel.js';
export interface EventDescription {tool:string;summary:string;callId:string|null;turn:number|null;step:number|null;time:number;failed:boolean;kind:string}
/** Prefer exact callId pairing over proximity; neighbors only supply known turn/step metadata. */
export function describeEvidenceEvent(event:RawEvent,events:RawEvent[]):EventDescription {
 const e=event as any;const data=e.data??{};
 const callId=typeof data.callId==='string'?data.callId:typeof data.message?.toolCallId==='string'?data.message.toolCallId:null;
 const call=e.type==='tool/call'?e:callId?events.find((raw:any)=>raw.type==='tool/call'&&raw.data?.callId===callId) as any:undefined;
 const anchor=events.filter((raw:any)=>raw.seq<=(call?.seq??event.seq)&&raw.type==='step/start').sort((a,b)=>b.seq-a.seq)[0] as any;
 let summary='';const args=call?.data?.arguments;
 if(args!==undefined){let value=args;try{if(typeof args==='string')value=JSON.parse(args);}catch{}summary=typeof value==='object'&&value?String(value.command??value.cmd??value.path??value.filePath??value.file_path??JSON.stringify(value)):String(value);}
 if(!summary){const message=data.message??(e.type==='user/message'?data:null);summary=(message?.content??[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join(' ')||e.type;}
 const turn=data.turn??call?.data?.turn??anchor?.data?.turn;
 const step=data.step??call?.data?.step??anchor?.data?.step;
 return {tool:call?.data?.name??(e.type==='tool/result'?'工具结果':e.type),summary:summary.replace(/\s+/g,' ').slice(0,180),callId,turn:typeof turn==='number'?turn:null,step:typeof step==='number'?step:null,time:event.time,failed:data.message?.isError===true,kind:e.type};
}
export function EvidenceEventCard(props:{refInfo:EvidenceRef;sessions?:SessionsService|undefined;description?:EventDescription|undefined;currentSessionId?:string|undefined;inspectCall?:((id:string)=>void)|undefined;onSelect?:(ref:EvidenceRef)=>void}) {
 const [loaded,setLoaded]=useState<EventDescription|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(props.description)return;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  void readEvidenceEvents(props.sessions,props.refInfo,controller.signal).then(events=>{const event=events.find(e=>e.seq===props.refInfo.seq);if(event&&!controller.signal.aborted)setLoaded(describeEvidenceEvent(event,events));},()=>{if(!controller.signal.aborted)setError('原始事件暂不可读');}).finally(()=>clearTimeout(timer));
  return()=>{clearTimeout(timer);controller.abort();};
 },[props.description,props.refInfo.sessionId,props.refInfo.seq,props.sessions]);
 const d=props.description??loaded;const failed=props.refInfo.failed||d?.failed;
 const canLocate=!!d?.callId&&props.currentSessionId===props.refInfo.sessionId&&!!props.inspectCall;
 return h('article',{'aria-label':`轨迹证据 ${props.refInfo.seq}`,style:{border:`1px solid ${failed?'#e5484d':'#9994'}`,borderRadius:8,padding:10,margin:'6px 0',fontSize:12}},[
  h('strong',{style:{color:failed?'#e5484d':undefined}},`${failed?'失败 · ':''}${d?.tool??props.refInfo.role} · ${props.refInfo.role}`),
  d?h('p',{style:{margin:'4px 0',opacity:0.7}},`第 ${d.turn??'?'} 轮 · 步骤 ${d.step??'?'} · ${formatDateTime(d.time)}`):h('p',{},error||'读取事件摘要…'),
  d?h('code',{style:{display:'block',whiteSpace:'pre-wrap',overflowWrap:'anywhere',margin:'6px 0'}},d.summary):null,
  canLocate?h('button',{onClick:()=>props.inspectCall?.(d!.callId!)},'打开原生轨迹'):h('small',{style:{display:'block',opacity:0.65}},d?.callId?'原生定位仅支持当前会话；请先打开所属会话。':'该事件暂无可用工具调用定位，请查看原始事件。'),
  props.onSelect?h('button',{onClick:()=>props.onSelect?.(props.refInfo)},'查看原始事件'):null,
  h('details',{},[h('summary',{style:{opacity:0.65}},`定位信息 · 事件 #${props.refInfo.seq}`),h('small',{},`${props.refInfo.sessionId} · callId ${d?.callId??'未提供'}`)]),
 ]);
}
