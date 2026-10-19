import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const result = await build({ stdin: { contents: `export {bindReact} from './client-src/react-binding'; export {EvolutionTab} from './client-src/tab-evolution'; export {LineChart} from './client-src/charts';`, resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false });
const { bindReact, EvolutionTab, LineChart } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function harness() {
  let cursor = 0;
  const states = [];
  bindReact({ createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), useState: (initial) => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => states[i] = typeof value === 'function' ? value(states[i]) : value]; }, useRef: () => ({current: {getBoundingClientRect: () => ({left: 0, top: 0, width: 720, height: 260})}}), useEffect: () => {}, Fragment: 'fragment' });
  return fn => { cursor = 0; return fn(); };
}
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...(tree.children ?? []).flat(Infinity).flatMap(nodes)] : []; }
const step = (seq, turn) => ({seq, turn, step: seq, timeMs: seq * 100, inputTokens: 1000, outputTokens: 20, surfaceTokens: 900, cacheReadTokens: 100});
const message = (seq, kind, sourceKind) => ({ seq, timeMs: seq * 100, kind, sourceKind, tokens: 50 });
test('evolution retains intra-turn requests and excludes assistant output from injection markers', () => {
  const render = harness();
  const data = {contextWindow: 10000, steps: [step(10,1), step(20,1), step(30,2)], timeline: { injections: [message(12,'assistant','agent'),message(13,'tool-result','tool'),message(14,'user','user')], compactions: [] }};
  let tree = render(() => EvolutionTab({data}));
  let chart = nodes(tree).find(n => n.type === LineChart);
  assert.equal(chart.props.markers.length,1);
  assert.ok(chart.props.markers[0].x > 1 && chart.props.markers[0].x < 2);
  nodes(tree).find(n => n.children.includes('按轮次')).props.onClick();
  tree = render(() => EvolutionTab({data}));
  chart = nodes(tree).find(n => n.type === LineChart);
  assert.equal(chart.props.series[0].points.length,3);
  assert.ok(chart.props.series[0].points[1].x > chart.props.series[0].points[0].x);
  assert.equal(chart.props.key,'turn');
});
test('drag selects a range and exposes reset; markers remain visible with all series hidden', () => {
  const render = harness();
  const props = {series: [{key:'a', label:'a', color:'blue', points:[{x:1,y:10},{x:10,y:20}]}], markers:[{x:5,kind:'injection',title:'event'}]};
  let tree = render(() => LineChart(props));
  nodes(tree).find(n => n.type === 'svg').props.onMouseDown({clientX:150,clientY:80,button:0,shiftKey:false});
  tree = render(() => LineChart(props));
  nodes(tree).find(n => n.type === 'svg').props.onMouseMove({clientX:450,clientY:80,buttons:1});
  tree = render(() => LineChart(props));
  assert.ok(nodes(tree).some(n => n.props.key === 'selection'));
  nodes(tree).find(n => n.type === 'svg').props.onMouseUp();
  tree = render(() => LineChart(props));
  assert.ok(nodes(tree).some(n => n.children.includes('重置缩放')));
  nodes(tree).find(n => n.children.includes('重置缩放')).props.onClick();
  tree = render(() => LineChart({...props,hidden:new Set(['a'])}));
  assert.ok(nodes(tree).some(n => n.props['aria-label'] === 'event'));
});
test('summary and prune have independent marker filters and counts', () => {
  const render = harness();
  const event = kind => ({kind,seq:15,timeMs:1500,turn:1,beforeTokens:1000,afterTokens:500,reclaimedTokens:500,reclaimRatio:0.5});
  const data = {contextWindow:10000,steps:[step(10,1),step(20,1)],timeline:{injections:[],compactions:[event('summary'),event('prune')],compactionTotals:{count:2,reclaimedTokens:1000,elapsedMs:0}}};
  let tree = render(() => EvolutionTab({data}));
  assert.deepEqual(nodes(tree).find(n => n.type === LineChart).props.markers.map(m => m.kind), ['compaction','prune']);
  assert.ok(nodes(tree).some(n => n.children.some(c => typeof c === 'string' && c.includes('摘要压缩 1 次 · 历史修剪 1 次'))));
  nodes(tree).find(n => n.props.title === '显示/隐藏 历史修剪标记').props.onClick();
  tree = render(() => EvolutionTab({data}));
  assert.deepEqual(nodes(tree).find(n => n.type === LineChart).props.markers.map(m => m.kind), ['compaction']);
});

