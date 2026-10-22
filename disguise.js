const $=s=>document.querySelector(s);let fresh=false,busy=false,revision;
const time=n=>Number.isFinite(n)?[Math.floor(n/3600),Math.floor(n/60)%60,Math.floor(n)%60].map(x=>String(x).padStart(2,'0')).join(':'):'…';
function buttons(){document.querySelectorAll('[data-action]').forEach(b=>b.disabled=busy||!fresh);}
async function poll(){try{
 const r=await fetch('/api/state',{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error();const s=await r.json(),d=s.disguise;
 revision=s.settings.revision;$('#transport-name').textContent=d.transport||s.settings.transportName;fresh=d.connected&&s.now-d.updated<5000;$('#status').textContent=fresh?'Live':'Disconnected';$('#status').title=d.error||d.warning||'';$('#feedback').textContent=fresh?(d.warning||''):[d.error,d.warning].filter(Boolean).join(' · ');$('#director').classList.toggle('offline',!fresh);
 $('#track').textContent=d.track||'Waiting for Designer';$('#section').textContent=d.section?`Section ${d.section}${d.sectionName?' · '+d.sectionName:''}`:'…';
 $('#engaged').textContent=d.engaged?'Engaged':'Disengaged';$('#engaged').className=d.engaged?'engaged':'';
 $('#mode').textContent=({HoldSection:'Holding at section end',PlaySection:'Play to section end',Play:'Playing',Stop:'Stopped',LoopSection:'Loop section'})[d.playmode]||d.playmode||'Unknown';
 $('#output').textContent=({0:'Faded down',1:'Faded up',2:'Hold'})[d.output]||'Output unknown';$('#output').className=Number(d.output)===1?'positive':'';$('#time').textContent=time(d.time);$('#section-time').textContent=time(d.sectionTime);$('#cue').textContent=d.cue||'None';
 $('#fade').textContent=Number(d.output)===1?'Fade down':'Fade up';$('#fade').dataset.action=Number(d.output)===1?'fade-down':'fade-up';$('#fade').classList.toggle('is-up',Number(d.output)===1);$('#fade').classList.toggle('is-down',Number(d.output)===0);
 $('#engage').textContent=d.engaged?'Engaged':'Disengaged';$('#engage').dataset.action=d.engaged?'disengage':'engage';$('#engage').classList.toggle('is-engaged',!!d.engaged);
 }catch{fresh=false;$('#status').textContent='Disconnected';$('#feedback').textContent='cuedo server unreachable';$('#director').classList.add('offline');}finally{buttons();setTimeout(poll,1000);}}
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{
 if(busy||!fresh)return;const action=button.dataset.action;busy=true;buttons();$('#result').textContent='Sending…';
 try{const r=await fetch('/api/disguise/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,revision}),signal:AbortSignal.timeout(15000)});const p=await r.json();if(!r.ok)throw Error(p.error||'Command failed');$('#result').textContent=p.message;}
 catch(e){$('#result').textContent=e.name==='TimeoutError'?'No response. Check Director status before trying again.':e.message;}
 finally{busy=false;buttons();}
}));buttons();poll();

