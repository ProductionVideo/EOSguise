// Outbound-only status publisher for the public Cues website (https://cues.stage.wiki).
// It sends PATCH requests to the Firebase Realtime Database REST API and never reads instructions back:
// response bodies are discarded and only the HTTP status is used.
import {createHash,randomUUID} from 'node:crypto';
import {displayName,showIdFor} from './cloud-identity.mjs';
import {stateSignature,telemetryCues} from './cloud-telemetry.mjs';

export const CLOUD_DATABASE_URL='https://stagewiki-cues-default-rtdb.europe-west1.firebasedatabase.app';
export const CLOUD_SITE_URL='https://cues.stage.wiki';
export const LIMITS={state:65536,cues:4194304};
const TIMESTAMP={'.sv':'timestamp'};
const sha256=text=>createHash('sha256').update(text,'utf8').digest('hex');

// Only fixed messages and error codes reach the Settings page; never response bodies or stack traces.
function reason(e){
 if(e?.name==='TimeoutError')return 'Cloud request timed out';
 const code=e?.cause?.code;
 return typeof code==='string'&&/^[A-Z0-9_]{2,40}$/.test(code)?'Cannot reach the cloud ('+code+')':'Cannot reach the cloud';
}

export function createPublisher({getState,getCatalogue,request=fetch,now=Date.now,random=Math.random,databaseURL=CLOUD_DATABASE_URL,tickMs=250,minIntervalMs=1000,heartbeatMs=10000,timeoutMs=5000,backoffBaseMs=2000,backoffMaxMs=60000,catalogueCheckMs=60000}={}){
 const sessionId=randomUUID();
 const endpoint=new URL(databaseURL);endpoint.pathname='/.json';
 let sequence=0,generation=0,enabled=false,showId=null,showName='',timer=null,inFlight=null;
 // Cloud progress for the current show: what was last confirmed and when to try again.
 let needFull=true,sentSignature=null,sentHash=null,sentAt=-Infinity,checkedAt=-Infinity,failures=0,retryAt=0;
 // Catalogue JSON is rebuilt only when the local catalogue version changes.
 let catalogueVersion,cuesJson='[]',cuesHash=sha256('[]'),cueCount=0;
 let status={state:'disabled',showName:'',showId:'',lastSuccess:0,lastAttempt:0,error:'',retryAt:0,cues:0};
 const update=changes=>{status={...status,...changes};};

 function reset(){
  generation++;inFlight?.controller.abort();clearInterval(timer);timer=null;
  enabled=false;showId=null;needFull=true;sentSignature=null;sentHash=null;sentAt=-Infinity;checkedAt=-Infinity;failures=0;retryAt=0;
 }
 async function configure({enabled:wanted,showName:name}={}){
  reset();const gen=generation;
  if(!wanted){status={state:'disabled',showName:'',showId:'',lastSuccess:0,lastAttempt:0,error:'',retryAt:0,cues:0};return;}
  const display=displayName(name);
  if(!display){status={...status,state:'error',showName:'',showId:'',error:'Enter a show name to publish'};return;}
  const id=await showIdFor(display);
  if(gen!==generation)return;
  enabled=true;showId=id;showName=display;
  status={state:'publishing',showName:display,showId:id,lastSuccess:0,lastAttempt:0,error:'',retryAt:0,cues:cueCount};
  timer=setInterval(tick,tickMs);timer.unref?.();tick();
 }
 function fail(message){
  failures++;needFull=true;
  const delay=Math.min(backoffMaxMs,backoffBaseMs*2**(failures-1))*(0.5+random()*0.5);
  retryAt=now()+delay;update({state:'retrying',error:message,retryAt});
 }
 function tick(){
  if(!enabled||inFlight||now()<retryAt)return;
  let state;try{state=getState();}catch{return;}
  const catalogue=getCatalogue();
  if(catalogue.version!==catalogueVersion){
   catalogueVersion=catalogue.version;const rows=telemetryCues(catalogue.values);
   cuesJson=JSON.stringify(rows);cuesHash=sha256(cuesJson);cueCount=rows.length;update({cues:cueCount});
  }
  // Another publisher using the same name (or a manual edit) can replace the catalogue without deleting the show.
  if(!needFull&&sentHash&&now()-checkedAt>=catalogueCheckMs)return checkCatalogue();
  const signature=stateSignature(state),full=needFull||cuesHash!==sentHash,changed=full||signature!==sentSignature;
  const elapsed=now()-sentAt;
  if(elapsed<(changed?minIntervalMs:heartbeatMs))return;
  const stateJson=JSON.stringify(state);
  if(stateJson.length>LIMITS.state){sentAt=now();fail('Show status is too large to publish');return;}
  if(full&&cuesJson.length>LIMITS.cues){sentAt=now();retryAt=now()+heartbeatMs;update({state:'error',error:`Cue catalogue is too large to publish (${cueCount} cues). The local show is unaffected.`});return;}
  send(full,state,stateJson,signature);
 }
 // Reads only the 64-character catalogue hash. The value is compared, never used as data or instructions.
 async function checkCatalogue(){
  const gen=generation,controller=new AbortController(),target=new URL(endpoint);target.pathname='/showData/'+showId+'/catalogueHash.json';
  const job=(async()=>{
   const response=await request(target,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)])});
   const text=response.ok?(await response.text()).slice(0,100):'';
   return response.ok?text!==JSON.stringify(sentHash):false;
  })();
  inFlight={controller,job};checkedAt=now();
  try{if(await job&&gen===generation)needFull=true;}catch{}
  finally{if(inFlight?.job===job)inFlight=null;}
 }
 async function send(full,state,stateJson,signature){
  const gen=generation,id=showId,controller=new AbortController(),json=cuesJson,hash=cuesHash;
  const summary=()=>({schemaVersion:1,name:showName,updatedAt:TIMESTAMP,sessionId,sequence:++sequence,eosConnected:state.eos.connected,disguiseConnected:state.disguise.connected});
  const attempt=async withCatalogue=>{
   const body=withCatalogue
    ?{['shows/'+id]:summary(),['showData/'+id]:{schemaVersion:1,updatedAt:TIMESTAMP,stateJson,cuesJson:json,catalogueHash:hash}}
    :{['shows/'+id]:summary(),['showData/'+id+'/updatedAt']:TIMESTAMP,['showData/'+id+'/stateJson']:stateJson};
   const response=await request(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)])});
   response.body?.cancel?.().catch(()=>{});
   return response.status;
  };
  const job=(async()=>{
   let code=await attempt(full);
   // A heartbeat is rejected when Delete removed the details: retry once with a full snapshot.
   if(!full&&(code===400||code===401||code===403)&&gen===generation){full=true;code=await attempt(true);}
   return code;
  })();
  inFlight={controller,job};sentAt=now();update({lastAttempt:sentAt});
  try{
   const code=await job;
   if(gen!==generation)return;
   if(code<200||code>299)return fail('Cloud rejected the update (HTTP '+code+')');
   failures=0;retryAt=0;needFull=false;sentSignature=signature;if(full){sentHash=hash;checkedAt=now();}
   update({state:'connected',lastSuccess:now(),error:'',retryAt:0});
  }catch(e){if(gen===generation)fail(reason(e));}
  finally{if(inFlight?.job===job)inFlight=null;}
 }
 return {
  configure,
  status:()=>({...status,url:status.showId?CLOUD_SITE_URL+'/show/'+status.showId:''}),
  stop:reset,
  // For tests: resolves once no request is in flight.
  idle:async()=>{while(inFlight)await inFlight.job.catch(()=>{});}
 };
}
