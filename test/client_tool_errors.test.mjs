import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
const built=await build({stdin:{contents:"export {toolFailures,analyzeToolError} from './client-src/toolErrors'; export {toolEvidence} from './client-src/evidence';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const {toolFailures,analyzeToolError,toolEvidence}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('only explicit failures are analyzed, and exact call and result references are marked',()=>{
 const events=[{seq:1,type:'tool/call',data:{callId:'c',name:'shell'}},...[[2,true],[3,false],[4,undefined]].map(([seq,isError])=>({seq,type:'tool/result',surfaceOp:'append',data:{message:{toolCallId:'c',isError,content:[{type:'text',text:'EACCES permission denied'}]}}}))];
 const failures=toolFailures(events);
 assert.equal(failures.length,1);assert.equal(failures[0].callSeq,1);assert.match(failures[0].analysis,/权限/);
 const chain=toolEvidence('s','shell',null,null,failures);
 assert.ok(chain.refs.find(r=>r.seq===1).failed);assert.ok(chain.refs.find(r=>r.seq===2).failed);assert.equal(chain.toolFailures.length,1);
 assert.equal(toolFailures([{...events[1],surfaceOp:{op:'replace'}}]).length,0);
});
test('unknown cause remains uncertain and missing call does not invent a match',()=>{
 assert.match(analyzeToolError('opaque failure'),/无法/);
 const failure=toolFailures([{seq:9,type:'tool/result',data:{message:{toolCallId:'unknown',isError:true,content:[]}}}])[0];
 assert.equal(failure.callSeq,undefined);assert.equal(failure.name,'未知工具');
});
