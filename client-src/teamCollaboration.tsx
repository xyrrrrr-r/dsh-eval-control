import {h,useState,useEffect,useRef} from './react-binding.js';
import {EvidenceButton} from './evidencePanel.js';
import {eventRef,type EvidenceChain} from './evidence.js';
import type {teamActivity,TeamInteraction} from './teamActivity.js';

type Details=ReturnType<typeof teamActivity>;
const palette={message:'#458af7',assignment:'#dd9a21',spawn:'#19a997',task:'#a970e2'};
const kindNames={message:'消息交互',assignment:'任务分配',spawn:'成员加入',task:'任务状态'};
const panel={border:'1px solid color-mix(in srgb,currentColor 14%,transparent)',borderRadius:12,padding:16};
const small={fontSize:12,opacity:.65};
const date=(time:number)=>{const d=new Date(time);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

export function TeamCollaboration(props:{details:Details;rootId:string;memberIds:string[];selectedMember:string;onEvidence?:((chain:EvidenceChain)=>void)|undefined}) {
 const [day,setDay]=useState('all'),[kind,setKind]=useState('all'),[pair,setPair]=useState('');
 const [page,setPage]=useState(0),[chosen,setChosen]=useState<string|null>(null);
 const [marker]=useState(()=>`team-arrow-${Math.random().toString(36).slice(2)}`);
 const detailRef=useRef<HTMLElement|null>(null);
 useEffect(()=>{if(chosen)detailRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[chosen]);
 const interactions=props.details.interactions.map(item=>item.kind==='spawn'?{...item,from:props.rootId}:item);
 const name=(id:string)=>id===props.rootId?'主 Agent':id==='$taskboard'?'共享任务板':props.details.members.find(m=>m.id===id)?.name||`成员 ${id.slice(0,6)}`;
 const ids=[...new Set([props.rootId,...props.memberIds,...interactions.flatMap(e=>[e.from,e.to]),'$taskboard'])].filter(Boolean);
 const rows=interactions.filter(e=>(day==='all'||date(e.time)===day)&&(kind==='all'||kind===e.kind)&&(props.selectedMember==='all'||e.from===props.selectedMember||e.to===props.selectedMember));
 const connections=new Map<string,{from:string;to:string;messages:number;assignments:number;other:number}>();
 for(const row of rows){if(row.from===row.to)continue;const key=JSON.stringify([row.from,row.to]);const c=connections.get(key)??{from:row.from,to:row.to,messages:0,assignments:0,other:0};if(row.kind==='message')c.messages++;else if(row.kind==='assignment')c.assignments++;else c.other++;connections.set(key,c);}
 const filtered=rows.filter(e=>!pair||pair===JSON.stringify([e.from,e.to]));
 const pages=Math.max(1,Math.ceil(filtered.length/30));const currentPage=Math.min(page,pages-1);
 const visible=filtered.slice(currentPage*30,currentPage*30+30);
 const selected=interactions.find(e=>e.id===chosen);
 const evidence=(e:TeamInteraction):EvidenceChain=>({title:`${name(e.from)} → ${name(e.to)} · ${e.label}`,conclusion:e.text,level:'observed',rule:e.kind==='message'?'原始消息的 senderId / targetId 确定方向，messageId 配对送达回执。':'来自成员或任务快照；负责人变化不代表已确认操作者身份。',facts:[{label:'交互时间',value:new Date(e.time).toLocaleString(),source:'原始事件时间'}],refs:e.refs.map(seq=>eventRef(props.rootId,seq,e.label)),notes:e.kind==='assignment'?['任务归属可验证，但快照没有操作人字段，不能证明由主 Agent 下发。']:[]});
 const choose=(id:string)=>setChosen(id);
 const control=(label:string,value:string,update:(value:string)=>void,options:Array<[string,string]>)=>h('label',{style:{fontSize:12}},[label+' ',h('select',{value,onChange:(e:Event)=>{update((e.target as HTMLSelectElement).value);setPage(0);setChosen(null);}},options.map(([id,title])=>h('option',{key:id,value:id},title)))]);
 const graphWidth=900,graphHeight=Math.max(300,Math.ceil((ids.length-2)/2)*105+140);
 const others=ids.filter(id=>id!==props.rootId&&id!=='$taskboard');
 const positions=new Map<string,{x:number;y:number}>([[props.rootId,{x:450,y:48}],['$taskboard',{x:450,y:graphHeight-42}]]);
 others.forEach((id,index)=>positions.set(id,{x:index%2===0?140:760,y:125+Math.floor(index/2)*105}));
 return h('section',{style:panel},[
  h('div',{style:{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:10}},[h('strong',{},'协作关系与交接'),h('div',{style:{display:'flex',flexWrap:'wrap',gap:12}},[
   control('日期',day,setDay,[['all','全部日期'],...[...new Set(interactions.map(e=>date(e.time)))].map(d=>[d,d] as [string,string])]),
   control('交互',kind,setKind,[['all','全部交互'],...Object.entries(kindNames)]),pair?h('button',{onClick:()=>{setPair('');setPage(0);}},'清除连线筛选'):null
  ])]),
  h('p',{style:small},'上方看协作关系，下方按时间看交接。点击连线筛选方向，点击交互箭头查看原文与证据。蓝色实线是消息；橙色虚线是任务归属，未推断操作者。'),
  h('div',{style:{overflowX:'auto'}},h('svg',{viewBox:`0 0 ${graphWidth} ${graphHeight}`,role:'group','aria-label':'Agent 协作关系图',style:{width:'100%',minWidth:650,maxHeight:500}},[
   h('defs',{},h('marker',{id:marker,markerWidth:8,markerHeight:8,refX:7,refY:4,orient:'auto'},h('path',{d:'M0,0 L8,4 L0,8 Z',fill:'context-stroke'}))),
   ...[...connections.entries()].map(([key,c])=>{const a=positions.get(c.from)!,b=positions.get(c.to)!;const dx=b.x-a.x,dy=b.y-a.y,len=Math.max(1,Math.hypot(dx,dy));const offset=connections.has(JSON.stringify([c.to,c.from]))?15:0;const x1=a.x+dx/len*58-dy/len*offset,y1=a.y+dy/len*30+dx/len*offset,x2=b.x-dx/len*65-dy/len*offset,y2=b.y-dy/len*30+dx/len*offset;const color=c.messages?palette.message:c.assignments?palette.assignment:palette.spawn;const title=`${name(c.from)} → ${name(c.to)}：${c.messages} 条消息 · ${c.assignments} 次任务归属 · ${c.other} 次状态事件`;const action=()=>{setPair(pair===key?'':key);setPage(0);setChosen(null);};return h('g',{key,role:'button',tabIndex:0,'aria-label':title,onClick:action,onKeyDown:(e:KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();action();}},style:{cursor:'pointer',opacity:pair&&pair!==key?.22:1}},[
    h('title',{},title),h('line',{x1,y1,x2,y2,stroke:'transparent',strokeWidth:22}),h('line',{x1,y1,x2,y2,stroke:color,strokeWidth:pair===key?3.5:2,strokeDasharray:c.messages?undefined:'6 4',markerEnd:`url(#${marker})`}),h('text',{x:(x1+x2)/2,y:(y1+y2)/2-7,textAnchor:'middle',fill:color,fontSize:12,paintOrder:'stroke',stroke:'var(--dsh-eval-bg, #181818)',strokeWidth:4},[c.messages?`${c.messages} 消息`:'',c.assignments?`${c.assignments} 分配`:'',c.other?`${c.other} 状态`:''].filter(Boolean).join(' · '))
   ]);}),
   ...ids.map(id=>{const p=positions.get(id)!;return h('g',{key:id},[h('rect',{x:p.x-90,y:p.y-24,width:180,height:48,rx:10,fill:id===props.rootId?'#244677':id==='$taskboard'?'#4e3b1c':'#203b3b',stroke:id===props.rootId?'#458af7':id==='$taskboard'?'#dd9a21':'#19a997'}),h('text',{x:p.x,y:p.y+4,textAnchor:'middle',fontSize:13,fill:'#fff'},name(id).slice(0,24))]);})
  ])),
  rows.filter(e=>e.kind==='message'&&e.from!==props.rootId&&e.to!==props.rootId).length===0?h('p',{style:small},'此范围未观察到子 Agent 之间的直接消息；图中只显示实际记录的交互。'):null,
  h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:12}},[h('strong',{style:{fontSize:13}},`交互时序 · ${filtered.length} 条${pair?' · 已筛选方向':''}`),h('div',{style:{display:'flex',gap:8,alignItems:'center'}},[h('button',{disabled:currentPage===0,onClick:()=>setPage(currentPage-1)},'上一段'),h('span',{style:small},`${currentPage+1} / ${pages}`),h('button',{disabled:currentPage>=pages-1,onClick:()=>setPage(currentPage+1)},'下一段')])]),
  h('p',{style:small},'从早到晚排列；每行代表一次交互，纵向等距，时间间隔以左侧时间戳为准。'),
  h('div',{style:{overflow:'auto',maxHeight:560}},h('svg',{viewBox:`0 0 ${Math.max(850,ids.length*170+160)} ${visible.length*54+60}`,role:'group','aria-label':'Agent 交互时序图',style:{display:'block',width:'100%',minWidth:Math.max(850,ids.length*170+160)}},[
   h('defs',{},h('marker',{id:marker+'-seq',markerWidth:8,markerHeight:8,refX:7,refY:4,orient:'auto'},h('path',{d:'M0,0 L8,4 L0,8 Z',fill:'context-stroke'}))),
   ...ids.map((id,i)=>h('g',{key:id},[h('text',{x:220+i*170,y:18,textAnchor:'middle',fill:'currentColor',fontSize:12},name(id).slice(0,22)),h('line',{x1:220+i*170,x2:220+i*170,y1:28,y2:visible.length*54+52,stroke:'#8886',strokeDasharray:'3 4'})])),
   ...visible.map((e,i)=>{const y=60+i*54,x1=220+ids.indexOf(e.from)*170,x2=220+ids.indexOf(e.to)*170,color=palette[e.kind];const label=`${new Date(e.time).toLocaleString()} ${name(e.from)} → ${name(e.to)} ${e.label}`;return h('g',{key:e.id,role:'button',tabIndex:0,'aria-label':label,onClick:()=>choose(e.id),onKeyDown:(event:KeyboardEvent)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(e.id);}},style:{cursor:'pointer'}},[
    h('title',{},`${label}\n${e.text.slice(0,240)}`),h('rect',{x:0,y:y-25,width:Math.max(850,ids.length*170+160),height:50,rx:4,fill:chosen===e.id?'#458af722':i%2?'#88888808':'transparent'}),h('text',{x:4,y:y-8,fill:'currentColor',fontSize:11},date(e.time)),h('text',{x:4,y:y+9,fill:'currentColor',fontSize:11},new Date(e.time).toLocaleTimeString()),
    x1===x2?h('path',{d:`M${x1},${y-6} h45 v17 h-45`,stroke:color,fill:'none',markerEnd:`url(#${marker}-seq)`}):h('line',{x1,x2:x2+(x2>x1?-4:4),y1:y,y2:y,stroke:color,strokeWidth:2,strokeDasharray:e.kind==='assignment'?'6 4':undefined,markerEnd:`url(#${marker}-seq)`}),h('text',{x:(x1+x2)/2+(x1===x2?50:0),y:y-8,textAnchor:x1===x2?'start':'middle',fill:color,fontSize:11},`${e.label} · ${e.text.replace(/\s+/g,' ').slice(0,24)}`)
   ]);})
  ])),
  filtered.length===0?h('p',{style:small},'当前范围没有记录到交互。'):null,
  selected?h('article',{ref:detailRef,'aria-label':'交互详情',style:{...panel,marginTop:14,borderColor:palette[selected.kind]}},[
   h('strong',{},`${name(selected.from)} → ${name(selected.to)} · ${selected.label}`),h('p',{style:small},new Date(selected.time).toLocaleString()),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:260,overflow:'auto',fontSize:12}},selected.text),h(EvidenceButton,{onEvidence:props.onEvidence,chain:()=>evidence(selected),label:'查看这次交互的轨迹证据'})
  ]):h('p',{style:small},'选择时序图中的箭头，在此展开这次交互的具体内容。')
 ]);
}
