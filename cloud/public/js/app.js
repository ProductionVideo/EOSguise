// cuedo dashboard: read-only status published by the cuedo runtime, plus one-click Delete of a cloud listing.
// All published values are rendered as text (textContent / text nodes). Nothing here can control a show.
// Layout is mobile-first: one centred column, single-line rows with ellipsis instead of wrapping.
import {isShowId,showIdFor} from './identity.js';
import * as M from './model.js';
import {connect} from './data.js';

const $=selector=>document.querySelector(selector);
function h(tag,props={},...children){
 const el=document.createElement(tag);
 for(const [key,value] of Object.entries(props)){
  if(value===null||value===undefined||value===false)continue;
  if(key==='class')el.className=value;
  else if(key.startsWith('on'))el.addEventListener(key.slice(2),value);
  else el.setAttribute(key,value===true?'':String(value));
 }
 for(const child of children.flat())if(child!==null&&child!==undefined&&child!==false)el.append(child instanceof Node?child:String(child));
 return el;
}
const hidden=text=>h('span',{class:'visually-hidden'},text);
const prefs={get(key,fallback){try{const v=localStorage.getItem('cues-'+key);return v===null?fallback:JSON.parse(v);}catch{return fallback;}},set(key,value){try{localStorage.setItem('cues-'+key,JSON.stringify(value));}catch{}}};

const app={db:null,offset:0,shows:new Map(),showsState:'loading',connection:'connecting',online:navigator.onLine,verified:new Map(),detail:null,view:null,query:'',sort:prefs.get('sort','recent')};
const serverNow=()=>Date.now()+app.offset;
const browserLive=()=>app.online&&app.connection==='open';
const isDenied=e=>/permission/i.test(String(e?.code||e?.message||''));

// The name must hash to the record's ID; anything else was written by hand and is flagged.
function verify(){
 for(const s of app.shows.values()){
  const key=s.id+'\n'+s.name;
  if(app.verified.has(key))continue;
  app.verified.set(key,null);
  showIdFor(s.name).then(id=>{app.verified.set(key,id===s.id);render();},()=>{app.verified.set(key,false);render();});
 }
}
const nameMatches=s=>app.verified.get(s.id+'\n'+s.name)!==false;

function connectionText(){
 if(!app.online)return ['Browser offline · data may be old','bad'];
 return ({open:['Live','good'],connecting:['Connecting…','wait'],reconnecting:['Reconnecting…','wait'],denied:['Access denied · retrying','bad']})[app.connection]||['Connecting…','wait'];
}
const FRESHNESS={fresh:['Live','good'],stale:['Stale','wait'],offline:['Offline','bad']};
// Compact status chip: a coloured dot and a short label; the full meaning is kept for screen readers.
function chip(short,tone,hiddenBefore='',hiddenAfter='',title){
 return h('span',{class:'badge '+tone,title},h('span',{class:'dot','aria-hidden':'true'}),hiddenBefore?hidden(hiddenBefore):null,short,hiddenAfter?hidden(hiddenAfter):null);
}
const freshChip=state=>chip(FRESHNESS[state][0],FRESHNESS[state][1],'Publisher: ');
function sourceChip(label,connected,fresh){
 if(!fresh)return chip(label,'muted','',connected?' last reported connected':' last reported disconnected');
 return chip(label,connected?'good':'bad','',connected?' connected':' disconnected');
}
const nameChip=()=>chip('Unverified','bad','','',' name does not match link');

