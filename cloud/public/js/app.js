// Cues dashboard: read-only status published by EOSguise, plus one-click Delete of a cloud listing.
// All published values are rendered as text (textContent / text nodes). Nothing here can control a show.
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
function badge(label,[text,tone],title){return h('span',{class:'badge '+tone,title},h('span',{class:'visually-hidden'},label+': '),text);}
function sourceBadge(label,connected,fresh){
 if(!fresh)return badge(label,[connected?label+' last reported connected':label+' last reported disconnected','muted']);
 return badge(label,[connected?label+' connected':label+' disconnected',connected?'good':'bad']);
}

// ---------- Directory ----------
function buildDirectory(){
 const search=h('input',{type:'search',placeholder:'Search shows',value:app.query,'aria-label':'Search shows',oninput:e=>{app.query=e.target.value;renderDirectory();}});
 const sort=h('select',{'aria-label':'Sort shows',onchange:e=>{app.sort=e.target.value;prefs.set('sort',app.sort);renderDirectory();}},h('option',{value:'recent'},'Recently updated'),h('option',{value:'name'},'Name'));
 sort.value=app.sort;
 const view=h('section',{class:'directory','aria-labelledby':'shows-title'},
  h('div',{class:'section-head'},h('h1',{id:'shows-title'},'Shows'),h('span',{id:'show-count',class:'muted'})),
  h('div',{class:'filters'},search,sort),h('div',{id:'notice',role:'status'}),h('ul',{id:'shows',class:'show-list'}));
 $('#view').replaceChildren(view);
}
function renderDirectory(){
 const list=$('#shows');if(!list)return;
 const now=serverNow(),rows=M.sortShows(M.filterShows([...app.shows.values()],app.query),app.sort);
 $('#show-count').textContent=app.showsState==='ready'?app.shows.size+(app.shows.size===1?' show':' shows'):'';
 let notice='';
 if(app.showsState==='loading')notice=app.showsError?'Cannot load shows right now. Retrying automatically.':'Loading shows…';
 else if(!app.shows.size)notice='No shows are publishing right now. Turn on “Publish status online” in EOSguise Settings to add one.';
 else if(!rows.length)notice='No shows match your search.';
 if(app.routeMissing)notice='That page does not exist. Showing all shows. '+notice;
 $('#notice').textContent=notice;
 list.replaceChildren(...rows.map(s=>{
  const state=M.freshness(s.updatedAt,now),fresh=state==='fresh';
  return h('li',{},h('a',{href:'/show/'+s.id,'data-nav':true,class:'show-row '+state},
   h('span',{class:'show-name'},s.name),
   h('span',{class:'show-meta'},'Updated '+M.ageText(now-s.updatedAt)),
   h('span',{class:'badges'},badge('Publisher',FRESHNESS[state]),sourceBadge('Eos',s.eosConnected,fresh),sourceBadge('Disguise',s.disguiseConnected,fresh),nameMatches(s)?null:badge('Name',['Name does not match link','bad'],'This listing was not written by EOSguise with this name'))));
 }));
}

