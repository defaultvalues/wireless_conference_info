#!/usr/bin/env python3
"""Read configured official conference sources for GitHub Actions."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime, timezone, timedelta
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import threading
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / '.cache' / 'conferences.json'
MONTHS = {name.lower(): i for i, name in enumerate(['January','February','March','April','May','June','July','August','September','October','November','December'], 1)}
MONTHS.update({k[:3]:v for k,v in list(MONTHS.items())})
MONTH = r'(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?'
DATE = rf'(?:\d{{4}}-\d{{2}}-\d{{2}}|{MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?\s*,?\s*\d{{4}}|\d{{1,2}}(?:st|nd|rd|th)?\s+{MONTH}\s*,?\s*\d{{4}})'
LABEL = r'(?:Call for Technical Papers Deadline|(?:Regular\s+|Full\s+|Technical\s+)?Paper[s]?\s+Submission(?:\s+Deadline)?|Submission\s+Deadline|Last\s+Date\s+of\s+Paper\s+Submission)'

class PageText(HTMLParser):
    """Read visible text, dropping scripts, hidden content and superseded dates."""
    BLOCKS = {'p','div','li','tr','td','th','h1','h2','h3','h4','h5','h6','br','section','article','dt','dd'}
    VOIDS = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts=[]; self.stack=[]; self.suppressed=0
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        hidden = tag in {'script','style','noscript','del','s','strike'} or 'hidden' in attrs or attrs.get('aria-hidden')=='true' or bool(re.search(r'display\s*:\s*none',attrs.get('style','')))
        if tag not in self.VOIDS:
            self.stack.append((tag, hidden)); self.suppressed += int(hidden)
        if not self.suppressed and tag in self.BLOCKS:self.parts.append('\n')
    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==tag:
                self.suppressed-=sum(int(v) for _,v in self.stack[i:]); del self.stack[i:]; break
        if not self.suppressed and tag in self.BLOCKS:self.parts.append('\n')
    def handle_data(self, data):
        if not self.suppressed:self.parts.append(data)
    def text(self):
        return '\n'.join(re.sub(r'\s+',' ',line).strip() for line in ''.join(self.parts).splitlines() if line.strip())

def parse_date(value):
    value=re.sub(r'(\d)(?:st|nd|rd|th)\b',r'\1',value,flags=re.I).replace(',','').replace('.','')
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):return date.fromisoformat(value).isoformat()
    p=value.split()
    if p[0].isdigit():d,m,y=int(p[0]),p[1],int(p[2])
    else:m,d,y=p[0],int(p[1]),int(p[2])
    return date(y,MONTHS[m.lower()[:3]],d).isoformat()

def parse_event_dates(value):
    value=re.sub(r'[–—]', '-',value.strip())
    # Official ComSoc formats, including cross-month conference ranges.
    match=re.fullmatch(rf'(\d{{1,2}})\s*-\s*(\d{{1,2}})\s+({MONTH})\s+(\d{{4}})',value,re.I)
    if match:
        a,b,m,y=match.groups();return parse_date(f'{a} {m} {y}'),parse_date(f'{b} {m} {y}')
    match=re.fullmatch(rf'(\d{{1,2}})\s+({MONTH})\s*-\s*(\d{{1,2}})\s+({MONTH})\s+(\d{{4}})',value,re.I)
    if match:
        a,m,b,n,y=match.groups();return parse_date(f'{a} {m} {y}'),parse_date(f'{b} {n} {y}')
    raise ValueError('Unrecognized conference date range')

def parse_page(html, conference):
    parser=PageText();parser.feed(html);text=parser.text()
    year=conference['start'][:4]
    if not re.search(rf'\b{year}\b',text):raise ValueError('Conference edition missing')
    # Reject generic challenge/error pages even when the navigation has dates.
    if re.search(r'just a moment|verify you are human|access denied|captcha',text,re.I):raise ValueError('Blocked page')
    found=[]
    for label in re.finditer(LABEL,text,re.I):
        prefix=text[max(0,label.start()-45):label.start()]
        if re.search(r'camera[- ]?ready|final[/ -]*|abstract\s*|proposal\s*|workshop\s*',prefix.split('\n')[-1],re.I):continue
        after=text[label.end():label.end()+180]
        # Never cross into a different submission milestone while looking for a date.
        after=re.split(r'acceptance notification|camera[- ]?ready|abstract (?:submission|deadline)|workshop proposals?|tutorial proposals?|final manuscript',after,flags=re.I)[0]
        m=re.search(DATE,after,re.I)
        if m and not re.search(r'[A-Za-z]{8,}',after[:m.start()].replace('extended','').replace('Extended','').replace('Deadline','').replace('deadline','').replace('Firm','')):
            found.append((parse_date(m.group()),after[m.end():m.end()+70]))
    dates={d for d,_ in found}
    if len(dates)!=1:raise ValueError('Missing or conflicting submission dates')
    deadline=next(iter(dates))
    if not (int(year)-1 <= int(deadline[:4]) <= int(year)) or deadline>conference['end']:raise ValueError('Implausible deadline')
    result={'deadline':deadline,'deadlineAt':None,'timezone':None,'verified':True}
    # Only use an explicitly adjacent time and zone; never assume AoE.
    suffix=' '.join(tail for d,tail in found if d==deadline)
    tm=re.search(r'\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*(AoE|UTC\s*[+-]\s*\d{1,2}(?::\d{2})?)\b',suffix,re.I)
    if tm:
        h,minute,sec,meridiem,zone=tm.groups();h=int(h)
        if meridiem:h=h%12+(12 if meridiem.upper()=='PM' else 0)
        zone=re.sub(r'\s','',zone)
        if zone.lower()=='aoe':offset='-12:00'
        else:
            off=re.fullmatch(r'UTC([+-])(\d{1,2})(?::(\d{2}))?',zone,re.I);offset=f'{off[1]}{int(off[2]):02d}:{off[3] or "00"}'
        instant=f'{deadline}T{h:02d}:{minute}:{sec or "00"}{offset}'
        datetime.fromisoformat(instant)
        result.update(deadlineAt=instant,timezone=f'{h:02d}:{minute} {zone}')
    # Preserve previously verified precision only when the date is unchanged.
    elif deadline==conference.get('deadline') and conference.get('deadlineAt'):
        result.update(deadlineAt=conference['deadlineAt'],timezone=conference['timezone'])
    if 'comsoc.org/conferences-events/' in conference['source']:
        event=re.search(r'(?:^|\n)Date\n([^\n]+)\nLocation\n([^\n]+)',text)
        if not event:raise ValueError('Missing conference date/location fields')
        start,end=parse_event_dates(event[1])
        if start[:4]!=year or start>end or deadline>start:raise ValueError('Conflicting conference year')
        result.update(start=start,end=end,location=event[2])
    return result

def fetch_html(url):
    req=Request(url,headers={'User-Agent':'CommDeadlines/1.1 (personal academic deadline reader)','Accept':'text/html','Cache-Control':'no-cache'})
    with urlopen(req,timeout=10) as response:
        if 'text/html' not in response.headers.get('Content-Type',''):raise ValueError('Not HTML')
        content=response.read(2_000_001)
        if len(content)>2_000_000:raise ValueError('Page too large')
        return content.decode(response.headers.get_content_charset() or 'utf-8',errors='replace')

class ConferenceStore:
    def __init__(self, seed, cache_path=CACHE):
        self.seed=deepcopy(seed);self.cache_path=cache_path;self.lock=threading.Lock();self.inflight=None
        self.data=deepcopy(seed);self.last_complete=None
        try:
            cached=json.loads(cache_path.read_text())
            by_id={c['id']:c for c in cached['conferences']}
            # Restore known fields only, retaining the provenance of previously checked dates.
            self.data=[{**c,**{k:v for k,v in by_id.get(c['id'],{}).items() if k in {'deadline','deadlineAt','timezone','start','end','location','verified','lastChecked','syncNote','note','source'}}} for c in seed]
        except (OSError,ValueError,KeyError,TypeError):pass
    def refresh(self, fetch=fetch_html):
        # Concurrent tabs share an in-flight fetch; later page visits always refetch.
        with self.lock:
            if self.inflight is not None:done=self.inflight;owner=False
            else:done=threading.Event();self.inflight=done;owner=True
        if not owner:
            if not done.wait(40):raise TimeoutError('Refresh still running')
            return deepcopy(self.last_complete)
        try:
            now=datetime.now(timezone.utc).isoformat()
            def update(c):
                updated=deepcopy(c)
                url=c['url'] if c['id']=='icc-2027' else c['source']
                try:
                    parsed=parse_page(fetch(url),{**c,'source':url})
                    updated.update(parsed,lastChecked=now,syncStatus='fresh',syncNote='本次已读取官方来源并解析论文截止日期。')
                    updated['source']=url
                    if c['id']=='icc-2027':updated['note']='本次已直接读取 ICC 会议官网并解析论文截止日期；具体时刻与时区仅在官网明确注明时采用。'
                except ValueError:
                    updated.update(syncStatus='stale',syncNote='官网格式变化、信息冲突或缺少可确认的截稿日期；保留旧数据。')
                except Exception:
                    updated.update(syncStatus='stale',syncNote='本次无法连接官方来源；保留旧数据。')
                return updated
            with ThreadPoolExecutor(max_workers=6) as pool:items=list(pool.map(update,self.data))
            fresh=sum(c['syncStatus']=='fresh' for c in items)
            payload={'conferences':items,'attemptedAt':now,'freshCount':fresh,'totalCount':len(items),'status':'fresh' if fresh==len(items) else 'partial' if fresh else 'offline','seedDate':'2026-10-27'}
            self.data=items;self.last_complete=payload
            try:
                self.cache_path.parent.mkdir(parents=True,exist_ok=True)
                temporary=self.cache_path.with_suffix('.tmp')
                temporary.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8');temporary.replace(self.cache_path)
            except OSError:pass
            return deepcopy(payload)
        finally:
            with self.lock:self.inflight=None;done.set()
