const $=s=>document.querySelector(s);let cues=[],state=null,lastCatalogue=0,lastLoaded=-1;
const time=n=>{if(!Number.isFinite(n))return '…';let t=Math.max(0,Math.floor(n));return [Math.floor(t/3600),Math.floor(t/60)%60,t%60].map(x=>String(x).padStart(2,'0')).join(':');};
const followed={1:null,2:null};
function followCurrent(){
 if(!$('#autofollow').checked||$('#query').value.trim())return;
 for(const list of [1,2]){
  const row=$('#results'+list).querySelector('tr.current');
  if(!row)continue;
  const number=row.firstElementChild.textContent;
  const wrap=row.closest('.table-wrap');
  const bounds=wrap.getBoundingClientRect(),r=row.getBoundingClientRect();
  // Follow is a viewport guarantee, not just a reaction to a new cue number.
  // Keep clear of the sticky column header, including after a resize/rebuild.
  if(followed[list]===number&&r.top>=bounds.top+36&&r.bottom<=bounds.top+wrap.clientHeight-8)continue;
  if(wrap.clientHeight<=0)continue;
  wrap.scrollTop+=r.top-bounds.top-(wrap.clientHeight-r.height+36)/2;
  followed[list]=number;
 }
}
// Eos sends cue times in milliseconds; show them as Eos does (5, 2.5, 1:30) with "up / down" when they differ.
const seconds=ms=>{const s=Math.round(ms/100)/10;return s<60?String(s):Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0')+(s%1?String(Math.round(s%1*10)/10).slice(1):'');};
const set=ms=>Number.isFinite(ms)&&ms>=0;
const cueTime=c=>!set(c.up)?'':set(c.down)&&c.down!==c.up?seconds(c.up)+' / '+seconds(c.down):seconds(c.up);
const renderedLists={},renderedListIds={};
function results(){
 const q=$('#query').value.trim().toLowerCase();
 for(const list of [1,2]){
  const listId=state?.settings?.cueLists?.[list-1]||list;
  if(renderedListIds[list]!==listId){followed[list]=null;renderedListIds[list]=listId;}
  const found=cues.filter(c=>c.list===listId&&`${c.list}/${c.number} ${c.number} ${c.name}`.toLowerCase().includes(q));
  const current=state?.eos.connected&&Date.now()-state.eos.lastReceived<15000?state.eos.lists[listId]?.current?.number:null;
  // Newly recorded cues can become active before the catalogue refresh completes.
  if(!q&&current!=null&&!found.some(c=>Number(c.number)===Number(current))){
   found.push({list:listId,number:current,name:state.eos.lists[listId].current.name||''});
   found.sort((a,b)=>Number(a.number)-Number(b.number));
  }
  const body=$('#results'+list),wrap=body.closest('.table-wrap');
  const signature=JSON.stringify([listId,found]);
  if(renderedLists[list]!==signature){
   const scroll=wrap.scrollTop,bounds=wrap.getBoundingClientRect();
   const anchor=Array.from(body.children).find(row=>row.getBoundingClientRect().bottom>bounds.top+30);
   const anchorNumber=anchor?.firstElementChild.textContent,offset=anchor?.getBoundingClientRect().top;
   const rows=found.map(c=>{const tr=document.createElement('tr');for(const [value,cls] of [[c.number],[c.name||'(Unlabelled)'],[cueTime(c),'time-col'],['']]){const td=document.createElement('td');td.textContent=value;if(cls)td.className=cls;tr.append(td);}return tr;});
   body.replaceChildren(...rows);renderedLists[list]=signature;
   const replacement=rows.find(row=>row.firstElementChild.textContent===anchorNumber);
   wrap.scrollTop=scroll;
   if(replacement&&offset!==undefined)wrap.scrollTop+=replacement.getBoundingClientRect().top-offset;
  }
  for(const row of body.children){const active=current!=null&&Number(row.firstElementChild.textContent)===Number(current);row.classList.toggle('current',active);const label=active?'Current':'';if(row.lastElementChild.textContent!==label)row.lastElementChild.textContent=label;}
  $('#search-status'+list).textContent=found.length?`${found.length} cues`:'No matching cues';
 }
 followCurrent();
}

function render(){const eosFresh=state.eos.connected&&Date.now()-state.eos.lastReceived<15000;$('#connection').textContent=eosFresh&&state.disguise.connected?'Live · Read only':'Some sources unavailable';for(const l of [1,2]){const el=$('#list'+l),s=state.eos.lists[state.settings.cueLists[l-1]];el.querySelector('.card-head span').textContent='EOS · LIST '+state.settings.cueLists[l-1];document.querySelectorAll('.cue-column h3')[l-1].textContent='List '+state.settings.cueLists[l-1];el.classList.toggle('offline',!eosFresh);el.querySelector('.status').textContent=eosFresh?'Live':'Disconnected';el.querySelector('.list-name').textContent=s.name;el.querySelector('.cue-number').textContent=s.current?.number||'—';el.querySelector('.cue-name').textContent=s.current?(s.current.name||'(Unlabelled)'):(eosFresh?'No active cue':'Waiting for Eos');el.querySelector('.next').textContent=s.next?`Next  ${s.next.number} · ${s.next.name}`:'Next cue unavailable';}const d=state.disguise;$('#disguise').classList.toggle('offline',!d.connected);$('#d-status').textContent=d.connected?'Live':'Disconnected';$('#track').textContent=d.track||'Waiting for Designer';$('#section').textContent=d.section?`Section ${d.section}${d.sectionName?' · '+d.sectionName:''}`:'…';$('#engaged').textContent=d.engaged===undefined?'Unknown':d.engaged?'Engaged':'Disengaged';$('#engaged').className=d.engaged?'engaged':'';$('#mode').textContent=({HoldSection:'Holding at section end',PlaySection:'Play to section end',Play:'Playing',Stop:'Stopped',LoopSection:'Loop section'})[d.playmode]||d.playmode||'Unknown';$('#output').textContent=({0:'Faded down',1:'Faded up',2:'Hold'})[d.output]||'Output unknown';$('#time').textContent=time(d.time);$('#section-time').textContent=time(d.sectionTime);$('#d-cue').textContent=d.cue||'None';$('#count').textContent=state.eos.loaded<state.eos.total?`Loading ${state.eos.loaded} / ${state.eos.total}`:`${cues.length} cues indexed`;}
async function poll(){try{const r=await fetch('/api/state',{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error();state=await r.json();render();if(state.eos.loaded!==lastLoaded||Date.now()-lastCatalogue>15000){cues=await(await fetch('/api/cues',{signal:AbortSignal.timeout(3000)})).json();lastLoaded=state.eos.loaded;lastCatalogue=Date.now();}render();results();}catch{$('#connection').textContent='Page disconnected · Data may be old';document.querySelectorAll('article').forEach(el=>el.classList.add('offline'));}finally{setTimeout(poll,1000);}}
try{$('#autofollow').checked=localStorage.getItem('show-follow-auto')!=='false';}catch{}
$('#autofollow').addEventListener('change',()=>{
 try{localStorage.setItem('show-follow-auto',String($('#autofollow').checked));}catch{}
 followed[1]=followed[2]=null;followCurrent();
});
const showTimes=()=>$('.search').classList.toggle('hide-times',!$('#cuetimes').checked);
try{$('#cuetimes').checked=localStorage.getItem('show-cue-times')!=='false';}catch{}
showTimes();
$('#cuetimes').addEventListener('change',()=>{try{localStorage.setItem('show-cue-times',String($('#cuetimes').checked));}catch{}showTimes();});
$('#query').addEventListener('input',()=>{followed[1]=followed[2]=null;results();});poll();
if(typeof ResizeObserver!=='undefined'){
 const observer=new ResizeObserver(()=>followCurrent());
 document.querySelectorAll('.table-wrap').forEach(wrap=>observer.observe(wrap));
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)followCurrent();});