// ---------- Directory ----------
function buildDirectory(){
 const search=h('input',{type:'search',placeholder:'Search shows',value:app.query,'aria-label':'Search shows',oninput:e=>{app.query=e.target.value;renderDirectory();}});
 const sort=h('select',{'aria-label':'Sort shows',onchange:e=>{app.sort=e.target.value;prefs.set('sort',app.sort);renderDirectory();}},h('option',{value:'recent'},'Recent'),h('option',{value:'name'},'A–Z'));
 sort.value=app.sort;
 const view=h('section',{class:'directory','aria-labelledby':'shows-title'},
  h('div',{class:'hero'},$('#plaque').content.cloneNode(true)),
  h('h1',{id:'shows-title',class:'visually-hidden'},'Shows'),
  h('div',{class:'bar'},search,sort),h('div',{id:'notice',role:'status'}),h('ul',{id:'shows',class:'show-list'}),h('p',{id:'show-count',class:'count'}));
 $('#view').replaceChildren(view);
}
function renderDirectory(){
 const list=$('#shows');if(!list)return;
 const now=serverNow(),rows=M.sortShows(M.filterShows([...app.shows.values()],app.query),app.sort);
 $('#show-count').textContent=app.showsState==='ready'&&app.shows.size?app.shows.size+(app.shows.size===1?' show':' shows'):'';
 let notice='';
 if(app.showsState==='loading')notice=app.showsError?'Cannot load shows right now. Retrying automatically.':'Loading shows…';
 else if(!app.shows.size)notice='No shows are publishing right now. Turn on “Publish status online” in cuedo Settings to add one.';
 else if(!rows.length)notice='No shows match your search.';
 if(app.routeMissing)notice='That page does not exist. Showing all shows. '+notice;
 $('#notice').textContent=notice;
 list.replaceChildren(...rows.map(s=>{
  const state=M.freshness(s.updatedAt,now),fresh=state==='fresh';
  return h('li',{},h('a',{href:'/show/'+s.id,'data-nav':true,class:'show-row '+state},
   h('span',{class:'row-top'},h('span',{class:'show-name',title:s.name},s.name),h('span',{class:'show-meta'},hidden('Updated '),M.shortAge(now-s.updatedAt))),
   h('span',{class:'badges'},freshChip(state),sourceChip('Eos',s.eosConnected,fresh),sourceChip('Disguise',s.disguiseConnected,fresh),nameMatches(s)?null:nameChip())));
 }));
}

