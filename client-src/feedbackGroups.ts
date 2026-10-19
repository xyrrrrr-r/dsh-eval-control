import type { ContextTimeline } from './types.js';
type Message=ContextTimeline['injections'][number];
/** A result belongs after the previous request and before the next request. */
export function groupFeedback(messages:Message[],requests:Array<{seq:number}>,failed:Set<number>):Message[][] {
  const anchors=requests.slice().sort((a,b)=>a.seq-b.seq);
  const groups=new Map<number,Message[]>();
  for(const message of messages.slice().sort((a,b)=>a.seq-b.seq)){
    if(failed.has(message.seq))continue;
    let lo=0,hi=anchors.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(anchors[mid]!.seq<=message.seq)lo=mid+1;else hi=mid;}
    const group=groups.get(lo)??[];group.push(message);groups.set(lo,group);
  }
  return [...groups.values()];
}
export function feedbackSummary(group:Message[]):string {
  const total=group.reduce((sum,row)=>sum+row.tokens,0);
  const tools=new Map<string,number>();
  for(const row of group)tools.set(row.toolName??'未知工具',(tools.get(row.toolName??'未知工具')??0)+row.tokens);
  const largest=group.reduce((a,b)=>a.tokens>=b.tokens?a:b);
  return `回填 ${group.length} 次 · 约 ${total.toLocaleString()} Token · ${[...tools].sort((a,b)=>b[1]-a[1]).map(([name,tokens])=>`${name} ${tokens.toLocaleString()} Token`).join('；')} · 最大结果 #${largest.seq}（${largest.tokens.toLocaleString()} Token）`;
}
