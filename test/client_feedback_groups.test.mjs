import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
const out=await build({stdin:{contents:"export {groupFeedback,feedbackSummary} from './client-src/feedbackGroups';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const {groupFeedback,feedbackSummary}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
test('groups request intervals, excludes failures, retains leading and trailing results',()=>{
 const rows=[1,11,12,13,21,31].map(seq=>({seq,tokens:seq*10,toolName:seq===12?'read':'shell'}));
 const groups=groupFeedback(rows,[{seq:10},{seq:20},{seq:30}],new Set([13]));
 assert.deepEqual(groups.map(g=>g.map(r=>r.seq)),[[1],[11,12],[21],[31]]);
 assert.match(feedbackSummary(groups[1]),/回填 2 次/);assert.match(feedbackSummary(groups[1]),/最大结果 #12/);assert.match(feedbackSummary(groups[1]),/read 120 Token/);
});