// ---------- Show detail ----------
function openDetail(id){
 if(app.detail?.id===id)return;
 closeDetail();
 const d={id,loaded:false,missing:false,error:false,updatedAt:null,state:null,cuesRaw:undefined,cues:null,cueIndex:new Map(),list:null,deleting:false,deleteMessage:'',deleteError:'',tableKey:null,tabsKey:null,followed:null};
 // Separate listeners so heartbeats (updatedAt + stateJson) never re-deliver or re-parse the catalogue.
 const base='showData/'+id+'/',failed=e=>{if(app.detail===d){d.error=isDenied(e)?'denied':'error';render();}};
 d.stops=[
  app.db.listen(base+'updatedAt',v=>{if(app.detail!==d)return;d.loaded=true;d.error=false;d.missing=v===null;d.updatedAt=Number.isFinite(v)?v:null;render();},failed),
  app.db.listen(base+'stateJson',v=>{if(app.detail!==d)return;d.state=v===null?null:M.parseState(v);render();},failed),
  app.db.listen(base+'cuesJson',v=>{if(app.detail!==d)return;d.cuesRaw=v;d.cues=v===null?null:M.parseCues(v);d.cueIndex=new Map((d.cues?.rows||[]).map(c=>[c.list+'/'+c.number,c]));d.tableKey=null;render();},failed)];
 app.detail=d;buildDetail();
}
function closeDetail(){app.detail?.stops.forEach(stop=>stop());app.detail=null;}
async function deleteShow(d){
 if(d.deleting)return;
 d.deleting=true;d.deleteError='';d.deleteMessage='';render();
 try{
  const r=await fetch(app.db.restURL(''),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({['shows/'+d.id]:null,['showData/'+d.id]:null}),signal:AbortSignal.timeout(10000)});
  r.body?.cancel().catch(()=>{});
  if(!r.ok)throw Error(r.status===401||r.status===403?'the database refused the request':'HTTP '+r.status);
  d.deleteMessage='Deleted. A show that is still publishing returns within about 10 seconds.';
 }catch(e){d.deleteError='Could not delete: '+(e.name==='TimeoutError'?'the request timed out':e.message==='Failed to fetch'?'no connection':e.message)+'.';}
 finally{d.deleting=false;render();}
}
function toggle(id,label,key){
 const input=h('input',{type:'checkbox',id,onchange:e=>{prefs.set(key,e.target.checked);if(app.detail){app.detail.tableKey=null;app.detail.followed=null;}render();}});
 input.checked=prefs.get(key,true);
 return h('label',{class:'toggle'},input,label);
}
function buildDetail(){
 const d=app.detail;
 const view=h('article',{class:'detail'},
  h('nav',{class:'detail-top'},h('a',{href:'/','data-nav':true,class:'back'},'‹ Shows')),
  h('h1',{id:'detail-name'},'Loading show…'),
  h('div',{id:'detail-badges',class:'badges centered'}),
  h('div',{id:'detail-notice',role:'status'}),
  h('section',{id:'live',class:'live-grid','aria-label':'Current status'}),
  h('section',{class:'catalogue','aria-labelledby':'catalogue-title'},
   h('h2',{id:'catalogue-title',class:'visually-hidden'},'Cue lists'),
   h('div',{id:'list-tabs',class:'tabs',role:'tablist','aria-label':'Cue list'}),
   h('div',{class:'bar'},h('input',{type:'search',id:'cue-query',placeholder:'Search cues','aria-label':'Search cue number or name',oninput:()=>{d.tableKey=null;d.followed=null;render();}}),
    toggle('follow','Follow','follow'),toggle('show-times','Times','times')),
   h('div',{id:'catalogue-lists'}),h('p',{id:'cue-count',class:'count'})),
  h('section',{class:'danger','aria-labelledby':'delete-title'},
   h('h2',{id:'delete-title',class:'visually-hidden'},'Remove from this website'),
   h('button',{type:'button',id:'delete',onclick:()=>deleteShow(d)},'Delete listing'),
   h('p',{id:'delete-status',role:'status'}),
   h('p',{class:'fine'},'Removes this listing for everyone. The show itself is unaffected, and a show that is still publishing returns within about 10 seconds. Turn publishing off in cuedo Settings to remove it for good.')));
 $('#view').replaceChildren(view);
}
function cueLine(kind,c,d,list){
 const label=kind==='current'?'Now':'Next';
 if(!c)return h('div',{class:'cue-line empty '+kind},h('span',{class:'slot'},label),h('span',{class:'cue-empty'},kind==='current'?'No active cue':'No next cue'));
 const row=d.cueIndex.get(list+'/'+c.number),fade=row?M.fadeText(row.up,row.down):'';
 return h('div',{class:'cue-line '+kind},h('span',{class:'slot'},label),
  h('span',{class:'cue-number'},c.number||'—'),
  h('span',{class:'cue-text'},h('span',{class:'cue-label',title:c.name||null},c.name||'(Unlabelled)'),c.notes?h('span',{class:'cue-notes',title:c.notes},c.notes):null),
  fade?h('span',{class:'cue-fade'},hidden('Time '),fade):null);
}
function renderDetail(){
 const d=app.detail;if(!d||!$('#live'))return;
 const now=serverNow(),summary=app.shows.get(d.id);
 const updatedAt=Math.max(summary?.updatedAt??-Infinity,d.updatedAt??-Infinity),age=now-updatedAt;
 const state=M.freshness(Number.isFinite(updatedAt)?updatedAt:NaN,now),fresh=state==='fresh',live=fresh&&browserLive();
 const name=summary?.name||(d.missing?'Show not publishing':d.loaded?'Unnamed show':'Loading show…');
 const title=$('#detail-name');title.textContent=name;title.title=name;
 document.title=(summary?summary.name+' · ':'')+'cuedo';
 const s=d.state&&!d.state.error?d.state:null;
 $('#detail-badges').replaceChildren(...(d.missing||!d.loaded?[]:[
  freshChip(state),s?sourceChip('Eos',s.eos.connected,fresh):null,s?sourceChip('Disguise',s.disguise.connected,fresh):null,
  summary&&!nameMatches(summary)?nameChip():null,h('span',{class:'age'},hidden('Updated '),M.shortAge(age))]).filter(Boolean));
 let notice='';
 if(!d.loaded)notice=d.error?'Cannot load this show right now. Retrying automatically.':'Loading…';
 else if(d.missing)notice='This show is not publishing right now. This page updates automatically if it starts again.';
 else if(state==='offline')notice='No updates for over 2 minutes. Showing the last known status.';
 else if(state==='stale')notice='Updates have paused. Showing the last known status.';
 else if(!browserLive())notice='This browser is offline. Status may be out of date.';
 $('#detail-notice').textContent=notice;$('#detail-notice').className=notice?'notice':'';
 const del=$('#delete');del.disabled=d.deleting||d.missing||!d.loaded;del.textContent=d.deleting?'Deleting…':d.deleteError?'Retry delete':'Delete listing';
 const ds=$('#delete-status');ds.textContent=d.deleteError||d.deleteMessage;ds.className=d.deleteError?'error':'';
 // Live status cards
 const cards=[];
 if(d.state?.error)cards.push(h('div',{class:'card error'},d.state.error));
 else if(s){
  for(const n of s.eos.cueLists){const l=s.eos.lists[n];
   cards.push(h('div',{class:'card'+(fresh&&s.eos.connected?'':' dim')},h('div',{class:'card-head'},h('span',{},'EOS · LIST '+n),h('span',{class:'head-name',title:l.name||null},l.name)),cueLine('current',l.current,d,n),cueLine('next',l.next,d,n)));}
  if(!s.eos.cueLists.length)cards.push(h('div',{class:'card dim'},'No Eos cue lists configured.'));
  const g=s.disguise,timing=v=>M.clock(M.liveSeconds(v,{playmode:g.playmode,ageMs:age,live}));
  const where=[g.track||'No track',g.section!==null?'Section '+g.section+(g.sectionName?' · '+g.sectionName:''):''].filter(Boolean).join(' · ');
  cards.push(h('div',{class:'card'+(fresh&&g.connected?'':' dim')},h('div',{class:'card-head'},h('span',{},'DISGUISE'),h('span',{class:'head-name',title:g.transport||null},g.transport||'Transport')),
   h('div',{class:'track',title:where},where),
   h('div',{class:'pills'},h('span',{},g.engaged===null?'Engaged ?':g.engaged?'Engaged':'Disengaged'),h('span',{},M.PLAYMODES[g.playmode]||g.playmode||'Mode ?'),h('span',{},M.OUTPUTS[g.output]||'Output ?')),
   h('dl',{},h('div',{},h('dt',{},'Track'),h('dd',{},timing(g.time))),h('div',{},h('dt',{},'Section'),h('dd',{},timing(g.sectionTime))),h('div',{},h('dt',{},'Cue'),h('dd',{title:g.cue||null},g.cue||'—'))),
   live?null:h('div',{class:'muted'},'Timing frozen at last update')));
 }
 $('#live').replaceChildren(...cards.filter(Boolean));
 renderCatalogue(d,s);
}
function renderCatalogue(d,s){
 const container=$('#catalogue-lists');
 const q=$('#cue-query').value.trim().toLowerCase(),showTimes=$('#show-times').checked;
 const lists=s?s.eos.cueLists:[...new Set((d.cues?.rows||[]).map(c=>c.list))].slice(0,2);
 if(!lists.includes(d.list))d.list=lists[0]??null;
 const n=d.list,listName=k=>s?.eos.lists[k]?.name||'';
 // List switcher (one table at a time keeps the page short on a phone).
 const tabsKey=JSON.stringify([lists,lists.map(listName),n]);
 if(tabsKey!==d.tabsKey){
  d.tabsKey=tabsKey;
  $('#list-tabs').replaceChildren(...lists.map(k=>h('button',{type:'button',role:'tab','aria-selected':String(k===n),class:k===n?'active':null,onclick:()=>{d.list=k;d.tableKey=null;d.followed=null;render();}},
   h('span',{},'List '+k),listName(k)?h('span',{class:'tab-name'},listName(k)):null)));
  $('#list-tabs').hidden=lists.length<2;
 }
 const current=s?.eos.lists[n]?.current?.number??null,next=s?.eos.lists[n]?.next?.number??null;
 const total=(d.cues?.rows||[]).filter(c=>c.list===n).length;
 $('#cue-count').textContent=d.cues?.error||n===null?'':total+' cues'+(s?.eos.loading?' · refreshing':'');
 const key=JSON.stringify([n,q,showTimes,current,next,d.cues?.rows.length,d.cuesRaw?.length]);
 if(key!==d.tableKey){
  d.tableKey=key;
  if(d.cues?.error)container.replaceChildren(h('p',{class:'notice'},d.cues.error));
  else if(n===null)container.replaceChildren(h('p',{class:'count'},d.cues?'No cues':''));
  else{
   const rows=(d.cues?.rows||[]).filter(c=>c.list===n&&(!q||`${c.number} ${c.name}`.toLowerCase().includes(q)));
   const body=h('tbody',{},...rows.map(c=>{
    const isCurrent=current!==null&&Number(c.number)===Number(current),isNext=!isCurrent&&next!==null&&Number(c.number)===Number(next);
    return h('tr',{class:isCurrent?'current':isNext?'next':null},h('td',{},c.number),h('td',{class:'name',title:c.name||null},c.name||'(Unlabelled)',isCurrent?hidden(' (current)'):isNext?hidden(' (next)'):null),showTimes?h('td',{class:'time'},M.fadeText(c.up,c.down)):null);
   }));
   container.replaceChildren(h('div',{class:'table-wrap'},h('table',{},h('thead',{},h('tr',{},h('th',{},'Cue'),h('th',{},'Name'),showTimes?h('th',{class:'time'},'Time'):null)),body)),
    ...(rows.length?[]:[h('p',{class:'count'},q?'No matching cues':'No cues')]));
  }
  d.followed=null;
 }
 if($('#follow').checked&&!q){
  const wrap=container.querySelector('.table-wrap'),row=wrap?.querySelector('tr.current');
  if(row&&d.followed!==key)wrap.scrollTop=Math.max(0,row.offsetTop-(wrap.clientHeight-row.offsetHeight)/2);
  d.followed=key;
 }
}

