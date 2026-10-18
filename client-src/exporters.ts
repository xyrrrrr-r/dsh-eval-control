/** PRD 3.9 report generation and downloads; shared reports contain aggregate snapshots. */
import { formatDateTime, formatFull, formatMs, formatPercent, formatTokens } from './format.js';
import { METRIC_LABELS, formatMetricValue } from './metricLabels.js';
import type { Alert } from './alerts.js';
import { currentContextOf } from './derive.js';
import type { ContextTimeline, TrajectoryAnalytics } from './types.js';

export type ExportFormat = 'pdf' | 'markdown' | 'json' | 'png' | 'html';
export type ReportTemplate = 'brief' | 'detailed' | 'team' | 'custom';
export type ReportSection = 'summary' | 'charts' | 'details' | 'alerts' | 'comparison';

export interface ExportInput {
  template?: ReportTemplate;
  title?: string;
  sections?: ReportSection[];
  comparison?: import('./tab-compare.js').LoadedSession[];
  sessionId: string | null;
  analytics: TrajectoryAnalytics | null;
  timeline: ContextTimeline | null;
  stats: { turns: number; steps: number; llmMs: number; toolMs: number; decodeTokens: number } | null;
  alerts: Alert[];
  /** The dashboard container element, for PNG and the HTML snapshot. */
  element: HTMLElement | null;
}

export async function exportReport(format: ExportFormat, input: ExportInput): Promise<void> {
  if (format === 'pdf') { downloadBlob(await buildPdf(input), 'trajectory-report.pdf'); return; }
  if (format === 'markdown') downloadText('trajectory-report.md', 'text/markdown;charset=utf-8', buildMarkdown(input));
  else if (format === 'json') downloadText('trajectory-report.json', 'application/json;charset=utf-8', buildJson(input));
  else if (format === 'html') downloadText('trajectory-report.html', 'text/html;charset=utf-8', buildHtml(input));
  else if (format === 'png') await exportPng(input.element, 'trajectory-dashboard.png');
}

/* ---- Markdown --------------------------------------------------------- */

