import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
const built=await build({stdin:{contents:"export {historyMessage,watchInjectionHistory,historyCompactions} from './client-src/injectionHistory';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const {historyMessage,watchInjectionHistory,historyCompactions}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const result=seq=>({seq,time:seq*100,type:'tool/result',surfaceOp:'append',data:{turn:1,message:{role:'tool',source:{kind:'tool'},toolCallId:'c',content:[{type:'text',text:'abcd'}]}}});
test('history includes more than 64 results, deduplicates snapshots and follows live events',async()=>{
 let entries=[result(100)];let more=true;let listener;let stopped=false;let released=false;let target;
 const source={getSnapshot:()=>({entries:entries.map(event=>({type:'event',event})),hasMore:more}),subscribe:fn=>{listener=fn;return()=>{stopped=true;}}};
 const states=[];const controller=new AbortController();let ready;
 const published=new Promise(resolve=>ready=resolve);
 const sessions={using:async(id,options,fn)=>{try{return await fn({ready:Promise.resolve(),binding:{eventSource:source,session:{loadThrough:async seq=>{target=seq;entries=[{seq:0,time:0,type:'tool/call',data:{callId:'c',name:'shell'}},...Array.from({length:100},(_,i)=>result(i+1))];more=false;listener();}}}});}finally{released=true;}}};
 const run=watchInjectionHistory(sessions,'s',controller.signal,state=>{states.push(state);if(state.phase==='ready')ready();}).catch(error=>{if(!controller.signal.aborted)throw error;});
 await published;
 assert.equal(target,0);assert.equal(states.at(-1).messages.length,100);assert.equal(states.at(-1).messages[0].toolName,'shell');assert.equal(states.at(-1).messages[0].tokens,9);assert.equal(states.at(-1).messages.at(-1).cumulativeTokens,900);
 listener();assert.equal(states.at(-1).messages.length,100);
 entries.push(result(101));listener();assert.equal(states.at(-1).messages.length,101);
 assert.equal(states.at(-1).lastSeq,101);
 controller.abort();await run;assert.ok(stopped&&released);
});
test('excludes replacements but keeps direct and assistant messages for full spike baselines',()=>{
 const tools=new Map();assert.equal(historyMessage({...result(2),surfaceOp:{op:'replace'}},tools),null);
 assert.equal(historyMessage({seq:1,time:1,type:'assistant/message',surfaceOp:'append',data:{}},tools),null);
 const user={seq:1,time:1,type:'user/message',surfaceOp:'append',data:{role:'user',source:{kind:'user'},content:[]}};
 assert.equal(historyMessage(user,tools).kind,'user');
 assert.equal(historyMessage({...user,type:'assistant/message',data:{message:{...user.data,role:'assistant'},usage:{outputTokens:12}}},tools).outputTokens,12);
 assert.equal(historyMessage({...user,data:{...user.data,source:{kind:'plugin'}}},tools).sourceKind,'plugin');
});
test('unexhausted history is partial and cancellation releases a pending load',async()=>{
 const controller=new AbortController();let stop=false;let release=false;let partial;
 const ready=new Promise(resolve=>partial=resolve);
 const sessions={using:async(id,o,fn)=>{try{return await fn({binding:{eventSource:{subscribe:()=>()=>{stop=true;},getSnapshot:()=>({entries:[],hasMore:true})},session:{loadThrough:async()=>{}}}});}finally{release=true;}}};
 const run=watchInjectionHistory(sessions,'s',controller.signal,state=>{if(state.phase==='partial')partial();}).catch(()=>{});
 await ready;controller.abort();await run;assert.ok(stop&&release);
});

test('all historical prune and summary markers retain exact lifecycle and replacement references',()=>{
 const events=[{seq:1,time:10,type:'compaction/start',data:{compactionId:'s'}},{seq:2,time:20,type:'compaction/summary',data:{compactionId:'s'}},{seq:3,time:30,type:'assistant/message',surfaceOp:{op:'replace'},data:{}},{seq:4,time:40,type:'compaction/end',data:{compactionId:'s'}}];
 for(let i=5;i<105;i++)events.push({seq:i,time:i*10,type:'compaction/prune',data:{}});
 const rows=historyCompactions(events);
 assert.equal(rows.length,101);assert.equal(rows[0].elapsedMs,30);assert.deepEqual(rows[0].evidenceRefs.map(r=>r.seq),[1,2,3,4]);assert.equal(rows[1].beforeTokens,null);assert.equal(rows.at(-1).seq,104);
});
test('full history retains all 553 request samples, priced before assistant output joins context',async()=>{
 const controller=new AbortController();let complete;
 const ready=new Promise(resolve=>complete=resolve);let latest;
 const events=Array.from({length:553},(_,i)=>({seq:i+1,time:(i+1)*100,type:'assistant/message',surfaceOp:'append',data:{turn:1,step:i+1,usage:{inputTokens:i+100,outputTokens:5,cacheReadTokens:20},message:{role:'assistant',source:{kind:'agent'},content:[{type:'text',text:'abcd'}]}}}));
 const sessions={using:async(id,options,fn)=>fn({binding:{eventSource:{subscribe:()=>()=>{},getSnapshot:()=>({hasMore:false,entries:events.map(event=>({type:'event',event}))})},session:{loadThrough:async()=>{}}}})};
 const run=watchInjectionHistory(sessions,'s',controller.signal,state=>{latest=state;if(state.phase==='ready')complete();}).catch(error=>{if(!controller.signal.aborted)throw error;});
 await ready;assert.equal(latest.requests.length,553);assert.equal(latest.requests[0].surfaceTokens,0);assert.equal(latest.requests[1].surfaceTokens,9);assert.equal(latest.requests[1].estimateParts.body,5);assert.equal(Object.values(latest.requests[1].estimateParts).reduce((a,b)=>a+b),9);assert.equal(latest.requests.at(-1).inputTokens,652);controller.abort();await run;
});