test('selecting an event pins one detail card and suppresses the request tooltip', () => {
  const render = harness();
  const props = {series:[{key:'a',label:'request',color:'blue',points:[{x:1,y:10},{x:2,y:20}]}],markers:[{x:1.5,kind:'spike',title:'single message +9000'}]};
  let tree = render(() => LineChart(props));
  nodes(tree).find(n => n.props['aria-label'] === 'single message +9000').props.onClick();
  tree = render(() => LineChart(props));
  nodes(tree).find(n => n.type === 'svg').props.onMouseMove({clientX:300,clientY:150,buttons:0});
  tree = render(() => LineChart(props));
  assert.ok(nodes(tree).some(n => n.props.key === 'event-detail'));
  assert.ok(!nodes(tree).some(n => n.props.key === 'tooltip'));
  nodes(tree).find(n => n.children.includes('取消选中')).props.onClick();
  tree = render(() => LineChart(props));
  assert.ok(!nodes(tree).some(n => n.props.key === 'event-detail'));
});
test('hover shows a nearby tooltip for both single events and clusters', () => {
  for (const count of [1, 5]) {
    const render = harness();
    const props = {series:[{key:'a',label:'request',color:'blue',points:[{x:1,y:10},{x:2,y:20}]}],markers:Array.from({length:count},(_,index)=>({x:1.5,kind:'prune',title:`prune ${index}`}))};
    let tree = render(() => LineChart(props));
    const target = nodes(tree).find(n => n.props.key?.startsWith(count === 1 ? 'hit-' : 'cluster-'));
    target.props.onMouseEnter();
    tree = render(() => LineChart(props));
    const tooltip = nodes(tree).find(n => n.props.role === 'tooltip');
    assert.ok(tooltip);
    assert.equal(tooltip.props.style.position,'absolute');
    assert.equal(tooltip.props.style.pointerEvents,'none');
    assert.ok(!nodes(tree).some(n => n.props.key === 'tooltip'));
    if (count > 1) assert.ok(nodes(tooltip).some(n => n.children.some(c => typeof c === 'string' && c.includes('5 条历史修剪'))));
    target.props.onMouseLeave();
    tree = render(() => LineChart(props));
    assert.ok(!nodes(tree).some(n => n.props.role === 'tooltip'));
  }
});

test('comparison scaling uses full extent or fitted data, with the same drag and double-click reset', () => {
  const render=harness();
  const props={eventLanes:false,scaleMax:1000,formatY:value=>String(value),series:[{key:'a',label:'a',color:'blue',points:[{x:1,y:10},{x:10,y:20}]}]};
  let tree=render(()=>LineChart(props));
  assert.ok(nodes(tree).some(n=>n.type==='text'&&n.children.includes('1000')));
  nodes(tree).find(n=>n.props.key==='scale').props.onClick();
  tree=render(()=>LineChart(props));assert.ok(!nodes(tree).some(n=>n.type==='text'&&n.children.includes('1000')));
  nodes(tree).find(n=>n.type==='svg').props.onMouseDown({clientX:150,clientY:140,button:0,shiftKey:false});
  tree=render(()=>LineChart(props));nodes(tree).find(n=>n.type==='svg').props.onMouseMove({clientX:450,clientY:140,buttons:1});
  tree=render(()=>LineChart(props));nodes(tree).find(n=>n.type==='svg').props.onMouseUp();
  tree=render(()=>LineChart(props));assert.ok(nodes(tree).some(n=>n.children.includes('重置缩放')));
  nodes(tree).find(n=>n.type==='svg').props.onDoubleClick();
  tree=render(()=>LineChart(props));assert.ok(!nodes(tree).some(n=>n.children.includes('重置缩放')));
});

test('context injection and tool feedback have separate counts and filters', () => {
  const render = harness();
  const messages = [message(12,'tool-result','tool'),message(13,'system','system-prompt'),message(14,'user','user'),message(15,'assistant','agent')];
  const data = {contextWindow:10000, steps:[step(10,1),step(20,1)], timeline:{injections:messages,compactions:[]}};
  let tree = render(() => EvolutionTab({data}));
  let chart = nodes(tree).find(n => n.type === LineChart);
  assert.deepEqual(chart.props.markers.map(m => m.kind).sort(), ['feedback','injection']);
  const text = n => (n.children ?? []).flat(Infinity).map(c => typeof c === 'string' ? c : c && typeof c === 'object' ? text(c) : '').join('');
  const feedbackButton = nodes(tree).find(n => n.type === 'button' && text(n).includes('共 1 次'));
  assert.ok(feedbackButton);
  assert.ok(nodes(tree).some(n => n.type === 'button' && text(n).includes('上下文注入 1')));
  feedbackButton.props.onClick();
  tree = render(() => EvolutionTab({data}));
  chart = nodes(tree).find(n => n.type === LineChart);
  assert.deepEqual(chart.props.markers.map(m => m.kind), ['injection']);
});

