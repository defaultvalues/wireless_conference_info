export const DAY = 86400000;
export const beijingDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function deadlineState(c, now = new Date()) {
  if (!c.verified || !c.deadline) return {status:'pending',days:null,exact:false};
  const exact = Boolean(c.deadlineAt);
  const days = exact ? Math.ceil((Date.parse(c.deadlineAt)-now.getTime())/DAY) : Math.round((Date.parse(c.deadline)-Date.parse(beijingDay(now)))/DAY);
  const expired = exact ? now.getTime() >= Date.parse(c.deadlineAt) : days < 0;
  return {status:expired?'past':'upcoming',days:Math.max(0,days),exact};
}
export function filterConferences(data, state, saved, now = new Date()) {
  return data.filter(c => {
    const d=deadlineState(c,now);
    const section=state.section==='saved'?saved.has(c.id):d.status===state.section;
    const query=[c.name,c.fullName,c.description,c.location,...c.topics].join(' ').toLowerCase();
    return section && query.includes(state.search.trim().toLowerCase()) && (state.topic==='全部方向'||c.topics.includes(state.topic)) && (state.type==='all'||c.type===state.type) && (state.range==='all'||(d.status==='upcoming' && d.days <= Number(state.range)));
  }).sort((a,b)=>state.sort==='name'?a.name.localeCompare(b.name):state.sort==='event'?a.start.localeCompare(b.start):(a.deadline||'9999').localeCompare(b.deadline||'9999')||a.name.localeCompare(b.name));
}
const compact=d=>d.replaceAll('-','');
const escapeICS=s=>s.replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(',','\\,').replaceAll(';','\\;');
function fold(line) { let result='',part=''; for(const ch of line) {if(new TextEncoder().encode(part+ch).length>74){result+=part+'\r\n';part=' ';}part+=ch;} return result+part; }
export function makeICS(conferences, now = new Date()) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Comm Deadlines//ZH','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  for (const c of conferences.filter(c=>c.verified&&c.deadline)) {
    lines.push('BEGIN:VEVENT',`UID:${c.id}-deadline@comm-deadlines`,`DTSTAMP:${stamp}`);
    if(c.deadlineAt) {const start=new Date(c.deadlineAt);const end=new Date(start.getTime()+60000);lines.push('DTSTART:'+start.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),'DTEND:'+end.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''));}
    else {lines.push('DTSTART;VALUE=DATE:'+compact(c.deadline),'DTEND;VALUE=DATE:'+compact(new Date(Date.parse(c.deadline)+DAY).toISOString().slice(0,10)));}
    lines.push('SUMMARY:'+escapeICS(c.name+' · 投稿截止'+(c.deadlineAt?'':'（时区待确认）')),'DESCRIPTION:'+escapeICS(`${c.description}\n截止原文：${c.deadline} ${c.timezone||'时刻与时区未公布；此为全天日期提醒，非精确截止时刻。'}\n${c.note}\n官方来源：${c.source}`),'LOCATION:'+escapeICS(c.location),'URL:'+c.url,'END:VEVENT');
  }
  lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';
}
