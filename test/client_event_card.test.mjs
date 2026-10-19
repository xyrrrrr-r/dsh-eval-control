import assert from 'node:assert/strict';import {test} from 'node:test';import {build} from 'esbuild';
const out=await build({stdin:{contents:"export {describeEvidenceEvent,EvidenceEventCard} from './client-src/evidenceEventCard';export {bindReact} from './client-src/react-binding';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const {describeEvidenceEvent,EvidenceEventCard,bindReact}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const nodes=t=>t&&typeof t==='object'?[t,...(t.children??[]).flat(Infinity).flatMap(nodes)]:[];
const events=[{seq:1,time:100,type:'step/start',data:{turn:1,step:2}},{seq:2,time:200,type:'tool/call',data:{callId:'c',name:'bash',arguments:{command:'git fetch origin'}}},{seq:3,time:300,type:'step/start',data:{turn:1,step:3}},{seq:4,time:400,type:'tool/result',data:{message:{toolCallId:'c',isError:true,content:[{type:'text',text:'failure'}]}}}];
test('result links to original call and uses its step rather than a newer nearby step',()=>{const d=describeEvidenceEvent(events[3],events);assert.equal(d.callId,'c');assert.equal(d.tool,'bash');assert.equal(d.summary,'git fetch origin');assert.equal(d.step,2);assert.equal(d.failed,true);});
test('native jump uses exact callId and is not offered for another session',()=>{
 bindReact({createElement:(type,props,...children)=>({type,props:props??{},children}),useState:initial=>[initial,()=>{}],useEffect:()=>{},Fragment:'f'});
 const description=describeEvidenceEvent(events[3],events);let jump;
 const props={refInfo:{sessionId:'s',seq:4,role:'错误结果'},description,currentSessionId:'s',inspectCall:id=>jump=id};
 let tree=EvidenceEventCard(props);nodes(tree).find(n=>n.type==='button'&&n.children.includes('打开原生轨迹')).props.onClick();assert.equal(jump,'c');
 tree=EvidenceEventCard({...props,currentSessionId:'other'});assert.ok(!nodes(tree).some(n=>n.type==='button'&&n.children.includes('打开原生轨迹')));
});