test('full history supplies old spikes, injections and pruning independently of the short projection',()=>{
 const render=harness();
 const messages=[message(1,'user','user'),message(2,'assistant','agent'),message(3,'user','user'),{...message(4,'assistant','agent'),tokens:5000},message(5,'developer','developer')];
 const prune={seq:6,timeMs:600,id:'prune-6',kind:'prune',beforeTokens:null,afterTokens:null,reclaimedTokens:null,reclaimRatio:null,elapsedMs:null,turn:1};
 const data={contextWindow:10000,steps:[step(10,1),step(20,1)],timeline:{injections:[],compactions:[]}};
 const tree=render(()=>EvolutionTab({data,injectionHistory:{phase:'ready',messages,compactions:[prune]}}));
 const markers=nodes(tree).find(n=>n.type===LineChart).props.markers;
 assert.deepEqual(markers.map(m=>m.kind).sort(),['injection','prune','spike']);
});
test('feedback is grouped by requests, failures stay red, and spikes link to exact tool calls',()=>{
 const render=harness();let evidence;
 const messages=[message(11,'tool-result','tool'),message(12,'tool-result','tool'),message(13,'tool-result','tool'),{...message(14,'tool-result','tool'),tokens:5000,callId:'c',toolName:'shell'}];
 const data={contextWindow:10000,steps:[step(10,1),step(20,1)],timeline:{injections:[],compactions:[]}};
 const history={phase:'ready',messages,toolCalls:[{seq:9,callId:'c',name:'shell'}],toolFailures:[{name:'shell',callId:'f',callSeq:8,resultSeq:13,excerpt:'failed',analysis:'unknown'}]};
 const tree=render(()=>EvolutionTab({data,injectionHistory:history,onEvidence:chain=>evidence=chain}));
 const markers=nodes(tree).find(n=>n.type===LineChart).props.markers;
 const feedback=markers.filter(m=>m.kind==='feedback');assert.equal(feedback.length,2);assert.equal(feedback.filter(m=>m.failed).length,1);assert.match(feedback.find(m=>!m.failed).title,/回填 3 次/);
 markers.find(m=>m.kind==='spike').onEvidence();assert.ok(evidence.refs.some(r=>r.seq===9));assert.ok(evidence.facts.some(f=>f.label==='工具结果与激增的关联'));
 feedback.find(m=>m.failed).onEvidence();assert.ok(evidence.refs.every(r=>r.failed));
});

test('default feedback highlights ten intervals while all mode preserves full history',()=>{
 const render=harness();const requests=Array.from({length:21},(_,i)=>step(i*10+10,1));
 const messages=Array.from({length:20},(_,i)=>({...message(i*10+11,'tool-result','tool'),tokens:(i+1)*10}));
 const props={data:{contextWindow:10000,steps:requests,timeline:{injections:messages,compactions:[]}}};
 let tree=render(()=>EvolutionTab(props));let chart=nodes(tree).find(n=>n.type===LineChart);
 assert.equal(chart.props.markers.filter(m=>m.kind==='feedback').length,10);
 nodes(tree).find(n=>n.props['aria-label']==='回填显示范围').props.onChange({target:{value:'all'}});
 tree=render(()=>EvolutionTab(props));chart=nodes(tree).find(n=>n.type===LineChart);assert.equal(chart.props.markers.filter(m=>m.kind==='feedback').length,20);
});
test('full-history curve uses every request instead of the last 256 projection samples',()=>{
 const render=harness();const requests=Array.from({length:553},(_,i)=>step(i+1,1));
 const data={contextWindow:10000,steps:requests.slice(-256),timeline:{injections:[],compactions:[]}};
 const tree=render(()=>EvolutionTab({data,injectionHistory:{phase:'ready',messages:[],requests}}));
 const chart=nodes(tree).find(n=>n.type===LineChart);
 assert.equal(chart.props.series[0].points.length,553);assert.equal(chart.props.series[0].points[0].x,1);assert.equal(chart.props.series[0].points.at(-1).x,553);
});
