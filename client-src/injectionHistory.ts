import { estimateParts, emptyEstimate, type EstimateParts } from './contextEstimate.js';
import { toolFailures, type ToolFailure } from './toolErrors.js';
import { useEffect, useState } from './react-binding.js';
import type { ContextTimeline, SessionsService } from './types.js';
import type { RawEvent } from './evidencePanel.js';
type Message = ContextTimeline['injections'][number];
export interface InjectionHistory { phase: 'loading' | 'ready' | 'partial' | 'error'; messages: Message[]; toolFailures?: ToolFailure[]; toolCalls?: Array<{seq:number;callId:string;name:string}>; compactions?: ContextTimeline['compactions']; error?: string; requests?: ContextTimeline['steps']; firstSeq?: number | undefined; lastSeq?: number | undefined }
interface Source { getSnapshot(): {entries: Array<{type:string;event:RawEvent}>; hasMore:boolean; change?: {kind:string}}; subscribe(listener:()=>void):()=>void }
/** All append messages are retained as lightweight spike baseline records.
 * Small marker records only: content remains in the host event source. */
export function historyMessage(event: RawEvent, tools: Map<string,string>, includeReplacement = false): Message | null {
  const e = event as any;
  if(e.type === 'tool/call') tools.set(String(e.data.callId), e.data.name);
  if(e.surfaceOp !== 'append' && !(includeReplacement && e.surfaceOp?.op === 'replace')) return null;
  const kinds: Record<string, Message['kind']> = {'user/message':'user','system/message':'system','developer/message':'developer','tool/result':'tool-result','assistant/message':'assistant'};
  const kind = kinds[e.type];
  if(!kind) return null;
  const message = kind === 'user' ? e.data : e.data?.message;
  if(!message || !Array.isArray(message.content)) return null;
  const sourceKind = kind === 'system' ? 'system-prompt' : kind === 'developer' ? 'developer' : message.source?.kind ?? 'unknown';
  if((kind === 'system' || kind === 'developer') && !message.content.length) return null;
  let textTokens=4, toolCallTokens=0, fileTokens=0;
  if(message.role === 'system') textTokens = Math.ceil(message.content.reduce((n:number,b:any)=>n+(b.type==='text'?b.text.length:JSON.stringify(b).length),0)/4)+4;
  else for(const b of message.content) {
    if(b.type==='text'||b.type==='reasoning') textTokens+=Math.ceil(b.text.length/4)+4;
    else if(b.type==='tool-call') toolCallTokens+=Math.ceil(b.name.length/4)+Math.ceil(b.arguments.length/4)+4;
    else if(b.type==='image') {const {offloaded,...reference}=b;fileTokens+=4+Math.ceil(JSON.stringify(reference).length/4);}
    else textTokens+=4+Math.ceil(JSON.stringify(b).length/4);
  }
  const callId=kind==='tool-result'?String(message.toolCallId):null;
  const toolName=callId?tools.get(callId)??null:null;
  return {seq:e.seq,timeMs:e.time,kind,sourceKind,toolName,tokens:textTokens+toolCallTokens+fileTokens,turn:e.data.turn??null,preview:'',textTokens,toolCallTokens,fileTokens,outputTokens:e.type==='assistant/message'?e.data.usage?.outputTokens??null:null,cumulativeTokens:0,callId,callTool:toolName};
}

/** Reconstruct lifecycle references from original events; absent metering remains unknown. */
export function historyCompactions(events:RawEvent[]):ContextTimeline['compactions'] {
  const rows:ContextTimeline['compactions']=[];
  const starts=new Map<string,{seq:number;time:number}>();
  let pending:ContextTimeline['compactions'][number]|undefined;
  for(const raw of events) {
    const e=raw as any;
    if(e.type==='compaction/start') starts.set(e.data.compactionId,{seq:e.seq,time:e.time});
    if(e.type==='compaction/summary'||e.type==='compaction/prune') {
      const summary=e.type==='compaction/summary';
      const id=summary?e.data.compactionId:`prune-${e.seq}`;
      const start=starts.get(id);
      pending={seq:e.seq,timeMs:e.time,id,kind:summary?'summary':'prune',beforeTokens:null,afterTokens:null,reclaimedTokens:null,reclaimRatio:null,elapsedMs:null,turn:e.data.turn??null,evidenceRefs:[...(start?[{seq:start.seq,role:'压缩开始'}]:[]),{seq:e.seq,role:summary?'摘要生成':'历史修剪'}]};
      rows.push(pending);
    }
    if(pending && e.surfaceOp && typeof e.surfaceOp==='object' && e.surfaceOp.op==='replace') {
      pending.evidenceRefs?.push({seq:e.seq,role:'替换后的上下文'});pending=undefined;
    }
    if(e.type==='compaction/end') {
      const row=rows.slice().reverse().find(row=>row.id===e.data.compactionId);
      if(row){const start=starts.get(row.id);row.elapsedMs=start?Math.max(0,e.time-start.time):null;row.evidenceRefs?.push({seq:e.seq,role:'压缩结束'});}
    }
  }
  return rows;
}

