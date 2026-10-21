// End-to-end acceptance test against the Firebase Realtime Database emulator (real database.rules.json)
// and the real dashboard in headless Chrome. Run from cloud/:
//   firebase emulators:exec --only database --project stagewiki-cues "node tests/test-emulator.mjs"
// Never touches the production database or any show hardware.
import assert from 'node:assert/strict';
import {createPublisher} from '../../cloud-publisher.mjs';
import {showIdFor} from '../../cloud-identity.mjs';
import {serve} from './serve.mjs';
import {launch,chromePath} from './browser.mjs';
const DB='http://127.0.0.1:9000',NS='stagewiki-cues-default-rtdb';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const url=path=>`${DB}/${path}.json?ns=${NS}`;
async function rest(method,path,body,owner=false){
 const r=await fetch(url(path),{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:'Bearer owner'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await r.text();return {status:r.status,json:text?JSON.parse(text):null};
}
const TS={'.sv':'timestamp'};
const summary=(name,extra={})=>({schemaVersion:1,name,updatedAt:TS,sessionId:'test',sequence:1,eosConnected:true,disguiseConnected:false,...extra});
const detail=(extra={})=>({schemaVersion:1,updatedAt:TS,stateJson:'{}',cuesJson:'[]',catalogueHash:'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',...extra});
const until=async(fn,what,ms=10000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=e.message;}await wait(100);}throw Error('Timed out: '+what+' (last: '+JSON.stringify(last)+')');};

