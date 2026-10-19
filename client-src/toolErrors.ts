import type { RawEvent } from './evidencePanel.js';
export interface ToolFailure {name:string;callId:string;callSeq?:number|undefined;resultSeq:number;excerpt:string;analysis:string}
export function analyzeToolError(text:string):string {
  const rules:Array<[RegExp,string]>=[
    [/permission denied|EACCES|EPERM|权限不足|拒绝访问/i,'权限限制：当前进程可能没有访问文件或执行操作的权限；核对目标路径和运行身份。'],
    [/ENOENT|no such file|not found|不存在/i,'目标不可用：可能是文件路径、命令或资源不存在；核对调用参数及工作目录。'],
    [/timed?\s*out|ETIMEDOUT|超时/i,'执行超时：可能是工具耗时过长或上游响应缓慢；核对耗时和服务状态。'],
    [/ECONNREFUSED|ENOTFOUND|ECONNRESET|network|网络/i,'连接异常：可能是服务未启动、地址解析失败或连接中断；核对端点和网络状态。'],
    [/invalid|validation|schema|missing required|参数.*错误/i,'参数或格式不匹配：核对工具参数、必填字段及输入格式。'],
    [/exit code|exited.*[1-9]|non.zero/i,'子进程失败：非零退出状态说明命令执行失败，需结合标准错误输出定位具体原因。'],
  ];
  return rules.find(([pattern])=>pattern.test(text))?.[1]??'暂无法从返回内容确定原因；请核对原始错误、调用参数和运行环境。';
}
export function toolFailures(events:RawEvent[]):ToolFailure[] {
  const calls=new Map<string,{name:string;seq:number}>();const failures:ToolFailure[]=[];
  for(const raw of events){const e=raw as any;
    if(e.type==='tool/call')calls.set(String(e.data.callId),{name:e.data.name,seq:e.seq});
    if(e.type!=='tool/result'||e.data?.message?.isError!==true||e.surfaceOp?.op==='replace')continue;
    const callId=String(e.data.message.toolCallId);const call=calls.get(callId);
    const text=(e.data.message.content??[]).map((b:any)=>typeof b.text==='string'?b.text:JSON.stringify(b)).join('\n');
    failures.push({name:call?.name??'未知工具',callId,callSeq:call?.seq,resultSeq:e.seq,excerpt:text.slice(0,2000),analysis:analyzeToolError(text)});
  }
  return failures;
}
