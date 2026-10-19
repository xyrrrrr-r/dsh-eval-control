import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const result=await build({stdin:{contents:`export * from './client-src/alerts'; export {ConfigurationAction} from './client-src/configuration'; export {bindReact} from './client-src/react-binding'; export {createDashboardView} from './client-src/dashboard'; export {AlertsDrawer,ThresholdSettings} from './client-src/alertsPanel'; export {DetailPanel} from './client-src/detailPanel'; export {EvidencePanel} from './client-src/evidencePanel';`,resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const m=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function harness(){let cursor=0;const states=[];m.bindReact({createElement:(type,props,...children)=>({type,props:props??{},children}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:initial=>{const i=cursor++;return states[i]??(states[i]={current:initial});},useEffect:()=>{},useMemo:fn=>fn(),Fragment:'fragment'});return fn=>{cursor=0;return fn();};}
const nodes=tree=>tree&&typeof tree==='object'?[tree,...(tree.children??[]).flat(Infinity).flatMap(nodes)]:[];
const text=tree=>nodes(tree).flatMap(n=>n.children).flat(Infinity).filter(c=>typeof c==='string').join(' ');
const input={utilization:.9,compactionFrequency:6,toolErrorRate:.2,repeatGroups:4,longGapCount:1};
test('alert thresholds and PRD boundary semantics, including per-rule switches',()=>{
 assert.equal(m.evaluateAlerts(input,m.DEFAULT_THRESHOLDS).length,5);
 assert.equal(m.evaluateAlerts({...input,repeatGroups:3,longGapCount:0},m.DEFAULT_THRESHOLDS).length,3);
 assert.ok(!m.evaluateAlerts(input,{...m.DEFAULT_THRESHOLDS,disabledRules:['context-overload']}).some(a=>a.id==='context-overload'));
 const actual=m.alertInputOf({utilization:0,analytics:{metricResults:[{metricId:'tool.repeat_loop',value:{loopCount:1,maxRunLength:5}}]}});assert.equal(actual.repeatGroups,5);
});
test('dismissed states stay scoped to their session',()=>{
 const stored=new Map();globalThis.localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)};
 m.saveAlertState({dismissed:['long-gaps'],resolved:[],firstSeen:{'long-gaps':100}},'a');
 assert.deepEqual(m.loadAlertState('a').dismissed,['long-gaps']);assert.deepEqual(m.loadAlertState('b').dismissed,[]);
 delete globalThis.localStorage;
});
test('right alert panel filters by state and severity and provides configuration actions',()=>{
 const render=harness();const alerts=m.evaluateAlerts(input,m.DEFAULT_THRESHOLDS);
 let tree=render(()=>m.AlertsDrawer({open:true,alerts,dismissed:['context-overload'],resolved:[],onView:()=>{},onSettings:()=>{},onClose:()=>{},onDismiss:()=>{},onResolve:()=>{}}));
 assert.equal(tree.props.role,'dialog');assert.doesNotMatch(text(tree),/🔴 上下文满载/);assert.ok(nodes(tree).some(n=>n.type===m.ConfigurationAction));
 const selects=nodes(tree).filter(n=>n.type==='select');selects[1].props.onChange({target:{value:'critical'}});
 tree=render(()=>m.AlertsDrawer({open:true,alerts,dismissed:['context-overload'],resolved:[],onView:()=>{},onSettings:()=>{},onClose:()=>{},onDismiss:()=>{},onResolve:()=>{}}));
 assert.match(text(tree),/高错误率/);assert.doesNotMatch(text(tree),/长间隔 ·/);
});
test('diagnostic search, sort and section filters affect batch export content',()=>{
 const render=harness();const data={analytics:{recentEvents:[{seq:1,type:'tool/call',label:'bash'},{seq:2,type:'turn/end'}],metricResults:[{metricId:'tool.failure_rate',value:.1}]}};
 const props={data,open:true,onToggle:()=>{},inspectCall:undefined};let tree=render(()=>m.DetailPanel(props));
 nodes(tree).find(n=>n.props['aria-label']==='搜索诊断数据').props.onChange({target:{value:'bash'}});
 tree=render(()=>m.DetailPanel(props));assert.match(text(tree),/1 条事件 · 0 项指标/);assert.doesNotMatch(text(tree),/消息列表/);
 assert.ok(nodes(tree).some(n=>n.children.includes('导出筛选结果')));
});
test('dashboard shows four clickable metrics, sticky status and collapsed diagnostics',()=>{
 const render=harness();const view=m.createDashboardView({});
 const analytics={eventsSeen:0,inputTokens:0,toolCalls:0,toolErrors:0,metricResults:[],recentEvents:[],turnTrend:[],teamInput:{memberIds:[],firstEventTimeMs:null,factTimeMax:null}};
 const props={sessionId:'s1',useProjection:key=>key==='trajectoryAnalytics'?analytics:null};
 let tree=render(()=>view(props));
 const grid=nodes(tree).find(n=>n.props.key==='cards');assert.equal(grid.children.flat(Infinity).filter(Boolean).length,4);
 assert.equal(nodes(tree).find(n=>n.props.key==='status').props.style.position,'sticky');
 assert.equal(nodes(tree).find(n=>n.type===m.DetailPanel).props.open,false);
 assert.equal(nodes(tree).filter(n=>n.type===m.AlertsDrawer).length,1);
 assert.equal(nodes(tree).find(n=>n.type===m.AlertsDrawer).props.inline,true);
 assert.ok(!nodes(tree).some(n=>n.props['aria-label']?.startsWith('智能告警：')));
 nodes(tree).find(n=>n.props.key==='tools').props.onClick();
 tree=render(()=>view(props));assert.ok(nodes(tree).some(n=>n.type===m.EvidencePanel));
 nodes(tree).find(n=>n.type===m.EvidencePanel).props.onClose();
 nodes(tree).find(n=>n.props.role==='tab'&&text(n).includes('工具分布')).props.onClick();
 tree=render(()=>view(props));assert.ok(!nodes(tree).some(n=>n.type===m.DetailPanel||n.type===m.AlertsDrawer));assert.equal(nodes(tree).find(n=>n.props.role==='tab'&&text(n).includes('工具分布')).props['aria-selected'],true);
});

test('configuration review never writes; direct action writes and verifies result',async()=>{
 const render=harness();const calls=[];const remote={describe:async()=>({path:'/profile/cordis.yml',entries:[{id:'compact',config:{thresholdRatio:.8}}]}),apply:async(...args)=>{calls.push(args);return{applied:true,path:'/profile/cordis.yml',thresholdRatio:args[2]};}};
 let tree=render(()=>m.ConfigurationAction({rule:'context-overload',remote}));
 nodes(tree).find(n=>n.children.includes('查看并调整配置')).props.onClick();
 await new Promise(r=>setImmediate(r));tree=render(()=>m.ConfigurationAction({rule:'context-overload',remote}));
 assert.equal(calls.length,0);assert.match(text(tree),/cordis.yml/);
 nodes(tree).find(n=>n.children.includes('直接应用推荐配置')).props.onClick();
 await new Promise(r=>setImmediate(r));tree=render(()=>m.ConfigurationAction({rule:'context-overload',remote}));
 assert.deepEqual(calls,[['compact',JSON.stringify({thresholdRatio:.8}),.7]]);assert.match(text(tree),/已保存并应用/);
});
test('configuration failures stay visible and multi-target direct action does not write',async()=>{
 const render=harness();let writes=0;const remote={describe:async()=>({path:'/config.yml',entries:[{id:'a',config:{}},{id:'b',config:{}}]}),apply:async()=>{writes++;throw Error('conflict');}};
 let tree=render(()=>m.ConfigurationAction({rule:'context-overload',remote}));nodes(tree).find(n=>n.children.includes('直接应用推荐配置')).props.onClick();
 await new Promise(r=>setImmediate(r));tree=render(()=>m.ConfigurationAction({rule:'context-overload',remote}));assert.equal(writes,0);assert.match(text(tree),/请选择/);
 nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:'a'}});tree=render(()=>m.ConfigurationAction({rule:'context-overload',remote}));nodes(tree).find(n=>n.children.includes('应用当前配置')).props.onClick();
 await new Promise(r=>setImmediate(r));tree=render(()=>m.ConfigurationAction({rule:'context-overload',remote}));assert.match(text(tree),/未应用：conflict/);
});
