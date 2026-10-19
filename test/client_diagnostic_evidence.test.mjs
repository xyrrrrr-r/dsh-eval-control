import assert from 'node:assert/strict';import {test} from 'node:test';import {build} from 'esbuild';
const out=await build({stdin:{contents:"export {collectFailureGroups,selectFailureGroups} from './client-src/diagnosticEvidence';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const {collectFailureGroups,selectFailureGroups}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const call=(seq,id,args)=>({seq,time:seq*100,type:'tool/call',data:{callId:id,name:'shell',...(args===undefined?{}:{arguments:args})}});
const result=(seq,id,isError,text='ENOENT file missing')=>({seq,time:seq*100,type:'tool/result',surfaceOp:'append',data:{message:{toolCallId:id,isError,content:[{type:'text',text}]}}});
test('groups real failures, pairs exact calls, measures observed duration and confirms exact-argument recovery',()=>{
 const events=[call(1,'a','{"cmd":"x"}'),result(2,'a',true),call(3,'b','{"cmd":"x"}'),result(4,'b',true),call(5,'c','{"cmd":"x"}'),result(6,'c',false)];
 const [group]=collectFailureGroups(events,'s');assert.equal(group.failureCount,2);assert.equal(group.status,'recovered');assert.equal(group.failedExecutionMs,200);assert.equal(group.recoverySeq,6);assert.equal(group.recoveryDelayMs,400);assert.ok(group.refs.some(ref=>ref.seq===1&&ref.failed));assert.ok(group.refs.some(ref=>ref.seq===6&&!ref.failed));
});
test('different or missing arguments, orphan results and missing flags do not prove recovery',()=>{
 const events=[call(1,'a','{"cmd":"x"}'),result(2,'a',true),call(3,'b','{"cmd":"y"}'),result(4,'b',false),result(5,'orphan',true),call(6,'d',undefined),result(7,'d',true),call(8,'e',undefined),result(9,'e',false),call(10,'f','x'),result(11,'f',undefined)];
 const [group]=collectFailureGroups(events,'s');assert.equal(group.failureCount,2);assert.equal(group.status,'not_observed');assert.equal(group.recoverySeq,null);
 assert.equal(selectFailureGroups([group],{toolFailures:[{resultSeq:2}]},2).length,1);
});
test('unconfirmed problems rank ahead of recovered problems; replacement results are excluded',()=>{
 const events=[call(1,'a','x'),result(2,'a',true,'permission denied'),call(3,'b','x'),result(4,'b',false),call(5,'c','z'),result(6,'c',true,'timeout'),{...result(7,'c',true),surfaceOp:{op:'replace'}}];
 const groups=collectFailureGroups(events,'s');assert.equal(groups.length,2);assert.equal(groups[0].status,'not_observed');assert.equal(groups[1].status,'recovered');
});
