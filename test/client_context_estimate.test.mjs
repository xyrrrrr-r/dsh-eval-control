import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
const b=await build({stdin:{contents:"export {estimateParts,ESTIMATE_PARTS} from './client-src/contextEstimate';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const {estimateParts,ESTIMATE_PARTS}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
test('separates thought, body and call arguments with additive structural overhead',()=>{
 const e={type:'assistant/message',data:{message:{role:'assistant',content:[{type:'text',text:'abcd'},{type:'reasoning',text:'abcdefgh'},{type:'tool-call',name:'read',arguments:'abcd'}]}}};
 const p=estimateParts(e,21);assert.equal(p.body,5);assert.equal(p.reasoning,6);assert.equal(p.toolCalls,6);assert.equal(p.structure,4);assert.equal(Object.values(p).reduce((a,b)=>a+b),21);
 assert.equal(ESTIMATE_PARTS.find(p=>p[0]==='reasoning')[2],'依路由而定');
});
test('tool result and system content are distinct from conversational body',()=>{
 assert.equal(estimateParts({type:'tool/result',data:{message:{role:'tool',content:[{type:'text',text:'abcd'}]}}},9).toolResults,5);
 assert.equal(estimateParts({type:'system/message',data:{message:{role:'system',content:[{type:'text',text:'abcd'}]}}},5).system,5);
});
