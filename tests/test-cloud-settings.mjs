// Runs the real server with an existing (pre-cloud) config, offline Director and a mock cloud endpoint.
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {showIdFor} from '../cloud-identity.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dir=new URL('./test-state-cloud/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
const freePort=async()=>{const s=net.createServer().listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
let helper,eos,cloud;const sockets=new Set();
try{
 // Eos console that accepts connections (counted) but never answers; Director is offline.
 let eosConnections=0;eos=net.createServer(s=>{eosConnections++;sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));});eos.listen(0,'127.0.0.1');await once(eos,'listening');
 const cloudLog=[];let cloudMode='ok';
 cloud=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;cloudLog.push({method:req.method,url:req.url,headers:req.headers,body});if(cloudMode==='hang')return;res.setHeader('Content-Type','application/json');res.end('{}');});
 cloud.listen(0,'127.0.0.1');await once(cloud,'listening');
 const port=await freePort(),directorPort=await freePort();
 const original={director:'http://127.0.0.1:'+directorPort,eosHost:'127.0.0.1',eosPort:eos.address().port,cueLists:[1,2],controlList:2,transportUid:'98765432109876543210',transportName:'show',revision:4,port};
 const config=new URL('config.json',dir);fs.writeFileSync(config,JSON.stringify(original));
 const base='http://127.0.0.1:'+port;let logs='';
 helper=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,EOSGUISE_CONFIG:fileURLToPath(config),EOSGUISE_CLOUD_DATABASE_URL:'http://127.0.0.1:'+cloud.address().port},windowsHide:true});
 helper.stderr.on('data',b=>logs+=b);helper.stdout.on('data',()=>{});
 const until=async(fn,ms=8000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return;}catch{}await wait(50);}throw Error('Timed out: '+logs);};
 const post=(path,body,headers={origin:base,'content-type':'application/json'})=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
 const cloudSettings=async()=>(await fetch(base+'/api/settings/cloud')).json();
 await until(async()=>(await fetch(base+'/api/state')).ok);await until(()=>eosConnections>0);

 // Migration: an existing config without cloud settings starts with publishing off and sends nothing.
 assert.deepEqual(await cloudSettings().then(p=>[p.enabled,p.showName,p.status.state]),[false,'','disabled']);
 await wait(800);assert.equal(cloudLog.length,0,'Nothing published by default');
 assert.deepEqual(JSON.parse(fs.readFileSync(config)),original,'Config file untouched until the operator saves');

 // Only the local Settings page may change publishing.
 assert.equal((await post('/api/settings/cloud',{enabled:true,showName:'X'},{'content-type':'application/json'})).status,403,'No Origin');
 assert.equal((await post('/api/settings/cloud',{enabled:true,showName:'X'},{origin:'https://cues.stage.wiki','content-type':'application/json'})).status,403,'Public website origin');
 assert.equal((await post('/api/settings/cloud',{enabled:true,showName:'   '})).status,400,'Name required');
 assert.equal((await post('/api/settings/cloud',{enabled:'yes',showName:'X'})).status,400);
 assert.equal((await post('/api/settings/cloud',{enabled:true,showName:'x'.repeat(121)})).status,400);

 // Enabling with only a show name works while the Director is offline, quickly, without touching hardware connections.
 const connectionsBefore=eosConnections,started=Date.now();
 const saved=await post('/api/settings/cloud',{enabled:true,showName:'  Test   Show '});
 assert.equal(saved.status,200);assert.ok(Date.now()-started<1000,'Publish-only save does not wait for hardware');
 const savedConfig=JSON.parse(fs.readFileSync(config));
 assert.equal(savedConfig.publishEnabled,true);assert.equal(savedConfig.showName,'Test Show');assert.equal(savedConfig.revision,4,'Command revision unchanged: open control pages keep working');
 for(const k of Object.keys(original))assert.deepEqual(savedConfig[k],original[k],'Unrelated setting preserved: '+k);
 await until(()=>cloudLog.length>0);
 const id=await showIdFor('test show'),first=cloudLog[0],body=JSON.parse(first.body);
 assert.equal(first.method,'PATCH');assert.equal(first.url,'/.json');assert.equal(first.headers.authorization,undefined);
 assert.deepEqual(Object.keys(body).sort(),['showData/'+id,'shows/'+id]);
 assert.equal(JSON.parse(body['showData/'+id].stateJson).disguise.connected,false,'Offline Director reported honestly');
 for(const secret of ['127.0.0.1',String(port),String(directorPort),String(eos.address().port),original.transportUid,'ECONNREFUSED','config'])
  assert.ok(!first.body.includes(secret),'Never published: '+secret);
 await until(async()=>(await cloudSettings()).status.state==='connected');
 assert.equal((await cloudSettings()).status.url,'https://cues.stage.wiki/show/'+id);
 assert.equal(eosConnections,connectionsBefore,'Eos connection not restarted');

 // Cloud hangs: local pages, state and control endpoints stay responsive.
 cloudMode='hang';await wait(11000);
 for(const path of ['/api/state','/api/cues','/','/settings','/api/settings/cloud']){const t=Date.now();assert.equal((await fetch(base+path,{signal:AbortSignal.timeout(2000)})).status,200);assert.ok(Date.now()-t<500,path+' responsive during cloud outage');}
 {const t=Date.now();const r=await post('/api/eos/goto',{cue:'1',revision:4});assert.ok(r.status<500||r.status===503,'Local Go to Cue answers');assert.ok(Date.now()-t<1000);}
 await until(async()=>['retrying','publishing'].includes((await cloudSettings()).status.state)&&(await cloudSettings()).status.error==='Cloud request timed out',10000);

 // Disabling stops publishing even with a request stuck in flight; settings stay saved.
 cloudMode='ok';assert.equal((await post('/api/settings/cloud',{enabled:false,showName:'Test Show'})).status,200);
 const stopped=cloudLog.length;await wait(1500);assert.equal(cloudLog.length,stopped,'Nothing published after disable');
 assert.deepEqual(await cloudSettings().then(p=>[p.enabled,p.showName,p.status.state]),[false,'Test Show','disabled']);
 assert.equal(eosConnections,connectionsBefore,'Eos connection still not restarted');
 console.log('PASS: disabled migration, local-only settings, offline publish-only save, allowlisted outbound payload, no hardware restart, local responsiveness during cloud outage, disable in flight');
}catch(e){console.error(e);process.exitCode=1;}
finally{helper?.kill();for(const s of sockets)s.destroy();eos?.close();cloud?.closeAllConnections?.();cloud?.close();}
