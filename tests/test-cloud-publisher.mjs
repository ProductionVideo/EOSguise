import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createPublisher,LIMITS} from '../cloud-publisher.mjs';
import {showIdFor} from '../cloud-identity.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const timing={tickMs:10,minIntervalMs:100,heartbeatMs:300,timeoutMs:200,backoffBaseMs:100,backoffMaxMs:400};

// Fake Firebase REST client. mode: 'ok' | 'hang' | status number | (body)=>status
function fakeCloud(){
 const cloud={mode:'ok',requests:[],active:0,maxActive:0};
 cloud.request=(url,init)=>{
  if(!init.method){cloud.reads=(cloud.reads||0)+1;return Promise.resolve(new Response(JSON.stringify(cloud.hash??null)));}
  const body=JSON.parse(init.body);cloud.requests.push({url:String(url),init,body,at:Date.now()});
  cloud.active++;cloud.maxActive=Math.max(cloud.maxActive,cloud.active);
  const done=()=>cloud.active--;
  const mode=typeof cloud.mode==='function'?cloud.mode(body):cloud.mode;
  if(mode==='hang')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>{done();reject(init.signal.reason);}));
  done();return Promise.resolve(new Response('{"error":"secret server detail"}',{status:mode==='ok'?200:mode}));
 };
 return cloud;
}
function show(){
 const s={state:{eos:{connected:true,loading:false,cueLists:[1],lists:{1:{name:'Main',current:{number:'1',name:'One',notes:''},next:null}}},disguise:{connected:false,transport:'',track:'',section:null,sectionName:'',cue:'',playmode:'',engaged:null,output:null,time:null,sectionTime:null}},catalogue:{version:1,values:[{list:1,number:'1',part:0,name:'One',up:5000,down:5000},{list:1,number:'1.5',part:0,name:'Point',up:1000,down:1000}]}};
 s.options=cloud=>({getState:()=>s.state,getCatalogue:()=>s.catalogue,request:cloud.request,databaseURL:'https://db.example/?ns=test',random:()=>1,...timing});
 return s;
}
const isFull=r=>Object.keys(r.body).some(k=>k.startsWith('showData/')&&!k.includes('/',9));
const ids=r=>[...new Set(Object.keys(r.body).map(k=>k.split('/')[1]))];

// Disabled by default: nothing is sent.
{const cloud=fakeCloud(),s=show(),p=createPublisher(s.options(cloud));await p.configure({enabled:false,showName:'Anything'});await p.configure();await wait(150);
 assert.equal(cloud.requests.length,0);assert.equal(p.status().state,'disabled');
 await p.configure({enabled:true,showName:'   '});assert.equal(p.status().state,'error');await wait(50);assert.equal(cloud.requests.length,0,'Enabled without a name publishes nothing');p.stop();}