// ---------- Show detail ----------
function openDetail(id){
 if(app.detail?.id===id)return;
 closeDetail();
 const d={id,loaded:false,missing:false,error:false,updatedAt:null,state:null,cuesRaw:undefined,cues:null,cueIndex:new Map(),deleting:false,deleteMessage:'',deleteError:'',tableKey:null,followed:null};
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
  d.deleteMessage='Deleted. If EOSguise is still publishing this show, it will reappear within about 10 seconds.';
 }catch(e){d.deleteError='Could not delete: '+(e.name==='TimeoutError'?'the request timed out':e.message==='Failed to fetch'?'no connection':e.message)+'. The listing is unchanged.';}
 finally{d.deleting=false;render();}
}
function buildDetail(){
 const d=app.detail;
 const times=h('input',{type:'checkbox',id:'show-times',onchange:e=>{prefs.set('times',e.target.checked);d.tableKey=null;render();}});times.checked=prefs.get('times',true);
 const follow=h('input',{type:'checkbox',id:'follow',onchange:e=>{prefs.set('follow',e.target.checked);d.followed=null;render();}});follow.checked=prefs.get('follow',true);
 const view=h('article',{class:'detail'},
  h('a',{href:'/','data-nav':true,class:'back'},'← All shows'),
  h('div',{class:'detail-head'},h('h1',{id:'detail-name'},'Loading show…'),h('div',{id:'detail-badges',class:'badges'})),
  h('div',{id:'detail-notice',role:'status'}),
  h('section',{id:'live',class:'live-grid','aria-label':'Current status'}),
  h('section',{class:'catalogue','aria-labelledby':'catalogue-title'},
   h('div',{class:'section-head'},h('h2',{id:'catalogue-title'},'Cue lists'),h('span',{id:'cue-count',class:'muted'})),
   h('div',{class:'filters'},h('input',{type:'search',id:'cue-query',placeholder:'Search cue number or name','aria-label':'Search cue number or name',oninput:()=>{d.tableKey=null;d.followed=null;render();}}),
    h('label',{class:'toggle'},follow,'Auto-follow'),h('label',{class:'toggle'},times,'Cue times')),
   h('div',{id:'catalogue-lists',class:'catalogue-lists'})),
  h('section',{class:'danger','aria-labelledby':'delete-title'},
   h('h2',{id:'delete-title'},'Remove from this website'),
   h('p',{},'Deletes this listing and its cue list from cues.stage.wiki for everyone. It does not affect the show. If EOSguise is still publishing, the show reappears within about 10 seconds with its full cue list. To stop publishing, turn it off in EOSguise Settings.'),
   h('div',{class:'delete-row'},h('button',{type:'button',id:'delete',onclick:()=>deleteShow(d)},'Delete listing'),h('span',{id:'delete-status',role:'status'}))));
 $('#view').replaceChildren(view);
}
function cueBlock(label,c,d,list){
 if(!c)return h('div',{class:'cue-slot'},h('span',{class:'slot-label'},label),h('span',{class:'cue-empty'},label==='Current'?'No active cue':'No next cue'));
 const row=d.cueIndex.get(list+'/'+c.number),fade=row?M.fadeText(row.up,row.down):'';
 return h('div',{class:'cue-slot'},h('span',{class:'slot-label'},label),
  h('span',{class:'cue-number'},c.number||'—'),h('span',{class:'cue-label'},c.name||'(Unlabelled)'),
  fade?h('span',{class:'cue-fade'},'Time '+fade):null,c.notes?h('span',{class:'cue-notes'},c.notes):null);
}
function renderDetail(){
 const d=app.detail;if(!d||!$('#live'))return;
 const now=serverNow(),summary=app.shows.get(d.id);
 const updatedAt=Math.max(summary?.updatedAt??-Infinity,d.updatedAt??-Infinity),age=now-updatedAt;
 const state=M.freshness(Number.isFinite(updatedAt)?updatedAt:NaN,now),fresh=state==='fresh',live=fresh&&browserLive();
 const name=summary?.name||(d.missing?'Show not publishing':d.loaded?'Unnamed show':'Loading show…');
 $('#detail-name').textContent=name;document.title=(summary?summary.name+' · ':'')+'Cues · Stage Wiki';
 const s=d.state&&!d.state.error?d.state:null;
 $('#detail-badges').replaceChildren(...(d.missing||!d.loaded?[]:[
  badge('Publisher',FRESHNESS[state]),h('span',{class:'muted'},'Updated '+M.ageText(age)),
  s?sourceBadge('Eos',s.eos.connected,fresh):null,s?sourceBadge('Disguise',s.disguise.connected,fresh):null,
  summary&&!nameMatches(summary)?badge('Name',['Name does not match link','bad']):null]).filter(Boolean));
 let notice='';
 if(!d.loaded)notice=d.error?'Cannot load this show right now. Retrying automatically.':'Loading…';
 else if(d.missing)notice='This show is not publishing right now: it was deleted, renamed or never existed. This page updates automatically if it starts publishing again.';
 else if(state==='offline')notice='This show has not published for over 2 minutes. Everything below is the last known status, not live.';
 else if(state==='stale')notice='Updates from this show have paused. Everything below is the last known status.';
 else if(!browserLive())notice='This browser is not connected to Cues. Everything below may be out of date.';
 $('#detail-notice').textContent=notice;$('#detail-notice').className=notice?'notice':'';
 const del=$('#delete');del.disabled=d.deleting||d.missing||!d.loaded;del.textContent=d.deleting?'Deleting…':'Delete listing';
 const ds=$('#delete-status');ds.textContent=d.deleteError||d.deleteMessage;ds.className=d.deleteError?'error':'';
 if(d.deleteError&&!d.deleting)del.textContent='Retry delete';
 // Live status cards
 const cards=[];
 if(d.state?.error)cards.push(h('div',{class:'card error'},d.state.error));
 else if(s){
  for(const n of s.eos.cueLists){const l=s.eos.lists[n];
   cards.push(h('div',{class:'card'+(fresh&&s.eos.connected?'':' dim')},h('div',{class:'card-head'},h('span',{},'EOS · LIST '+n),h('span',{},l.name)),cueBlock('Current',l.current,d,n),cueBlock('Next',l.next,d,n)));}
  if(!s.eos.cueLists.length)cards.push(h('div',{class:'card dim'},'No Eos cue lists configured.'));
  const g=s.disguise,timing=v=>{const t=M.liveSeconds(v,{playmode:g.playmode,ageMs:age,live});return M.clock(t);};
  cards.push(h('div',{class:'card'+(fresh&&g.connected?'':' dim')},h('div',{class:'card-head'},h('span',{},'DISGUISE'),h('span',{},g.transport||'Transport')),
   h('div',{class:'track'},g.track||'No track'),h('div',{},g.section!==null?'Section '+g.section+(g.sectionName?' · '+g.sectionName:''):'Section unknown'),
   h('div',{class:'pills'},h('span',{},g.engaged===null?'Engaged unknown':g.engaged?'Engaged':'Disengaged'),h('span',{},M.PLAYMODES[g.playmode]||g.playmode||'Mode unknown'),h('span',{},M.OUTPUTS[g.output]||'Output unknown')),
   h('dl',{},h('div',{},h('dt',{},'Track time'),h('dd',{},timing(g.time))),h('div',{},h('dt',{},'In section'),h('dd',{},timing(g.sectionTime))),h('div',{},h('dt',{},'Cue'),h('dd',{},g.cue||'None'))),
   live?null:h('div',{class:'muted'},'Timing frozen at last update ('+M.ageText(age)+')')));
 }
 $('#live').replaceChildren(...cards.filter(Boolean));
 renderCatalogue(d,s);
}
function renderCatalogue(d,s){
 const container=$('#catalogue-lists');
 const q=$('#cue-query').value.trim().toLowerCase(),showTimes=$('#show-times').checked;
 const lists=s?s.eos.cueLists:[...new Set((d.cues?.rows||[]).map(c=>c.list))].slice(0,2);
 const current=n=>s?.eos.lists[n]?.current?.number??null,next=n=>s?.eos.lists[n]?.next?.number??null;
 $('#cue-count').textContent=d.cues?.error?'':d.cues?d.cues.rows.length+' cues'+(s?.eos.loading?' · Eos is refreshing the cue list':''):'';
 const key=JSON.stringify([q,showTimes,lists,lists.map(current),lists.map(next),d.cues?.rows.length,d.cuesRaw?.length]);
 if(key!==d.tableKey){
  d.tableKey=key;
  if(d.cues?.error)container.replaceChildren(h('p',{class:'notice'},d.cues.error));
  else container.replaceChildren(...lists.map(n=>{
   const rows=(d.cues?.rows||[]).filter(c=>c.list===n&&(!q||`${c.number} ${c.name}`.toLowerCase().includes(q)));
   const body=h('tbody',{},...rows.map(c=>{
    const isCurrent=current(n)!==null&&Number(c.number)===Number(current(n)),isNext=!isCurrent&&next(n)!==null&&Number(c.number)===Number(next(n));
    return h('tr',{class:isCurrent?'current':isNext?'next':null},h('td',{},c.number),h('td',{},c.name||'(Unlabelled)'),showTimes?h('td',{class:'time'},M.fadeText(c.up,c.down)):null,h('td',{class:'status'},isCurrent?'Current':isNext?'Next':''));
   }));
   return h('div',{class:'cue-column'},h('h3',{},'List '+n+(s?.eos.lists[n]?.name?' · '+s.eos.lists[n].name:'')),
    h('div',{class:'table-wrap'},h('table',{},h('thead',{},h('tr',{},h('th',{},'Cue'),h('th',{},'Name'),showTimes?h('th',{class:'time'},'Time'):null,h('th',{},'Status'))),body)),
    rows.length?null:h('p',{class:'muted'},q?'No matching cues':'No cues'));
  }));
  d.followed=null;
 }
 if($('#follow').checked&&!q){
  for(const wrap of container.querySelectorAll('.table-wrap')){
   const row=wrap.querySelector('tr.current');if(!row)continue;
   const target=row.offsetTop-(wrap.clientHeight-row.offsetHeight)/2;
   if(d.followed!==key)wrap.scrollTop=Math.max(0,target);
  }
  d.followed=key;
 }
}

// ---------- Shell ----------
function render(){
 const [text,tone]=connectionText();const c=$('#connection');c.textContent=text;c.className='connection '+tone;
 if(app.view==='directory')renderDirectory();else if(app.view==='detail')renderDetail();
}
function route(){
 const m=location.pathname.match(/^\/show\/([^/]+)\/?$/);
 if(m&&isShowId(m[1])){app.view='detail';app.routeMissing=false;openDetail(m[1]);}
 else{closeDetail();app.routeMissing=location.pathname!=='/';app.view='directory';document.title='Cues · Stage Wiki';buildDirectory();}
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
 catch{$('#view').replaceChildren(h('p',{class:'notice'},'Cues could not start. Check your connection and reload.'));return;}
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