// ---------- Shell ----------
function render(){
 // Connection banner appears only when something is wrong.
 const [text,tone]=connectionText();const c=$('#connection');c.textContent=text;c.className='connection '+tone;
 if(app.view==='directory')renderDirectory();else if(app.view==='detail')renderDetail();
}
function route(){
 const m=location.pathname.match(/^\/show\/([^/]+)\/?$/);
 if(m&&isShowId(m[1])){app.view='detail';app.routeMissing=false;openDetail(m[1]);}
 else{closeDetail();app.routeMissing=location.pathname!=='/';app.view='directory';document.title='cuedo';buildDirectory();}
 render();
}
document.addEventListener('click',e=>{
 const a=e.target.closest?.('a[data-nav]');
 if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
 e.preventDefault();history.pushState(null,'',a.getAttribute('href'));route();window.scrollTo(0,0);
});
window.addEventListener('popstate',route);
window.addEventListener('online',()=>{app.online=true;render();});
window.addEventListener('offline',()=>{app.online=false;render();});

async function start(){
 try{app.db=connect(await(await fetch('/firebase-config.json',{cache:'no-store'})).json());}
 catch{$('#view').replaceChildren(h('p',{class:'notice'},'cuedo could not start. Check your connection and reload.'));return;}
 // Browser-to-Firebase connection and server clock offset come from the SDK; ages advance on a 1 s timer.
 app.db.listen('.info/connected',v=>{app.connection=v?'open':app.connection==='open'?'reconnecting':'connecting';render();});
 app.db.listen('.info/serverTimeOffset',v=>{if(Number.isFinite(v))app.offset=v;});
 // Exactly one summary listener for the whole page.
 app.db.listen('shows',tree=>{app.showsError=false;app.shows=new Map(M.parseSummaries(tree).map(s=>[s.id,s]));app.showsState='ready';verify();render();},
  e=>{app.showsError=true;if(isDenied(e))app.connection='denied';render();});
 setInterval(render,1000);
 route();
}
start();
