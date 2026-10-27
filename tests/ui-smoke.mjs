import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const bundle=fs.readFileSync(new URL('preview.html',root),'utf8').split('<script>')[1].split('</script>')[0];
const seed=JSON.parse(fs.readFileSync(new URL('dist/conferences.json',root),'utf8'));
const instant='2026-10-27T03:00:00Z';
class Clock extends Date{constructor(...args){super(...(args.length?args:[instant]));}static now(){return Date.parse(instant);}}
const makePayload=(items=seed)=>({schemaVersion:1,mode:'github-actions',seedDate:'2026-10-27',conferences:items.map((c,i)=>({...c,syncStatus:i?'stale':'fresh',lastChecked:i?undefined:instant})),status:'partial',freshCount:1,totalCount:items.length,attemptedAt:instant,generatedAt:instant});
async function run({protocol='https:',fail=false,cache=false,payload=makePayload()}={}){
 const nodes=new Map();
 const get=s=>{if(!nodes.has(s))nodes.set(s,{textContent:'',innerHTML:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},append(){},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(s);};
 const storage=new Map();if(cache)storage.set('comm-pages-data-v1',JSON.stringify(makePayload(seed.map(c=>({...c,deadline:c.id==='secon-2027'?'2026-12-07':c.deadline})))));
 let calls=0;const urls=[];const handlers={};
 const context={console,Date:Clock,Intl,Set,Map,JSON,Number,String,Array,Object,URL,Blob,AbortController,TextEncoder,clearTimeout(){},setTimeout(){return 1;},setInterval(){},location:{protocol},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{querySelector:get,querySelectorAll:()=>[],addEventListener(){},activeElement:{tagName:'BODY'}},fetch:async(url,options)=>{calls++;urls.push(new URL(url,'https://defaultvalues.github.io/wireless_conference_info/').href);assert.match(url,/^\.\/data\/latest\.json\?t=\d+$/);assert.equal(options.cache,'no-store');if(fail)throw new Error('offline');return {ok:true,json:async()=>payload};}};
 context.window={addEventListener:(type,fn)=>handlers[type]=fn};vm.runInNewContext(bundle,context);await new Promise(resolve=>setImmediate(resolve));
 return {nodes,storage,handlers,get,urls,calls:()=>calls};
}
test('Opening Pages reads a relative JSON URL, without a backend or token',async()=>{const ui=await run();assert.equal(ui.calls(),1);assert.match(ui.urls[0],/^https:\/\/defaultvalues.github.io\/wireless_conference_info\/data\/latest.json/);assert.match(ui.get('#sync-title').textContent,/1 \/ 9/);assert.match(ui.get('#results').innerHTML,/历史数据 · 上轮未确认/);assert.ok(ui.storage.has('comm-pages-data-v1'));ui.get('#refresh').onclick();await new Promise(r=>setImmediate(r));assert.equal(ui.calls(),2);});
test('Network failure preserves cached extended deadline and original check timestamp',async()=>{const ui=await run({fail:true,cache:true});assert.match(ui.get('#sync-title').textContent,/无法读取/);assert.match(ui.get('#results').innerHTML,/2026.12.07/);assert.match(ui.get('#stat-sync-time').textContent,/2026/);assert.equal(ui.get('#refresh').disabled,false);});
test('Offline preview directs users to hosted site, not a local service',async()=>{const ui=await run({protocol:'file:'});assert.equal(ui.calls(),0);assert.match(ui.get('#sync-title').textContent,/离线预览/);assert.match(ui.get('#sync-description').textContent,/defaultvalues.github.io/);assert.doesNotMatch(ui.get('#sync-description').textContent,/npm start|启动网站.sh/);});
test('Browser back-forward cache restoration reloads published data',async()=>{const ui=await run();ui.handlers.pageshow({persisted:true});await new Promise(r=>setImmediate(r));assert.equal(ui.calls(),2);});
test('Newly added conferences are accepted without a frontend redeploy',async()=>{const more=[...seed,{...seed[0],id:'extra-2027',name:'Extra 2027'}];const ui=await run({payload:makePayload(more)});assert.match(ui.get('#results').innerHTML,/Extra 2027/);});
test('Old successful jobs cannot look like current successful updates',async()=>{const payload=makePayload();payload.attemptedAt='2026-10-26T00:00:00Z';payload.generatedAt=payload.attemptedAt;const ui=await run({payload});assert.match(ui.get('#sync-title').textContent,/超过 3 小时/);});
test('Invalid external URLs are rejected rather than inserted into HTML',async()=>{const payload=makePayload();payload.conferences[0].url='javascript:alert(1)';const ui=await run({payload});assert.match(ui.get('#sync-title').textContent,/无法读取/);assert.doesNotMatch(ui.get('#results').innerHTML,/javascript:/);});
test('All source failures are distinct from a failure to load published JSON',async()=>{const payload=makePayload();payload.status='offline';payload.conferences.forEach(c=>c.syncStatus='stale');const ui=await run({payload});assert.match(ui.get('#sync-title').textContent,/官网检查失败/);});
