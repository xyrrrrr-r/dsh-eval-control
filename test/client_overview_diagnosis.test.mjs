import assert from 'node:assert/strict';import {test} from 'node:test';import {build} from 'esbuild';
const out=await build({stdin:{contents:"export {overviewDiagnosticChain,overviewHistoryEvidence} from './client-src/overviewDiagnosis';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const {overviewDiagnosticChain,overviewHistoryEvidence}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
test('overview scope carries all dimensions even with no tool failures',()=>{
 const data={analytics:{metricResults:[{metricId:'model.long_gap_segments',status:'available',value:{count:1},evidenceRefs:[{sessionId:'s',seq:4}],sampleCount:1,qualityRefs:[]}],recentEvents:[{seq:6}],teamInput:{memberIds:['child'],lastEventRef:{sessionId:'s',seq:6}}},stats:{llmMs:1000,toolMs:200},utilization:0.9,contextWindow:100};
 const chain=overviewDiagnosticChain('s',data,[]);assert.equal(chain.diagnosisScope,'overview');assert.equal(chain.overviewSnapshot.analytics.memberCount,1);assert.equal(chain.overviewSnapshot.stats.llmMs,1000);
 const events=[{seq:1,time:1,type:'user/message',surfaceOp:'append',data:{}},{seq:2,time:2,type:'request/context',data:{contextWindow:100}},{seq:3,time:3,type:'assistant/message',surfaceOp:'append',data:{usage:{inputTokens:80,cacheReadTokens:10,outputTokens:5}}},{seq:4,time:4,type:'compaction/summary',data:{}},{seq:5,time:5,type:'team/member',data:{}},{seq:6,time:6,type:'assistant/message',surfaceOp:'append',data:{}}];
 const result=overviewHistoryEvidence(events,'s',[],chain.overviewSnapshot);
 assert.equal(result.summary.peakKnownWindowRatio,0.9);assert.equal(result.summary.explicitFailures,0);assert.equal(result.summary.teamEventCount,1);
 for(const seq of [1,3,4,5,6])assert.ok(result.refs.some(ref=>ref.seq===seq));
 assert.match(result.summary.progressVerification,/未独立验收/);
});
test('missing metric values stay unavailable rather than crashing the overview',()=>{
 const chain=overviewDiagnosticChain('s',{analytics:{metricResults:[{metricId:'model.latency',status:'unavailable',evidenceRefs:[],qualityRefs:[]}],recentEvents:[]},stats:null},[]);
 assert.equal(chain.overviewSnapshot.metrics[0].value,'未提供');
});