function buildMarkdownBase(input: ExportInput): string {
  const { analytics, timeline, stats, alerts } = input;
  const lines: string[] = [];
  const metric = (id: string) => analytics?.metricResults?.find((item) => item.metricId === id);
  lines.push('# 轨迹分析报告');
  lines.push('');
  lines.push(`- 会话：${input.sessionId ?? '当前会话'}`);
  lines.push(`- 导出时间：${formatDateTime(Date.now())}`);
  if (timeline?.model) lines.push(`- 模型：${timeline.provider ?? '—'} / ${timeline.model}`);
  lines.push(`- 轮次 / 步骤：${analytics?.turnsEnded ?? 0} / ${analytics?.stepsEnded ?? 0}`);
  if (stats) lines.push(`- 模型耗时 / 工具耗时：${formatMs(stats.llmMs)} / ${formatMs(stats.toolMs)}`);
  lines.push('');
  lines.push('## 关键指标');
  lines.push('');
  lines.push('| 指标 | 值 |');
  lines.push('| --- | --- |');
  const inputTokens = analytics?.inputTokens ?? 0;
  const window = timeline?.contextWindow ?? null;
  const currentContext = currentContextOf(timeline);
  const utilization = window !== null && window > 0 && currentContext > 0 ? currentContext / window : null;
  lines.push(`| 输入 Token（未缓存累计） | ${formatFull(inputTokens)} |`);
  if (window !== null) lines.push(`| 上下文窗口 | ${formatFull(window)} |`);
  if (utilization !== null) lines.push(`| 当前窗口占用 | ${formatPercent(utilization)} |`);
  lines.push(`| 输出 Token | ${formatFull(stats?.decodeTokens ?? 0)} |`);
  lines.push(`| 工具调用 / 错误 | ${analytics?.toolCalls ?? 0} / ${analytics?.toolErrors ?? 0} |`);
  lines.push(`| 压缩次数 | ${timeline?.compactionTotals?.count ?? 0} |`);
  lines.push(`| 消息记录（累计） | ${timeline?.injectionTotals?.count ?? 0} |`);
  if (analytics) {
    lines.push('', '## 指标明细', '', '| 指标 | 值 |', '| --- | --- |');
    for (const result of analytics.metricResults) {
      if (result.metricId === 'model.step_to_first_chunk_ms' && result.status !== 'available') continue;
      lines.push(`| ${METRIC_LABELS[result.metricId] ?? result.metricId} | ${formatMetricValue(result.value)} |`);
    }
  }
  if (timeline) {
    lines.push('');
    lines.push('## 上下文组成（估算）');
    lines.push('');
    lines.push('| 分区 | Token | 占比 |');
    lines.push('| --- | --- | --- |');
    const total = timeline.surface.totalTokens;
    const segmentRows: Array<[string, number]> = [
      ['系统提示', timeline.surface.systemPrompt],
      ['对话消息', timeline.surface.conversation],
      ['工具定义', timeline.surface.toolDefinitions],
      ['文件内容', timeline.surface.fileContents],
      ['工具结果', timeline.surface.toolResults],
      ['压缩摘要', timeline.surface.compactionSummary],
      ['其他', timeline.surface.other],
    ];
    for (const [label, tokens] of segmentRows) {
      lines.push(`| ${label} | ${formatFull(tokens)} | ${total > 0 ? ((tokens / total) * 100).toFixed(1) : '0.0'}% |`);
    }
    if (timeline.compactions.length > 0) {
      lines.push('');
      lines.push('## 压缩事件');
      lines.push('');
      lines.push('| 类型 | 时间 | 回收 Token | 回收比 | 耗时 |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const compaction of timeline.compactions.slice().reverse()) {
        lines.push(`| ${compaction.kind === 'summary' ? '摘要压缩' : '历史修剪'} | ${formatDateTime(compaction.timeMs)} | ${compaction.reclaimedTokens === null ? '—' : formatFull(compaction.reclaimedTokens)} | ${compaction.reclaimRatio === null ? '—' : formatPercent(compaction.reclaimRatio)} | ${compaction.elapsedMs === null ? '—' : formatMs(compaction.elapsedMs)} |`);
      }
    }
    if (timeline.injections.length > 0) {
      lines.push('');
      lines.push('## 注入事件（最近）');
      lines.push('');
      lines.push('| 类型 | 来源 | Token |');
      lines.push('| --- | --- | --- |');
      const kindLabel: Record<string, string> = { user: '用户消息', 'tool-result': '工具结果', system: '系统消息', developer: '开发者消息' };
      for (const injection of timeline.injections.slice().reverse().slice(0, 20)) {
        lines.push(`| ${kindLabel[injection.kind] ?? injection.kind} | ${injection.sourceKind} | ${formatFull(injection.tokens)} |`);
      }
    }
  }
  if (alerts.length > 0) {
    lines.push('');
    lines.push('## 智能告警');
    lines.push('');
    for (const alert of alerts) {
      const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵';
      lines.push(`### ${icon} ${alert.rule}`);
      lines.push('');
      lines.push(alert.detail);
      lines.push('');
      lines.push(`> 建议：${alert.suggestion}`);
      lines.push('');
    }
  } else {
    lines.push('');
    lines.push('## 智能告警');
    lines.push('');
    lines.push('无触发的告警。');
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('组成与注入 Token 为启发式估算（与 dsh-token-meter 同一算法，`CHARS_PER_TOKEN=4`）；精确账目以服务商 usage 为准。');
  return lines.join('\n');
}

/* ---- JSON ------------------------------------------------------------ */

export function buildJson(input: ExportInput): string {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    sessionId: input.sessionId,
    template: input.template ?? 'detailed',
    comparison: input.comparison ?? [],
    analytics: input.analytics ?? null,
    timeline: input.timeline ?? null,
    stats: input.stats ?? null,
    alerts: input.alerts,
    estimator: { kind: 'dsh-token-meter-mirror', charsPerToken: 4, blockOverhead: 4 },
  }, null, 2);
}

/* ---- PNG ------------------------------------------------------------- */

