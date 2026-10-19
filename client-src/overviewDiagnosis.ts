import type {RawEvent} from './evidencePanel.js';
import type {EvidenceChain,EvidenceRef} from './evidence.js';
import type {DashboardData} from './derive.js';
import type {FailureGroup} from './diagnosticEvidence.js';
export function overviewDiagnosticChain(sessionId:string,data:DashboardData,alerts:Array<{title:string;detail:string}>):EvidenceChain {
 const a=data.analytics;
 return {diagnosisScope:'overview',title:'全链路综合诊断',conclusion:'综合判断当前进展、主要瓶颈和下一步，不以单个工具错误代表整个会话。',level:'derived',rule:'联合任务进展、上下文、消耗、延迟、工具与团队六个维度；缺失数据必须标为未知。',facts:alerts.map(a=>({label:a.title,value:a.detail,source:'规则诊断'})),notes:['完成状态需核查任务目标与最终产物；助手声称完成不等于已经验收。'],refs:[...(a?.teamInput?.lastEventRef?[{...a.teamInput.lastEventRef,role:'最新会话事件'}]:[]),...(a?.recentEvents??[]).slice(-1).map(e=>({sessionId,seq:e.seq,role:'最新轨迹'}))],overviewSnapshot:{sessionId,stats:data.stats,utilization:data.utilization,contextWindow:data.contextWindow,analytics:a?{turnsStarted:a.turnsStarted,turnsEnded:a.turnsEnded,stepsStarted:a.stepsStarted,stepsEnded:a.stepsEnded,toolCalls:a.toolCalls,toolErrors:a.toolErrors,inputTokens:a.inputTokens,retries:a.retries,compactions:a.compactionSummaries,prunes:a.prunePasses,queuedTeamMessages:a.queuedTeamMessages,deliveredTeamMessages:a.deliveredTeamMessages,memberCount:a.teamInput?.memberIds?.length??0}:null,metrics:[...new Map((a?.metricResults??[]).filter(m=>/context|model|tool|team/.test(m.metricId)).map(m=>[m.metricId,m])).values()].slice(0,12).map(m=>({metricId:m.metricId,status:m.status,value:(JSON.stringify(m.value)??'未提供').slice(0,800),sampleCount:m.sampleCount,qualityRefs:m.qualityRefs,refs:m.evidenceRefs.slice(0,2)}))}};
}
/** Evidence is selected across stages and dimensions, not solely from tool failures. */
export function overviewHistoryEvidence(events:RawEvent[],sessionId:string,groups:FailureGroup[],snapshot:unknown) {
 const ordered=events.slice().sort((a,b)=>a.seq-b.seq);
 const refs:EvidenceRef[]=[];const add=(e:RawEvent|undefined,role:string)=>{if(e)refs.push({sessionId,seq:e.seq,role});};
 const users=ordered.filter(e=>e.type==='user/message'&&(e as any).surfaceOp==='append');
 const assistants=ordered.filter(e=>e.type==='assistant/message'&&(e as any).surfaceOp==='append');
 add(users[0],'最初任务输入');add(users.at(-1),'最新用户目标');add(assistants.at(-1),'最新助手进展（未独立验收）');
 let window:number|null=null;let peak:{event:RawEvent;ratio:number}|null=null;let input=0,output=0,requests=0;
 for(const e of ordered){const data=(e as any).data;
  if(e.type==='request/context'&&typeof data?.contextWindow==='number')window=data.contextWindow;
  if(e.type==='assistant/message'&&data?.usage){requests++;input+=data.usage.inputTokens??0;output+=data.usage.outputTokens??0;const occupancy=(data.usage.inputTokens??0)+(data.usage.cacheReadTokens??0);if(window&&(!peak||occupancy/window>peak.ratio))peak={event:e,ratio:occupancy/window};}
 }
 add(peak?.event,'最高已知窗口占用请求');
 const compactions=ordered.filter(e=>e.type==='compaction/summary'||e.type==='compaction/prune');add(compactions.at(-1),'最新压缩/修剪');
 const s=snapshot as {metrics?:Array<{metricId:string;refs?:Array<{sessionId:string;seq:number}>}>}|undefined;
 for(const family of ['model','tool.repeat','context']){const metric=s?.metrics?.find(m=>m.metricId.includes(family)&&m.refs?.length);for(const ref of metric?.refs??[])refs.push({...ref,role:`${metric!.metricId} 计算证据`});}
 refs.push(...(groups[0]?.refs??[]));
 const team=ordered.filter(e=>e.type.startsWith('team/'));add(team.at(-1),'最新 Team 活动');
 return {refs:[...new Map(refs.map(ref=>[`${ref.sessionId}:${ref.seq}`,ref])).values()],summary:{readableEventCount:ordered.length,requestCount:requests,inputTokens:input,outputTokens:output,peakKnownWindowRatio:peak?.ratio??null,summaryCompactions:compactions.filter(e=>e.type==='compaction/summary').length,prunes:compactions.filter(e=>e.type==='compaction/prune').length,explicitFailures:groups.reduce((sum,g)=>sum+g.failureCount,0),failureGroups:groups.length,fullyRecoveredGroups:groups.filter(g=>g.status==='recovered').length,teamEventCount:team.length,progressVerification:'仅提供最初目标、最新用户输入与最新助手记录；产物正确性及任务完成未独立验收',latencyInterpretation:'长间隔需结合模型、工具和用户空闲区间区分，不能直接认定为模型慢',teamCoverage:'提供主会话 Team 指标与事件；未合并成员完整轨迹时不能推断协调效率'}};
}