// First publish is one atomic full snapshot; later activity is coalesced; heartbeats omit the catalogue.
{const cloud=fakeCloud(),s=show(),p=createPublisher(s.options(cloud));const id=await showIdFor('Test Show');
 await p.configure({enabled:true,showName:'  test   SHOW '});await wait(30);
 const first=cloud.requests[0];assert.ok(isFull(first),'First publish is full');
 assert.equal(first.url,'https://db.example/.json?ns=test');assert.equal(first.init.method,'PATCH');
 assert.equal(first.init.headers.Authorization,undefined,'No credentials');
 assert.deepEqual(Object.keys(first.body).sort(),['showData/'+id,'shows/'+id]);
 const summary=first.body['shows/'+id],detail=first.body['showData/'+id];
 assert.deepEqual(Object.keys(summary).sort(),['disguiseConnected','eosConnected','name','schemaVersion','sequence','sessionId','updatedAt']);
 assert.deepEqual(summary.updatedAt,{'.sv':'timestamp'});assert.deepEqual(detail.updatedAt,{'.sv':'timestamp'});
 assert.equal(summary.name,'test SHOW','Display name keeps the operator casing');
 assert.equal(detail.catalogueHash,sha(detail.cuesJson),'Hash of the exact cuesJson string');
 assert.deepEqual(JSON.parse(detail.cuesJson).map(c=>c.number),['1','1.5'],'Point cues kept as strings');
 // Rapid state changes: at most one request per minIntervalMs, carrying the latest state.
 const before=cloud.requests.length;
 for(let i=0;i<20;i++){s.state={...s.state,eos:{...s.state.eos,lists:{1:{...s.state.eos.lists[1],current:{number:String(100+i),name:'Cue',notes:''}}}}};await wait(10);}
 await wait(150);await p.idle();
 const burst=cloud.requests.slice(before);
 assert.ok(burst.length<=4,'Coalesced to about one request per interval, got '+burst.length);
 for(let i=1;i<burst.length;i++)assert.ok(burst[i].at-burst[i-1].at>=90,'At most one request per interval');
 const last=burst.at(-1);assert.ok(!isFull(last),'State change does not resend the catalogue');
 assert.deepEqual(Object.keys(last.body).sort(),['showData/'+id+'/stateJson','showData/'+id+'/updatedAt','shows/'+id]);
 assert.equal(JSON.parse(last.body['showData/'+id+'/stateJson']).eos.lists[1].current.number,'119','Latest state wins');
 const seqs=cloud.requests.map(r=>r.body['shows/'+id].sequence);assert.deepEqual(seqs,[...seqs].sort((a,b)=>a-b),'Sequence increases');
 assert.equal(new Set(cloud.requests.map(r=>r.body['shows/'+id].sessionId)).size,1,'One session ID per process');
 // Idle: heartbeat every heartbeatMs, state only.
 const idle=cloud.requests.length;await wait(700);const beats=cloud.requests.slice(idle);
 assert.ok(beats.length>=2&&beats.length<=3,'Heartbeats while idle: '+beats.length);assert.ok(beats.every(r=>!isFull(r)));
 // Catalogue change: full publish once.
 s.catalogue={version:2,values:[...s.catalogue.values,{list:1,number:'2',part:0,name:'Two',up:0,down:0}]};
 const pre=cloud.requests.length;await wait(150);const after=cloud.requests.slice(pre);
 assert.ok(isFull(after[0]),'Catalogue change sends full snapshot');assert.equal(JSON.parse(after[0].body['showData/'+id].cuesJson).length,3);
 assert.equal(cloud.maxActive,1,'One request in flight');
 assert.equal(p.status().state,'connected');p.stop();}

// Delete removed the details: heartbeat is rejected, retried once immediately as a full snapshot.
{const cloud=fakeCloud(),s=show(),p=createPublisher(s.options(cloud));await p.configure({enabled:true,showName:'Restore'});await wait(30);
 let deleted=true;cloud.mode=body=>deleted&&!isFull({body})?401:(deleted=false,'ok');
 const pre=cloud.requests.length;await wait(400);const tail=cloud.requests.slice(pre);
 assert.ok(!isFull(tail[0])&&isFull(tail[1]),'Heartbeat then immediate full retry');assert.ok(tail[1].at-tail[0].at<50);
 assert.ok(JSON.parse(tail[1].body[Object.keys(tail[1].body).find(k=>k.startsWith('showData/'))].cuesJson).length===2,'Catalogue restored');
 assert.equal(p.status().state,'connected');p.stop();}

// Repeated rejection: bounded exponential backoff, sanitized error, no endless full retries.
{const cloud=fakeCloud(),s=show(),p=createPublisher(s.options(cloud));cloud.mode=401;await p.configure({enabled:true,showName:'Denied'});await wait(1500);p.stop();
 const gaps=cloud.requests.slice(1).map((r,i)=>r.at-cloud.requests[i].at);
 assert.ok(cloud.requests.length<=8,'Backoff limits retries: '+cloud.requests.length);
 assert.ok(gaps.every(g=>g<=400+60),'Backoff is capped: '+gaps);assert.ok(Math.max(...gaps)>=350,'Backoff grows: '+gaps);
 assert.equal(p.status().error,'Cloud rejected the update (HTTP 401)');assert.ok(!JSON.stringify(p.status()).includes('secret'),'Response body never surfaces');}

// Timeout: hanging request is aborted, reported, and retried with backoff. The event loop stays responsive.
{const cloud=fakeCloud(),s=show(),p=createPublisher(s.options(cloud));cloud.mode='hang';await p.configure({enabled:true,showName:'Slow'});
 let worst=0;for(let i=0;i<20;i++){const t=Date.now();await wait(10);worst=Math.max(worst,Date.now()-t-10);}
 assert.ok(worst<40,'Local event loop not blocked: '+worst+'ms');
 await wait(250);const st=p.status();assert.equal(st.state,'retrying');assert.equal(st.error,'Cloud request timed out');assert.ok(st.retryAt>0,"A retry is scheduled");
 assert.equal(cloud.maxActive,1);p.stop();}

