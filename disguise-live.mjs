import WebSocket from './vendor/ws/wrapper.mjs';
export const properties={
 transport:'object.description', track:'object.track.description',
 time:'object.track.beatToTime(object.player.tCurrent)',
 section:'int(object.track.beatToSection(object.player.tCurrent)) + 1',
 sectionStart:'object.track.beatToTime(object.track.sectionToBeat(object.track.beatToSection(object.player.tCurrent)))',
 previousStart:'object.track.beatToTime(object.track.sectionToBeat(max(0,int(object.track.beatToSection(object.player.tCurrent))-1)))',
 sectionName:'object.track.cueAtBeat(object.track.sectionToBeat(object.track.beatToSection(object.player.tCurrent))).getNote()',
 cue:'[str(x.text) for x in object.track.cueAtBeat(object.track.sectionToBeat(object.track.beatToSection(object.player.tCurrent))).getTags()]',
 engaged:'object.engaged', playmode:'str(object.player.playMode)', brightness:'object.brightness', output:'LocalState.directorState().output'
};
const norm=p=>String(p).replace(/\s+/g,'').replace(/^object\./,'');
export function matchSubscriptions(subs){
 const keys=Object.keys(properties),out=new Map();
 subs.forEach((s,i)=>{const field=keys.find(k=>norm(properties[k])===norm(s.propertyPath))||(subs.length===keys.length&&s.propertyPath===undefined?keys[i]:undefined);if(field)out.set(String(s.id),field);});
 if(!out.size&&subs.length===keys.length)subs.forEach((s,i)=>out.set(String(s.id),keys[i]));
 return out;
}
// Designer expressions take UIDs in hex; decimal UIDs above int64 fail to parse ("InvalidCharacter").
export const objectPath=uid=>'getByUID(0x'+BigInt(uid).toString(16)+')';
export const reason=e=>e?.name==='TimeoutError'?'timed out':e?.cause?.code||e?.cause?.message||e?.message||String(e);
export async function discover(director,request=fetch){
 let r;try{r=await request(director+'/api/session/transport/activetransport',{signal:AbortSignal.timeout(5000)});}catch(e){throw Error('Cannot reach Director at '+director+' ('+reason(e)+')');}
 const p=await r.json().catch(()=>null);
 if(!r.ok||!p||(p.status?.code??0)!==0||!Array.isArray(p.result))throw Error('Cannot read Director transports ('+(p?.status?.message||(r.ok?'unexpected response':'HTTP '+r.status))+')');
 return p.result.map(t=>({uid:String(t.uid),name:String(t.name)})).filter(t=>/^\d+$/.test(t.uid));
}
export function createLive(cfg,onState,{Socket=WebSocket,request=fetch,retryMs=3000,heartbeatMs=2000}={}){
 let ws,timer,heartbeat,epoch=0,closed=false,snapshot={connected:false},ids=new Map(),seen=new Set(),pongAt=0,logged=0,unmatched=false;
 const publish=()=>{snapshot.sectionTime=Number.isFinite(snapshot.time)&&Number.isFinite(snapshot.sectionStart)?snapshot.time-snapshot.sectionStart:null; const missing=['time','engaged','output','playmode'].filter(k=>!seen.has(k)); onState({...snapshot,connected:snapshot.connected&&!missing.length,...(snapshot.connected&&missing.length?{error:'Waiting for Director values: '+missing.join(', ')}:{}),feedback:'Live Update'});};
 const fail=message=>{if(message!==snapshot.error)console.error(new Date().toISOString(),'Disguise:',message);snapshot.connected=false;snapshot.error=message;publish();};
 async function connect(){
  const gen=++epoch;ids=new Map();seen=new Set();logged=0;unmatched=false;snapshot={connected:false};publish();
  try{
   const transports=await discover(cfg.director,request);if(closed||gen!==epoch)return;
   const selected=cfg.transportUid?transports.find(t=>t.uid===cfg.transportUid):transports.find(t=>t.name===(cfg.transportName||'show'));
   if(!selected)throw Error('Selected transport is unavailable. Choose one in Settings.');
   snapshot.transportUid=selected.uid;snapshot.transport=selected.name;
   const url=new URL('/api/session/liveupdate',cfg.director);url.protocol=url.protocol==='https:'?'wss:':'ws:';
   const socket=ws=new Socket(url,{handshakeTimeout:5000});
   socket.on('open',()=>{
    if(gen!==epoch)return socket.close();pongAt=Date.now();
    socket.send(JSON.stringify({subscribe:{object:objectPath(selected.uid),properties:Object.values(properties),configuration:{updateFrequencyMs:250}}}));
    heartbeat=setInterval(()=>{if(gen!==epoch)return;if(Date.now()-pongAt>6500){fail('Director feedback timed out');socket.terminate();return;}socket.ping();},heartbeatMs);
   });
   socket.on('pong',()=>{if(gen!==epoch)return;pongAt=Date.now();snapshot.updated=pongAt;publish();});
   socket.on('unexpected-response',(req,res)=>{if(gen!==epoch)return;fail('Live Update rejected (HTTP '+res.statusCode+')');socket.terminate();});
   socket.on('message',raw=>{if(gen!==epoch)return;pongAt=Date.now();try{
    const data=JSON.parse(String(raw));if(logged<3){logged++;console.error(new Date().toISOString(),'Disguise message:',String(raw).slice(0,3000));}
    if(data.error||data.errors){const text='Live Update error: '+(typeof data.error==='string'?data.error:JSON.stringify(data.error||data.errors));if(text!==snapshot.warning)console.error(new Date().toISOString(),'Disguise:',text);snapshot.warning=text;publish();return;}
    if(Array.isArray(data.subscriptions))for(const [id,field] of matchSubscriptions(data.subscriptions))ids.set(id,field);
    for(const v of data.valuesChanged||[]){const field=ids.get(String(v.id));if(field){snapshot[field]=field==='cue'&&Array.isArray(v.value)?v.value.join(', '):v.value;seen.add(field);}else if(!unmatched){unmatched=true;console.error(new Date().toISOString(),'Disguise: value for unknown subscription id',v.id,'known ids',JSON.stringify([...ids]));}}
    snapshot.connected=true;snapshot.updated=Date.now();snapshot.error='';publish();
   }catch{fail('Invalid Director feedback');socket.terminate();}});
   socket.on('error',e=>{if(gen===epoch)fail('Live Update: '+reason(e));});
   socket.on('close',()=>{if(gen!==epoch)return;clearInterval(heartbeat);fail('Director disconnected');if(!closed)timer=setTimeout(connect,retryMs);});
  }catch(e){if(gen!==epoch||closed)return;fail(e.message);timer=setTimeout(connect,retryMs);}
 }
 connect();return {stop(){closed=true;epoch++;clearTimeout(timer);clearInterval(heartbeat);ws?.terminate();}};
}
