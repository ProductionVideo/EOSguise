const $=s=>document.querySelector(s);let cues=[],state=null,lastCatalogue=0,lastLoaded=-1;
const time=n=>{if(!Number.isFinite(n))return '…';let t=Math.max(0,Math.floor(n));return [Math.floor(t/3600),Math.floor(t/60)%60,t%60].map(x=>String(x).padStart(2,'0')).join(':');};
const followed={1:null,2:null};
function followCurrent(){
 if(!$('#autofollow').checked||$('#query').value.trim())return;
 for(const list of [1,2]){
  const row=$('#results'+list).querySelector('tr.current');
  if(!row)continue;
  const number=row.firstElementChild.textContent;
  if(followed[list]===number)continue;
  const wrap=row.closest('.table-wrap');
  const bounds=wrap.getBoundingClientRect(),r=row.getBoundingClientRect();
  wrap.scrollTop+=r.top-bounds.top-(wrap.clientHeight-r.height)/2;
  followed[list]=number;
 }
}
function results(){const q=$('#query').value.trim().toLowerCase();for(const list of [1,2]){const found=cues.filter(c=>c.list===(state?.settings?.cueLists?.[list-1]||list)&&`${c.list}/${c.number} ${c.number} ${c.name}`.toLowerCase().includes(q));const body=$('#results'+list);const wrap=body.closest('.table-wrap'),scroll=wrap.scrollTop;body.replaceChildren();for(const c of found){const active=state?.eos.connected&&Date.now()-state.eos.lastReceived<15000&&state.eos.lists[state.settings.cueLists[list-1]]?.current?.number===c.number;const tr=document.createElement('tr');if(active)tr.className='current';for(const value of [c.number,c.name||'(Unlabelled)',active?'Current':'']){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}$('#search-status'+list).textContent=found.length?`${found.length} cues`:'No matching cues';wrap.scrollTop=scroll;}followCurrent();}
function render(){const eosFresh=state.eos.connected&&Date.now()-state.eos.lastReceived<15000;$('#connection').textContent=eosFresh&&state.disguise.connected?'Live · Read only':'Some sources unavailable';for(const l of [1,2]){const el=$('#list'+l),s=state.eos.lists[state.settings.cueLists[l-1]];el.querySelector('.card-head span').textContent='EOS · LIST '+state.settings.cueLists[l-1];document.querySelectorAll('.cue-column h3')[l-1].textContent='List '+state.settings.cueLists[l-1];el.classList.toggle('offline',!eosFresh);el.querySelector('.status').textContent=eosFresh?'Live':'Disconnected';el.querySelector('.list-name').textContent=s.name;el.querySelector('.cue-number').textContent=s.current?.number||'—';el.querySelector('.cue-name').textContent=s.current?.name||(eosFresh?'No active cue':'Waiting for Eos');el.querySelector('.next').textContent=s.next?`Next  ${s.next.number} · ${s.next.name}`:'Next cue unavailable';}const d=state.disguise;$('#disguise').classList.toggle('offline',!d.connected);$('#d-status').textContent=d.connected?'Live':'Disconnected';$('#d-feedback').textContent=d.connected?(d.warning||''):[d.error,d.warning].filter(Boolean).join(' · ');$('#track').textContent=d.track||'Waiting for Designer';$('#section').textContent=d.section?`Section ${d.section}${d.sectionName?' · '+d.sectionName:''}`:'…';$('#engaged').textContent=d.engaged===undefined?'Unknown':d.engaged?'Engaged':'Disengaged';$('#engaged').className=d.engaged?'engaged':'';$('#mode').textContent=({HoldSection:'Holding at section end',PlaySection:'Play to section end',Play:'Playing',Stop:'Stopped',LoopSection:'Loop section'})[d.playmode]||d.playmode||'Unknown';$('#output').textContent=({0:'Faded down',1:'Faded up',2:'Hold'})[d.output]||'Output unknown';$('#time').textContent=time(d.time);$('#section-time').textContent=time(d.sectionTime);$('#d-cue').textContent=d.cue||'None';$('#count').textContent=state.eos.loaded<state.eos.total?`Loading ${state.eos.loaded} / ${state.eos.total}`:`${cues.length} cues indexed`;}
async function poll(){try{const r=await fetch('/api/state',{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error();state=await r.json();render();if(state.eos.loaded!==lastLoaded||Date.now()-lastCatalogue>15000){cues=await(await fetch('/api/cues',{signal:AbortSignal.timeout(3000)})).json();lastLoaded=state.eos.loaded;lastCatalogue=Date.now();}render();results();}catch{$('#connection').textContent='Page disconnected · Data may be old';document.querySelectorAll('article').forEach(el=>el.classList.add('offline'));}finally{setTimeout(poll,1000);}}
try{$('#autofollow').checked=localStorage.getItem('show-follow-auto')!=='false';}catch{}
$('#autofollow').addEventListener('change',()=>{
 try{localStorage.setItem('show-follow-auto',String($('#autofollow').checked));}catch{}
 followed[1]=followed[2]=null;followCurrent();
});
$('#query').addEventListener('input',()=>{followed[1]=followed[2]=null;results();});poll();