// Rename and disable while a request is in flight: the old request is aborted and the old ID is never written again.
{const cloud=fakeCloud(),s=show(),p=createPublisher(s.options(cloud));const oldId=await showIdFor('Old Name'),newId=await showIdFor('New Name');
 cloud.mode='hang';await p.configure({enabled:true,showName:'Old Name'});await wait(30);assert.equal(cloud.active,1);
 cloud.mode='ok';const switched=cloud.requests.length;await p.configure({enabled:true,showName:'New Name'});await wait(400);
 assert.equal(cloud.active,0,'Old request aborted');
 assert.ok(cloud.requests.slice(switched).every(r=>ids(r).every(i=>i===newId)),'Only the new show is written after rename');
 assert.ok(cloud.requests.slice(0,switched).every(r=>ids(r).every(i=>i===oldId)));
 assert.ok(isFull(cloud.requests[switched]),'New name starts with a full publish');assert.equal(p.status().showId,newId);
 cloud.mode='hang';await wait(350);assert.equal(cloud.active,1);
 await p.configure({enabled:false});const off=cloud.requests.length;await wait(400);
 assert.equal(cloud.requests.length,off,'Nothing after disable');assert.equal(cloud.active,0);assert.equal(p.status().state,'disabled');}

// Two shows and the same name: independent IDs; same name targets the same ID (last writer wins in the cloud).
{const a=fakeCloud(),b=fakeCloud(),c=fakeCloud(),s=show();
 const pa=createPublisher(s.options(a)),pb=createPublisher(s.options(b)),pc=createPublisher(s.options(c));
 await pa.configure({enabled:true,showName:'Show A'});await pb.configure({enabled:true,showName:'Show B'});await pc.configure({enabled:true,showName:'show a'});await wait(30);
 assert.notEqual(ids(a.requests[0])[0],ids(b.requests[0])[0]);assert.equal(ids(a.requests[0])[0],ids(c.requests[0])[0]);
 assert.notEqual(a.requests[0].body[Object.keys(a.requests[0].body)[0]].sessionId,c.requests[0].body[Object.keys(c.requests[0].body)[0]].sessionId,'Different processes have different sessions');
 pa.stop();pb.stop();pc.stop();}

// Oversized catalogue: clear local error, nothing silently dropped, no full publish attempted.
{const cloud=fakeCloud(),s=show();const huge='x'.repeat(500);
 s.catalogue={version:9,values:Array.from({length:Math.ceil(LIMITS.cues/500)+10},(_,i)=>({list:1,number:String(i+1),part:0,name:huge,up:0,down:0}))};
 const p=createPublisher(s.options(cloud));await p.configure({enabled:true,showName:'Huge'});await wait(100);
 assert.equal(cloud.requests.length,0);assert.equal(p.status().state,'error');assert.match(p.status().error,/too large to publish \(\d+ cues\)/);p.stop();}

// Catalogue check: a different cloud hash (another same-name publisher) triggers a full republish; a matching one does not.
{const cloud=fakeCloud(),s=show(),p=createPublisher({...s.options(cloud),catalogueCheckMs:200});await p.configure({enabled:true,showName:'Checked'});await wait(30);
 const id=await showIdFor('Checked');cloud.hash=cloud.requests[0].body['showData/'+id].catalogueHash;
 await wait(500);assert.ok(cloud.reads>=1,'Hash checked');assert.ok(cloud.requests.slice(1).every(r=>!isFull(r)),'Matching hash: no full publish');
 cloud.hash='0'.repeat(64);const pre=cloud.requests.length;await wait(400);
 assert.ok(cloud.requests.slice(pre).some(isFull),'Replaced catalogue is republished');p.stop();}

// Network failure: sanitized code only.
{const s=show(),p=createPublisher({...s.options(fakeCloud()),request:async()=>{throw new TypeError('fetch failed',{cause:Object.assign(Error('getaddrinfo ENOTFOUND db.example (10.1.2.3)'),{code:'ENOTFOUND'})});}});
 await p.configure({enabled:true,showName:'Offline'});await wait(50);assert.equal(p.status().error,'Cannot reach the cloud (ENOTFOUND)');p.stop();}

console.log('PASS: disabled default, atomic full publish, coalescing, heartbeats without catalogue, catalogue change, delete recovery, backoff cap, timeout, responsive event loop, rename/disable in flight, independent and same-name shows, oversized catalogue, sanitized errors');
