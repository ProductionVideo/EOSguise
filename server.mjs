import {CueCatalogue} from './cue-catalogue.mjs';
import {createListeners} from './listeners.mjs';
import {addresses,allowedRequest} from './network.mjs';
import {pathToFileURL} from 'node:url';
import {createLive,discover} from './disguise-live.mjs';
import {validateSettings,validateCloudSettings,saveSettings} from './settings.mjs';
import {createDirectorHandler} from './web-disguise.mjs';
import {createCueHandler} from './web-eos.mjs';
import {createPublisher} from './cloud-publisher.mjs';import {telemetryState} from './cloud-telemetry.mjs';
import http from 'node:http';import net from 'node:net';import fs from 'node:fs';import {message,slip,parser} from './osc.mjs';
const configFile=process.env.EOSGUISE_CONFIG?pathToFileURL(process.env.EOSGUISE_CONFIG):new URL('./config.json',import.meta.url);
if(!fs.existsSync(configFile))fs.copyFileSync(new URL('./config.example.json',import.meta.url),configFile);
const cfg=JSON.parse(fs.readFileSync(configFile));
cfg.cueLists ||= [1,2];cfg.controlList ||= 2;cfg.revision ||= 1;cfg.publishEnabled=cfg.publishEnabled===true;cfg.showName=typeof cfg.showName==='string'?cfg.showName:'';
const state={app:'eosguise',eos:{connected:false,lastReceived:0,lists:{1:{name:'Cue list 1',current:null,next:null},2:{name:'Cue list 2',current:null,next:null}},loaded:0,total:0},disguise:{connected:false}};
let reconnectTimer;
let catalogueSource=null;
function prepareCatalogue(){
 const source=JSON.stringify([cfg.eosHost,cfg.eosPort]);
 if(catalogueSource!==source)catalogue.clear();
 else catalogue.reconnect(cfg.cueLists);
 catalogueSource=source;
}
let catalogue=new CueCatalogue(),socket,queue=[],counts={},received=new Set(),generation=0,lastPing=0;
function send(address,args=[]){if(!/^\/eos\/(get\/|ping$|cuelist\/[0-9]+\/config\/[0-9]+\/0\/1$|subscribe$)/.test(address))throw Error('Read-only OSC address denied');if(socket&&!socket.destroyed)socket.write(slip(message(address,args)));}
function connect(){const gen=++generation;clearTimeout(reconnectTimer);socket?.destroy();state.eos.connected=false;state.eos.lists=Object.fromEntries(cfg.cueLists.map(l=>[l,{name:"Cue list "+l,current:null,next:null}]));queue=[];counts={};received.clear();prepareCatalogue();state.eos.loaded=0;state.eos.total=0;for(const l of Object.values(state.eos.lists)){l.current=null;l.next=null;}socket=net.createConnection({host:cfg.eosHost,port:cfg.eosPort});socket.on('connect',()=>{if(gen!==generation)return;state.eos.connected=true;state.eos.error='';state.eos.lastReceived=Date.now();for(const l of cfg.cueLists){send(`/eos/cuelist/${l}/config/${l}/0/1`);send(`/eos/get/cue/${l}/count`);}send('/eos/get/version');send('/eos/subscribe',[1]);});socket.on('data',parser(({address:a,args:v})=>{if(gen!==generation)return;
 state.eos.lastReceived=Date.now();let m;const match=a.match(/\/(?:cuelist|cue)\/(\d+)/);if(match&&!cfg.cueLists.includes(Number(match[1])))return;
 if((m=a.match(/^\/eos\/out\/cuelist\/([0-9]+)$/)))state.eos.lists[m[1]].name=v[0];
 else if((m=a.match(/^\/eos\/out\/cuelist\/([0-9]+)\/([0-9]+)$/))){const l=state.eos.lists[m[1]],cue={number:String(v[1]||''),name:String(v[2]||''),notes:String(v[3]||''),duration:v[6],remaining:v[7]};if(m[2]==='1'){l.current=/^\s*[\[{]/.test(String(v[0]))?cue:null;l.next=l.current?l.next:cue;}else if(l.current)l.next=cue;}
 else if((m=a.match(/^\/eos\/out\/get\/cue\/([0-9]+)\/count$/))){queue=queue.filter(a=>!a.startsWith('/eos/get/cue/'+m[1]+'/'));for(const key of received)if(key.startsWith(m[1]+'/'))received.delete(key);counts[m[1]]=Math.min(20000,v[0]);catalogue.begin(m[1],counts[m[1]]);state.eos.total=Object.values(counts).reduce((a,b)=>a+b,0);for(let i=0;i<counts[m[1]];i++)queue.push(`/eos/get/cue/${m[1]}/index/${i}`);}
 else if((m=a.match(/^\/eos\/out\/get\/cue\/([0-9]+)\/([^/]+)\/(\d+)\/list\/0\/\d+$/))){const key=`${m[1]}/${m[2]}/${m[3]}`;catalogue.add({list:Number(m[1]),number:m[2],part:Number(m[3]),name:String(v[2]||''),up:Number(v[3]),down:Number(v[5])},v[0]);received.add(m[1]+'/'+v[0]);state.eos.loaded=received.size;}
 else if((m=a.match(/^\/eos\/out\/notify\/cue\/([0-9]+)\/list\//))){const path='/eos/get/cue/'+m[1]+'/count';if(!queue.includes(path))queue.push(path);}
 }));socket.on('error',e=>{if(gen===generation)state.eos.error=e.message;});socket.on('close',()=>{if(gen===generation){state.eos.connected=false;reconnectTimer=setTimeout(connect,3000);}});}
connect();setInterval(()=>{if(!state.eos.connected)return;if(queue.length)send(queue.shift());if(Date.now()-lastPing>5000){lastPing=Date.now();send('/eos/ping',['eosguise']);}if(Date.now()-state.eos.lastReceived>15000)socket.destroy();},40);
let live=createLive(cfg,s=>{state.disguise=s;});
// Public status publishing is opt-in and outbound only. EOSGUISE_CLOUD_DATABASE_URL is for local tests.
const publisher=createPublisher({getState:()=>telemetryState(state,cfg.cueLists),getCatalogue:()=>({version:catalogue.version,values:catalogue.values()}),...(process.env.EOSGUISE_CLOUD_DATABASE_URL?{databaseURL:process.env.EOSGUISE_CLOUD_DATABASE_URL}:{})});
publisher.configure({enabled:cfg.publishEnabled,showName:cfg.showName});
let handleCue=createCueHandler(cfg,undefined,(list,cue)=>catalogue.lookup(list,cue)); let handleDirector=createDirectorHandler(cfg,()=>state.disguise);
const assets={'/settings':['settings.html','text/html'],'/settings.js':['settings.js','text/javascript'],'/settings.css':['settings.css','text/css'],'/disguise':['disguise.html','text/html'],'/disguise.js':['disguise.js','text/javascript'],'/disguise.css':['disguise.css','text/css'],'/eos':['eos.html','text/html'],'/eos.js':['eos.js','text/javascript'],'/eos.css':['eos.css','text/css'],'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
function handler(req,res){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'self'");if(new URL(req.url,'http://localhost').pathname==='/api/disguise/command'){handleDirector(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});return;}if(new URL(req.url,'http://localhost').pathname==='/api/eos/goto'){handleCue(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});return;}if(new URL(req.url,'http://localhost').pathname.startsWith('/api/settings')||new URL(req.url,'http://localhost').pathname==='/api/transports'){settingsRoute(req,res).catch(e=>{if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));});return;}if(req.method!=='GET'){res.writeHead(405);return res.end('Read only');}const u=new URL(req.url,'http://localhost');if(u.pathname==='/api/state'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({...state,settings:{revision:cfg.revision,cueLists:cfg.cueLists,controlList:cfg.controlList,transportName:cfg.transportName},now:Date.now()}));}if(u.pathname==='/api/cues'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify([...catalogue.values()].filter(c=>c.part===0).sort((a,b)=>a.list-b.list||Number(a.number)-Number(b.number))));}const asset=assets[u.pathname];if(!asset){res.writeHead(404);return res.end('Not found');}res.setHeader('Content-Type',asset[1]+'; charset=utf-8');res.end(fs.readFileSync(new URL('./'+asset[0],import.meta.url)));}
const listeners=createListeners(cfg,handler);
async function settingsRoute(req,res){
 const reply=(status,p)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(p));};
 const u=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&u.pathname==='/api/settings/network')return reply(200,{addresses:listeners.rows(),revision:cfg.revision});
 if(req.method==='GET'&&u.pathname==='/api/settings')return reply(200,cfg);
 if(req.method==='GET'&&u.pathname==='/api/settings/cloud')return reply(200,{enabled:cfg.publishEnabled,showName:cfg.showName,status:publisher.status()});
 if(req.method==='POST'&&u.pathname==='/api/settings/cloud'){
  // Publishing changes never touch the Eos/Director connections and work while hardware is offline.
  if(!allowedRequest(req,cfg.port))return reply(403,{error:'Open Settings from this server'});
  if(saving)return reply(409,{error:'Settings are being saved'});
  let text='';for await(const chunk of req){text+=chunk;if(text.length>1024)return reply(413,{error:'Request too large'});}
  const next=validateCloudSettings(JSON.parse(text));
  saveSettings({...cfg,...next},configFile);Object.assign(cfg,next);
  await publisher.configure({enabled:cfg.publishEnabled,showName:cfg.showName});
  return reply(200,{saved:true,enabled:cfg.publishEnabled,showName:cfg.showName,status:publisher.status()});
 }
 if(req.method==='GET'&&u.pathname==='/api/transports'){
  const host=u.searchParams.get('director')||cfg.director;
  const url=new URL(host.includes('://')?host:'http://'+host);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid Director address');
  return reply(200,await discover(url.origin));
 }
 if(req.method==='POST'&&u.pathname==='/api/settings/network'){
  if(!allowedRequest(req,cfg.port))return reply(403,{error:'Open Settings from this server'});
  let text='';for await(const chunk of req){text+=chunk;if(text.length>4096)return reply(413,{error:'Request too large'});}
  const input=JSON.parse(text);
  if(saving||input.revision!==cfg.revision)return reply(409,{error:'Settings changed. Reload this page.'});
  const rows=addresses(cfg.port);if(typeof input.shared!=='boolean'||!rows.some(a=>a.adapter===input.adapter&&!a.local))return reply(400,{error:'Choose a network adapter'});
  const disabled=new Set(cfg.disabledInterfaces||[]);if(input.shared)disabled.delete(input.adapter);else disabled.add(input.adapter);
  const next={...cfg,disabledInterfaces:[...disabled],revision:cfg.revision+1};saveSettings(next,configFile);Object.assign(cfg,next);
  reply(200,{saved:true,revision:cfg.revision});setTimeout(()=>listeners.reconcile(),100);return;
 }
 if(req.method!=='POST'||u.pathname!=='/api/settings')return reply(405,{error:'Method not allowed'});
 if(!allowedRequest(req,cfg.port))return reply(403,{error:'Open Settings from this server'});
 if(saving)return reply(409,{error:'Settings are being saved'});
 let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)return reply(413,{error:'Request too large'});}
 saving=true;try{
  const input=JSON.parse(body);if(input.revision!==cfg.revision)return reply(409,{error:'Settings changed. Reload this page.'});
  const next=validateSettings(input,cfg);const available=await discover(next.director);const transport=available.find(t=>t.uid===next.transportUid);if(!transport)throw Error('Selected transport is not available');next.transportName=transport.name;
  saveSettings(next,configFile);
  live.stop();Object.assign(cfg,next);state.disguise={connected:false};live=createLive(cfg,s=>{state.disguise=s;});connect();handleCue=createCueHandler(cfg,undefined,(list,cue)=>catalogue.lookup(list,cue));handleDirector=createDirectorHandler(cfg,()=>state.disguise);
  reply(200,{saved:true,revision:cfg.revision});
 }finally{saving=false;}
}
let saving=false;
