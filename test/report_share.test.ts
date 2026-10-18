import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {newSharedReport,passwordMatches,ReportShare} from '../src/report_share.js';
test('share validity and hashed passwords',()=>{
 const report=newSharedReport('<h1>test</h1>',7,'correct-password',1000);
 assert.equal(report.expiresAt,1000+7*86400000);assert.ok(passwordMatches(report,'correct-password'));assert.ok(!passwordMatches(report,'incorrect-password'));assert.ok(!JSON.stringify(report).includes('correct-password'));
 assert.equal(newSharedReport('x',0,'').expiresAt,null);assert.throws(()=>newSharedReport('x',1,''));assert.throws(()=>newSharedReport('x',7,'short'));
});
test('persistent public/password reports enforce expiration, revocation and isolated views',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'trajectory-share-'));const service=Object.create(ReportShare.prototype) as ReportShare;
 Object.defineProperty(service,'ctx',{value:{get:(key:string)=>key==='profileContext'?{dir:directory}:true}});Object.defineProperty(service,'attempts',{value:new Map()});
 const server=createServer((req,res)=>{void service.serve(req,res);});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address() as {port:number};const origin=`http://127.0.0.1:${address.port}`;
 try{
  const publicReport=await service.create('<h1>公开报告</h1><script>evil()</script>',7,'');let response=await fetch(origin+publicReport.path);assert.equal(response.status,200);const html=await response.text();assert.match(html,/sandbox=""/);assert.match(html,/&lt;script&gt;/);assert.match(response.headers.get('content-security-policy')!,/default-src 'none'/);
  const protectedReport=await service.create('<h1>secret</h1>',30,'correct-password');response=await fetch(origin+protectedReport.path);assert.match(await response.text(),/请输入分享者提供的密码/);
  response=await fetch(origin+protectedReport.path,{method:'POST',body:'password=wrong'});assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/srcdoc/);
  response=await fetch(origin+protectedReport.path,{method:'POST',body:'password=correct-password'});assert.equal(response.status,200);assert.match(await response.text(),/srcdoc/);
  const id=publicReport.path.split('/').pop()!;const file=join(directory,'trajectory-shares',`${id}.json`);const stored=JSON.parse(await readFile(file,'utf8'));stored.expiresAt=Date.now()-100;await writeFile(file,JSON.stringify(stored));
  response=await fetch(origin+publicReport.path);assert.equal(response.status,410);assert.match(await response.text(),/链接已过期/);
  await service.revoke(protectedReport.path.split('/').pop()!);response=await fetch(origin+protectedReport.path);assert.equal(response.status,404);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});}
});
