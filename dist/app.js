import {DAY,beijingDay,deadlineState,filterConferences,makeICS} from './core.js';
let data=window.CONFERENCES;
let syncState=window.PUBLISHED_SNAPSHOT||{status:'seed',freshCount:0,totalCount:data.length,attemptedAt:null,generatedAt:null};
let refreshing=false;
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const state={section:'upcoming',search:'',topic:'全部方向',type:'all',range:'all',sort:'deadline',view:'list'};
let saved=new Set();try{const v=JSON.parse(localStorage.getItem('comm-bookmarks-v1')||'[]');if(Array.isArray(v))saved=new Set(v.filter(id=>typeof id==='string'));}catch{}
const initialDay=beijingDay();let month=initialDay.slice(0,7);let visible=[];let toastTimer;
const topics=()=>['全部方向',...new Set(data.flatMap(c=>c.topics))];
const timeFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const formatChecked=iso=>Number.isFinite(Date.parse(iso))?timeFormat.format(new Date(iso)):'未刷新';
function validPayload(payload){
  if(!payload||payload.schemaVersion!==1||!Array.isArray(payload.conferences)||!payload.conferences.length||payload.conferences.length>2000)return false;
  if(!['seed','fresh','partial','offline'].includes(payload.status))return false;
  for(const key of ['attemptedAt','generatedAt'])if(payload[key]!==null&&!Number.isFinite(Date.parse(payload[key])))return false;
  const ids=new Set();
  for(const c of payload.conferences){
    if(typeof c.id!=='string'||!/^[-a-z0-9]+$/.test(c.id)||ids.has(c.id))return false;ids.add(c.id);
    if(!['name','fullName','description','location','note','source','url','start','end'].every(k=>typeof c[k]==='string')||!Array.isArray(c.topics)||!c.topics.every(t=>typeof t==='string'))return false;
    if(typeof c.verified!=='boolean'||!['main','workshop'].includes(c.type)||!['fresh','stale'].includes(c.syncStatus))return false;
    if(![c.url,c.source,c.extraSource].filter(Boolean).every(u=>{try{return ['http:','https:'].includes(new URL(u).protocol);}catch{return false;}}))return false;
    if(![c.start,c.end,c.deadline].filter(Boolean).every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d)))||c.deadlineAt&&!Number.isFinite(Date.parse(c.deadlineAt)))return false;
    if(c.lastChecked&&!Number.isFinite(Date.parse(c.lastChecked)))return false;
  }
  return true;
}
function showSync(){
  const banner=$('#sync-banner');
  const fresh=data.filter(c=>c.syncStatus==='fresh').length;
  const old=syncState.attemptedAt&&Date.now()-Date.parse(syncState.attemptedAt)>3*60*60*1000;
  const status=refreshing?'loading':syncState.status;
  banner.dataset.status=old&&!['loading','unavailable','local'].includes(status)?'partial':status;
  const titles={seed:'初始会议数据 · 等待首次云端更新',loading:'正在读取已发布的最新数据…',fresh:'最近一轮官网检查全部成功',partial:`最近一轮 ${fresh} / ${data.length} 场更新成功，其余保留历史数据`,offline:'最近一轮官网检查失败，保留历史数据',unavailable:'无法读取最新发布数据，正在显示已有快照',local:'离线预览 · 在线网站由 GitHub 自动更新'};
  $('#sync-title').textContent=old&&!['loading','unavailable','local'].includes(status)?'数据已超过 3 小时未更新，请核对官网':titles[status]||titles.unavailable;
  $('#sync-description').textContent=status==='local'?'正式网站无需本地启动。请访问 defaultvalues.github.io/wireless_conference_info/。':status==='loading'?'读取 GitHub Pages 上已发布的数据，不会触发官网抓取。':'GitHub Actions 计划每小时检查官网（可能延迟）；打开页面或点击刷新会读取最近一次发布结果。';
  $('#stat-sync').innerHTML=`${fresh}<em>/ ${data.length} 场</em>`;
  $('#stat-sync-time').textContent=syncState.attemptedAt?'官网检查 '+formatChecked(syncState.attemptedAt):'初始核查 '+window.DATA_UPDATED;
  $('#refresh').disabled=refreshing;$('#refresh').textContent=refreshing?'↻ 正在读取…':'↻ 读取最新数据';
}
async function refreshData(){
  if(refreshing)return;
  if(location.protocol==='file:'){syncState={...syncState,status:'local'};showSync();return;}
  refreshing=true;showSync();
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(`./data/latest.json?t=${Date.now()}`,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('Snapshot unavailable');
    const payload=await response.json();if(!validPayload(payload))throw new Error('Invalid response');
    data=payload.conferences;syncState=payload;
    try{localStorage.setItem('comm-pages-data-v1',JSON.stringify(payload));}catch{}
  }catch{
    syncState={...syncState,status:'unavailable'};
  }finally{clearTimeout(timeout);refreshing=false;showSync();render();}
}
try{
  const cached=JSON.parse(localStorage.getItem('comm-pages-data-v1')||'null');
  if(validPayload(cached)&&Date.parse(cached.generatedAt)> (Date.parse(syncState.generatedAt)||0)){data=cached.conferences;syncState=cached;}
}catch{}
const names={upcoming:'即将截稿',saved:'我的收藏',pending:'待核实',past:'已截止'};
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
function dateRange(c){return `${c.start.replaceAll('-','.')} – ${c.end.slice(5).replace('-','.')}`;}
function counter(c){const d=deadlineState(c);if(d.status==='pending')return '<span class="countdown pending">◷ 截稿日期待核实</span>';if(d.status==='past')return '<span class="countdown past">已截止</span>';return `<span class="countdown ${d.days<=14?'urgent':''}">◷ ${d.exact?'剩余':'约剩'} ${d.days} 天${d.days===0?' · 今日关注':''}</span>`;}
function card(c){return `<article class="conference"><div class="conference-main"><div class="title-line"><h3><button class="title-button" data-detail="${c.id}">${escape(c.name)}</button></h3><span class="kind ${c.type}">${c.type==='workshop'?'WORKSHOP':'主会论文'}</span></div><p class="description">${escape(c.description)}</p><div class="tags">${c.topics.map(t=>`<span class="tag">${escape(t)}</span>`).join('')}</div><div class="card-links"><a href="${escape(c.url)}" target="_blank" rel="noopener noreferrer">会议官网 ↗</a><button data-detail="${c.id}">详情与来源 ↗</button></div></div><div class="deadline">${c.deadline?`<time datetime="${c.deadline}">${c.deadline.replaceAll('-','.')}</time>`:'<time>待核实</time>'}<div class="time-zone">${escape(c.timezone||'具体时刻 / 时区待确认')}</div>${counter(c)}<div class="source-freshness ${c.syncStatus==='fresh'?'fresh':'stale'}">${c.syncStatus==='fresh'?'● 最近一轮检查成功':'○ 历史数据 · 上轮未确认'}</div></div><div class="event"><p><span>▦</span>${dateRange(c)}</p><p><span>⌖</span>${escape(c.location)}${c.type==='workshop'?'<small>主会会期 · Workshop 日期待确认</small>':''}</p></div><button class="bookmark" data-save="${c.id}" aria-label="${saved.has(c.id)?'取消收藏':'收藏'} ${escape(c.name)}" aria-pressed="${saved.has(c.id)}">${saved.has(c.id)?'★':'☆'}</button></article>`;}
function render(){
  const open=data.filter(c=>deadlineState(c).status==='upcoming').sort((a,b)=>a.deadline.localeCompare(b.deadline));
  $('#today').textContent=beijingDay().replaceAll('-',' / ');
  $('#stat-open').textContent=open.length;$('#nav-count').textContent=open.length;
  $('#stat-soon').textContent=open.filter(c=>deadlineState(c).days<=30).length;
  $('#stat-next').innerHTML=open.length?`${deadlineState(open[0]).days}<em>天${open[0].deadlineAt?'':' · 约'}</em>`:'—';
  $('#stat-next-name').textContent=open[0]?.name||'暂无已确认截稿';$('#saved-count').textContent=saved.size;
  $('#section-title').textContent=names[state.section];$('#breadcrumb').textContent=names[state.section];
  document.querySelectorAll('[data-section]').forEach(b=>{b.classList.toggle('active',b.dataset.section===state.section);b.setAttribute('aria-current',b.dataset.section===state.section?'page':'false');});
  const milestones=[...new Set(open.filter(c=>deadlineState(c).days<=90).map(c=>c.deadline))].slice(0,5);
  $('#timeline').innerHTML=milestones.length?milestones.map(d=>{const group=open.filter(c=>c.deadline===d);return `<button data-detail="${group[0].id}" title="${escape(group.map(c=>c.name).join(' / '))}"><span>${d.slice(5).replace('-',' / ')}</span><strong>${escape(group[0].name.replace('IEEE ',''))}${group.length>1?` +${group.length-1}`:''}</strong></button>`;}).join(''):'<span class="calendar-note">未来 90 天暂无已确认截稿</span>';
  $('#topics').innerHTML=topics().map(t=>`<button data-topic="${escape(t)}" class="${state.topic===t?'active':''}" aria-pressed="${state.topic===t}">${escape(t)}</button>`).join('');
  visible=filterConferences(data,state,saved);
  $('#result-count').textContent=`${visible.length} 场会议`;
  $('#results').innerHTML=visible.map(card).join('');
  $('#results').hidden=state.view!=='list';$('.list-labels').hidden=state.view!=='list'||!visible.length;
  $('#empty').hidden=Boolean(visible.length)||state.view==='calendar';$('#calendar').hidden=state.view!=='calendar';
  $('#list-view').classList.toggle('selected',state.view==='list');$('#calendar-view').classList.toggle('selected',state.view==='calendar');
  $('#list-view').setAttribute('aria-pressed',state.view==='list');$('#calendar-view').setAttribute('aria-pressed',state.view==='calendar');
  if(state.view==='calendar')renderCalendar();
}
function renderCalendar(){
  const [year,m]=month.split('-').map(Number);$('#calendar-title').textContent=`${year} 年 ${m} 月`;
  const first=new Date(Date.UTC(year,m-1,1));const offset=(first.getUTCDay()+6)%7;const days=new Date(Date.UTC(year,m,0)).getUTCDate();
  const slots=Math.ceil((offset+days)/7)*7;
  $('#calendar-grid').innerHTML=Array.from({length:slots},(_,i)=>{const date=new Date(Date.UTC(year,m-1,i-offset+1)).toISOString().slice(0,10);const cs=visible.filter(c=>c.verified&&c.deadline===date);return `<div class="calendar-day ${date.slice(0,7)!==month?'outside':''} ${date===beijingDay()?'is-today':''}"><span class="day-number">${Number(date.slice(8))}</span>${cs.map(c=>`<button class="calendar-event" data-detail="${c.id}" title="${escape(c.name)}">${escape(c.name.replace('IEEE ',''))}</button>`).join('')}</div>`;}).join('');
  let note=$('.calendar-note-bottom');if(!note){note=document.createElement('p');note.className='calendar-note calendar-note-bottom';$('#calendar').append(note);}const count=visible.filter(c=>c.verified&&c.deadline?.startsWith(month)).length;note.textContent=`本月 ${count} 个截稿节点。日历按官网原始日期显示；具体时区见会议详情。待核实条目不放入日历。`;
}
function detail(id){const c=data.find(c=>c.id===id);if(!c)return;
  $('#dialog-content').innerHTML=`<div class="eyebrow">CONFERENCE DETAILS</div><h2>${escape(c.name)}</h2><p class="full-name">${escape(c.fullName)}</p>${counter(c)}<p>${escape(c.description)}</p><dl><dt>投稿类型</dt><dd>${c.type==='workshop'?'Workshop 论文':'主会论文'}</dd><dt>投稿截止</dt><dd>${c.deadline||'待核实'}<br>${escape(c.timezone||'具体时刻与时区待确认')}${c.deadlineAt?`<br>北京时间：${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short',hour12:false}).format(new Date(c.deadlineAt))}`:''}</dd><dt>会议时间</dt><dd>${dateRange(c)}</dd><dt>举办地点</dt><dd>${escape(c.location)}${c.venue?`<br>${escape(c.venue)}`:''}</dd></dl><p class="dialog-note">${escape(c.note)}</p><div class="dialog-actions"><a class="button primary" href="${escape(c.url)}" target="_blank" rel="noopener noreferrer">访问官网 ↗</a><a class="button" href="${escape(c.source)}" target="_blank" rel="noopener noreferrer">日期来源 ↗</a>${c.extraSource?`<a class="button" href="${escape(c.extraSource)}" target="_blank" rel="noopener noreferrer">补充来源 ↗</a>`:''}${c.verified&&c.deadline?`<button class="button" data-export="${c.id}">↓ 加入日历</button>`:''}</div><p class="source-note">${c.lastChecked?'上次读取官网：'+escape(formatChecked(c.lastChecked)):'初始人工核查：'+window.DATA_UPDATED} · ${escape(c.syncNote||'当前显示内置快照，尚无云端更新记录。')}</p>`;$('#details').showModal();
}
function download(cs){const selected=cs.filter(c=>c.verified&&c.deadline);if(!selected.length){toast('当前没有可导出的已确认日期');return;}const blob=new Blob([makeICS(selected)],{type:'text/calendar;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='comm-deadlines.ics';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`已导出 ${selected.length} 个截稿提醒，可导入系统日历`);}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.section){state.section=b.dataset.section;state.range='all';$('#range').value='all';render();}else if(b.dataset.topic){state.topic=b.dataset.topic;render();}else if(b.dataset.detail){detail(b.dataset.detail);}else if(b.dataset.save){const id=b.dataset.save;if(saved.has(id))saved.delete(id);else saved.add(id);try{localStorage.setItem('comm-bookmarks-v1',JSON.stringify([...saved]));}catch{toast('当前浏览器无法保存收藏，收藏仅在本次访问有效');}render();document.querySelector(`[data-save="${id}"]`)?.focus();}else if(b.dataset.export){download(data.filter(c=>c.id===b.dataset.export));}});
$('#search').addEventListener('input',e=>{state.search=e.target.value;render();});
for(const key of ['range','type','sort'])$('#'+key).addEventListener('change',e=>{state[key]=e.target.value;render();});
$('#list-view').onclick=()=>{state.view='list';render();};$('#calendar-view').onclick=()=>{state.view='calendar';render();};
function changeMonth(delta){const [y,m]=month.split('-').map(Number);month=new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7);renderCalendar();}
$('#prev-month').onclick=()=>changeMonth(-1);$('#next-month').onclick=()=>changeMonth(1);$('#current-month').onclick=()=>{month=beijingDay().slice(0,7);renderCalendar();};
$('#reset').onclick=()=>{Object.assign(state,{search:'',topic:'全部方向',type:'all',range:'all',sort:'deadline'});$('#search').value='';for(const k of ['type','range','sort'])$('#'+k).value=state[k];render();};
$('#export').onclick=()=>download(visible);
$('.dialog-close').onclick=()=>$('#details').close();$('#details').addEventListener('click',e=>{if(e.target===$('#details')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#about').onclick=()=>{$('#dialog-content').innerHTML='<div class="eyebrow">ABOUT THE DATA</div><h2>让每一个日期都有出处</h2><p>本站收录通信、网络、信息论及部分相关交叉会议。初始数据于 2026 年 10 月 27 日查询会议官网或 IEEE 学会官方目录，GitHub Actions 计划每小时读取已收录会议的官方页面，生成数据后由 GitHub Pages 发布。打开网页读取最近发布的快照，不触发官网抓取。无法读取或解析时保留旧数据；本站不是完整会议名录。</p><p>主会论文和 Workshop 分开标注；最终稿、录用通知和 Workshop 提案不作为论文截稿日期。遇到来源冲突或解析失败时，保留上次记录并标记为缓存；没有已确认日期的条目保留在“待核实”。</p><p>AoE 为 UTC−12，比北京时间晚 20 小时。官网未公布具体时刻或时区时，仅按原始日期和北京时间估算剩余天数，导出全天提醒，不推定为 AoE。</p><p>收藏保存在当前浏览器。导出的 ICS 文件可导入 Apple 日历、Google 日历或 Outlook；导入后不会自动同步延期。网页每次打开会读取最新发布的数据；ICS 文件需要在日期变更后重新导入。</p><p class="dialog-note">投稿前请访问每场会议详情中的官方来源，确认最新 CFP、摘要前置要求、时区和延期公告。</p>';$('#details').showModal();};
document.addEventListener('keydown',e=>{if(e.key==='/'&&!$('#details').open&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('#search').focus();}});
$('#refresh').onclick=refreshData;
$('#sync-details').onclick=()=>{
  $('#dialog-content').innerHTML=`<div class="eyebrow">SOURCE STATUS</div><h2>云端检查明细</h2><p>以下是最近一轮 GitHub Actions 的检查结果。日期或时区不能可靠识别时，保留旧数据。每次打开网页不会触发官网抓取。</p><div class="sync-rows">${data.map(c=>`<div><strong>${escape(c.name)}</strong><span class="${c.syncStatus==='fresh'?'fresh':'stale'}">${c.syncStatus==='fresh'?'上轮成功':'历史数据 / 未确认'}</span><p>${escape(c.syncNote||'尚无云端检查记录')}<br>${c.lastChecked?'上次成功：'+escape(formatChecked(c.lastChecked)):'初始核查：'+window.DATA_UPDATED}</p><a href="${escape(c.source)}" target="_blank" rel="noopener noreferrer">查看来源 ↗</a></div>`).join('')}</div>`;$('#details').showModal();
};
render();showSync();refreshData();
// A page restored from the back/forward cache is also a new visit.
window.addEventListener('pageshow',e=>{if(e.persisted)refreshData();});
setInterval(()=>{render();showSync();},60000);
