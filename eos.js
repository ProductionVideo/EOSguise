const $=s=>document.querySelector(s);let busy=false,cues=[],connected=false,lastCatalogue=0,controlList=2,revision;
const valid=()=>/^\d{1,5}(?:\.\d{1,3})?$/.test($('#cue').value);
function update(){const c=cues.find(c=>c.list===controlList&&Number(c.number)===Number($('#cue').value));$('#cue-name').textContent=$('#cue').value?c?.name||'':'';$('#go').disabled=busy||!connected||!valid();}
function notice(text,error=false){$('#result').textContent=text;$('#result').classList.toggle('error',error);}
function focusEntry(){if(window.matchMedia('(pointer:fine)').matches)$('#cue').focus({preventScroll:true});}
function edit(k){
 if(busy)return;
 let s=$('#cue').value;
 if(k==='back')s=s.slice(0,-1);
 else if(k==='clear')s='';
 else{if(k==='.'&&s.includes('.'))return;if(s.length<9)s+=k==='.'&&!s?'0.':k;}
 $('#cue').value=s;notice('');update();
}
document.querySelectorAll('[data-key]').forEach(b=>b.addEventListener('click',()=>edit(b.dataset.key)));
$('#cue').addEventListener('input',()=>{notice('');update();});
document.addEventListener('keydown',e=>{
 if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing||busy)return;
 const target=e.target;
 if(target?.closest('a,select,textarea,[contenteditable=true]')||(target?.tagName==='INPUT'&&target!==$('#cue')))return;
 if(e.key==='Enter'){e.preventDefault();if(!e.repeat)sendCue();return;}
 if(e.key==='Escape'){e.preventDefault();edit('clear');return;}
 if(target===$('#cue'))return;
 if(/^\d$/.test(e.key)||e.key==='.'||e.key==='Decimal'){e.preventDefault();edit(e.key==='Decimal'?'.':e.key);}
 else if(e.key==='Backspace'||e.key==='Delete'){e.preventDefault();edit(e.key==='Backspace'?'back':'clear');}
});
async function sendCue(){
 if(busy||!valid()||!connected)return;
 const cue=$('#cue').value;busy=true;$('#cue').disabled=true;update();notice('Sending…');
 try{
  const r=await fetch('/api/eos/goto',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cue,revision}),signal:AbortSignal.timeout(8000)});
  const p=await r.json();if(!r.ok)throw Error(p.error||'Send failed');
  $('#cue').value='';notice(`Sent: cue ${p.list}/${cue}`);
 }catch(e){notice(e.name==='TimeoutError'?'No reply. Check Eos before retrying.':e.message,true);}
 finally{busy=false;$('#cue').disabled=false;update();focusEntry();}
}
$('#go').addEventListener('click',sendCue);
async function poll(){try{const s=await(await fetch('/api/state',{signal:AbortSignal.timeout(3000)})).json();if(Date.now()-lastCatalogue>15000){cues=await(await fetch('/api/cues')).json();lastCatalogue=Date.now();}controlList=s.settings.controlList;revision=s.settings.revision;const letter=s.settings.cueLists.indexOf(controlList)===1?'B':'A';document.querySelector('label[for=cue]').textContent='Go to cue · '+letter+' · List '+controlList;$('#go').textContent='Go to cue · '+letter;connected=s.eos.connected&&Date.now()-s.eos.lastReceived<15000;const c=s.eos.lists[controlList].current;$('#current').textContent=connected?(c?`Current: ${controlList}/${c.number} · ${c.name}`:'No active cue in list '+controlList):'Eos disconnected';}catch{connected=false;$('#current').textContent='Server disconnected';}update();setTimeout(poll,1000);}
fetch('/api/cues').then(r=>r.json()).then(c=>{cues=c;update();}).catch(()=>{});focusEntry();poll();
