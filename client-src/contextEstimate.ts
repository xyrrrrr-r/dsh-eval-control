import type { RawEvent } from './evidencePanel.js';
export const ESTIMATE_PARTS = [
  ['body','消息正文','候选输入','用户及助手正文；实际发送范围取决于请求构建。'],
  ['reasoning','历史思考','依路由而定','部分适配器支持 thinking 重放；不能断言全部发送或全部排除。'],
  ['toolCalls','工具调用参数','候选输入','历史调用名称与参数；适配器可能转换参数格式。'],
  ['toolResults','工具结果正文','候选输入','工具结果文本；替换或修剪后的内容才计入当前表面。'],
  ['system','系统/开发者内容','依路由而定','适配器可能合并、提升角色或转换为系统更新。'],
  ['images','图片引用结构','非图片真实计价','这里只估算引用结构，图片处理后的输入用量无法由此确定。'],
  ['structure','消息及其他结构','估算开销','启发式结构开销，不等于服务商协议实际开销。'],
] as const;
export type EstimateParts=Record<(typeof ESTIMATE_PARTS)[number][0],number>;
export const emptyEstimate=():EstimateParts=>({body:0,reasoning:0,toolCalls:0,toolResults:0,system:0,images:0,structure:0});
export function estimateParts(event:RawEvent,total:number):EstimateParts {
  const e=event as any;const message=e.type==='user/message'?e.data:e.data?.message;
  const parts=emptyEstimate();
  if(!message)return parts;
  if(message.role==='system'||message.role==='developer'){parts.system=total;return parts;}
  for(const b of message.content??[]) {
    if(b.type==='reasoning')parts.reasoning+=Math.ceil(b.text.length/4)+4;
    else if(b.type==='text')parts[e.type==='tool/result'?'toolResults':'body']+=Math.ceil(b.text.length/4)+4;
    else if(b.type==='tool-call')parts.toolCalls+=Math.ceil(b.name.length/4)+Math.ceil(b.arguments.length/4)+4;
    else if(b.type==='image'){const {offloaded,...reference}=b;parts.images+=4+Math.ceil(JSON.stringify(reference).length/4);}
  }
  parts.structure=total-Object.values(parts).reduce((sum,n)=>sum+n,0);
  return parts;
}
