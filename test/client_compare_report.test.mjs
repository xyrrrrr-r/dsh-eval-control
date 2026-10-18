import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
const bundled=await build({stdin:{contents:`export * from './client-src/tab-compare'; export {LineChart} from './client-src/charts'; export * from './client-src/exporters'; export {bindReact} from './client-src/react-binding'; export {ReportActions} from './client-src/reportActions';`,resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const m=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const session=(id,input,output,errors=0)=>({id,title:id,analytics:{inputTokens:input,toolCalls:10,toolErrors:errors,turnsEnded:2,stepsEnded:5,metricResults:[{metricId:'context.compaction_frequency_per_1k_input_tokens',status:'available',value:2}]},stats:{decodeTokens:output,llmMs:1000},timeline:null});
const input={sessionId:'s1',analytics:session('s1',100,20).analytics,timeline:null,stats:{decodeTokens:20,llmMs:1000,toolMs:100,turns:2,steps:5},alerts:[],element:null};
test('comparison identifies minimum cost, ties and unavailable values honestly',()=>{
 const sessions=[session('a',100,20),session('b',200,20,1),{id:'missing',title:'missing',analytics:null,stats:null,timeline:null}];
 const facts=m.compareFacts(sessions);assert.equal(facts[0].winners[0].id,'a');assert.equal(facts[0].values.length,2);assert.equal(facts[1].winners.length,2);
 assert.match(m.comparisonSummary(sessions)[0],/最低：a/);assert.match(m.comparisonSummary(sessions)[0],/2\/3/);
 assert.ok(!m.comparisonSummary(sessions).join('').includes('最低：missing'));
});
test('report templates select sections and HTML escapes user text and has no execution surface',()=>{
 const html=m.buildHtml({...input,title:'<script>alert(1)</script>',template:'brief'});
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script\b/);assert.doesNotMatch(html,/<h2>智能告警/);
 const custom=m.buildMarkdown({...input,template:'custom',sections:['alerts']});assert.match(custom,/## 智能告警/);assert.doesNotMatch(custom,/## 关键指标/);
 const team=m.buildMarkdown({...input,template:'team',comparison:[session('a',100,20),session('b',200,20)]});assert.match(team,/Token 总消耗最低：a/);assert.match(team,/最佳实践/);
});
test('PDF writer emits byte-addressable objects and all JPEG pages',async()=>{
 const blob=m.pdfFromJpegs([new Uint8Array([255,216,255,217]),new Uint8Array([255,216,255,217])],100,100);
 assert.equal(blob.type,'application/pdf');const bytes=new Uint8Array(await blob.arrayBuffer());const text=new TextDecoder().decode(bytes);
 assert.match(text,/\/Count 2/);const start=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(new TextDecoder().decode(bytes.slice(start,start+4)),'xref');
});
function harness(){let cursor=0;const states=[];m.bindReact({createElement:(type,props,...children)=>({type,props:props??{},children}),useState:initial=>{const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useRef:initial=>{const index=cursor++;return states[index]??(states[index]={current:initial});},useEffect:()=>{},useMemo:fn=>fn(),Fragment:'fragment'});return fn=>{cursor=0;return fn();};}
const nodes=tree=>tree&&typeof tree==='object'?[tree,...(tree.children??[]).flat(Infinity).flatMap(nodes)]:[];
test('comparison loads only after Start, keeps current selectable and caps at four',async()=>{
 const render=harness();let reads=0;let result=null;const current=session('a',100,20);
 const props={current,sessionId:'a',useSessions:()=>({ids:['a','b','c','d','e'],byId:Object.fromEntries(['a','b','c','d','e'].map(id=>[id,{displayTitle:id}]))}),sessions:{using:async(_id,_options,fn)=>{reads++;return fn({ready:Promise.resolve(),binding:{session:{projections:{faceOf:key=>({getSnapshot:()=>key==='trajectoryAnalytics'?session('b',200,10).analytics:key==='sessionStats'?session('b',200,10).stats:null})}}}});}},onResult:value=>result=value};
 let tree=render(()=>m.CompareTab(props));assert.equal(reads,0);
 nodes(tree).filter(n=>n.type==='input'&&n.props.type==='checkbox')[1].props.onChange();
 tree=render(()=>m.CompareTab(props));assert.equal(reads,0);await nodes(tree).find(n=>n.children.includes('开始对比')).props.onClick();await new Promise(r=>setImmediate(r));
 assert.equal(reads,1);assert.equal(result.length,2);assert.equal(result[0].id,'a');
 tree=render(()=>m.CompareTab(props));let chart=nodes(tree).find(n=>n.type===m.LineChart);chart.props.onToggle('b');tree=render(()=>m.CompareTab(props));chart=nodes(tree).find(n=>n.type===m.LineChart);assert.equal(chart.props.series.length,2);assert.equal(chart.props.hidden.has('b'),true);
 tree=render(()=>m.CompareTab(props));nodes(tree).filter(n=>n.type==='input'&&n.props.type==='checkbox')[2].props.onChange();tree=render(()=>m.CompareTab(props));nodes(tree).filter(n=>n.type==='input'&&n.props.type==='checkbox')[3].props.onChange();tree=render(()=>m.CompareTab(props));assert.equal(nodes(tree).filter(n=>n.type==='input'&&n.props.type==='checkbox')[4].props.disabled,true);
});

test('custom report template restores title and selected sections from browser storage',()=>{
 const storage=new Map([['dsh-eval-report-template',JSON.stringify({template:'custom',title:'每周诊断',sections:['summary']})]]);globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
 try{const render=harness();const props={input,chartElement:()=>null};let tree=render(()=>m.ReportActions(props));nodes(tree).find(n=>n.children.includes('导出')).props.onClick();tree=render(()=>m.ReportActions(props));assert.equal(nodes(tree).find(n=>n.props['aria-label']==='报告模板').props.value,'custom');assert.equal(nodes(tree).find(n=>n.props['aria-label']==='报告标题').props.value,'每周诊断');assert.equal(nodes(tree).filter(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked).length,1);}finally{delete globalThis.localStorage;}
});

test('radar preserves magnitude ratios and true zeros rather than forcing endpoints',()=>{
 assert.equal(m.radarRatio(90,100),.9);assert.equal(m.radarRatio(32,100),.32);assert.equal(m.radarRatio(0,100),0);assert.equal(m.radarRatio(0,0),0);assert.equal(m.radarRatio(100,100),1);
 const render=harness();const tree=render(()=>m.RadarChart({sessions:[session('a',90,0),session('b',100,0,1)]}));
 const circles=nodes(tree).filter(n=>n.type==='circle');assert.equal(circles.length,8);assert.equal(circles[0].props.cy,175-105*.9);
 circles[0].props.onMouseEnter();const hovered=render(()=>m.RadarChart({sessions:[session('a',90,0),session('b',100,0,1)]}));assert.ok(nodes(hovered).some(n=>n.props.role==='status'&&n.children.some(value=>typeof value==='string'&&value.includes('90.0%'))));
});
