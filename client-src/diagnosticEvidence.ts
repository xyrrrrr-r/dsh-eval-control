import type {RawEvent} from './evidencePanel.js';
import type {EvidenceChain,EvidenceRef} from './evidence.js';
export interface FailureGroup {
  tool:string;failureCount:number;failureSeqs:number[];status:'recovered'|'not_observed'|'mixed';
  failedExecutionMs:number;measuredFailures:number;firstSeq:number;lastSeq:number;
  error:string;parameters:string;recoverySeq:number|null;recoveryDelayMs:number|null;relatedSuccessSeq:number|null;refs:EvidenceRef[];
}
const stable=(value:any):string=>typeof value!=='object'||value===null?JSON.stringify(value)??String(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
function argumentsKey(value:unknown):string {if(typeof value==='string'){try{return stable(JSON.parse(value));}catch{return value;}}return stable(value);}
/** Exact callId pairs; recovery requires a later successful retry with identical tool and arguments. */
export function collectFailureGroups(events:RawEvent[],sessionId:string):FailureGroup[] {
  const ordered=events.slice().sort((a,b)=>a.seq-b.seq);
  const calls=new Map<string,{seq:number;time:number;name:string;args:string|null}>();
  const attempts:Array<{call:{seq:number;time:number;name:string;args:string|null};seq:number;time:number;failed:boolean;error:string}>=[];
  const seen=new Set<string>();
  for(const raw of ordered){const e=raw as any;
    if(e.type==='tool/call')calls.set(String(e.data.callId),{seq:e.seq,time:e.time,name:e.data.name,args:e.data.arguments===undefined&&e.data.input===undefined?null:argumentsKey(e.data.arguments??e.data.input)});
    if(e.type!=='tool/result'||e.surfaceOp?.op==='replace')continue;
    const message=e.data?.message;const id=String(message?.toolCallId);const call=calls.get(id);
    if(!call||seen.has(id)||typeof message?.isError!=='boolean')continue;
    seen.add(id);attempts.push({call,seq:e.seq,time:e.time,failed:message.isError,error:(message.content??[]).map((b:any)=>typeof b.text==='string'?b.text:'').join('\n')});
  }
  const buckets=new Map<string,typeof attempts>();
  for(const attempt of attempts.filter(a=>a.failed)){
    const fingerprint=attempt.error.replace(/\b\d+\b/g,'#').replace(/\s+/g,' ').slice(0,300);
    const key=`${attempt.call.name}\n${fingerprint}`;const bucket=buckets.get(key)??[];bucket.push(attempt);buckets.set(key,bucket);
  }
  return [...buckets.values()].map(failures=>{
    const first=failures[0]!,last=failures[failures.length-1]!;
    const recoveries=failures.map(failed=>attempts.find(a=>!a.failed&&a.call.seq>failed.seq&&a.call.name===failed.call.name&&failed.call.args!==null&&a.call.args===failed.call.args));
    const recovered=recoveries.filter(Boolean).length;
    const recovery=recoveries[recoveries.length-1];
    const related= !recovery ? attempts.find(a=>!a.failed&&a.call.name===last.call.name&&a.call.seq>last.seq):undefined;
    const refs=new Map<number,EvidenceRef>();
    for(const a of [first,last,...recoveries.filter(a=>a!==undefined).slice(-1),...(related?[related]:[])]){
      refs.set(a.call.seq,{sessionId,seq:a.call.seq,role:a.failed?'失败调用':a===related?'后续同工具成功（参数不同，非恢复证明）':'同参数成功重试',failed:a.failed});
      refs.set(a.seq,{sessionId,seq:a.seq,role:a.failed?'错误结果':a===related?'后续成功结果（参数不同，非恢复证明）':'重试成功结果',failed:a.failed});
    }
    const measured=failures.filter(a=>Number.isFinite(a.time)&&Number.isFinite(a.call.time)&&a.time>=a.call.time);
    return {failureSeqs:failures.map(f=>f.seq),relatedSuccessSeq:related?.seq??null,tool:first.call.name,failureCount:failures.length,status:recovered===failures.length?'recovered' as const:recovered?'mixed' as const:'not_observed' as const,failedExecutionMs:measured.reduce((sum,a)=>sum+a.time-a.call.time,0),measuredFailures:measured.length,firstSeq:first.seq,lastSeq:last.seq,error:last.error.slice(0,700),parameters:last.call.args?.slice(0,700)??'调用参数未记录，无法确认同参数重试',recoverySeq:recovery?.seq??null,recoveryDelayMs:recovery?Math.max(0,recovery.time-first.time):null,refs:[...refs.values()]};
  }).sort((a,b)=>Number(a.status==='recovered')-Number(b.status==='recovered')||b.failureCount-a.failureCount||b.failedExecutionMs-a.failedExecutionMs);
}
export function selectFailureGroups(groups:FailureGroup[],chain:EvidenceChain,limit:number):FailureGroup[] {
  if(chain.toolFailures?.length){const seqs=new Set(chain.toolFailures.map(f=>f.resultSeq));return groups.filter(g=>g.failureSeqs.some(seq=>seqs.has(seq))).slice(0,limit);}
  return groups.slice(0,limit);
}
