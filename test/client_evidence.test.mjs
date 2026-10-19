import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const buildResult=await build({stdin:{contents:`export * from './client-src/evidence'; export {readEvidenceEvents,EvidenceButton,EvidencePanel,ContextCalculationView,calculationFieldChecks} from './client-src/evidencePanel'; export {comparisonEvidence} from './client-src/tab-compare'; export {bindReact} from './client-src/react-binding'; export {teamAggregate} from './client-src/team'; export {EvolutionTab} from './client-src/tab-evolution'; export {LineChart} from './client-src/charts'; export {TokensTab} from './client-src/tab-tokens'; export {CompactionTab} from './client-src/tab-compaction';`,resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const m=await import(`data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString('base64')}`);
const message=(seq,tokens,extra={})=>({seq,tokens,timeMs:seq*100,kind:'assistant',sourceKind:'agent',toolName:null,turn:1,preview:'demo',textTokens:tokens*.82,toolCallTokens:tokens*.18,fileTokens:0,outputTokens:null,cumulativeTokens:tokens,callId:null,callTool:null,...extra});
const nodes=tree=>tree&&typeof tree==='object'?[tree,...(tree.children??[]).flat(Infinity).flatMap(nodes)]:[];
function harness(){let cursor=0;const states=[];m.bindReact({createElement:(type,props,...children)=>({type,props:props??{},children}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:initial=>{const i=cursor++;return states[i]??(states[i]={current:initial});},useEffect:()=>{},useMemo:fn=>fn(),Fragment:'fragment'});return fn=>{cursor=0;return fn();};}
const metric={metricId:'tool.failure_rate',contractVersion:'1',subjectId:'s',value:.5,status:'partial',sampleCount:2,denominator:2,evidenceLevel:'derived',qualityRefs:['tool_result_error_flag_missing'],evidenceRefs:[{sessionId:'s',seq:10},{sessionId:'s',seq:20}]};
test('spike uses original ordered five-message baseline, keeps difference distinct from net context growth',()=>{
 const messages=[message(3,100),message(10,500),message(90,200),message(100,30700,{timeMs:12300,outputTokens:30000})];
 const chain=m.messageEvidence('s',messages[3],messages.slice().reverse(),true);
 assert.match(chain.title,/突增/);assert.equal(m.spikeInfo(messages,100).median,200);
 assert.deepEqual(chain.refs.map(ref=>ref.seq),[100,3,10,90]);
 assert.match(chain.facts.find(f=>f.label==='主导成分').value,/82.0%/);
 assert.equal(chain.facts.find(f=>f.label==='模型输出用量').value,'30K');
 assert.match(chain.facts.find(f=>f.label.includes('消息体积差')).source,/不是上下文净增量/);
 assert.equal(chain.facts.find(f=>f.label==='相邻消息时间间隔').value,'3.3 s');
});
test('zero baseline, insufficient retained samples and missing output remain explicit',()=>{
 const messages=[message(1,0),message(2,0),message(3,0),message(8,2000)];
 assert.equal(m.spikeInfo(messages,8).ratio,Infinity);
 const chain=m.messageEvidence('s',messages[3],[messages[3]],true);
 assert.ok(chain.notes.some(note=>note.includes('不足以复现')));
 assert.equal(chain.facts.find(f=>f.label==='模型输出用量').value,'未记录');
 assert.ok(!chain.title.includes('突增'));
});
test('metric evidence retains quality, denominator and contract formula',()=>{
 const chain=m.metricEvidence(metric);assert.equal(chain.facts.find(f=>f.label==='分母').value,'2');
 assert.match(chain.rule,/去重/);assert.ok(chain.notes.some(note=>note.includes('tool_result_error_flag_missing')));
 assert.deepEqual(chain.refs.map(ref=>ref.seq),[10,20]);
 assert.ok(m.metricEvidence({...metric,evidenceRefs:[]}).notes.some(note=>note.includes('未提供事件引用')));
});
test('reference identity includes session, combines roles without mutating inputs',()=>{
 const refs=[{sessionId:'a',seq:2,role:'baseline'},{sessionId:'a',seq:2,role:'current'},{sessionId:'b',seq:2,role:'current'},{sessionId:'a',seq:-1,role:'invalid'}];
 const result=m.uniqueEvidenceRefs(refs);assert.equal(result.length,2);assert.equal(result[0].role,'baseline / current');assert.equal(refs[0].role,'baseline');
});
function service(entries,{missingLoader=false}={}){
 const calls=[];const source={entries:[],hasMore:true};
 return {calls,sessions:{using:async(id,options,operation)=>{calls.push(['retain',id]);try{return await operation({ready:Promise.resolve(),binding:{eventSource:{getSnapshot:()=>source},session:missingLoader?{}:{loadThrough:async(seq)=>{calls.push(['load',seq]);source.entries=entries;}}}});}finally{calls.push(['release',id]);}}}};
}
test('raw event lookup loads through exact seq, excludes transient data, releases cross-session reference',async()=>{
 const fixture=service([{type:'transient',event:{seq:5,type:'assistant/live-chunk'}},...Array.from({length:9},(_,seq)=>({type:'event',event:{seq,type:'test',time:seq}}))]);
 const result=await m.readEvidenceEvents(fixture.sessions,{sessionId:'member-b',seq:5,role:'result'});
 assert.deepEqual(result.map(event=>event.seq),[2,3,4,5,6,7,8]);assert.ok(result.every(event=>event.type==='test'));
 assert.deepEqual(fixture.calls,[['retain','member-b'],['load',5],['release','member-b']]);
});
test('missing, invalid and unavailable event sources never silently substitute a neighbor',async()=>{
 const fixture=service([{type:'event',event:{seq:4,type:'test',time:0}}]);
 await assert.rejects(m.readEvidenceEvents(fixture.sessions,{sessionId:'s',seq:5,role:'x'}),/不会用相邻事件代替/);
 assert.equal(fixture.calls.at(-1)[0],'release');
 await assert.rejects(m.readEvidenceEvents(undefined,{sessionId:'s',seq:5,role:'x'}),/服务不可用/);
 await assert.rejects(m.readEvidenceEvents(fixture.sessions,{sessionId:'s',seq:NaN,role:'x'}),/无效/);
});
test('cancelled lookup cannot publish a result and still releases held session',async()=>{
 const fixture=service([]);const controller=new AbortController();controller.abort();
 await assert.rejects(m.readEvidenceEvents(fixture.sessions,{sessionId:'s',seq:5,role:'x'},controller.signal),{name:'AbortError'});
 assert.deepEqual(fixture.calls,[['retain','s'],['release','s']]);
});
test('compaction batch links changed originals and replacements, reporting missing measurements',()=>{
 const event={seq:8,kind:'summary',beforeTokens:100,afterTokens:40,reclaimedTokens:60,detail:{algorithm:'recorded',before:{nodes:[{seq:1,changed:true},{seq:2,changed:false}]},after:{nodes:[{seq:9,changed:true}]}}};
 const chain=m.compactionEvidence('s',[event,{seq:10,kind:'prune',beforeTokens:null,afterTokens:null,reclaimedTokens:null}]);
 assert.deepEqual(chain.refs.map(ref=>ref.seq),[8,1,9,10]);assert.ok(chain.notes.some(note=>note.includes('未回填')));
});
test('tool lookup joins results by callId rather than adjacency or another tool name',()=>{
 const analytics={recentEvents:[{seq:1,type:'tool/call',label:'read',callId:'r'},{seq:2,type:'tool/call',label:'bash',callId:'b'},{seq:3,type:'tool/result',callId:'b'},{seq:4,type:'tool/result',callId:'r'}],metricResults:[]};
 const chain=m.toolEvidence('s','read',analytics,{tools:[{name:'read',calls:1,errors:0}]});
 assert.deepEqual(chain.refs.map(ref=>ref.seq),[1,4]);
});
test('comparison evidence preserves session ownership and its actual error-rate denominator',()=>{
 const sessions=['a','b'].map(id=>({id,title:id,analytics:{toolCalls:10,toolErrors:2,recentEvents:[{seq:1,type:'tool/call'}],metricResults:[{...metric,subjectId:id,value:.5,evidenceRefs:[{sessionId:id,seq:2}]}]},timeline:null,stats:null}));
 const chain=m.comparisonEvidence(sessions,'errors');assert.match(chain.conclusion,/20.0%/);assert.match(chain.rule,/调用数/);assert.deepEqual(chain.refs.map(ref=>ref.sessionId),['a','b']);
});
test('alert evidence uses the correct contract for repeat calls and long gaps',()=>{
 const analytics={metricResults:[{...metric,metricId:'tool.repeat_loop',value:{maxRunLength:5},evidenceLevel:'inferred'}]};
 const chain=m.alertEvidence('s','token-waste','waste','5 repeated',analytics,null,5,3);
 assert.equal(chain.level,'inferred');assert.match(chain.rule,/tool.repeat_loop/);assert.equal(chain.facts[0].value,'5');assert.equal(chain.facts[1].value,'3');
});
test('touching member intervals do not manufacture a concurrent peak',()=>{
 const input=id=>({sessionId:id,memberIds:[],factTimeMax:20,subagentChildren:[],turnIntervals:[],hasEvents:true});
 const root={...input('root'),memberIds:['a','b']};
 const members=[{memberId:'a',summary:{teamInput:{...input('a'),turnIntervals:[{startMs:0,firstEndMs:10}]}}},{memberId:'b',summary:{teamInput:{...input('b'),turnIntervals:[{startMs:10,firstEndMs:20}]}}}];
 assert.equal(m.teamAggregate(root,members).peak,1);
});
test('evolution markers and requests expose evidence without altering chart selection',()=>{
 const render=harness();const chains=[];const messages=[message(1,100),message(2,100),message(3,100),message(4,5000)];
 const steps=[{seq:5,step:1,turn:1,timeMs:500,inputTokens:100,cacheReadTokens:20,outputTokens:10,surfaceTokens:90}];
 const tree=render(()=>m.EvolutionTab({data:{messages,steps,contextWindow:10000,timeline:{injections:messages,compactions:[]}},evidenceSessionId:'s',onEvidence:chain=>chains.push(chain)}));
 const chart=nodes(tree).find(node=>node.type===m.LineChart);chart.props.markers.find(marker=>marker.kind==='spike').onEvidence();chart.props.onPointEvidence(0);
 assert.match(chains[0].title,/突增 #4/);assert.equal(chains[1].refs[0].seq,5);
});
test('message spike button opens evidence directly without toggling its row',()=>{
 const render=harness();let selected;
 const messages=[message(1,100),message(2,100),message(3,100),message(4,5000)];
 const data={messages,surfaceTotal:10000,messageCapNote:false,timeline:{compactions:[]},analytics:null};
 const tree=render(()=>m.TokensTab({data,evidenceSessionId:'s',onEvidence:chain=>selected=chain}));
 let stopped=false;nodes(tree).find(node=>node.props['aria-label']==='查看突增 #4 证据链').props.onClick({stopPropagation:()=>stopped=true});
 assert.equal(stopped,true);assert.match(selected.title,/突增 #4/);
});

test('drop evidence distinguishes correlation from an unexplained decline',()=>{
 const messages=[message(1,500,{cumulativeTokens:10000}),message(9,100,{cumulativeTokens:3000})];
 assert.equal(m.dropEvidence('s',messages[1],messages,[]).level,'inferred');
 const chain=m.dropEvidence('s',messages[1],messages,[{seq:5,kind:'prune',beforeTokens:10000,afterTokens:2900,reclaimedTokens:7100}]);
 assert.equal(chain.level,'derived');assert.deepEqual(chain.refs.map(ref=>ref.seq),[1,9,5]);
 assert.match(chain.rule,/不将净下降/);
});

test('aborting pending history releases the reference without waiting for the history promise',async()=>{
 let released=false,started=false;
 const controller=new AbortController();
 const sessions={using:async(_id,_options,fn)=>{try{return await fn({binding:{eventSource:{getSnapshot:()=>({entries:[]})},session:{loadThrough:()=>{started=true;return new Promise(()=>{});}}}});}finally{released=true;}}};
 const pending=m.readEvidenceEvents(sessions,{sessionId:'s',seq:1,role:'test'},controller.signal);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(started,true);controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(released,true);
});

test('legacy partial metric lacks refs gracefully instead of fabricating evidence',()=>{
 const chain=m.metricEvidence({metricId:'tool.failure_rate',subjectId:'s',value:.2});
 assert.equal(chain.refs.length,0);assert.equal(chain.level,'inferred');assert.ok(chain.notes.some(note=>note.includes('未提供事件引用')));
});

const contextTimeline=(cacheReadTokens=100000)=>({contextWindow:262144,contextWindowSeq:600,steps:[{seq:641,inputTokens:30911,cacheReadTokens,outputTokens:30000,timeMs:1000,turn:1,step:1,surfaceTokens:161900}]});
test('occupancy proof binds both numerator fields to response usage and denominator to its independent context event',()=>{
 const chain=m.aggregateEvidence('s','上下文窗口占用',null,contextTimeline(),'context');
 assert.equal(chain.contextCalculation.occupancy,130911);
 assert.equal(chain.contextCalculation.ratio,130911/262144);
 assert.deepEqual(chain.contextCalculation.fields.map(field=>[field.path,field.value,field.ref.seq]),[['data.usage.inputTokens',30911,641],['data.usage.cacheReadTokens',100000,641],['data.contextWindow',262144,600]]);
 assert.deepEqual(chain.refs.map(ref=>ref.seq),[641,600]);
 assert.ok(chain.notes.some(note=>note.includes('回复正文和输出 Token 不计入')));
 assert.ok(!chain.notes.some(note=>note.includes('累计统计')));
});
test('occupancy proof differentiates unknown cache from observed zero, and never invents missing window origins',()=>{
 const missing=m.contextOccupancyEvidence('s','占用',contextTimeline(null));
 const zero=m.contextOccupancyEvidence('s','占用',contextTimeline(0));
 assert.equal(missing.contextCalculation.occupancy,30911);assert.equal(zero.contextCalculation.occupancy,30911);
 assert.equal(missing.contextCalculation.fields[1].value,null);assert.equal(zero.contextCalculation.fields[1].value,0);
 assert.ok(missing.notes.some(note=>note.includes('不等于原始记录已确认')));
 assert.ok(!zero.notes.some(note=>note.includes('不等于原始记录已确认')));
 const old={...contextTimeline(),contextWindowSeq:null};
 assert.equal(m.contextOccupancyEvidence('s','占用',old).refs.length,1);
 assert.ok(m.contextOccupancyEvidence('s','占用',old).notes.some(note=>note.includes('旧投影')));
 const absent=m.contextOccupancyEvidence('s','占用',{...old,steps:[],surface:{totalTokens:1234}});
 assert.equal(absent.contextCalculation.occupancy,null);assert.equal(absent.contextCalculation.ratio,null);
 assert.ok(absent.notes.some(note=>note.includes('回退到表面估算')));
});
test('original-field verification checks exact session and seq, catches mismatches and missing cache rather than confirming a fallback',()=>{
 const fields=m.contextOccupancyEvidence('s','占用',contextTimeline()).contextCalculation.fields;
 const raw={seq:641,type:'assistant/message',time:0,data:{usage:{inputTokens:30911,cacheReadTokens:100000,outputTokens:999999}}};
 const checks=m.calculationFieldChecks(fields,'s',raw);
 assert.equal(checks.length,2);assert.ok(checks.every(check=>check.status==='与计算输入一致'));
 assert.equal(m.calculationFieldChecks(fields,'other',raw).length,0);
 assert.equal(m.calculationFieldChecks(fields,'s',{...raw,seq:640}).length,0);
 assert.equal(m.calculationFieldChecks(fields,'s',{...raw,data:{usage:{inputTokens:1}}})[0].status,'与计算快照不一致');
 assert.equal(m.calculationFieldChecks(fields,'s',{...raw,data:{usage:{inputTokens:1}}})[1].status,'原始字段未记录');
 assert.equal(m.calculationFieldChecks(fields,'s',{...raw,type:'tool/result'})[0].status,'事件类型不符');
 assert.equal(m.calculationFieldChecks(fields,'s',{seq:600,type:'request/context',time:0,data:{contextWindow:262144}})[0].status,'与计算输入一致');
});
test('calculation card exposes inspectable source links and the exact arithmetic, not rounded input estimates',()=>{
 const render=harness();let target;
 const calculation=m.contextOccupancyEvidence('s','占用',contextTimeline()).contextCalculation;
 const tree=render(()=>m.ContextCalculationView({calculation,onSelect:ref=>target=ref}));
 const text=nodes(tree).flatMap(node=>node.children).flat(Infinity).filter(value=>typeof value==='string').join(' ');
 assert.match(text,/30,911 \+ 100,000 = 130,911 Token/);assert.match(text,/130,911 ÷ 262,144 × 100% = 49.9%/);
 nodes(tree).find(node=>node.props['aria-label']==='查看窗口上限来源 #600').props.onClick();assert.equal(target.seq,600);
});
