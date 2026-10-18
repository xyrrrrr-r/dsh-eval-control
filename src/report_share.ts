import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-app-boot';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface SharedReport { html:string; createdAt:number; expiresAt:number|null; salt:string|null; passwordHash:string|null }
export function passwordMatches(report:SharedReport,password:string):boolean {
  if (!report.passwordHash || !report.salt) return true;
  const actual=scryptSync(password,report.salt,32);
  return timingSafeEqual(actual,Buffer.from(report.passwordHash,'hex'));
}
export function newSharedReport(html:string,days:number,password:string,now=Date.now()):SharedReport {
  if (![0,7,30].includes(days)) throw new Error('有效期必须为 7 天、30 天或永久');
  if (typeof html!=='string'||Buffer.byteLength(html)>2_000_000||html.length===0) throw new Error('报告必须非空且小于 2 MB');
  if (typeof password!=='string'||password.length>128||password.length>0&&password.length<8) throw new Error('分享密码须为 8–128 个字符');
  const salt=password?randomBytes(16).toString('hex'):null;
  return {html,createdAt:now,expiresAt:days===0?null:now+days*86400000,salt,passwordHash:salt?scryptSync(password,salt,32).toString('hex'):null};
}
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const page=(body:string)=>`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>轨迹分析 · 只读分享</title><style>body{margin:0;font:14px/1.6 system-ui;background:#f7f8fa;color:#202124}header,form,main{padding:20px}iframe{border:0;width:100%;height:calc(100vh - 76px);background:white}input,button{font:inherit;padding:8px;margin:8px}p{max-width:700px}</style>${body}</html>`;

/** Public bearer links only serve isolated snapshots; creation remains authenticated Gateway RPC. */
export class ReportShare extends TypertRemoteService {
  private attempts=new Map<string,{at:number;count:number}>();
  constructor(ctx:Context) {
    super(ctx,'trajectorySharing');
    ctx.inject(['webServer'],(scope)=>scope.effect(()=>scope.webServer.register({kind:'prefix',path:'/trajectory-share',handler:(req,res)=>this.serve(req,res)})));
  }
  private directory() {
    const profile=this.ctx.get('profileContext');
    if (!profile) throw new Error('当前宿主没有本地 profile 存储');
    return join(profile.dir,'trajectory-shares');
  }
  @Remote
  async create(html:string,days:number,password:string) {
    if (!this.ctx.get('webServer')) throw new Error('当前宿主未启用 HTTP 分享服务');
    const report=newSharedReport(html,days,password);
    const directory=this.directory();await mkdir(directory,{recursive:true,mode:0o700});
    const files=(await readdir(directory)).filter((file)=>/^[a-f0-9]{48}\.json$/.test(file));
    for (const file of files) {
      try {const old=JSON.parse(await readFile(join(directory,file),'utf8')) as SharedReport;if (old.expiresAt!==null&&old.expiresAt<Date.now()-86400000) await unlink(join(directory,file));} catch { /* ignore unrelated damaged files */ }
    }
    if ((await readdir(directory)).length>=100) throw new Error('分享快照已达 100 份，请先删除不再使用的分享');
    const id=randomBytes(24).toString('hex');
    await writeFile(join(directory,`${id}.json`),JSON.stringify(report),{mode:0o600,flag:'wx'});
    return {path:`/trajectory-share/${id}`,expiresAt:report.expiresAt,protected:!!password};
  }
  @Remote
  async revoke(id:string) {
    if (!/^[a-f0-9]{48}$/.test(id)) throw new Error('无效的分享标识');
    await unlink(join(this.directory(),`${id}.json`)).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});
    return {revoked:true};
  }
  async serve(req:IncomingMessage,res:ServerResponse):Promise<void> {
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-src 'self' about:; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (!['GET','POST','HEAD'].includes(req.method??'')) {res.writeHead(405,{Allow:'GET, POST, HEAD'});res.end();return;}
    const pathname=new URL(req.url??'/', 'http://localhost').pathname;
    const id=pathname.match(/^\/trajectory-share\/([a-f0-9]{48})$/)?.[1];
    if(!id){res.statusCode=404;res.end(page('<main>分享链接无效或不存在。</main>'));return;}
    let report:SharedReport;
    try {report=JSON.parse(await readFile(join(this.directory(),`${id}.json`),'utf8')) as SharedReport;} catch {res.statusCode=404;res.end(page('<main>分享链接无效、已撤销或不存在。</main>'));return;}
    if(typeof report.html!=='string'||typeof report.createdAt!=='number'||report.expiresAt!==null&&typeof report.expiresAt!=='number'||report.passwordHash!==null&&(!/^[a-f0-9]{64}$/.test(report.passwordHash)||typeof report.salt!=='string')){res.statusCode=500;res.end(page('<main>分享报告已损坏，请联系分享者重新生成。</main>'));return;}
    if(report.expiresAt!==null&&report.expiresAt<=Date.now()){res.statusCode=410;res.end(page('<main>链接已过期，请联系分享者重新生成。</main>'));return;}
    if(req.method==='HEAD'){res.end();return;}
    if(report.passwordHash){
      const key=`${id}:${req.socket.remoteAddress}`;const attempt=this.attempts.get(key);
      if(attempt&&Date.now()-attempt.at<60000&&attempt.count>=10){res.statusCode=429;res.end(page('<main>尝试次数过多，请一分钟后重试。</main>'));return;}
      let password='';
      if(req.method==='POST'){
        let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>2048){res.statusCode=413;res.end();return;}}
        password=new URLSearchParams(body).get('password')??'';
      }
      if(req.method!=='POST'||!passwordMatches(report,password)){
        if(req.method==='POST'){
          if(this.attempts.size>1000)this.attempts.clear();
          this.attempts.set(key,{at:attempt&&Date.now()-attempt.at<60000?attempt.at:Date.now(),count:attempt&&Date.now()-attempt.at<60000?attempt.count+1:1});res.statusCode=403;
        }
        res.end(page(`<form method="post"><h1>密码保护的分析报告</h1><p>${req.method==='POST'?'密码错误，请重试。':'请输入分享者提供的密码。'}</p><label>访问密码<input type="password" name="password" required maxlength="128" autocomplete="off"></label><button>查看只读报告</button></form>`));return;
      }
      this.attempts.delete(key);
    }
    res.end(page(`<header>轨迹分析 · 只读快照 · ${report.expiresAt?`有效期至 ${new Date(report.expiresAt).toISOString()}`:'永久有效（宿主可用期间）'}</header><iframe title="只读分析报告" sandbox="" srcdoc="${escape(report.html)}"></iframe>`));
  }
}
