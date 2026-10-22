import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import * as M from '../cloud/public/js/model.js';
const id='a'.repeat(64);
// Untrusted summaries: invalid IDs, wrong types and empty names are ignored, never thrown.
assert.deepEqual(M.parseSummaries({[id]:{name:'  <b>x</b> ',updatedAt:5,eosConnected:'true',disguiseConnected:true,extra:1},bad:{name:'x'},['b'.repeat(64)]:{name:''},['c'.repeat(64)]:'junk'}),[{id,name:'<b>x</b>',updatedAt:5,eosConnected:false,disguiseConnected:true}]);
assert.deepEqual(M.parseSummaries(null),[]);assert.deepEqual(M.parseSummaries([1,2]),[]);
assert.equal(M.parseSummary(id,{name:'x'.repeat(500)}).name.length,120);
// State and catalogue JSON: invalid or hostile content degrades to an error, not a crash.
for(const bad of ['{bad','null','[]','"text"',undefined,42])assert.ok(M.parseState(bad).error,'Invalid state: '+bad);
const st=M.parseState(JSON.stringify({eos:{connected:true,cueLists:[1,'2',1000,3,4],lists:{1:{name:7,current:{number:'1.5',name:'<script>'},next:'x'}}},disguise:{time:'5',section:2,engaged:'yes',playmode:'Play',__proto__:{polluted:true}}}));
assert.deepEqual(st.eos.cueLists,[1,3]);assert.equal(st.eos.lists[1].name,'');assert.equal(st.eos.lists[1].current.name,'<script>');assert.equal(st.eos.lists[1].next,null);
assert.equal(st.disguise.time,null);assert.equal(st.disguise.engaged,null);assert.equal({}.polluted,undefined);
for(const bad of ['{}','x',null,'{"length":5}'])assert.ok(M.parseCues(bad).error,'Invalid cues: '+bad);
const cues=M.parseCues(JSON.stringify([{list:1,number:'0.5',name:'a',up:1000,down:null},{list:1,number:5},{list:0,number:'1'},'x',{list:2,number:'9',name:{},up:-1}]));
assert.deepEqual(cues.rows,[{list:1,number:'0.5',name:'a',up:1000,down:null},{list:2,number:'9',name:'',up:null,down:null}]);assert.equal(cues.skipped,3);
assert.ok(M.parseCues(JSON.stringify(Array(M.MAX_CUES+1).fill(0))).error);
// Freshness thresholds and timing.
const now=1e6;
assert.equal(M.freshness(now-30000,now),'fresh');assert.equal(M.freshness(now-30001,now),'stale');assert.equal(M.freshness(now-120000,now),'stale');assert.equal(M.freshness(now-120001,now),'offline');assert.equal(M.freshness(null,now),'offline');
assert.equal(M.liveSeconds(10,{playmode:'Play',ageMs:4000,live:true}),14);
assert.equal(M.liveSeconds(10,{playmode:'Play',ageMs:60000,live:true}),22,'Extrapolation capped at one heartbeat');
assert.equal(M.liveSeconds(10,{playmode:'Play',ageMs:4000,live:false}),10,'Frozen when not live');
assert.equal(M.liveSeconds(10,{playmode:'HoldSection',ageMs:4000,live:true}),10,'Frozen when not playing');
assert.equal(M.fadeText(5000,3000),'5 / 3');assert.equal(M.fadeText(90000,90000),'1:30');assert.equal(M.fadeText(null,null),'');
assert.deepEqual(M.sortShows([{id:'2',name:'b',updatedAt:1},{id:'1',name:'a',updatedAt:2},{id:'3',name:'c',updatedAt:null}],'recent').map(s=>s.id),['1','2','3']);
for(const [name,n,want] of [['1 Main',1,'1 Main'],['51 Video',51,'51 Video'],['Main',1,'Main'],['Cue list 7',7,'7'],['',3,'3'],[null,51,'51']])assert.equal(M.listName(name,n),want,'list label '+name);
assert.deepEqual(M.filterShows([{name:'Hamlet'},{name:'Panto'}],' ham').map(s=>s.name),['Hamlet']);
// The hosted site has no route to local cuedo controls, settings or runtime code, and renders data only as text.
const site=new URL('../cloud/public/',import.meta.url),files=[];
const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true}))e.isDirectory()?walk(path.join(d,e.name)):files.push(path.join(d,e.name));};walk(site.pathname);
const sources=files.map(f=>[path.relative(site.pathname,f),fs.readFileSync(f,'utf8')]);
for(const [file,text] of sources){
 for(const forbidden of ['/api/','eos/goto','disguise/command','transports','newcmd','transportcontrol','playsection','gotonextsection','gotoprevsection','gototime','/eos/','web-eos','web-disguise','eos-control','server.mjs','settings.mjs','innerHTML','outerHTML','insertAdjacentHTML','document.write','eval(','new Function'])
  assert.ok(!text.includes(forbidden),file+' must not contain '+forbidden);
 assert.ok(!/from\s+['"]\.\.\//.test(text),file+' imports only website modules');
 for(const m of text.matchAll(/https:\/\/www\.gstatic\.com\/[^'"]+/g))assert.match(m[0],/^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\/firebase-(app|database)\.js$/,'Pinned Firebase SDK only');
}
assert.deepEqual(sources.map(([f])=>f).sort(),['favicon.svg','firebase-config.json','index.html','install.sh','js/app.js','js/data.js','js/identity.js','js/model.js','style.css']);
const hosting=JSON.parse(fs.readFileSync(new URL('../cloud/firebase.json',import.meta.url))).hosting;
const csp=hosting.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value;
assert.match(csp,/script-src 'self' https:\/\/www\.gstatic\.com;/);assert.match(csp,/style-src 'self';/);assert.ok(!csp.includes('unsafe'));
assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(new URL('../cloud/public/firebase-config.json',import.meta.url)))),['databaseURL'],'No API key or other identifiers in the public config');
for(const [file,text] of sources)assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(text),file+' contains no Google API key');
const rules=JSON.parse(fs.readFileSync(new URL('../cloud/database.rules.json',import.meta.url))).rules;
assert.equal(rules['.read'],false);assert.equal(rules['.write'],false);assert.deepEqual(Object.keys(rules).sort(),['.read','.write','showData','shows']);
console.log('PASS: untrusted summary/state/catalogue parsing, freshness thresholds, frozen/capped timing, no local control paths or HTML sinks in the hosted site, CSP and locked root rules');