function cancellable<T>(promise:Promise<T>|undefined, signal:AbortSignal):Promise<T|undefined> {
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason??new Error('读取已取消'));
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export async function watchInjectionHistory(sessions:SessionsService|undefined, sessionId:string, signal:AbortSignal, publish:(state:InjectionHistory)=>void):Promise<void> {
  if(!sessions?.using) throw Error('宿主未提供原始会话读取服务');
  await sessions.using(sessionId,{source:'dsh-eval-control-analytics',signal},async(reference)=>{
    const held=reference as {ready?:Promise<unknown>;binding?:{eventSource:Source;session:{loadThrough(seq:number):Promise<void>}}};
    await cancellable(held.ready,signal);signal.throwIfAborted();
    const binding=held.binding;
    if(!binding?.eventSource || !binding.session?.loadThrough) throw Error('宿主不支持完整历史读取');
    let loaded=false;
    let cache=new Map<number,Message>();let seen=new Set<number>();let tools=new Map<string,string>();let first:number|undefined;let surface=new Map<number,number>();let surfaceTotal=0;let componentNodes=new Map<number,EstimateParts>();let componentTotal=emptyEstimate();let requestCache=new Map<number,ContextTimeline['steps'][number]>();
    const update=()=>{
      if(signal.aborted)return;
      const snap=binding.eventSource.getSnapshot();
      const events=snap.entries.filter(e=>e.type==='event').map(e=>e.event).sort((a,b)=>a.seq-b.seq);
      // Prepending/replacing a window requires replay so early tool names are available.
      if(snap.change?.kind==='replace' || events[0]?.seq!==first || events.length<seen.size){cache=new Map();seen=new Set();tools=new Map();surface=new Map();surfaceTotal=0;requestCache=new Map();componentNodes=new Map();componentTotal=emptyEstimate();first=events[0]?.seq;}
      for(const event of events) if(!seen.has(event.seq)){
        seen.add(event.seq);
        const e=event as any;
        if(e.type==='assistant/message' && e.data?.usage){
          const usage=e.data.usage;
          requestCache.set(e.seq,{seq:e.seq,timeMs:e.time,turn:e.data.turn,step:e.data.step,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,cacheReadTokens:typeof usage.cacheReadTokens==='number'?usage.cacheReadTokens:null,cacheWriteTokens:typeof usage.cacheWriteTokens==='number'?usage.cacheWriteTokens:null,surfaceTokens:surfaceTotal,estimateParts:{...componentTotal}});
        }
        const op=e.surfaceOp;
        if(op?.op==='replace')for(const [seq,tokens] of surface)if(seq>=op.startSeq&&seq<=op.endSeq){surfaceTotal-=tokens;surface.delete(seq);const parts=componentNodes.get(seq);if(parts)for(const key of Object.keys(componentTotal) as Array<keyof EstimateParts>)componentTotal[key]-=parts[key];componentNodes.delete(seq);}
        const row=historyMessage(event,tools,true);
        if(row){const parts=estimateParts(event,row.tokens);componentNodes.set(event.seq,parts);for(const key of Object.keys(componentTotal) as Array<keyof EstimateParts>)componentTotal[key]+=parts[key];surface.set(event.seq,row.tokens);surfaceTotal+=row.tokens;row.cumulativeTokens=surfaceTotal;if(op==='append')cache.set(event.seq,row);}
      }
      const requests=[...requestCache.values()].sort((a,b)=>a.seq-b.seq);
      const compactions=historyCompactions(events);
      publish({toolCalls:events.filter(e=>e.type==='tool/call').map(e=>({seq:e.seq,callId:String((e as any).data.callId),name:(e as any).data.name})),toolFailures:toolFailures(events),requests,compactions,phase:loaded?(snap.hasMore?'partial':'ready'):'loading',messages:[...cache.values()].sort((a,b)=>a.seq-b.seq),firstSeq:events[0]?.seq,lastSeq:events.at(-1)?.seq});
    };
    const stop=binding.eventSource.subscribe(update);
    try {
      update();
      await cancellable(binding.session.loadThrough(0),signal);signal.throwIfAborted();loaded=true;update();
      await cancellable(new Promise<void>(()=>{}),signal);
    } finally {stop();}
  });
}
export function useInjectionHistory(sessions:SessionsService|undefined,sessionId:string,active:boolean):InjectionHistory {
  const [value,setValue]=useState<{id:string;state:InjectionHistory}>({id:sessionId,state:{phase:'loading',messages:[]}});
  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();
    setValue({id:sessionId,state:{phase:'loading',messages:[]}});
    void watchInjectionHistory(sessions,sessionId,controller.signal,state=>setValue({id:sessionId,state})).catch(error=>{
      if(!controller.signal.aborted)setValue(previous=>({id:sessionId,state:{...previous.state,phase:'error',error:String(error instanceof Error?error.message:error)}}));
    });
    return ()=>controller.abort();
  },[sessions,sessionId,active]);
  return value.id===sessionId?value.state:{phase:'loading',messages:[]};
}
