import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiagnosticConfig } from '../src/diagnostic_config.js';

function fixture() {
  const entry = { fiber: {state:2}, options: { id: 'compact', name: '@deepseek-ai/dsh-compaction-basic', config: {thresholdRatio: .8, retainRatio: .16, headroomTokens: 4000, modelPolicies: [{provider:'test', model:'a', thresholdRatio:.9}]} as Record<string, unknown> } };
  let writes = 0;
  const editor = {documentPath:'/profile/cordis.yml',configuration:()=>[{entry}],entries:()=>[entry],edit:async (_entry:unknown,change:(current:Record<string,unknown>)=>Record<string,unknown>)=>{entry.options.config=change(entry.options.config);writes++;}};
  const service = Object.create(DiagnosticConfig.prototype) as DiagnosticConfig;
  Object.defineProperty(service,'ctx',{value:{get:()=>editor}});
  return {service,entry,writes:()=>writes};
}
test('diagnostic config reports real path and applies only verified fields preserving other config',async()=>{
 const {service,entry,writes}=fixture();assert.equal(service.describe().path,'/profile/cordis.yml');
 await service.apply('compact',JSON.stringify(entry.options.config),.7);
 assert.equal(writes(),1);assert.equal(entry.options.config.auto,true);assert.equal(entry.options.config.headroomTokens,4000);
 assert.deepEqual(entry.options.config.modelPolicies,[{provider:'test',model:'a',thresholdRatio:.7}]);
});
test('diagnostic config rejects stale, unknown and invalid writes',async()=>{
 const {service,entry,writes}=fixture();
 await assert.rejects(service.apply('compact','{}',.7),/其他操作/);
 await assert.rejects(service.apply('other',JSON.stringify(entry.options.config),.7),/不存在/);
 await assert.rejects(service.apply('compact',JSON.stringify(entry.options.config),NaN),/0.2/);
 entry.options.config.retainRatio=.75;
 await assert.rejects(service.apply('compact',JSON.stringify(entry.options.config),.7),/保留比例/);
 assert.equal(writes(),0);
});

test('preset-owned nested group config is writable without altering other plugins',async()=>{
 const {service,entry}=fixture();entry.options.name='@deepseek-ai/dsh-agent-preset';entry.options.id='preset-standard';
 entry.options.config={id:'standard',plugins:[{name:'cordis:group',config:[{name:'@deepseek-ai/dsh-compaction-basic',config:{retainRatio:.2}},{name:'other',config:{keep:true}}]}]};
 const described=service.describe();assert.equal(described.entries[0]?.id,'preset-standard::0.0');
 await service.apply('preset-standard::0.0',JSON.stringify({retainRatio:.2}),.7);
 assert.match(JSON.stringify(entry.options.config),/"thresholdRatio":0.7/);assert.match(JSON.stringify(entry.options.config),/"keep":true/);
 await assert.rejects(service.apply('preset-standard::0.1','{}',.7),/目标已变化/);
});
