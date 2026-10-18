import { h, useState } from './react-binding.js';
import { buildHtml, copyText, exportPng, exportReport, type ExportFormat, type ExportInput, type ReportSection, type ReportTemplate } from './exporters.js';
import type { ConfigurationConnection } from './configuration.js';

export function ReportActions(props:{input:ExportInput;connection?:ConfigurationConnection|undefined;chartElement:()=>HTMLElement|null;disabled?:boolean}):unknown {
  const [open,setOpen]=useState<'export'|'share'|null>(null);
  const [template,setTemplate]=useState<ReportTemplate>(()=>savedTemplate().template);
  const [title,setTitle]=useState(()=>savedTemplate().title);
  const [sections,setSections]=useState<ReportSection[]>(()=>savedTemplate().sections);
  const [format,setFormat]=useState<ExportFormat>('pdf');
  const [days,setDays]=useState(7);
  const [access,setAccess]=useState('public');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [status,setStatus]=useState('');
  const [share,setShare]=useState<{url:string;path:string;expiresAt:number|null}|null>(null);
  const input={...props.input,template,title,sections};
  const invoke=async(method:string,args:Record<string,unknown>)=>{
    if(!props.connection)throw Error('当前宿主未提供分享连接');
    const result=await props.connection.rpc.call('/api',`trajectorySharing/${method}`,{args},AbortSignal.timeout(30000));
    if(!result.ok)throw Error(result.error?.message??'分享操作失败');return result.value;
  };
  const run=async()=>{
    setBusy(true);setError('');setStatus('');
    try{
      if((template==='team'||template==='custom'&&sections.includes('comparison'))&&(input.comparison?.length??0)<2)throw Error('请先在“对比分析”选择至少两个会话并开始对比，再导出含对比数据的报告。');
      if(open==='export'){
        if(format==='png')await exportPng(props.chartElement(),'trajectory-chart.png');else await exportReport(format,input);
        setStatus('已生成并提交浏览器下载。');
      }else{
        if(!/^https?:$/.test(location.protocol))throw Error('请在宿主 HTTP 页面中生成分享链接');
        if(access==='password'&&password.length<8)throw Error('密码至少需要 8 个字符');
        const result=await invoke('create',{html:buildHtml(input),days,password:access==='password'?password:''}) as {path:string;expiresAt:number|null};
        const url=new URL(result.path,location.origin).href;
        setShare({...result,url});setPassword('');
        const copied=await copyText(url);setStatus(copied?'分享链接已生成并复制。':'分享链接已生成，请手动复制下方地址。');
      }
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  };
  const saveTemplate=()=>{try{localStorage.setItem('dsh-eval-report-template',JSON.stringify({template:'custom',title,sections}));setStatus('已保存自定义模板。');}catch{setError('浏览器无法保存模板。');}};
  const chooseTemplate=(next:ReportTemplate)=>{
    setTemplate(next);setError('');setStatus('');
    if(next==='custom')try{const saved=JSON.parse(localStorage.getItem('dsh-eval-report-template')??'null');if(saved){setTitle(typeof saved.title==='string'?saved.title:'轨迹分析报告');if(Array.isArray(saved.sections))setSections(saved.sections.filter((section:ReportSection)=>['summary','charts','details','alerts','comparison'].includes(section)));}}catch{/* keep current */}
  };
  return h('div',{style:{position:'relative',display:'flex',gap:6}},[
    h('button',{key:'export',disabled:props.disabled,onClick:()=>{setOpen(open==='export'?null:'export');setError('');setStatus('');},'aria-expanded':open==='export'},'导出'),
    h('button',{key:'share',disabled:props.disabled,onClick:()=>{setOpen(open==='share'?null:'share');setError('');setStatus('');},'aria-expanded':open==='share'},'分享'),
    open ? h('section',{key:'menu',role:'region','aria-label':open==='export'?'导出报告':'分享只读报告',style:{position:'absolute',right:0,top:'100%',marginTop:8,zIndex:60,width:'min(390px,calc(100vw - 40px))',maxHeight:'72vh',overflow:'auto',display:'grid',gap:12,padding:16,background:'var(--dsh-eval-surface,Canvas)',color:'var(--dsh-eval-text,CanvasText)',border:'1px solid #9996',borderRadius:10,boxShadow:'0 8px 30px #0003',fontSize:12}},[
      h('div',{key:'head',style:{display:'flex',justifyContent:'space-between'}},[h('strong',{},open==='export'?'导出分析报告':'分享只读快照'),h('button',{'aria-label':'关闭导出分享面板',onClick:()=>setOpen(null)},'关闭')]),
      h('label',{key:'template'},['报告模板 ',h('select',{'aria-label':'报告模板',value:template,onChange:(event:{target:{value:ReportTemplate}})=>chooseTemplate(event.target.value)},[['brief','简洁版：关键指标 + 图表'],['detailed','详细版：完整投影 + 分析'],['team','团队版：多会话对比 + 建议'],['custom','自定义模板']].map(([value,label])=>h('option',{key:value,value},label)))]),
      h('label',{key:'title'},['报告标题 ',h('input',{'aria-label':'报告标题',value:title,maxLength:120,onChange:(event:{target:{value:string}})=>setTitle(event.target.value),style:{width:'100%',boxSizing:'border-box'}})]),
      template==='custom' ? h('fieldset',{key:'sections'},[h('legend',{},'报告内容'),...(['summary:关键指标','charts:图表','details:事件和指标明细','alerts:告警及建议','comparison:多会话对比'] as const).map((entry)=>{const [section,label]=entry.split(':') as [ReportSection,string];return h('label',{key:section,style:{display:'block'}},[h('input',{type:'checkbox',checked:sections.includes(section),onChange:()=>setSections((items)=>items.includes(section)?items.filter((item)=>item!==section):[...items,section])}),label]);}),h('button',{onClick:saveTemplate},'保存自定义模板')]) : null,
      open==='export' ? h('label',{key:'format'},['导出格式 ',h('select',{'aria-label':'导出格式',value:format,onChange:(event:{target:{value:ExportFormat}})=>setFormat(event.target.value)},[['pdf','PDF 完整报告'],['markdown','Markdown 文本报告'],['json','JSON 原始投影'],['png','PNG 当前图表'],['html','HTML 离线报告']].map(([value,label])=>h('option',{key:value,value},label)))]) : h('div',{key:'sharing',style:{display:'grid',gap:10}},[
        h('label',{},['有效期 ',h('select',{'aria-label':'分享有效期',value:String(days),onChange:(event:{target:{value:string}})=>setDays(Number(event.target.value))},[h('option',{value:'7'},'7 天'),h('option',{value:'30'},'30 天'),h('option',{value:'0'},'永久')])]),
        h('label',{},['访问权限 ',h('select',{'aria-label':'分享访问权限',value:access,onChange:(event:{target:{value:string}})=>setAccess(event.target.value)},[h('option',{value:'public'},'公开（持有链接可查看）'),h('option',{value:'password'},'密码保护')])]),
        access==='password'?h('label',{},['访问密码 ',h('input',{type:'password','aria-label':'分享访问密码',value:password,minLength:8,maxLength:128,autoComplete:'new-password',onChange:(event:{target:{value:string}})=>setPassword(event.target.value)})]):null,
        h('p',{style:{margin:0,opacity:.7}},'分享内容为当前报告的只读快照，不包含原始消息正文或工具参数。链接由当前宿主提供，宿主关闭后暂不可用。'),
        /^127\.|^localhost$|^\[::1\]$/.test(typeof location!=='undefined'?location.hostname:'')?h('p',{style:{margin:0,color:'#d28518'}},'当前为本机地址：链接仅在本机可访问。团队访问须通过已配置可达地址的宿主打开此面板再生成。'):null,
      ]),
      open==='export'&&['json','png'].includes(format)?h('small',{key:'scope'},format==='json'?'JSON 包含当前原始投影和对比数据，不按报告章节裁剪。':'PNG 导出当前 Tab 的首个可用图表；模板设置仅用于报告。'):null,
      h('button',{key:'run',disabled:busy||template==='custom'&&sections.length===0,onClick:()=>void run()},busy?'正在生成…':open==='export'?'生成并下载':'生成分享链接并复制'),
      error?h('div',{key:'error',role:'alert'},[error,h('button',{onClick:()=>void run(),disabled:busy},'重试')]):null,
      status?h('div',{key:'status',role:'status'},status):null,
      open==='share'&&share?h('div',{key:'result',style:{display:'grid',gap:8}},[
        h('label',{},['只读分享链接',h('input',{'aria-label':'只读分享链接',readOnly:true,value:share.url,style:{width:'100%',boxSizing:'border-box'}})]),
        h('span',{},share.expiresAt?`有效期至 ${new Date(share.expiresAt).toLocaleString()}`:'永久有效（可主动撤销）'),
        h('div',{},[h('a',{href:share.url,target:'_blank',rel:'noopener noreferrer'},'打开只读视图'),h('button',{onClick:()=>void copyText(share.url).then((copied)=>setStatus(copied?'已复制链接。':'复制失败，请手动复制。'))},'复制链接'),h('button',{disabled:busy,onClick:()=>{setBusy(true);void invoke('revoke',{id:share.path.split('/').pop()}).then(()=>{setShare(null);setStatus('分享已撤销。');},(reason)=>setError(String(reason))).finally(()=>setBusy(false));}},'撤销分享')]),
      ]):null,
    ]):null,
  ]);
}

function savedTemplate():{template:ReportTemplate;title:string;sections:ReportSection[]} {
  const fallback={template:'detailed' as ReportTemplate,title:'轨迹分析报告',sections:['summary','charts','details','alerts','comparison'] as ReportSection[]};
  try {const saved=JSON.parse(localStorage.getItem('dsh-eval-report-template')??'null');if(saved?.template!=='custom')return fallback;return{template:'custom',title:typeof saved.title==='string'?saved.title:fallback.title,sections:Array.isArray(saved.sections)?saved.sections.filter((section:ReportSection)=>fallback.sections.includes(section)):fallback.sections};}catch{return fallback;}
}
