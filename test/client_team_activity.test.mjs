import assert from 'node:assert/strict';import {test} from 'node:test';import {build} from 'esbuild';
const out=await build({stdin:{contents:"export {teamActivity} from './client-src/teamActivity';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const {teamActivity}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
test('team history preserves names, latest task state and pairs delivery by message ID',()=>{
 const events=[{seq:1,time:1,type:'team/member',data:{member:{id:'c',name:'实现成员',description:'负责插件',phase:'active'}}},{seq:2,time:2,type:'team/task',data:{task:{id:'t',subject:'实现插件',ownerId:'c',status:'pending'}}},{seq:3,time:3,type:'team/task',data:{task:{id:'t',subject:'实现插件',ownerId:'c',status:'completed',blockedBy:[]}}},{seq:4,time:10,type:'team/message/queued',data:{message:{id:'m',senderId:'c',senderName:'实现成员',targetId:'root',content:[{type:'text',text:'已提交'}]}}},{seq:5,time:30,type:'team/message/delivered',data:{messageId:'other'}},{seq:6,time:50,type:'team/message/delivered',data:{messageId:'m'}}];
 const result=teamActivity(events.reverse());assert.equal(result.members[0].name,'实现成员');assert.equal(result.tasks.length,1);assert.equal(result.tasks[0].status,'completed');assert.equal(result.messages[0].text,'已提交');assert.equal(result.messages[0].delayMs,40);assert.equal(result.messages[0].deliveredSeq,6);
});
test('missing delivery is unknown, deleted tasks hidden, absent metadata safe',()=>{
 const result=teamActivity([{seq:1,time:0,type:'team/task',data:{task:{id:'t',status:'deleted'}}},{seq:2,time:1,type:'team/message/queued',data:{message:{id:'m'}}},{seq:3,time:2,type:'team/member',data:{member:{id:'c'}}}]);
 assert.equal(result.tasks.length,0);assert.equal(result.messages[0].deliveredSeq,null);assert.equal(result.messages[0].delayMs,null);assert.equal(result.members[0].name,'');
});
test('collaboration records ownership transitions rather than counting repeated snapshots as dispatches',()=>{
 const e=(seq,type,data)=>({seq,time:seq*100,type,data});
 const result=teamActivity([
 e(1,'team/member',{teamId:'root',member:{id:'a',name:'Alpha'}}),e(2,'team/member',{teamId:'root',member:{id:'a',phase:'active'}}),
 e(3,'team/task',{task:{id:'t',subject:'开发',ownerId:'a',status:'pending'}}),e(4,'team/task',{task:{id:'t',subject:'开发',ownerId:'a',status:'in_progress'}}),e(5,'team/task',{task:{id:'t',subject:'开发',ownerId:'b',status:'in_progress'}}),
 e(6,'team/message/queued',{message:{id:'m',senderId:'a',targetId:'b',content:[{type:'text',text:'请核对接口'}]}}),e(7,'team/message/delivered',{messageId:'m'})]);
 assert.equal(result.interactions.filter(i=>i.kind==='spawn').length,1);
 const assignments=result.interactions.filter(i=>i.kind==='assignment');assert.equal(assignments.length,2);assert.equal(assignments[0].from,'$taskboard');assert.equal(assignments[1].to,'b');assert.equal(assignments[1].label,'任务改派');
 const message=result.interactions.find(i=>i.kind==='message');assert.equal(message.from,'a');assert.equal(message.to,'b');assert.deepEqual(message.refs,[6,7]);assert.deepEqual(result.interactions.map(i=>i.seq),[1,3,4,5,6]);
});