export async function exportPng(element: HTMLElement | null, filename: string): Promise<void> {
  if (element === null) return;
  const svg = element.querySelector('svg');
  if (svg === null || typeof XMLSerializer === 'undefined' || typeof Image === 'undefined') {
    throw new Error('当前视图没有可导出的图表，请切换至上下文演化或工具分布。');
  }
  const clone = svg.cloneNode(true) as SVGElement;
  // Resolve CSS variables/currentColor before the SVG leaves the live document.
  const originals = [svg, ...svg.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  originals.forEach((node, index) => {
    const copy = copies[index];
    if (!copy || typeof getComputedStyle !== 'function') return;
    const computed = getComputedStyle(node);
    for (const property of ['fill','stroke','stroke-width','stroke-dasharray','color','font-size','font-family','font-weight','opacity']) copy.setAttribute(property, computed.getPropertyValue(property));
    if (node.localName === 'text') { copy.setAttribute('fill', '#333333'); copy.setAttribute('color', '#333333'); }
  });
  const box = svg.getBoundingClientRect();
  const width = Math.max(320, Math.round(box.width || 720));
  const height = Math.max(160, Math.round(box.height || 400));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const background = '#ffffff';
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width','100%');rect.setAttribute('height','100%');rect.setAttribute('fill',background);clone.insertBefore(rect,clone.firstChild);
  const serialized = new XMLSerializer().serializeToString(clone);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('SVG rasterization failed'));
    image.src = svgUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas 2d context unavailable');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(2, 0, 0, 2, 0, 0);
  context.drawImage(image, 0, 0, width, height);
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob === null) throw new Error('canvas toBlob failed');
  downloadBlob(blob, filename);
}

/* ---- Standalone HTML -------------------------------------------------- */

/* ---- download / clipboard helpers ------------------------------------- */

export function downloadText(filename: string, mime: string, text: string): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Clipboard write with a selection-based fallback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function reportSections(input: ExportInput): ReportSection[] {
  if (input.template === 'custom') return input.sections ?? ['summary'];
  if (input.template === 'brief') return ['summary','charts'];
  if (input.template === 'team') return ['summary','charts','comparison','alerts'];
  return ['summary','charts','details','alerts'];
}
export function buildMarkdown(input: ExportInput): string {
  const sections=reportSections(input);
  const base=buildMarkdownBase(input).split('\n');
  const kept:string[]=[];let keep=true;
  for(const line of base){
    if(line.startsWith('## ')) keep=sections.includes(line.includes('关键指标')?'summary':line.includes('智能告警')?'alerts':'details');
    if(line==='---') keep=true;
    if(keep)kept.push(line);
  }
  kept[0]=`# ${input.title?.trim()||'轨迹分析报告'}`;
  if(sections.includes('charts')){
    kept.push('\n## 图表数据\n','| 请求 | 上下文占用 Token（含缓存读） |\n| --- | --- |');
    const samples=input.timeline?.steps??[];
    for(const [index,step] of samples.entries()) { if(input.template==='brief'&&index!==samples.length-1&&index%Math.max(1,Math.ceil(samples.length/10))!==0)continue;kept.push(`| ${index+1} | ${step.inputTokens+(step.cacheReadTokens??0)} |`); }
    kept.push('\nHTML、PDF 报告包含对应可视化图表；以上为保留请求样本。');
  }
  if(sections.includes('comparison')){
    const sessions=input.comparison??[];
    kept.push('\n## 多会话对比与建议\n');
    if(sessions.length<2)kept.push('请先在对比分析中选择 2–4 个会话并开始对比，再导出团队报告。');
    else {
      kept.push('| 会话 | 输入 Token | 输出 Token | 工具调用 | 工具错误 |\n| --- | --- | --- | --- | --- |');
      for(const session of sessions) kept.push(`| ${session.title.replaceAll('|','\\|').replaceAll('\n',' ')} | ${session.analytics?.inputTokens??'数据不可用'} | ${session.stats?.decodeTokens??'数据不可用'} | ${session.analytics?.toolCalls??'数据不可用'} | ${session.analytics?.toolErrors??'数据不可用'} |`);
      kept.push(...comparisonSummaryForReport(sessions));
      kept.push('最佳实践：在任务规模、模型与完成质量相同的前提下，复现较低消耗会话的工具和压缩配置；资源消耗不代表任务质量。');
    }
  }
  kept.push('\n数据范围：宿主当前可读取的聚合指标与有界历史投影；不等同于完整原始事件日志。');
  return kept.join('\n');
}
// Kept as a direct import so the report and comparison use identical metric semantics.
import { comparisonSummary as comparisonSummaryForReport } from './tab-compare.js';