function makeShow(cues=40){
 const show={state:{eos:{connected:true,loading:false,cueLists:[1,2],lists:{1:{name:'Main',current:{number:'12.5',name:'Point cue',notes:'Slow build'},next:{number:'13',name:'Night',notes:''}},2:{name:'FX',current:null,next:null}}},disguise:{connected:true,transport:'show',track:'Act 1',section:3,sectionName:'Storm',cue:'1.5',playmode:'Play',engaged:true,output:1,time:83,sectionTime:12}},
  catalogue:{version:1,values:[...Array.from({length:cues},(_,i)=>({list:1,number:String(i+1),part:0,name:'Cue '+(i+1),up:3000,down:3000})),{list:1,number:'12.5',part:0,name:'Point cue',up:90000,down:5000}]}};
 show.publisher=createPublisher({getState:()=>show.state,getCatalogue:()=>show.catalogue,databaseURL:`${DB}/?ns=${NS}`,heartbeatMs:1000,minIntervalMs:300,backoffBaseMs:200,backoffMaxMs:1000,catalogueCheckMs:2000});
 return show;
}
const shows=[];let server,browser;
try{
 assert.equal((await rest('PUT','',null,true)).status,200,'Emulator reset');
 // ---------- Rules (the deployed v1 contract) ----------
 const id=await showIdFor('Rules Show');
 assert.equal((await rest('GET','')).status,401,'Root not readable');
 assert.equal((await rest('GET','showData')).status,401,'Detail collection not listable');
 assert.equal((await rest('GET','shows')).status,200,'Summaries readable');
 assert.equal((await rest('PATCH','',{['shows/'+id]:summary('Rules Show'),['showData/'+id]:detail()})).status,200,'Unauthenticated full publish');
 assert.equal((await rest('GET','showData/'+id)).status,200,'Detail readable');
 const denied=async(body,why)=>assert.equal((await rest('PATCH','',body)).status,401,why);
 await denied({['shows/'+id]:summary('Rules Show',{command:'go'})},'Unknown field');
 await denied({['commands/'+id]:{go:1}},'Control path');
 await denied({['settings/'+id]:{x:1}},'Settings path');
 await denied({['shows/NOT-AN-ID']:summary('x')},'Invalid ID');
 await denied({['shows/'+id]:summary('Rules Show',{updatedAt:1})},'Forged timestamp');
 await denied({['shows/'+id]:summary('x'.repeat(121))},'Name too long');
 await denied({['shows/'+id]:{name:'x',updatedAt:TS}},'Missing fields');
 await denied({['showData/'+id+'/stateJson']:'x'.repeat(16385),['showData/'+id+'/updatedAt']:TS},'Oversized state');
 await denied({['showData/'+id+'/catalogueHash']:'nothex'},'Bad hash');
 await denied({['showData/'+id+'/cuesJson']:'x'.repeat(1048577),['showData/'+id+'/updatedAt']:TS},'Oversized catalogue');
 assert.equal((await rest('PATCH','',{['showData/'+id+'/cuesJson']:'x'.repeat(1048576),['showData/'+id+'/updatedAt']:TS})).status,200,'Catalogue at the limit is accepted');
 await denied({shows:null},'Ancestor delete');
 assert.equal((await rest('PATCH','',{['shows/'+id]:null,['showData/'+id]:null})).status,200,'Public atomic delete');
 await denied({['shows/'+id]:summary('Rules Show'),['showData/'+id+'/updatedAt']:TS,['showData/'+id+'/stateJson']:'{}'},'Heartbeat cannot recreate missing detail');
 assert.deepEqual((await rest('GET','shows/'+id)).json,null);

 // ---------- Publisher against the real rules ----------
 const a=makeShow(),b=makeShow(5);shows.push(a,b);
 b.state={...b.state,eos:{...b.state.eos,lists:{1:{name:'Main',current:{number:'1',name:'<img src=x onerror="window.__xss=1">',notes:'"><script>window.__xss=2</script>'},next:null},2:{name:'FX',current:null,next:null}}}};
 const idA=await showIdFor('Hamlet'),idB=await showIdFor('<img src=x onerror="window.__xss=1"> Panto');
 await a.publisher.configure({enabled:true,showName:'Hamlet'});await b.publisher.configure({enabled:true,showName:'<img src=x onerror="window.__xss=1"> Panto'});
 await until(async()=>(await rest('GET','shows')).json?.[idA]&&(await rest('GET','shows')).json?.[idB],'two independent shows');
 const stored=(await rest('GET','showData/'+idA)).json;
 assert.equal(JSON.parse(stored.cuesJson).find(c=>c.number==='12.5').name,'Point cue');
 // Same canonical name from another process: last writer wins, same public show.
 const twin=makeShow(1);shows.push(twin);twin.state={...twin.state,disguise:{...twin.state.disguise,track:'Twin track'}};
 await twin.publisher.configure({enabled:true,showName:'HAMLET'});
 await until(async()=>JSON.parse((await rest('GET','showData/'+idA)).json.stateJson).disguise.track==='Twin track','same-name last writer');
 assert.equal((await rest('GET','shows/'+idA)).json.name,'HAMLET');
 twin.publisher.stop();await until(async()=>JSON.parse((await rest('GET','showData/'+idA)).json.stateJson).disguise.track==='Act 1','original publisher writes again');
 await until(async()=>JSON.parse((await rest('GET','showData/'+idA)).json.cuesJson).length===41,'catalogue check restores the overwritten catalogue');

 // ---------- Dashboard in Chrome ----------
 if(!chromePath){console.log('SKIP dashboard checks: Chrome not found');}
 else{
  server=await serve();const site='http://127.0.0.1:'+server.address().port;browser=await launch();
  const page=await browser.page();
  await page.goto(site+'/');
  await until(()=>page.evaluate(`document.querySelectorAll('.show-row').length===2`),'directory rows');
  assert.equal(await page.text('#connection'),'Live');
  const names=await page.evaluate(`[...document.querySelectorAll('.show-name')].map(e=>e.textContent).sort()`);
  assert.deepEqual(names,['<img src=x onerror="window.__xss=1"> Panto','Hamlet'],'Hostile names render as text');
  // Directory search
  await page.evaluate(`(()=>{const i=document.querySelector('input[type=search]');i.value='ham';i.dispatchEvent(new Event('input'));})()`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.show-row').length`),1);
  await page.evaluate(`(()=>{const i=document.querySelector('input[type=search]');i.value='';i.dispatchEvent(new Event('input'));})()`);
  // Index live update: Eos disconnect appears without reload.
  a.state={...a.state,eos:{...a.state.eos,connected:false}};
  await until(()=>page.evaluate(`[...document.querySelectorAll('.show-row')].some(r=>r.textContent.includes('Hamlet')&&r.textContent.includes('Eos disconnected'))`),'index live update');
  a.state={...a.state,eos:{...a.state.eos,connected:true}};
  // Navigate in-app to the hostile show detail.
  await page.evaluate(`[...document.querySelectorAll('.show-row')].find(r=>r.textContent.includes('Panto')).click()`);
  await until(()=>page.evaluate(`location.pathname==='/show/${idB}'&&document.querySelector('.cue-label')?.textContent.includes('onerror')`),'hostile detail');
  assert.equal(await page.evaluate(`document.querySelectorAll('img,script:not([src])').length`),0,'No injected elements');
  assert.equal(await page.evaluate(`window.__xss`),undefined,'No injected script ran');
  // Back navigation keeps one summary listener and closes detail.
  await page.evaluate(`history.back()`);await until(()=>page.evaluate(`location.pathname==='/'&&document.querySelectorAll('.show-row').length===2`),'back navigation');
  // Direct link to Hamlet: current cue, times and catalogue; then a live detail update.
  await page.goto(site+'/show/'+idA);
  await until(()=>page.evaluate(`document.querySelector('.cue-number')?.textContent==='12.5'&&document.querySelectorAll('tbody tr').length>=41`),'detail render');
  assert.equal(await page.evaluate(`document.querySelector('.cue-fade').textContent`),'Time 1:30 / 5');
  assert.equal(await page.evaluate(`document.querySelector('tr.current td').textContent`),'12.5');
  a.state={...a.state,eos:{...a.state.eos,lists:{...a.state.eos.lists,1:{name:'Main',current:{number:'13',name:'Night',notes:''},next:{number:'14',name:'Dawn',notes:''}}}}};
  await until(()=>page.evaluate(`document.querySelector('.cue-number')?.textContent==='13'&&document.querySelector('tr.current td')?.textContent==='13'`),'detail live update');
  // Cue search and times toggle.
  await page.evaluate(`(()=>{const i=document.querySelector('#cue-query');i.value='point';i.dispatchEvent(new Event('input'));})()`);
  assert.equal(await page.evaluate(`document.querySelectorAll('tbody tr').length`),1);
  await page.evaluate(`(()=>{const i=document.querySelector('#cue-query');i.value='';i.dispatchEvent(new Event('input'));document.querySelector('#show-times').click();})()`);
  assert.equal(await page.evaluate(`document.querySelectorAll('th.time').length`),0,'Times hidden');
  await page.evaluate(`document.querySelector('#show-times').click()`);
  assert.deepEqual(page.errors,[],'No script errors or CSP violations');

  // Delete while still publishing: removed, then restored with the full catalogue by the next activity.
  await page.evaluate(`document.querySelector('#delete').click()`);
  await until(()=>page.evaluate(`document.querySelector('#delete-status').textContent.startsWith('Deleted')`),'delete confirmed');
  await until(async()=>(await rest('GET','showData/'+idA)).json===null||(await rest('GET','showData/'+idA)).json?.updatedAt,'delete applied',3000);
  await until(async()=>{const d=(await rest('GET','showData/'+idA)).json;return d&&JSON.parse(d.cuesJson).length===41;},'restored with catalogue');
  await until(()=>page.evaluate(`document.querySelectorAll('tbody tr').length>=41&&document.querySelector('.cue-number')?.textContent==='13'`),'page recovers after restore');

  // Delete a stopped show: stays deleted.
  b.publisher.stop();
  await page.goto(site+'/show/'+idB);await until(()=>page.evaluate(`!document.querySelector('#delete').disabled`),'B loaded');
  await page.evaluate(`document.querySelector('#delete').click()`);
  await until(()=>page.evaluate(`document.querySelector('#detail-notice').textContent.includes('not publishing')`),'deleted state');
  await wait(2500);
  assert.equal((await rest('GET','shows/'+idB)).json,null,'Stopped show stays deleted');assert.equal((await rest('GET','showData/'+idB)).json,null);
  assert.equal(await page.evaluate(`document.querySelector('#delete').disabled`),true);

  // Direct link to a show that is not publishing recovers when it appears.
  const late=makeShow(3);shows.push(late);const idLate=await showIdFor('Late Show');
  await page.goto(site+'/show/'+idLate);
  await until(()=>page.evaluate(`document.querySelector('#detail-notice').textContent.includes('not publishing')`),'missing show message');
  await late.publisher.configure({enabled:true,showName:'Late Show'});
  await until(()=>page.evaluate(`document.querySelector('#detail-name').textContent==='Late Show'&&document.querySelectorAll('tbody tr').length===4`),'missing show appears');

  // Failed delete keeps the listing and offers retry (database refuses: emulate offline network for the request).
  await page.offline(true);
  await until(()=>page.evaluate(`document.querySelector('#connection').textContent!=='Live'`),'browser disconnection shown');
  await page.evaluate(`document.querySelector('#delete').click()`);
  await until(()=>page.evaluate(`document.querySelector('#delete').textContent==='Retry delete'&&document.querySelector('#delete-status').textContent.startsWith('Could not delete')`),'failed delete');
  assert.ok(await page.evaluate(`document.querySelector('.card .muted')?.textContent.includes('Timing frozen')`),'Timing frozen while browser disconnected');
  assert.ok((await rest('GET','shows/'+idLate)).json,'Listing kept after failed delete');
  await page.offline(false);
  await until(()=>page.evaluate(`document.querySelector('#connection').textContent==='Live'`),'reconnected',20000);
  late.publisher.stop();

  // Stale, offline and invalid records (written with emulator owner access to fake old timestamps / bad JSON).
  const now=Date.now(),idStale=await showIdFor('Stale Show'),idOld=await showIdFor('Old Show'),idBad=await showIdFor('Broken Show');
  await rest('PATCH','',{
   ['shows/'+idStale]:{...summary('Stale Show'),updatedAt:now-45000},['showData/'+idStale]:{...detail(),updatedAt:now-45000},
   ['shows/'+idOld]:{...summary('Old Show'),updatedAt:now-200000},['showData/'+idOld]:{...detail(),updatedAt:now-200000},
   ['shows/'+idBad]:summary('Broken Show',{updatedAt:now}),['showData/'+idBad]:{...detail(),updatedAt:now,stateJson:'{not json',cuesJson:'"nope"'},
   ['shows/'+'f'.repeat(64)]:{name:12,junk:true}},true);
  await page.goto(site+'/');
  const badgeFor=name=>page.evaluate(`[...document.querySelectorAll('.show-row')].find(r=>r.querySelector('.show-name').textContent===${JSON.stringify(name)})?.querySelector('.badge')?.textContent`);
  await until(async()=>(await badgeFor('Stale Show'))?.includes('Stale')&&(await badgeFor('Old Show'))?.includes('Offline'),'stale/offline badges');
  assert.ok(await page.evaluate(`[...document.querySelectorAll('.show-row')].find(r=>r.textContent.includes('Old Show')).textContent.includes('Eos last reported connected')`),'Old status labelled as last known');
  assert.equal(await page.evaluate(`[...document.querySelectorAll('.show-name')].filter(n=>n.textContent==='Hamlet').length`),1,'No duplicate rows');
  await page.goto(site+'/show/'+idBad);
  await until(()=>page.evaluate(`document.querySelector('.card.error')?.textContent==='Show status could not be read'&&document.querySelector('#catalogue-lists').textContent.includes('Cue list could not be read')`),'invalid JSON state').catch(async e=>{console.error(await page.evaluate(`document.querySelector('main').innerText.slice(0,400)`));throw e;});
  await page.goto(site+'/show/'+idOld);
  await until(()=>page.evaluate(`document.querySelector('#detail-notice').textContent.includes('over 2 minutes')`),'offline detail notice');
  await page.goto(site+'/not-a-page');
  await until(()=>page.evaluate(`document.querySelector('#notice').textContent.includes('does not exist')`),'unknown route');
  // Many tabs at once (the database serves HTTP/1.1, so per-tab HTTP streams would exhaust the browser's 6-connection limit).
  const tabs=await Promise.all(Array.from({length:8},()=>browser.page()));
  await Promise.all(tabs.map(t=>t.goto(site+'/show/'+idA)));
  await Promise.all(tabs.map((t,i)=>until(()=>t.evaluate(`document.querySelectorAll('tbody tr').length>=41`),'tab '+i+' loads')));
  tabs.forEach(t=>t.close());
  page.close();
 }
 console.log('PASS: deployed rules contract, unauthenticated publish/delete, rejected spoof/control/oversize writes, real publisher, same-name last writer, live index/detail updates, delete + restore with catalogue, stopped show stays deleted, direct links and recovery, failed delete retry, browser disconnect, stale/offline/invalid data, XSS-safe text, no script errors');
}catch(e){console.error(e);process.exitCode=1;}
finally{for(const s of shows)s.publisher.stop();browser?.close();server?.close();server?.closeAllConnections?.();}
