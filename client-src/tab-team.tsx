import { EvidenceButton } from './evidencePanel.js';
import { eventRef, uniqueEvidenceRefs, type EvidenceChain, type EvidenceProps } from './evidence.js';
/**
 * Team activity tab (ported from the shipped client half): per-member busy
 * timeline bars, concurrency facts, branch first-activity latencies, and the
 * wire-cap caveats the aggregate honestly reports.
 */
import { h, useState, useEffect } from './react-binding.js';
import {readEvidenceEvents} from './evidencePanel.js';
import {TeamCollaboration} from './teamCollaboration.js';
import {teamActivity} from './teamActivity.js';
import type {SessionsService} from './types.js';
import { formatMs, formatTokens } from './format.js';
import type { DashboardData } from './derive.js';
import type { MemberEntry, TeamAggregate } from './team.js';

function formatTeamMs(value:number):string {
 if(value<3600000)return formatMs(value);
 const hours=Math.floor(value/3600000),minutes=Math.floor(value%3600000/60000);
 return `${hours}h ${minutes}m`;
}

export function TeamTab(props: EvidenceProps & {
  sessions?: SessionsService | undefined;
  data: DashboardData;
  teamState: { phase: string; members: MemberEntry[] };
  team: TeamAggregate | null;
}): unknown {
  const { data, teamState, team } = props;
  const [selected,setSelected]=useState('all');
  const [details,setDetails]=useState<ReturnType<typeof teamActivity>>({members:[],tasks:[],messages:[],interactions:[]});
  const [historyStatus,setHistoryStatus]=useState('loading');
  const [messageLimit,setMessageLimit]=useState(15);
  const root=data.analytics?.teamInput;
  useEffect(()=>{const controller=new AbortController();setDetails({members:[],tasks:[],messages:[],interactions:[]});setHistoryStatus('loading');setSelected('all');
    if(!root?.lastEventRef||!props.sessions){setHistoryStatus('unavailable');return;}
    const timeout=setTimeout(()=>{controller.abort();setHistoryStatus('unavailable');},20000);
    void readEvidenceEvents(props.sessions,{...root.lastEventRef,role:'Team 历史'},controller.signal,true).then(events=>{if(!controller.signal.aborted){setDetails(teamActivity(events));setHistoryStatus('ready');}}).catch(()=>{if(!controller.signal.aborted)setHistoryStatus('unavailable');}).finally(()=>clearTimeout(timeout));
    return()=>{clearTimeout(timeout);controller.abort();};
  },[root?.sessionId,root?.teamMemberSnapshotRefs?.length,root?.taskSnapshots?.length,data.analytics?.queuedTeamMessages,data.analytics?.deliveredTeamMessages,props.sessions]);
  const memberIds = data.analytics?.teamInput?.memberIds ?? [];
  if (memberIds.length === 0) {
    return h('div', { style: emptyStyle }, '本会话没有 Team 成员活动。');
  }
  const asOf = team?.asOf ?? null;
  const teamEvidence = (memberId?: string): EvidenceChain => {
    const entries = teamState.members.filter(entry => !memberId || entry.memberId === memberId);
    const refs = entries.flatMap(entry => (entry.summary?.teamInput?.turnIntervals ?? []).flatMap(turn => [eventRef(entry.memberId, turn.startSeq, '成员轮次开始'), ...(turn.firstEndSeq !== null ? [eventRef(entry.memberId, turn.firstEndSeq, '成员轮次结束')] : [])]));
    return {title:memberId ? `成员 ${memberId} 忙碌时间` : 'Team 活动证据', conclusion:memberId ? formatTeamMs(team?.busyMs[memberId] ?? 0) : `并发峰值 ${team?.peak ?? '未知'} · 当前活跃 ${team?.activeNow ?? '未知'}`,level:'derived',
      rule:'合并各成员轮次区间计算忙碌时间，以区间扫描计算并发；未结束区间截到共同观测时间。',
      facts:[{label:'共同观测时间',value:asOf === null ? '未知' : new Date(asOf).toISOString(),source:'成员与根会话 factTimeMax 最大值'}],
      refs:uniqueEvidenceRefs([...(data.analytics?.teamInput?.teamMemberSnapshotRefs ?? []).map(ref=>({...ref,role:'成员快照'})), ...(data.analytics?.teamInput?.subagentChildren ?? []).filter(child=>!memberId||child.childId===memberId).map(child=>({...child.ref,role:'分支创建'})), ...(data.analytics?.teamInput?.lastEventRef ? [{...data.analytics.teamInput.lastEventRef,role:'根会话观测截至'}] : []), ...entries.flatMap(entry=>entry.summary?.teamInput?.lastEventRef ? [{...entry.summary.teamInput.lastEventRef,role:'成员观测截至'}] : []), ...refs]),
      notes:['成员投影有界，当前结果为近似值。', ...(team?.wallCoverage ?? []), ...entries.filter(entry=>!entry.summary?.teamInput).map(entry=>`成员 ${entry.memberId} 输入缺失，不能验证其活动。`)]};
  };

  const colors=['#4285f4','#13a3ad','#a970e2','#e69b31','#e35c7a'];
  const name=(id:string)=>id===root?.sessionId?'主会话':details.members.find(m=>m.id===id)?.name||(memberIds.includes(id)?`成员 ${memberIds.indexOf(id)+1}`:`未知成员 ${id.slice(0,8)}`);
  const visible=memberIds.filter(id=>selected==='all'||id===selected);
  const allTurns=teamState.members.flatMap(e=>e.summary?.teamInput?.turnIntervals??[]);
  const starts=allTurns.map(t=>t.startMs).filter(Number.isFinite);
  const ends=allTurns.map(t=>t.firstEndMs??asOf??t.startMs).filter(Number.isFinite);
  const start=starts.length?Math.min(...starts):0,end=ends.length?Math.max(...ends):start;
  const span=Math.max(1,end-start);
  const clock=(time:number)=>new Date(time).toLocaleString();
  const eventEvidence=(seq:number,title:string,conclusion:string):EvidenceChain=>({title,conclusion,level:'observed',rule:'直接读取主会话 Team 原始事件；消息按 messageId 配对送达回执。',facts:[],notes:[],refs:root?[eventRef(root.sessionId,seq,title)]:[]});
  const panel={border:'1px solid color-mix(in srgb, currentColor 14%, transparent)',borderRadius:12,padding:16};
  const muted={opacity:0.65,fontSize:12};
  const tasks=details.tasks.filter(t=>selected==='all'||t.ownerId===selected);
  const messages=details.messages.filter(m=>selected==='all'||m.senderId===selected||m.targetId===selected);
  return h('div',{style:{display:'grid',gap:16}},[
    h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}},[h('div',{},[h('strong',{},'团队协作'),h('p',{style:muted},'分工、并行执行与消息交接')]),h(EvidenceButton,{...props,chain:()=>teamEvidence()}),h('label',{},['筛选成员 ',h('select',{value:selected,onChange:(e:Event)=>{setSelected((e.target as HTMLSelectElement).value);setMessageLimit(15);}},[h('option',{value:'all'},'全部成员'),...memberIds.map(id=>h('option',{value:id},name(id)))])])]),
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}},[
      ['协作成员',String(memberIds.length),'子会话'],['并发峰值',String(team?.peak??'—'),`未闭合轮次 ${Object.values(team?.openFlags??{}).filter(Boolean).length}`],['成员累计忙碌',team?formatTeamMs(Object.values(team.busyMs).reduce((a,b)=>a+b,0)):'—','各成员轮次区间合并后求和，可重叠'],['成员活动跨度',starts.length?formatTeamMs(end-start):'—','首个轮次开始 → 最后观测结束，包含空档'],['协作消息',String(data.analytics?.queuedTeamMessages??0),`送达回执 ${data.analytics?.deliveredTeamMessages??0}`]
    ].map(([label,value,note])=>h('div',{key:label,style:panel},[h('div',{style:muted},label),h('div',{style:{fontSize:23,fontWeight:650,margin:'8px 0'}},value),h('div',{style:muted},note)]))),
    h(TeamCollaboration,{details,rootId:root?.sessionId??'',memberIds,selectedMember:selected,onEvidence:props.onEvidence}),
    h('section',{style:panel},[h('strong',{},'成员并行时间线'),h('p',{style:muted},'色块为已观测轮次；间隔为空档。悬停查看轮次与时间，点击核查成员证据。细小区间至少显示 2px。'),
      starts.length?h('div',{style:{overflowX:'auto'}},h('div',{style:{minWidth:600}},[
       h('div',{style:{marginLeft:150,display:'flex',justifyContent:'space-between',fontSize:11,opacity:.6,marginBottom:10}},[start,start+span/2,end].map(time=>h('span',{key:time},clock(time)))),
       ...visible.map(id=>{const entry=teamState.members.find(m=>m.memberId===id);const turns=entry?.summary?.teamInput?.turnIntervals??[];const color=colors[memberIds.indexOf(id)%colors.length];return h('div',{key:id,style:{display:'grid',gridTemplateColumns:'140px 1fr',alignItems:'center',gap:10,marginBottom:14}},[
        h('button',{title:id,onClick:()=>setSelected(selected===id?'all':id),style:{textAlign:'left',overflow:'hidden',textOverflow:'ellipsis'}},name(id)),
        h('div',{style:{position:'relative',height:30,borderRadius:5,background:'color-mix(in srgb,currentColor 6%,transparent)',backgroundImage:'linear-gradient(to right,transparent calc(100% - 1px),#8883 1px)',backgroundSize:'25% 100%'}},turns.length?turns.map(t=>h('button',{key:t.startSeq,title:`${name(id)} · 第 ${t.turn} 轮 · ${clock(t.startMs)} → ${t.firstEndMs===null?'未结束':clock(t.firstEndMs)}`,onClick:()=>props.onEvidence?.({...teamEvidence(id),title:`${name(id)} · 第 ${t.turn} 轮`,refs:[eventRef(id,t.startSeq,'成员轮次开始'),...(t.firstEndSeq!==null?[eventRef(id,t.firstEndSeq,'成员轮次结束')]:[])]}),style:{position:'absolute',left:`${(t.startMs-start)/span*100}%`,width:`${Math.max(0,((t.firstEndMs??asOf??t.startMs)-t.startMs)/span*100)}%`,minWidth:2,height:22,top:4,padding:0,border:0,borderRadius:3,background:color,opacity:t.firstEndMs===null?.6:1}},'')):h('small',{style:muted},'成员轮次数据未加载'))]);})
      ])):h('p',{style:muted},teamState.phase==='loading'?'正在读取成员活动…':'暂无可用成员轮次数据')]),
    h('section',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:12}},visible.map(id=>{const m=details.members.find(m=>m.id===id);const summary=teamState.members.find(e=>e.memberId===id)?.summary as any;const busy=team?.busyMs[id];const open=team?.openFlags[id];const branch=team?.branchFirst.find(b=>b.childId===id);return h('article',{key:id,style:{...panel,borderTop:`3px solid ${colors[memberIds.indexOf(id)%colors.length]}`}},[
      h('div',{style:{display:'flex',justifyContent:'space-between',gap:10}},[h('strong',{},name(id)),h('span',{style:{color:m?.phase==='failed'?'#e5484d':open?'#dd9a21':'#13a3ad',fontSize:12}},m?.phase==='failed'?'创建失败':open?'轮次未结束':summary?'暂无进行中轮次':'数据不可读')]),
      h('p',{style:{fontSize:13,lineHeight:1.6,whiteSpace:'pre-wrap'}},m?.description||'未记录分工说明'),
      m?.error?h('p',{style:{color:'#e5484d'}},m.error):null,
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,fontSize:12}},[`忙碌 ${busy===undefined?'—':formatTeamMs(busy)}`,`轮次 ${summary?.turnsStarted??'—'}`,`输入 ${summary?formatTokens(summary.inputTokens??0):'—'} Token`,`工具 ${summary?.toolCalls??'—'} · 错误 ${summary?.toolErrors??'—'}`,`首活动延迟 ${branch?.latencyMs!==undefined?formatTeamMs(branch.latencyMs):'未知'}`,`${m?.provider||'提供商未记录'} · ${m?.context==='fork'?'继承上下文':m?.context==='fresh'?'独立上下文':'上下文模式未知'}`].map((value,index)=>h('span',{key:index},value))),
      h('div',{style:{marginTop:14}},h(EvidenceButton,{...props,label:'查看成员轨迹证据',chain:()=>teamEvidence(id)})),h('details',{style:{marginTop:10,fontSize:11}},[h('summary',{},'会话标识'),id])
    ]);})),
    h('section',{style:panel},[h('strong',{},`协作任务 · ${tasks.length}`),h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginTop:12}},['pending','in_progress','completed'].map(status=>h('div',{key:status,style:{maxHeight:420,overflowY:'auto'}},[h('div',{style:{fontSize:12,opacity:.7,marginBottom:8}},`${({pending:'待处理',in_progress:'进行中',completed:'已完成'} as Record<string,string>)[status]} · ${tasks.filter(t=>t.status===status).length}`),...tasks.filter(t=>t.status===status).map(t=>h('article',{key:t.id,style:{...panel,padding:10,marginBottom:8}},[h('strong',{style:{fontSize:13}},t.subject),h('p',{style:muted},t.ownerId?name(t.ownerId):'未分配'),t.blockedBy.length?h('p',{style:{fontSize:12,color:'#dd9a21'}},`依赖：${t.blockedBy.join('、')}`):null,h('details',{},[h('summary',{style:muted},'任务详情'),h('p',{style:{whiteSpace:'pre-wrap',fontSize:12}},t.description),h(EvidenceButton,{...props,chain:()=>eventEvidence(t.seq,'任务变更',t.subject)})])]))]))),tasks.length===0?h('p',{style:muted},historyStatus==='loading'?'正在读取任务记录…':'主会话未记录共享任务；不根据成员忙碌时长推断完成情况。'):null]),
    h('section',{style:panel},[h('strong',{},`消息往来 · ${messages.length}`),h('p',{style:muted},'按消息 ID 合并排队与送达事件；送达只表示对方收到，不代表任务已完成。'),...messages.slice(0,messageLimit).map(m=>h('article',{key:m.id,style:{borderTop:'1px solid #8883',padding:'12px 0'}},[
      h('div',{style:{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap',fontSize:12}},[h('strong',{},`${m.senderName||name(m.senderId)} → ${name(m.targetId)}`),h('span',{style:muted},`${clock(m.time)} · ${m.deliveredSeq!==null?'已送达'+(m.delayMs!==null?' · '+formatTeamMs(m.delayMs):''):'未观察到送达回执'}`)]),
      h('p',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:13,lineHeight:1.6}},m.text.slice(0,240)),h('details',{},[h('summary',{style:muted},'完整消息与证据'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:240,overflow:'auto'}},m.text),h(EvidenceButton,{...props,chain:()=>({...eventEvidence(m.seq,'协作消息',`${m.senderName||name(m.senderId)} → ${name(m.targetId)}`),refs:uniqueEvidenceRefs([eventRef(root!.sessionId,m.seq,'消息排队'),...(m.deliveredSeq!==null?[eventRef(root!.sessionId,m.deliveredSeq,'送达回执')]:[])])})})])
    ])),messages.length>messageLimit?h('button',{onClick:()=>setMessageLimit(n=>n+20)},`再显示 20 条（剩余 ${messages.length-messageLimit}）`):null,messages.length===0?h('p',{style:muted},historyStatus==='loading'?'正在读取通信历史…':'当前范围没有可读消息。'):null]),
    h('small',{style:muted},`${historyStatus==='unavailable'?'协作原文读取失败，当前仅展示可用投影。 ':''}忙碌时长按成员轮次区间合并估算，包含轮次中的等待；未闭合不等于当前正在运行。成员投影可能有界。${team?.wallCoverage.length?' 部分成员缺少结束记录。':''}`)
  ]);
}

const emptyStyle = {
  textAlign: 'center', padding: '48px 20px', opacity: 0.55, fontSize: '13px',
} as const;
