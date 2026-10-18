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
