import { h, useState } from './react-binding.js';

export interface ConfigurationRemote {
  describe(): Promise<{ path: string; entries: Array<{id: string; config: Record<string, unknown>; applies?: string}> }>;
  apply(id: string, expected: string, thresholdRatio: number): Promise<{applied: boolean; path: string; thresholdRatio: number; applies?: string}>;
}

export function ConfigurationAction(props: { rule: string; remote?: ConfigurationRemote | undefined }): unknown {
  const [plan, setPlan] = useState<Awaited<ReturnType<ConfigurationRemote['describe']>> | null>(null);
  const [selected, setSelected] = useState('');
  const [ratio, setRatio] = useState(props.rule === 'frequent-compaction' ? 0.85 : 0.7);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const supported = props.rule === 'context-overload' || props.rule === 'frequent-compaction';
  const run = async (direct: boolean) => {
    setBusy(true); setMessage(''); setDone(false);
    try {
      if (!props.remote) throw new Error('配置服务未连接，请刷新页面或更新宿主插件');
      const latest = await props.remote.describe();
      setPlan(latest);
      if (!supported) { setMessage('此建议需要结合工具和任务人工判断，请按下方路径调整；不自动修改无关配置。'); return; }
      const entry = latest.entries.find((item) => item.id === selected) ?? (latest.entries.length === 1 ? latest.entries[0] : undefined);
      if (!entry) { setMessage(latest.entries.length ? '请选择要调整的压缩配置。' : '当前配置文件中没有可编辑的基础压缩插件，请在宿主插件设置中检查当前 Agent 的压缩配置。'); return; }
      setSelected(entry.id);
      const current = typeof entry.config.thresholdRatio === 'number' ? entry.config.thresholdRatio : 0.8;
      const proposed = props.rule === 'context-overload' ? Math.min(current, 0.7) : Math.max(current, 0.85);
      setRatio(proposed);
      if (direct) {
        const result = await props.remote.apply(entry.id, JSON.stringify(entry.config), proposed);
        setPlan({...latest,entries:latest.entries.map((item)=>item.id===entry.id?{...item,config:{...item.config,auto:true,thresholdRatio:proposed,modelPolicies:(Array.isArray(item.config.modelPolicies)?item.config.modelPolicies:[]).map((policy)=>({...policy,thresholdRatio:proposed}))}}:item)});
        setDone(true); setMessage(`已保存并应用，已校验压缩触发比例 ${(result.thresholdRatio * 100).toFixed(0)}%。${result.applies ?? '后续步骤'}生效。`);
      }
    } catch (error) { setMessage(`未应用：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!plan || !props.remote) return;
    const entry = plan.entries.find((item) => item.id === selected);
    if (!entry) { setMessage('请选择配置目标'); return; }
    setBusy(true); setDone(false);
    try {
      const result = await props.remote.apply(entry.id, JSON.stringify(entry.config), ratio);
      setPlan({...plan,entries:plan.entries.map((item)=>item.id===entry.id?{...item,config:{...item.config,auto:true,thresholdRatio:ratio,modelPolicies:(Array.isArray(item.config.modelPolicies)?item.config.modelPolicies:[]).map((policy)=>({...policy,thresholdRatio:ratio}))}}:item)});
      setDone(true); setMessage(`已保存并应用，配置回读校验通过。${result.applies ?? '后续步骤'}生效。`);
    } catch (error) { setMessage(`未应用：${error instanceof Error ? error.message : String(error)}。可重新读取配置后重试。`); }
    finally { setBusy(false); }
  };
  const button = { font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid #9996', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' };
  return h('div', { style: { display: 'grid', gap: 8, fontSize: 12 } }, [
    h('div', {key:'actions',style:{display:'flex',gap:8,flexWrap:'wrap'}}, [
      h('button',{key:'prepare',disabled:busy,onClick:()=>void run(false),style:button},supported ? '查看并调整配置' : '查看配置路径'),
      supported ? h('button',{key:'direct',disabled:busy,onClick:()=>void run(true),style:button},busy ? '处理中…' : '直接应用推荐配置') : null,
    ]),
    plan ? h('div',{key:'plan',style:{display:'grid',gap:8}},[
      h('div',{key:'path',style:{overflowWrap:'anywhere'}},`配置文件：${plan.path}`),
      h('div',{key:'navigation'},supported ? '设置 → 插件 → 基础压缩 → thresholdRatio / auto' : '设置 → 插件 → 对应工具；检查参数、超时及工具权限'),
      supported && plan.entries.length ? h('label',{key:'target'},['配置目标 ',h('select',{value:selected,disabled:busy,onChange:(event:{target:{value:string}})=>{setSelected(event.target.value);setMessage('');const current=plan.entries.find((entry)=>entry.id===event.target.value)?.config.thresholdRatio;setRatio(props.rule==='frequent-compaction'?Math.max(typeof current==='number'?current:0.8,0.85):Math.min(typeof current==='number'?current:0.8,0.7));setDone(false);}},[h('option',{key:'empty',value:''},'请选择'),...plan.entries.map((entry)=>h('option',{key:entry.id,value:entry.id},entry.id.replace('preset-','').replace('::',' · 基础压缩 #')))])]) : null,
      supported && selected ? h('div',{key:'before'},`当前配置：auto = ${String(plan.entries.find((item) => item.id === selected)?.config.auto ?? true)}，thresholdRatio = ${String(plan.entries.find((item) => item.id === selected)?.config.thresholdRatio ?? 0.8)}（未配置时使用默认值）`) : null,
      supported && selected ? h('label',{key:'ratio'},['压缩触发比例 ',h('input',{type:'number',min:0.2,max:0.9,step:0.05,value:ratio,disabled:busy,onChange:(event:{target:{value:string}})=>{setRatio(Number(event.target.value));setDone(false);},style:{width:70}})]) : null,
      supported && selected ? h('div',{key:'effect'},`将开启自动压缩（auto: true），默认及所有模型覆盖策略的 thresholdRatio 设为 ${ratio}。影响当前 profile；${plan.entries.find((item) => item.id === selected)?.applies ?? '后续步骤'}生效。`) : null,
      supported && selected ? h('button',{key:'apply',disabled:busy || done || !Number.isFinite(ratio) || ratio<0.2 || ratio>0.9,onClick:()=>void apply(),style:button},done ? '已应用 ✓' : '应用当前配置') : null,
    ]) : null,
    message ? h('div',{key:'message',role:'status',style:{overflowWrap:'anywhere'}},message) : null,
  ]);
}

/** Use the host Gateway carrier for this plugin-owned Remote namespace. */
export interface ConfigurationConnection { rpc: { call(path: string, endpoint: string, payload: unknown, signal: AbortSignal): Promise<{ok: boolean; value?: unknown; error?: {message?: string}}> } }
export function configurationRemote(connection?: ConfigurationConnection): ConfigurationRemote | undefined {
  if (!connection) return undefined;
  const invoke = async (method: string, args: Record<string, unknown>) => {
    const result = await connection.rpc.call('/api', `trajectoryConfiguration/${method}`, {args}, AbortSignal.timeout(30000));
    if (!result.ok) throw new Error(result.error?.message ?? '宿主拒绝配置操作');
    return result.value;
  };
  return {
    describe: async () => await invoke('describe', {}) as Awaited<ReturnType<ConfigurationRemote['describe']>>,
    apply: async (entryId, expected, thresholdRatio) => await invoke('apply', {entryId, expected, thresholdRatio}) as Awaited<ReturnType<ConfigurationRemote['apply']>>,
  };
}
