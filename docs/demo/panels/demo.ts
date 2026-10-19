/** Public README recordings use synthetic data and the actual dashboard components. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { bindReact } from '../../../client-src/react-binding.js';
import { createDashboardView } from '../../../client-src/dashboard.js';
import { injectStyles } from '../../../client-src/styles.js';

bindReact(React as never);injectStyles();
const time=Date.UTC(2026,9,19,2);
const teamInput=(id:string,offset=0,duration=240000)=>({sessionId:id,hasEvents:true,firstEventTimeMs:time+offset,lastEventRef:{sessionId:id,seq:360},eventCount:360,factTimeMax:time+720000,turnIntervals:[{turn:1,startMs:time+offset,startSeq:1,firstEndMs:time+offset+duration,firstEndSeq:360}],memberIds:[],teamMemberSnapshotRefs:[],memberLastRefs:{},subagentChildren:[],childLastRefs:{},taskSnapshots:[],teamMemberSnapshots:[],qualityItems:[],unpairedToolResultRefs:[],unknownEventTypes:0,openSpans:0});
const metric=(metricId:string,value:unknown)=>({metricId,contractVersion:'1',subjectId:'demo-run-a',status:'available',value,sampleCount:36,denominator:36,evidenceRefs:[],qualityRefs:[],evidenceLevel:'observed'});
const previews=['读取项目结构与接口定义，整理实现约束。','运行单元测试并收集失败用例。','根据测试输出修复参数校验与错误处理。','汇总已完成任务、关键改动和剩余验证项。'];
const injections=Array.from({length:24},(_,i)=>({seq:i*10+3,timeMs:time+i*26000,kind:i%4===0?'assistant':i%4===1?'tool-result':i%4===2?'user':'system',sourceKind:i%4===1?'tool':i%4===2?'user':i%4===0?'agent':'instructions',toolName:i%4===1?'read':null,tokens:i===15?8500:400+(i%6)*230,turn:1+Math.floor(i/8),preview:previews[i%4],textTokens:i===15?8500:350+(i%6)*200,toolCallTokens:i%4===0?150:0,fileTokens:i%4===1?100:0,outputTokens:i%4===0?900:null,cumulativeTokens:12000+i*2400,callId:i%4===1?`demo-call-${i}`:null,callTool:i%4===1?'read':null}));
for(let i=0;i<3;i++)injections.push({...injections[1],seq:270+i,timeMs:time+680000+i*100,tokens:600+i*120,preview:`演示工具输出 ${i+1}：测试摘要与增量检查结果。`,cumulativeTokens:95000+i*800});
const oldNodes=[{seq:41,label:'assistant · 实现说明',tokens:12000,preview:previews[0],changed:true},{seq:81,label:'tool-result · 测试日志',tokens:24000,preview:'测试日志包含重复诊断输出，已完成校验。',changed:true},{seq:121,label:'assistant · 验证结果',tokens:17000,preview:previews[2],changed:true}];
const summary={evidenceRefs:[{seq:184,role:'压缩开始'},{seq:185,role:'摘要生成'},{seq:186,role:'上下文替换操作'},{seq:187,role:'压缩结束'}],seq:185,timeMs:time+360000,id:'demo-summary',kind:'summary',beforeTokens:95100,afterTokens:43000,reclaimedTokens:52100,reclaimRatio:52100/95100,elapsedMs:4200,turn:2,detail:{trigger:'manual',algorithm:'演示数据：模型摘要 + checkpoint + surfaceOp.replace',summary:'保留目标、实施约束、已完成的验证和待办事项；合并重复测试输出。',before:{nodeCount:3,truncated:false,nodes:oldNodes},after:{nodeCount:1,truncated:false,nodes:[{seq:186,label:'checkpoint · 任务摘要',tokens:900,preview:'目标：完成接口校验。已验证：参数边界、失败重试、成功路径。下一步：执行回归测试并整理报告。',changed:true}]}}};
const prunes=Array.from({length:3},(_,i)=>({seq:245+i*2,timeMs:time+510000+i*300,id:`demo-prune-${i}`,kind:'prune',beforeTokens:68000-i*900,afterTokens:67100-i*900,reclaimedTokens:900,reclaimRatio:900/(68000-i*900),elapsedMs:12,turn:3}));
const steps=Array.from({length:36},(_,i)=>({turn:1+Math.floor(i/12),step:i+1,seq:i*10+10,timeMs:time+i*20000,inputTokens:Math.round((i<18?22000+i*4300:43000+(i-18)*3800)*.6),cacheReadTokens:Math.round((i<18?22000+i*4300:43000+(i-18)*3800)*.4),cacheWriteTokens:0,outputTokens:1000+(i%5)*260,surfaceTokens:i<18?20000+i*4000:41000+(i-18)*3600}));
const surface={totalTokens:106000,systemPrompt:7000,conversation:52000,toolResults:24000,toolDefinitions:8500,fileContents:7000,compactionSummary:6500,other:1000};
const timeline={contextWindow:131072,contextWindowSeq:0,provider:'demo-provider',model:'demo-model',surface,steps,injections,injectionTotals:{count:injections.length,tokens:injections.reduce((sum,m)=>sum+m.tokens,0)},compactions:[summary,...prunes],compactionTotals:{count:4,reclaimedTokens:54800,elapsedMs:4236},tools:[{name:'read',calls:14,errors:0},{name:'edit',calls:10,errors:1},{name:'bash',calls:8,errors:1},{name:'write',calls:4,errors:0}],segments:Object.entries(surface).filter(([key])=>key!=='totalTokens').map(([segment,tokens],i)=>({segment,tokens,nodeCount:3,nodes:[{seq:i*10+1,label:`${segment} · 演示内容`,tokens,preview:previews[i%4],turn:1,callId:null,callTool:null}]}))};
const rootTeam={...teamInput('demo-run-a'),memberIds:['demo-research','demo-implement','demo-review'],subagentChildren:['demo-research','demo-implement','demo-review'].map((childId,i)=>({childId,childCreatedAtMs:time+i*40000,ref:{sessionId:'demo-run-a',seq:i+1}}))};
const analytics={eventsSeen:360,turnsStarted:3,turnsEnded:3,stepsStarted:36,stepsEnded:36,toolCalls:36,toolResults:36,toolErrors:2,inputTokens:820000,inputUsageSteps:36,retries:1,compactionStarts:1,compactionSummaries:1,compactionEnds:1,prunePasses:3,compactionShadowedTokens:52100,pruneShadowedTokens:2700,compactionElapsedMs:4236,teamMemberSnapshots:3,teamTaskSnapshots:3,queuedTeamMessages:3,deliveredTeamMessages:3,metricResults:[metric('context.compaction_frequency_per_1k_input_tokens',.0012),metric('tool.failure_rate',2/36),metric('tool.repeat_loop',{loopCount:0,maxRunLength:2}),metric('model.long_gap_segments',{gapCount:2}),metric('quality.coverage',{unknownEventTypes:0,openSpans:0})],teamInput:rootTeam,turnTrend:[{turn:1,toolCalls:14,toolErrors:1,retries:0,compactionStarts:0,inputTokens:280000},{turn:2,toolCalls:12,toolErrors:1,retries:1,compactionStarts:1,inputTokens:300000},{turn:3,toolCalls:10,toolErrors:0,retries:0,compactionStarts:0,inputTokens:240000}],recentEvents:[{seq:185,time:time+360000,type:'compaction/summary',label:'任务摘要检查点'},{seq:245,time:time+510000,type:'compaction/prune',label:'工具结果修剪'}]};
const stats={turns:3,steps:36,llmMs:420000,toolMs:90000,ttftMs:36000,ttftSteps:36,decodeTokens:48000};
const alternative=structuredClone({trajectoryAnalytics:analytics,contextTimeline:timeline,sessionStats:stats});
alternative.trajectoryAnalytics.inputTokens=560000;alternative.trajectoryAnalytics.toolErrors=0;alternative.trajectoryAnalytics.teamInput.sessionId='demo-run-b';alternative.trajectoryAnalytics.metricResults[0].value=.0008;alternative.sessionStats.llmMs=310000;alternative.sessionStats.decodeTokens=39000;alternative.contextTimeline.steps=steps.map(step=>({...step,inputTokens:Math.round(step.inputTokens*.75),cacheReadTokens:Math.round(step.cacheReadTokens*.75)}));
const data:any={'demo-run-a':{trajectoryAnalytics:analytics,contextTimeline:timeline,sessionStats:stats,contextPressure:{contextWindow:131072}} ,'demo-run-b':alternative};
['demo-research','demo-implement','demo-review'].forEach((id,i)=>data[id]={trajectoryAnalytics:{...analytics,inputTokens:50000+i*18000,toolCalls:5+i*2,teamInput:teamInput(id,i*40000,180000+i*60000)}});
// Synthetic durable history uses the current host event shape, including
// subscriptions, task ownership changes, peer messages and delivery receipts.
const event=(seq:number,offset:number,type:string,data:any,surfaceOp?:unknown)=>({type:'event',event:{seq,time:time+offset,type,data,...(surfaceOp?{surfaceOp}:{})}});
const rawEvents=injections.flatMap((m,i)=>{
 const text=i===15?'演示上下文更新：包含验收约束与测试摘要。'.repeat(1700):m.kind==='tool-result'&&i===5?'ENOENT: /workspace/demo/missing-config.json not found':m.preview.repeat(50+i%5*20);
 const message={role:m.kind==='tool-result'?'tool':m.kind,content:[{type:'text',text}],source:{kind:m.sourceKind},...(m.callId?{toolCallId:m.callId,isError:i===5}:{})};
 return [...(m.callId?[event(m.seq-1,m.timeMs-time-300,'tool/call',{callId:m.callId,name:i===5?'read':'bash',arguments:{command:'npm test',path:'/workspace/demo/config.json'}})]:[]),event(m.seq,m.timeMs-time,m.kind==='tool-result'?'tool/result':`${m.kind}/message`,m.kind==='user'?message:{turn:m.turn,message,...(m.outputTokens!==null?{step:i+1,usage:{inputTokens:22000+i*2000,cacheReadTokens:4000,outputTokens:m.outputTokens}}:{})},'append')];
});
const occupancyEvents=[event(0,0,'request/context',{contextWindow:131072,provider:'demo-provider',model:'demo-model'}),event(1,0,'turn/start',{turn:1}),...steps.map(step=>event(step.seq,step.timeMs-time,'assistant/message',{turn:step.turn,step:step.step,usage:{inputTokens:step.inputTokens,cacheReadTokens:step.cacheReadTokens,outputTokens:step.outputTokens},message:{role:'assistant',content:[{type:'reasoning',text:'核对已知约束与验证结果。'.repeat(30)},{type:'text',text:'演示回复：已完成当前步骤验证。'.repeat(40)}]}},'append'))];
const compactionEvents=[event(184,356000,'compaction/start',{compactionId:'demo-summary'}),event(185,360000,'compaction/summary',{compactionId:'demo-summary'}),event(186,360100,'system/message',{message:{role:'system',content:[{type:'text',text:summary.detail.summary}],source:{kind:'compaction'}}},{op:'replace',startSeq:1,endSeq:183}),event(187,360200,'compaction/end',{compactionId:'demo-summary'}),...prunes.map(row=>event(row.seq,row.timeMs-time,'compaction/prune',{}))];
const memberSpecs=[['demo-research','调研 Agent','梳理接口边界，输出实现约束。'],['demo-implement','实现 Agent','根据接口契约开发并反馈集成结果。'],['demo-review','验证 Agent','执行回归测试并复核结果。']];
const collaboration=memberSpecs.map(([id,name,description],i)=>event(400+i,i*40000,'team/member',{teamId:'demo-run-a',member:{id,name,description,phase:'active',provider:'demo-provider',context:'fresh'}}));
const task=(seq:number,offset:number,id:string,subject:string,ownerId:string,status:string,blockedBy:string[]=[])=>event(seq,offset,'team/task',{task:{id,subject,description:'演示共享任务：按约定接口执行，并附验证证据。',ownerId,status,blockedBy}});
collaboration.push(task(410,50000,'task-design','梳理接口与风险','demo-research','in_progress'),task(411,70000,'task-build','实现参数校验','demo-implement','pending',['task-design']),task(412,80000,'task-test','执行回归测试','demo-review','pending',['task-build']),task(413,180000,'task-design','梳理接口与风险','demo-research','completed'),task(414,210000,'task-build','实现参数校验','demo-implement','in_progress'),task(415,390000,'task-build','实现参数校验','demo-implement','completed'),task(416,420000,'task-test','执行回归测试','demo-review','in_progress'));
const communicate=(seq:number,offset:number,id:string,senderId:string,senderName:string,targetId:string,text:string)=>{
 collaboration.push(event(seq,offset,'team/message/queued',{message:{id,senderId,senderName,targetId,content:[{type:'text',text}]}}),event(seq+1,offset+120,'team/message/delivered',{messageId:id,targetId}));
};
communicate(420,100000,'message-plan','demo-run-a','主 Agent','demo-research','请先梳理接口约束，完成 task-design 后将结论发给实现 Agent。');
communicate(422,190000,'message-contract','demo-research','调研 Agent','demo-implement','接口约束已确认：缺少配置文件时返回明确路径错误；请按该契约实现。');
communicate(424,200000,'message-report','demo-research','调研 Agent','demo-run-a','task-design 已完成，接口约束已同步给实现 Agent。');
communicate(426,400000,'message-handoff','demo-implement','实现 Agent','demo-review','task-build 已完成。请验证路径缺失、无权限和成功路径三个分支。');
communicate(428,430000,'message-review','demo-run-a','主 Agent','demo-review','请优先执行失败路径验证；发现问题直接回传实现 Agent，并保留测试证据。');
communicate(430,500000,'message-finding','demo-review','验证 Agent','demo-implement','验证发现空路径报错信息不完整，请补充参数名后再次提交。');
communicate(432,540000,'message-fix','demo-implement','实现 Agent','demo-review','已补充参数名并更新测试，请复核最新版本。');
communicate(434,600000,'message-done','demo-review','验证 Agent','demo-run-a','回归测试通过：成功与失败路径均已覆盖，证据已写入任务说明。');
collaboration.push(task(440,610000,'task-test','执行回归测试','demo-review','completed'),event(480,720000,'turn/end',{turn:3}));
rootTeam.lastEventRef={sessionId:'demo-run-a',seq:480};rootTeam.teamMemberSnapshotRefs=collaboration.filter(e=>e.event.type==='team/member').map(e=>({sessionId:'demo-run-a',seq:e.event.seq}));
analytics.queuedTeamMessages=8;analytics.deliveredTeamMessages=8;
const fixtureEvents=[...new Map([...rawEvents,...occupancyEvents,...compactionEvents,...collaboration].map(entry=>[entry.event.seq,entry])).values()].sort((a,b)=>a.event.seq-b.event.seq);
const ctx={sessions:{
 refreshProjections:async()=>{},
 using:async(id:string,_options:unknown,callback:any)=>callback({
  ready:Promise.resolve(),
  binding:{
   eventSource:{
    getSnapshot:()=>({entries:id.startsWith('demo-run-')?fixtureEvents:[event(1,0,'turn/start',{turn:1}),event(360,240000,'turn/end',{turn:1})],hasMore:false}),
    subscribe:()=>()=>{},
   },
   session:{loadThrough:async()=>{},projections:{faceOf:(key:string)=>({getSnapshot:()=>data[id]?.[key]})}},
  },
 }),
}};
const View=createDashboardView(ctx);
const rows={ids:['demo-run-a','demo-run-b'],byId:{'demo-run-a':{displayTitle:'基线运行 · 完整工具集',updatedAt:time,blank:false,running:false},'demo-run-b':{displayTitle:'优化运行 · 精简上下文',updatedAt:time+3600000,blank:false,running:false}}};
createRoot(document.getElementById('app')!).render(React.createElement(View,{sessionId:'demo-run-a',useProjection:(key:string)=>data['demo-run-a'][key],useSessions:(selector:any)=>selector(rows)}));
