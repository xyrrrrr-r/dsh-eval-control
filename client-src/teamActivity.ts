import type {RawEvent} from './evidencePanel.js';
export interface TeamInteraction {
 id:string;kind:'spawn'|'assignment'|'task'|'message';from:string;to:string;time:number;seq:number;
 label:string;text:string;refs:number[];
}
export function teamActivity(events:RawEvent[]) {
 const interactions:TeamInteraction[]=[];
 const previousOwners=new Map<string,string>();
 const seenMembers=new Set<string>();

 const members=new Map<string,{id:string;name:string;description:string;phase:string;provider:string;context:string;error:string;seq:number}>();
 const tasks=new Map<string,{id:string;subject:string;description:string;status:string;ownerId:string;blockedBy:string[];seq:number}>();
 const messages=new Map<string,{id:string;senderId:string;senderName:string;targetId:string;text:string;time:number;seq:number;deliveredSeq:number|null;delayMs:number|null}>();
 const deliveries=new Map<string,{seq:number;time:number}>();
 for(const e of events.slice().sort((a,b)=>a.seq-b.seq)){const d=(e as any).data??{};
  if(e.type==='team/member'&&typeof d.member?.id==='string'){const m=d.member;if(!seenMembers.has(m.id)){seenMembers.add(m.id);interactions.push({id:`member-${e.seq}`,kind:'spawn',from:d.teamId||'',to:m.id,time:e.time,seq:e.seq,label:'成员加入',text:m.description||'未记录分工说明',refs:[e.seq]});}members.set(m.id,{id:m.id,name:m.name||'',description:m.description||'',phase:m.phase||'',provider:m.provider||'',context:m.context||'',error:m.error||'',seq:e.seq});}
  if(e.type==='team/task'&&typeof d.task?.id==='string'){const t=d.task;const previous=tasks.get(t.id);const owner=typeof t.ownerId==='string'?t.ownerId:'';
   if(owner&&owner!==previousOwners.get(t.id))interactions.push({id:`assignment-${e.seq}`,kind:'assignment',from:'$taskboard',to:owner,time:e.time,seq:e.seq,label:previousOwners.get(t.id)?'任务改派':'任务分配',text:`${t.subject||t.id}\n${t.description||''}`,refs:[e.seq]});
   if(previous&&previous.status!==t.status)interactions.push({id:`task-${e.seq}`,kind:'task',from:'$taskboard',to:owner||'$taskboard',time:e.time,seq:e.seq,label:`任务${({pending:'待处理',in_progress:'开始',completed:'完成',deleted:'删除'} as Record<string,string>)[t.status]??t.status}`,text:t.subject||t.id,refs:[e.seq]});
   previousOwners.set(t.id,owner);tasks.set(t.id,{id:t.id,subject:t.subject||t.id,description:t.description||'',status:t.status||'unknown',ownerId:t.ownerId||'',blockedBy:Array.isArray(t.blockedBy)?t.blockedBy:[],seq:e.seq});}
  if(e.type==='team/message/queued'&&typeof d.message?.id==='string'){const m=d.message;messages.set(m.id,{id:m.id,senderId:m.senderId||'',senderName:m.senderName||'',targetId:m.targetId||'',text:(Array.isArray(m.content)?m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n'):'')||'非文本消息',time:e.time,seq:e.seq,deliveredSeq:null,delayMs:null});}
  if(e.type==='team/message/delivered'&&typeof d.messageId==='string')deliveries.set(d.messageId,{seq:e.seq,time:e.time});
 }
 for(const m of messages.values()){const delivery=deliveries.get(m.id);if(delivery){m.deliveredSeq=delivery.seq;m.delayMs=delivery.time>=m.time?delivery.time-m.time:null;}}
 for(const m of messages.values())interactions.push({id:`message-${m.id}`,kind:'message',from:m.senderId,to:m.targetId,time:m.time,seq:m.seq,label:m.deliveredSeq!==null?'消息 · 已送达':'消息 · 未观察到送达',text:m.text,refs:[m.seq,...(m.deliveredSeq!==null?[m.deliveredSeq]:[])]});
 return {interactions:interactions.sort((a,b)=>a.time-b.time||a.seq-b.seq),members:[...members.values()],tasks:[...tasks.values()].filter(t=>t.status!=='deleted'),messages:[...messages.values()].sort((a,b)=>b.time-a.time)};
}
