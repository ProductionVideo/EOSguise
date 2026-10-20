import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {WebSocketServer} from '../vendor/ws/wrapper.mjs';import {properties} from '../disguise-live.mjs';import {message,slip,parser} from '../osc.mjs';
const calls=[],eosCommands=[],subscriptions=[];let helper,wsServer,director,eos;const sockets=new Set();
const dir=new URL('./test-state/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 director=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;calls.push({path:req.url,body:body?JSON.parse(body):null});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:{code:0},result:[{uid:'111',name:'show'},{uid:'222',name:'utility'}]}));});director.listen(0,'127.0.0.1');await once(director,'listening');
 wsServer=new WebSocketServer({server:director});wsServer.on('connection',ws=>{ws.on('message',b=>{const q=JSON.parse(b);subscriptions.push(q);assert.ok(q.subscribe);const alt=q.subscribe.object==='getByUID(0xde)';const values={transport:alt?'utility':'show',track:'Test track',time:20,section:3,sectionStart:18,previousStart:10,sectionName:'Cue name',cue:['1.5'],engaged:true,playmode:'HoldSection',brightness:1,output:1};const subs=q.subscribe.properties.map((p,i)=>({id:i+1,propertyPath:p,objectPath:q.subscribe.object}));ws.send(JSON.stringify({subscriptions:subs}));ws.send(JSON.stringify({valuesChanged:subs.map(s=>({id:s.id,value:values[Object.keys(properties).find(k=>properties[k]===s.propertyPath)]}))}));});});
 eos=net.createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});s.on('data',parser(({address,args})=>{
  if(address==='/eos/ping')s.write(slip(message('/eos/out/ping',args)));
  else if(address==='/eos/newcmd')eosCommands.push(args[0]);
  else if(address.endsWith('/count'))s.write(slip(message(address.replace('/eos/','/eos/out/'),[2])));
  else {const m=address.match(/^\/eos\/get\/cue\/(\d+)\/index\/(\d+)$/);if(m){const number=['0.3','13'][Number(m[2])];s.write(slip(message(`/eos/out/get/cue/${m[1]}/${number}/0/list/0/1`,[Number(m[2]),number,'Mock cue',...[[5000,0,5000],[2500,0,90000]][Number(m[2])]])));}}
 }));});eos.listen(0,'127.0.0.1');await once(eos,'listening');
 const spare=net.createServer().listen(0,'127.0.0.1');await once(spare,'listening');const port=spare.address().port;await new Promise(r=>spare.close(r));
 const cfg={director:'http://127.0.0.1:'+director.address().port,eosHost:'127.0.0.1',eosPort:eos.address().port,cueLists:[1,2],controlList:2,transportUid:'111',transportName:'show',revision:1,port,lanAddress:'',additionalAddresses:[]};const config=new URL('config.json',dir);fs.writeFileSync(config,JSON.stringify(cfg));
 const base='http://127.0.0.1:'+port;let logs='';helper=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,EOSGUISE_CONFIG:fileURLToPath(config)},windowsHide:true});helper.stderr.on('data',b=>logs+=b);helper.stdout.on('data',()=>{});
 async function state(){return (await fetch(base+'/api/state')).json();}async function until(fn){for(let i=0;i<100;i++){try{if(await fn())return;}catch{}await wait(100);}throw Error('Timed out: '+logs);}
 await until(async()=>{const s=await state();return s.disguise.connected&&s.eos.connected;});
 assert.equal((await state()).disguise.transportUid,'111');await wait(7000);assert.equal((await state()).disguise.connected,true,'Idle connection remains live');assert.ok(Date.now()-(await state()).disguise.updated<4000);assert.equal(subscriptions.length,1);
 const post=(path,body)=>fetch(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
 for(const action of ['engage','disengage','play','stop','previous','next','previous-end','fade-up','fade-down'])assert.equal((await post('/api/disguise/command',{action,revision:1})).status,200);
 assert.ok(!calls.some(c=>c.path.includes('python')));const prev=calls.find(c=>c.path.endsWith('/gototime')).body.transports[0];assert.deepEqual(prev,{transport:{uid:'111'},time:17,playmode:'NotSet'});
 assert.equal((await post('/api/eos/goto',{cue:'0.3',revision:1})).status,200);assert.deepEqual(eosCommands,['Go_To_Cue 2 / 0.3 Enter']);
 assert.equal((await post('/api/eos/goto',{cue:'99999',revision:1})).status,404);assert.equal(eosCommands.length,1,'Nonexistent cue cannot send an Eos command');
 const changed={...cfg,transportUid:'222',cueLists:[7,9],controlList:9};assert.equal((await post('/api/settings',changed)).status,200);await until(async()=>(await state()).disguise.transportUid==='222'&&(await state()).disguise.connected);
 assert.equal((await post('/api/disguise/command',{action:'play',revision:1})).status,409);assert.equal((await post('/api/eos/goto',{cue:'13',revision:1})).status,409);
 assert.equal((await post('/api/disguise/command',{action:'next',revision:2})).status,200);assert.equal(calls.at(-1).body.transports[0].transport.uid,'222');
 await until(async()=>(await(await fetch(base+'/api/cues')).json()).some(c=>c.list===9&&c.number==='13'));{const c=(await(await fetch(base+'/api/cues')).json()).find(c=>c.list===9&&c.number==='13');assert.equal(c.up,2500);assert.equal(c.down,90000);}
 assert.equal((await post('/api/eos/goto',{cue:'13',revision:2})).status,200);assert.equal(eosCommands.at(-1),'Go_To_Cue 9 / 13 Enter');
 assert.equal(JSON.parse(fs.readFileSync(config)).transportUid,'222');
 for(const ws of wsServer.clients)ws.terminate();await until(async()=>!(await state()).disguise.connected);assert.equal((await post('/api/disguise/command',{action:'play',revision:2})).status,503);await until(async()=>(await state()).disguise.connected);assert.equal((await state()).disguise.transportUid,'222');
 for(const path of ['/','/settings','/eos','/disguise'])assert.equal((await fetch(base+path)).status,200);
 assert.equal((await post('/api/settings',{...changed,revision:2,cueLists:[1,1]})).status,400);
 assert.equal(wsServer.clients.size,1,'No leaked subscriptions after settings/reconnect');
 console.log('PASS: idle heartbeat, subscription reconnect/cleanup, selected transport commands, preserved navigation mode, previous-end timing, decimal Eos cue, configurable lists, stale command rejection, persisted settings, pages. All commands used mock servers.');
}catch(e){console.error(e);process.exitCode=1;}finally{helper?.kill();for(const s of sockets)s.destroy();for(const ws of wsServer?.clients||[])ws.terminate();wsServer?.close();director?.close();eos?.close();}