export function reportChartSvg(input:ExportInput):string {
  const steps=input.timeline?.steps??[];
  if(!steps.length)return '<p>上下文演化：数据不可用。</p>';
  const points=steps.map((step,index)=>({x:index,y:step.inputTokens+(step.cacheReadTokens??0)}));
  const max=Math.max(1,...points.map((point)=>point.y));
  const sampled=points.filter((_,index)=>index===0||index===points.length-1||index%Math.max(1,Math.ceil(points.length/180))===0);
  const polyline=sampled.map((point)=>`${50+point.x/Math.max(1,points.length-1)*640},${205-point.y/max*160}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 250" role="img" aria-label="上下文演化图"><rect width="720" height="250" fill="white"/><text x="50" y="24" font-size="15" fill="#202124">上下文演化 · 含缓存读</text><path d="M50 42V205H695" fill="none" stroke="#aaa"/><text x="5" y="52" font-size="11" fill="#555">${formatTokens(max)}</text><text x="50" y="230" font-size="12" fill="#555">请求 1 → ${steps.length}</text><polyline points="${polyline}" fill="none" stroke="#4285f4" stroke-width="2"/></svg>`;
}
export function buildHtml(input:ExportInput):string {
  const markdown=buildMarkdown(input);
  let table=false;let html='';
  for(const line of markdown.split('\n')){
    if(line.startsWith('|')){
      if(/^\|[\s|:-]+$/.test(line))continue;
      if(!table){html+='<table>';table=true;}
      html+=`<tr>${line.slice(1,-1).split(/(?<!\\)\|/).map((cell)=>`<td>${escapeHtml(cell.trim().replaceAll('\\|','|'))}</td>`).join('')}</tr>`;continue;
    }
    if(table){html+='</table>';table=false;}
    const heading=line.match(/^(#{1,3}) (.*)/);
    html+=heading?`<h${heading[1]!.length}>${escapeHtml(heading[2]!)}</h${heading[1]!.length}>`:line.trim()?`<p>${escapeHtml(line)}</p>`:'';
  }
  if(table)html+='</table>';
  if(reportSections(input).includes('charts'))html=html.replace('<h2>图表数据</h2>', `${reportChartSvg(input)}<h2>图表样本</h2>`);
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title||'轨迹分析报告')}</title><style>body{margin:0;background:#fff;color:#202124;font:14px/1.65 system-ui,"PingFang SC",sans-serif}main{max-width:1000px;padding:28px;margin:auto}h1{font-size:24px}h2{font-size:18px;margin-top:28px}h3{font-size:15px}p,td{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:12px}td{padding:7px;border-bottom:1px solid #ddd}tr:first-child{background:#f1f4f8;font-weight:600}svg{width:100%;max-height:320px}footer{margin-top:24px;color:#666}@media print{body{font-size:10pt}h2,h3{break-after:avoid}tr,svg{break-inside:avoid}main{padding:0}}</style></head><body><main>${html}<footer>只读分析快照 · 由 dsh-eval-control 生成</footer></main></body></html>`;
}

/** Chinese glyphs are rasterized by the browser; PDF needs no external font service. */
export async function buildPdf(input:ExportInput):Promise<Blob> {
  const width=1190,height=1684,margin=80,lineHeight=30,bodyWidth=width-margin*2;
  const pages:HTMLCanvasElement[]=[];let canvas:HTMLCanvasElement;let ctx:CanvasRenderingContext2D;let y=margin;
  const font=(size=22,bold=false)=>`${bold?'600 ':''}${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  const next=()=>{canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;ctx=canvas.getContext('2d')!;if(!ctx)throw Error('无法创建 PDF 画布');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#202124';ctx.font=font();y=margin;pages.push(canvas);};
  const wrap=(text:string,available:number)=>{const lines:string[]=[];let line='';for(const character of text){if(ctx!.measureText(line+character).width>available&&line){lines.push(line);line='';}line+=character;}lines.push(line);return lines;};
  const text=(value:string,size=22,bold=false)=>{ctx!.font=font(size,bold);for(const line of wrap(value,bodyWidth)){if(y>height-margin-45)next();ctx!.font=font(size,bold);ctx!.fillStyle='#202124';ctx!.fillText(line,margin,y);y+=bold?42:lineHeight;}};
  let tableHeader:string[]|null=null;
  const tableRow=(cells:string[],header=false)=>{
    ctx!.font=font(20,header);const columnWidth=bodyWidth/cells.length;const lines=cells.map((cell)=>wrap(cell,columnWidth-24));
    const count=Math.max(...lines.map((cell)=>cell.length));
    for(let offset=0;offset<count;offset+=36){
      const part=Math.min(36,count-offset);const rowHeight=part*27+18;
      if(y+rowHeight>height-margin-45){next();if(tableHeader&&!header)tableRow(tableHeader,true);}
      ctx!.font=font(20,header);
      if(header){ctx!.fillStyle='#edf2fa';ctx!.fillRect(margin,y-22,bodyWidth,rowHeight);}
      ctx!.strokeStyle='#d9dee5';ctx!.beginPath();ctx!.moveTo(margin,y-22+rowHeight);ctx!.lineTo(width-margin,y-22+rowHeight);ctx!.stroke();
      ctx!.fillStyle='#202124';for(let column=0;column<cells.length;column++)for(let row=0;row<part;row++){const line=lines[column]?.[offset+row];if(line)ctx!.fillText(line,margin+columnWidth*column+12,y+row*27);}
      y+=rowHeight;
    }
  };
  const chart=async()=>{
    if(!input.timeline?.steps.length){text('上下文演化：数据不可用。');return;}
    if(y>height-margin-410)next();
    const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('PDF 图表渲染失败'));image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(reportChartSvg(input))}`;});
    ctx!.drawImage(image,margin,y,bodyWidth,350);y+=370;
  };
  next();let skippingChartTable=false;
  for(const source of buildMarkdown(input).split('\n')){
    if(source==='## 图表数据'){tableHeader=null;skippingChartTable=true;await chart();continue;}
    if(skippingChartTable){if(!source.startsWith('## '))continue;skippingChartTable=false;}
    if(source.startsWith('|')){
      if(/^\|[\s|:-]+$/.test(source))continue;
      const cells=source.slice(1,-1).split(/(?<!\\)\|/).map((cell)=>cell.trim().replaceAll('\\|','|'));
      const header=tableHeader===null;if(header)tableHeader=cells;tableRow(cells,header);continue;
    }
    tableHeader=null;
    const heading=source.match(/^(#{1,3}) (.*)/);
    if(!source.trim()){y+=10;continue;}
    if(source==='---')continue;
    if(heading){if(y>height-margin-130)next();text(heading[2]!,heading[1]!.length===1?34:27,true);}
    else text(source.replaceAll('**','').replaceAll('`',''));
  }
  text('数据范围：宿主当前可读取的聚合指标与有界历史投影。',18);
  const images=pages.map((page,index)=>{const context=page.getContext('2d')!;context.fillStyle='#666';context.font='18px sans-serif';context.fillText(`${index+1} / ${pages.length}`,width-margin-75,height-40);return Uint8Array.from(atob(page.toDataURL('image/jpeg',.94).split(',')[1]!),character=>character.charCodeAt(0));});
  return pdfFromJpegs(images,width,height);
}
export function pdfFromJpegs(images:Uint8Array[],width:number,height:number):Blob {
  const encoder=new TextEncoder();const chunks:Uint8Array[]=[];const offsets=[0];let length=0;
  const add=(value:string|Uint8Array)=>{const bytes=typeof value==='string'?encoder.encode(value):value;chunks.push(bytes);length+=bytes.length;};
  const object=(id:number,body:string)=>{offsets[id]=length;add(`${id} 0 obj\n${body}\nendobj\n`);};
  add('%PDF-1.4\n');object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,`<< /Type /Pages /Count ${images.length} /Kids [${images.map((_,index)=>`${3+index*3} 0 R`).join(' ')}] >>`);
  images.forEach((image,index)=>{
    const id=3+index*3;object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    offsets[id+1]=length;add(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);add(image);add('\nendstream\nendobj\n');
    const commands='q 595 0 0 842 0 0 cm /Im0 Do Q';object(id+2,`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`);
  });
  const xref=length;const xrefEol=String.fromCharCode(32,10);add(`xref\n0 ${offsets.length}\n0000000000 65535 f${xrefEol}`);for(const offset of offsets.slice(1))add(`${String(offset).padStart(10,'0')} 00000 n${xrefEol}`);
  add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks as BlobPart[],{type:'application/pdf'});
}
