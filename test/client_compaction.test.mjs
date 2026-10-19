import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const result = await build({stdin:{contents:`export { bindReact } from './client-src/react-binding'; export { CompactionTab, CompactionDetails, groupCompactions, groupInjections } from './client-src/tab-compaction';`,resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const {bindReact,CompactionTab,CompactionDetails,groupCompactions,groupInjections} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function harness(){let cursor=0;const states=[]; bindReact({createElement:(type,props,...children)=>({type,props:props??{},children}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:initial=>{const i=cursor++;if(!(i in states))states[i]={current:initial};return states[i];},useEffect:()=>{},Fragment:'fragment'});return fn=>{cursor=0;return fn();};}
const nodes = tree => tree && typeof tree==='object' ? [tree,...(tree.children??[]).flat(Infinity).flatMap(nodes)] : [];
const text = tree => nodes(tree).flatMap(n=>n.children).flat(Infinity).filter(c=>typeof c==='string').join(' ');
const snap = {nodeCount:1,truncated:false,nodes:[{seq:1,label:'user',tokens:10,preview:'old',changed:true}]};
const event = {id:'c1',seq:2,timeMs:1000,kind:'summary',turn:1,beforeTokens:10,afterTokens:5,reclaimedTokens:5,reclaimRatio:0.5,elapsedMs:10,detail:{trigger:'unknown',algorithm:'LLM summary',summary:'new summary',before:snap,after:{...snap,nodes:[{...snap.nodes[0],seq:3,preview:'new'}]}}};
test('comparison provides highlighted snapshots and bidirectional proportional scrolling',()=>{
 const render=harness();let tree=render(()=>CompactionDetails({event,sessionId:'a/b'}));
 assert.match(text(tree),/整批替换/);
 assert.match(text(tree),/替换组 #2/);
 assert.match(text(tree),/1 条摘要消息 #3/);
 assert.equal(nodes(tree).find(n=>n.props.key==='snapshots').props.style.gridTemplateColumns,'repeat(2, minmax(0, 1fr))');
 const panes=nodes(tree).filter(n=>n.props.key==='scroll');
 panes[0].props.ref.current={scrollHeight:1000,clientHeight:100,scrollTop:450};
 panes[1].props.ref.current={scrollHeight:500,clientHeight:100,scrollTop:0};
 panes[0].props.onScroll();assert.equal(panes[1].props.ref.current.scrollTop,200);
 panes[1].props.ref.current.scrollTop=100;panes[1].props.onScroll();assert.equal(panes[0].props.ref.current.scrollTop,225);
 nodes(nodes(tree).find(n=>n.type==='label' && text(n).includes('按进度同步滚动'))).find(n=>n.type==='input').props.onChange();tree=render(()=>CompactionDetails({event,sessionId:'a/b'}));
 nodes(tree).filter(n=>n.props.key==='scroll')[0].props.ref.current.scrollTop=800;
 nodes(tree).filter(n=>n.props.key==='scroll')[0].props.onScroll();assert.equal(panes[1].props.ref.current.scrollTop,100);
 assert.match(text(tree),/− 被替换/);assert.match(text(tree),/＋ 替代内容/);
 assert.ok(nodes(tree).some(n=>n.props.href==='/api/session.export?sessionId=a%2Fb&includeDescendants=false'));
});
test('missing history degrades explicitly and injection cards show preview and delta',()=>{
 const render=harness();let tree=render(()=>CompactionDetails({event:{...event,detail:undefined}}));assert.match(text(tree),/详情不可用/);
 const message={seq:5,timeMs:1000,kind:'tool-result',sourceKind:'tool',toolName:'shell',turn:1,tokens:30,cumulativeTokens:100,textTokens:30,toolCallTokens:0,fileTokens:0,preview:'tool output'};
 const renderTab=harness();tree=renderTab(()=>CompactionTab({data:{timeline:{compactions:[],compactionTotals:{reclaimedTokens:0,elapsedMs:0}},messages:[message]},sessionId:'s1'}));
 nodes(tree).find(n=>n.type==='button' && text(n).includes('工具结果回填 1')).props.onClick();
 tree=renderTab(()=>CompactionTab({data:{timeline:{compactions:[]},messages:[message]},sessionId:'s1'}));
 assert.match(text(tree),/加入前 70 → 加入后 100 Token/);assert.match(text(tree),/tool output/);
 assert.ok(nodes(tree).some(n=>n.type==='details' && n.props.key==='injection-5'));
});
test('replacement comparison hides retained messages until explicitly requested',()=>{
 const render=harness();
 const retained={seq:9,label:'keep',tokens:10,preview:'unchanged retained context',changed:false};
 const rich={...event,detail:{...event.detail,before:{...snap,nodeCount:11,nodes:[...snap.nodes,retained]},after:{...event.detail.after,nodeCount:2,nodes:[...event.detail.after.nodes,retained]}}};
 let tree=render(()=>CompactionDetails({event:rich}));
 assert.doesNotMatch(text(tree),/unchanged retained context/);
 assert.match(text(tree),/10 条历史消息/);
 assert.match(text(tree),/1 条摘要消息 #3/);
 const toggle=nodes(tree).find(n=>n.type==='label' && text(n).includes('显示保留上下文'));
 nodes(toggle).find(n=>n.type==='input').props.onChange();
 tree=render(()=>CompactionDetails({event:rich}));
 assert.match(text(tree),/unchanged retained context/);
});

test('details describe the replacement mechanism and distinguish unobserved prune rules',()=>{
 const render=harness();const tree=render(()=>CompactionDetails({event}));
 assert.match(text(tree),/检查点消息/);assert.match(text(tree),/原始事件仍保留在会话日志/);assert.match(text(tree),/compaction\/summary #2/);
 const renderPrune=harness();let prune=renderPrune(()=>CompactionDetails({event:{...event,kind:'prune'}}));
 assert.match(text(prune),/具体裁剪规则未记录/);assert.doesNotMatch(text(prune),/保留工具输出的头尾/);
 const marked={...event,kind:'prune',detail:{...event.detail,after:{...event.detail.after,nodes:[{...snap.nodes[0],preview:'head [... tool result middle pruned ...] tail'}]}}};
 prune=renderPrune(()=>CompactionDetails({event:marked}));assert.match(text(prune),/保留工具输出的头尾/);
});

test('prune grouping keeps original details and splits unrelated events',()=>{
 const prune=(seq,timeMs,beforeTokens,afterTokens)=>({...event,id:`p${seq}`,kind:'prune',seq,timeMs,beforeTokens,afterTokens});
 const a=prune(10,1000,100,90),b=prune(12,1100,90,80),c=prune(14,1200,80,70);
 assert.deepEqual(groupCompactions([c,a,b]),[[a,b,c]]);
 assert.deepEqual(groupCompactions([a,{...event,seq:11},b]).map(g=>g.length),[1,1,1]);
 assert.equal(groupCompactions([a,{...b,seq:13}]).length,2);
 assert.equal(groupCompactions([a,{...b,timeMs:4000}]).length,2);
 assert.equal(groupCompactions([a,{...b,beforeTokens:95}]).length,2);
 const render=harness();const tree=render(()=>CompactionTab({data:{timeline:{compactions:[a,b,c]},messages:[]}}));
 assert.match(text(tree),/3 次已聚合/);assert.match(text(tree),/100 → 70 Token/);assert.match(text(tree),/合计回收 30/);
 assert.equal(nodes(tree).filter(n=>n.type===CompactionDetails).length,3);
});

test('injections group by displayed second, retain source details, and sum only injected tokens',()=>{
 const base={kind:'tool-result',sourceKind:'tool',toolName:'edit',turn:1,tokens:10,cumulativeTokens:100,textTokens:10,toolCallTokens:0,fileTokens:0,preview:'result'};
 const a={...base,seq:1,timeMs:1001},b={...base,seq:2,timeMs:1999,tokens:20},c={...base,seq:3,timeMs:2000};
 assert.deepEqual(groupInjections([c,b,a]),[[a,b],[c]]);
 const render=harness();let tree=render(()=>CompactionTab({data:{timeline:{compactions:[]},messages:[a,b,c]}}));
 nodes(tree).find(n=>n.type==='button' && text(n).includes('工具结果回填 3')).props.onClick();
 tree=render(()=>CompactionTab({data:{timeline:{compactions:[]},messages:[a,b,c]}}));
 assert.match(text(tree),/工具结果回填 · 2 条已聚合/);assert.match(text(tree),/合计 \+30 Token/);assert.match(text(tree),/工具结果 \/ edit ×2/);
 assert.equal(nodes(tree).filter(n=>n.type==='details' && /^injection-\d/.test(n.props.key)).length,3);
});
