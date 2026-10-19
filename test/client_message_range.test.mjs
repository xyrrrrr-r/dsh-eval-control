import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
const out=await build({stdin:{contents:"export {TokensTab} from './client-src/tab-tokens';export {bindReact} from './client-src/react-binding';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const {TokensTab,bindReact}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const nodes=t=>t&&typeof t==='object'?[t,...(t.children??[]).flat(Infinity).flatMap(nodes)]:[];
const text=t=>nodes(t).flatMap(n=>n.children.flat(Infinity).filter(v=>typeof v==='string')).join(' ');
test('defaults to all history with pagination, supports recent and custom sequence range',()=>{
 let cursor=0;const states=[];
 bindReact({createElement:(type,props,...children)=>({type,props:props??{},children}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useRef:()=>({current:null}),useEffect:()=>{},Fragment:'f'});
 const messages=Array.from({length:150},(_,i)=>({seq:i+1,timeMs:i*1000,kind:'user',sourceKind:'user',tokens:10,turn:1,textTokens:10,toolCallTokens:0,fileTokens:0,outputTokens:null,cumulativeTokens:(i+1)*10,preview:'',callId:null,callTool:null,toolName:null}));
 const props={data:{messages:messages.slice(-64),timeline:null,analytics:null,surfaceTotal:0,messageCapNote:true},history:{phase:'ready',messages,firstSeq:1,lastSeq:150}};
 const render=()=>{cursor=0;return TokensTab(props);};let tree=render();
 assert.match(text(tree),/显示 150 \/ 150 条/);assert.equal(nodes(tree).filter(n=>n.props.id?.startsWith('dsh-msg-row-')).length,100);
 nodes(tree).find(n=>n.props['aria-label']==='消息历史范围').props.onChange({target:{value:'recent'}});tree=render();assert.match(text(tree),/显示 100 \/ 100 条/);
 nodes(tree).find(n=>n.props['aria-label']==='消息历史范围').props.onChange({target:{value:'custom'}});tree=render();
 nodes(tree).find(n=>n.props['aria-label']==='起始事件序号').props.onInput({target:{value:'5'}});nodes(tree).find(n=>n.props['aria-label']==='结束事件序号').props.onInput({target:{value:'10'}});tree=render();assert.match(text(tree),/显示 6 \/ 6 条/);
 nodes(tree).find(n=>n.props['aria-label']==='起始事件序号').props.onInput({target:{value:'20'}});tree=render();assert.match(text(tree),/起始不能大于结束/);
});
