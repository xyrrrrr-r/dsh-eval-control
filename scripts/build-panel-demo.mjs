/** Build a disposable viewer for README recordings. No host or private session is loaded. */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const runtime=process.env.PANEL_DEMO_RUNTIME;
if(!runtime)throw Error('Set PANEL_DEMO_RUNTIME to a node_modules directory containing react and react-dom (18.3.1).');
const out=resolve(process.argv[2]??'/tmp/dsh-panel-demo');await mkdir(out,{recursive:true});
await build({entryPoints:['docs/demo/panels/demo.ts'],bundle:true,format:'iife',outfile:join(out,'demo.js'),define:{'process.env.NODE_ENV':'"production"'},alias:{'react-dom':resolve(runtime,'react-dom'),'react':resolve(runtime,'react')},logLevel:'info'});
await writeFile(join(out,'index.html'),`<!doctype html><html lang="zh"><meta charset="utf-8"><title>DSH 轨迹分析 · 演示数据</title><style>html{color-scheme:light}body{margin:0;padding:18px 24px;background:#f5f7fb;color:#202124;font:14px/1.5 system-ui,"PingFang SC",sans-serif}main{max-width:1240px;background:#fff;border:1px solid #dfe4eb;border-radius:14px;padding:18px;box-sizing:border-box}header{max-width:1240px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}header strong{font-size:18px}header span{font-size:12px;color:#667085}button,select,input{font:inherit;color:inherit;border:1px solid #cdd5df;border-radius:5px;background:white;padding:3px 7px}button{cursor:pointer}button:disabled{opacity:.5}h4{margin:8px 0}td,th{overflow-wrap:anywhere}*{scrollbar-width:thin}#app{--dsh-eval-bg:#fff;--dsh-eval-surface:#fff;--dsh-eval-text:#202124}a{color:#1a73e8}</style><header><strong>DSH 轨迹分析面板</strong><span>演示数据 · 真实组件交互 · 不包含真实会话</span></header><main id="app"></main><script src="demo.js"></script></html>`);
console.log(`Viewer: ${out}/index.html`);
