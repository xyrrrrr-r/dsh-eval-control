import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { contextTimelineProjection as projection, type ContextTimelineState } from '../src/analytics/contextTimeline.js';
const event = (value: Record<string, unknown>) => value as unknown as SessionEvent;
const user = (seq: number, text: string, surfaceOp: unknown = 'append') => event({seq,time:seq * 100,type:'user/message',surfaceOp,data:{role:'user',source:{kind:'user'},content:[{type:'text',text}]}});

test('historical snapshots preserve affected and retained nodes and capture the landing replacement', () => {
  let state: ContextTimelineState = projection.init();
  for (const item of [user(1,'old content '.repeat(400)),user(2,'retained'),event({seq:3,time:300,type:'compaction/start',data:{compactionId:'c1',turn:null}}),event({seq:4,time:400,type:'compaction/summary',data:{compactionId:'c1',summary:[{type:'text',text:'summary'}],provider:'test',model:'model',shadowedRange:{start:1,end:1},shadowedSeqs:[1],shadowedTokenCount:500}}),user(5,'summary '.repeat(200),{op:'replace',startSeq:1,endSeq:1}),event({seq:6,time:600,type:'compaction/end',data:{compactionId:'c1',turn:null}})]) state = projection.apply(state,item);
  const row = state.compactions[0]!;
  assert.equal(row.detail?.trigger,'manual');
  assert.equal(row.detail?.before.nodes.find(node=>node.seq===1)?.changed,true);
  assert.equal(row.detail?.before.nodes.find(node=>node.seq===2)?.changed,false);
  assert.deepEqual(row.detail?.after?.nodes.map(node=>node.seq),[2,5]);
  assert.equal(row.detail?.after?.nodes.find(node=>node.seq===5)?.changed,true);
  assert.ok(row.detail!.after!.nodes.find(node=>node.seq===5)!.preview.length > 200);
  assert.equal(row.elapsedMs,300);
  assert.ok(row.reclaimedTokens! > 0);
  const frozen = JSON.stringify(row.detail);
  state = projection.apply(state,user(7,'future'));
  assert.equal(JSON.stringify(state.compactions[0]!.detail),frozen);
  assert.ok(projection.stateSchema.safeParse(state).success);
  assert.ok(projection.wire.viewSchema.safeParse(projection.wire.view(state)).success);
});
test('pruning uses its own algorithm and unmatched replacement does not invent an after snapshot', () => {
  let state: ContextTimelineState = projection.init();
  state = projection.apply(state,user(1,'old'));
  state = projection.apply(state,event({seq:2,time:200,type:'compaction/prune',data:{shadowedRange:{start:1,end:1},shadowedSeqs:[1],shadowedTokenCount:10}}));
  state = projection.apply(state,user(3,'mismatch',{op:'replace',startSeq:4,endSeq:4}));
  assert.equal(state.compactions[0]!.detail?.after,null);
  assert.match(state.compactions[0]!.detail!.algorithm,/无模型调用/);
  assert.equal(state.compactions[0]!.detail?.trigger,'unknown');
});
test('snapshot payload stays bounded for long histories', () => {
  let state: ContextTimelineState = projection.init();
  for(let seq=1;seq<=100;seq++) state = projection.apply(state,user(seq,'message '.repeat(100)));
  state = projection.apply(state,event({seq:101,time:10100,type:'compaction/prune',data:{shadowedRange:{start:1,end:80},shadowedSeqs:[],shadowedTokenCount:1000}}));
  const before = state.compactions[0]!.detail!.before;
  assert.equal(before.nodeCount,100);
  assert.equal(before.nodes.length,32);
  assert.equal(before.truncated,true);
});


test('evidence locators retain real header, window and compaction lifecycle sequence numbers', () => {
  let state: ContextTimelineState = projection.init();
  state = projection.apply(state, event({seq:10,time:1000,type:'request/header',data:{header:{tools:[{name:'read',description:'Read a file',inputSchema:{type:'object'}}]}}}));
  state = projection.apply(state, event({seq:11,time:1100,type:'request/context',data:{contextWindow:65536,provider:'demo',model:'demo'}}));
  const view = projection.wire.view(state);
  assert.equal(view.segments.find(segment=>segment.segment==='toolDefinitions')?.nodes[0]?.seq,10);
  assert.equal(view.contextWindowSeq,11);
  for (const item of [user(12,'old content '.repeat(100)),event({seq:13,time:1300,type:'compaction/start',data:{compactionId:'c',turn:null}}),event({seq:14,time:1400,type:'compaction/summary',data:{compactionId:'c',summary:[{type:'text',text:'summary'}],provider:'demo',model:'demo',shadowedRange:{start:12,end:12},shadowedSeqs:[12],shadowedTokenCount:200}}),user(15,'summary',{op:'replace',startSeq:12,endSeq:12}),event({seq:16,time:1600,type:'compaction/end',data:{compactionId:'c',turn:null}})]) state=projection.apply(state,item);
  assert.deepEqual(state.compactions[0]!.evidenceRefs?.map(ref=>ref.seq),[13,14,15,16]);
  assert.equal(state.compactions[0]!.elapsedMs,300);
  assert.ok(projection.stateSchema.safeParse(state).success);
  assert.ok(projection.wire.viewSchema.safeParse(projection.wire.view(state)).success);
  // Repeated tool schemas still point to the latest real header event.
  state = projection.apply(state,event({seq:17,time:1700,type:'request/header',data:{header:{tools:[{name:'read',description:'Read a file',inputSchema:{type:'object'}}]}}}));
  assert.equal(projection.wire.view(state).segments.find(segment=>segment.segment==='toolDefinitions')?.nodes[0]?.seq,17);
});

test('session sample counts follow actual history beyond previous fixed caps', () => {
  let state: ContextTimelineState = projection.init();
  for(let i=0;i<600;i++) {
    state=projection.apply(state,event({seq:i+1,time:i*100,type:'assistant/message',surfaceOp:'append',data:{turn:1,step:i+1,usage:{inputTokens:10,outputTokens:1},message:{role:'assistant',source:{kind:'agent'},content:[{type:'text',text:'sample'}]}}}));
  }
  for(let i=0;i<40;i++)state=projection.apply(state,event({seq:601+i,time:60000+i,type:'compaction/prune',data:{shadowedRange:{start:1,end:1}}}));
  assert.equal(state.steps.length,600);
  assert.equal(state.injections.length,600);
  assert.equal(state.compactions.length,40);
  assert.equal(state.steps[0]!.seq,1);
  assert.equal(state.injections[0]!.seq,1);
  assert.equal(state.compactions[0]!.seq,601);
  assert.equal(projection.stateVersion,7);
});
