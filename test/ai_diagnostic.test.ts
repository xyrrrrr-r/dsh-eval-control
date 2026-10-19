import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateDiagnosis,validateDiagnosticInput,parseQuickDecision} from '../src/ai_diagnostic.js';
import type {GenerateOptions,StreamChunk} from '@deepseek-ai/dsh-llm';
test('AI diagnostics make a tool-free auxiliary request and return model and usage',async()=>{
 let request:GenerateOptions|undefined;
 const stream=async function*(options:GenerateOptions):AsyncIterable<StreamChunk>{request=options;yield {type:'text-delta',index:0,text:'可能原因：权限限制，参见 s #12。'};};
 const result=await generateDiagnosis(stream,'configured','test-model','s #12: permission denied',new AbortController().signal,'detail');
 assert.equal(result.model,'test-model');assert.match(result.text,/#12/);assert.equal(request?.tools,undefined);assert.equal(request?.maxTokens,8192);assert.match(request?.system??'',/非可信证据/);assert.equal(result.usage,null);
});
test('rejects empty or oversized evidence, empty output and cancellation',async()=>{
 assert.throws(()=>validateDiagnosticInput('p','m',''));assert.throws(()=>validateDiagnosticInput('p','m','x'.repeat(65001)));
 await assert.rejects(generateDiagnosis(async function*(){},'p','m','evidence',new AbortController().signal),/未返回正文/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(generateDiagnosis(async function*(){yield {type:'text-delta',index:0,text:'partial'};},'p','m','evidence',controller.signal));
});

test('accepts finalized text blocks without duplicating streamed text',async()=>{
 const stream=async function*():AsyncIterable<StreamChunk>{yield {type:'text-delta',index:0,text:'partial'};yield {type:'block-end',index:0,block:{type:'text',text:'complete diagnostic'}};};
 const result=await generateDiagnosis(stream,'p','m','evidence',new AbortController().signal,'detail');assert.equal(result.text,'complete diagnostic');
});

test('quick decisions validate category and restrict references to supplied events',()=>{
 const value={decision:'timeout',confidence:'medium',reason:'工具等待超时',evidence:[12],nextStep:'检查超时配置'};
 assert.equal(parseQuickDecision(JSON.stringify(value),JSON.stringify({raw:[{seq:12}]})).decision,'timeout');
 assert.throws(()=>parseQuickDecision(JSON.stringify({...value,evidence:[99]}),JSON.stringify({raw:[{seq:12}]})),/未提供/);
 assert.throws(()=>parseQuickDecision(JSON.stringify({...value,decision:'invented'}),'{}'),/格式/);
});

test('quick mode disables thinking on supported routes and emits a compact decision',async()=>{
 let request:GenerateOptions|undefined;
 const value={decision:'unknown',confidence:'low',reason:'缺少失败事件',evidence:[],nextStep:'选择一条失败结果再诊断'};
 const result=await generateDiagnosis(async function*(options):AsyncIterable<StreamChunk>{request=options;yield {type:'text-delta',index:0,text:JSON.stringify(value)};},'p','m',JSON.stringify({raw:[]}),new AbortController().signal,'quick',ReasoningEffortId('off'));
 assert.equal(request?.reasoningEffort,'off');assert.equal(request?.maxTokens,1200);assert.equal(result.text.split('\n').length,3);assert.equal(result.decision?.decision,'unknown');
});
test('overview requires six dimensions and does not substitute tool errors for the whole chain',async()=>{
 const decision={decision:'latency',confidence:'medium',reason:'主要瓶颈是等待，偶发工具错误不足以代表整体失败',nextStep:'检查长等待区间的实际来源',evidence:[],overall:'attention',dimensions:['progress','context','efficiency','latency','tools','team'].map(name=>({name,status:name==='team'?'unknown':'attention',summary:'按该维度证据判断'}))};
 const evidence=JSON.stringify({scope:'overview',raw:[],problemGroups:[{tool:'bash',failureCount:2,status:'recovered',failedExecutionMs:100,measuredFailures:2,recoverySeq:3}]});
 assert.throws(()=>parseQuickDecision(JSON.stringify({...decision,dimensions:[]}),evidence),/维度/);
 const result=await generateDiagnosis(async function*():AsyncIterable<StreamChunk>{yield {type:'text-delta',index:0,text:JSON.stringify(decision)};},'p','m',evidence,new AbortController().signal,'quick',ReasoningEffortId('off'));
 assert.match(result.text,/整体状态/);assert.match(result.text,/任务进展/);assert.match(result.text,/上下文/);assert.match(result.text,/Team 协调/);assert.doesNotMatch(result.text,/bash：失败/);
});

test('accepts explicit metric and group references but rejects embedded numbers and ambiguous sessions',()=>{
 const value={decision:'context_pressure',confidence:'medium',reason:'依据上下文指标',evidence:[42,43],nextStep:'检查峰值请求'};
 const input={raw:[{sessionId:'s',seq:12,event:'{"seq":999}'}],overviewSnapshot:{metrics:[{refs:[{sessionId:'s',seq:42}]}]},problemGroups:[{refs:[{sessionId:'s',seq:43}],failureSeqs:[888]}]};
 assert.deepEqual(parseQuickDecision(JSON.stringify(value),JSON.stringify(input)).evidence,[42,43]);
 for(const seq of [999,888,777])assert.throws(()=>parseQuickDecision(JSON.stringify({...value,evidence:[seq]}),JSON.stringify(input)),/未提供/);
 input.raw.push({sessionId:'other',seq:42,event:''});
 assert.throws(()=>parseQuickDecision(JSON.stringify({...value,evidence:[42]}),JSON.stringify(input)),/跨会话/);
});
