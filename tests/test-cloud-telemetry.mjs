import assert from 'node:assert/strict';
import {telemetryState,telemetryCues,stateSignature} from '../cloud-telemetry.mjs';
const now=1_000_000;
const state={app:'eosguise',eos:{connected:true,lastReceived:now-1000,error:'connect ECONNREFUSED 10.0.0.9:3032',loaded:3,total:3,
 lists:{7:{name:'Main',current:{number:'12.5',name:'<img src=x onerror=alert(1)>',notes:'n'.repeat(5000),duration:5,remaining:2,uid:'secret'},next:{number:'13',name:'Next',notes:''}},9:{name:'FX',current:null,next:null}}},
 disguise:{connected:true,updated:now-100,transport:'show',transportUid:'12123513483926918423',track:'Act 1',cue:'1.5',time:83.25,section:3,sectionStart:80,previousStart:60,sectionName:'Storm',sectionTime:3.25,engaged:true,playmode:'Play',brightness:1,output:1,error:'Live Update: ECONNRESET',warning:'Live Update error: x',feedback:'Live Update'}};
const t=telemetryState(state,[7,9],now),json=JSON.stringify(t);
assert.deepEqual(Object.keys(t),['eos','disguise']);
assert.deepEqual(Object.keys(t.eos),['connected','loading','cueLists','lists']);
assert.deepEqual(Object.keys(t.disguise).sort(),['connected','cue','engaged','output','playmode','section','sectionName','sectionTime','time','track','transport'].sort());
assert.deepEqual(Object.keys(t.eos.lists[7].current),['number','name','notes']);
for(const secret of ['ECONNREFUSED','10.0.0.9','12123513483926918423','secret','ECONNRESET','warning','previousStart','feedback','eosguise'])assert.ok(!json.includes(secret),'Not published: '+secret);
assert.equal(t.eos.lists[7].current.number,'12.5','Point cue numbers stay strings');
assert.equal(t.eos.lists[7].current.name,'<img src=x onerror=alert(1)>','Labels are data, published verbatim');
assert.equal(t.eos.lists[7].current.notes.length,2000,'Notes are bounded');
assert.deepEqual(t.eos.cueLists,[7,9],'Configured list order is kept');
assert.equal(telemetryState(state,[7,9],now+20000).eos.connected,false,'Silent Eos is reported disconnected');
assert.equal(telemetryState(state,[7,9],now+6000).disguise.connected,false,'Silent Director is reported disconnected');
assert.ok(JSON.stringify(telemetryState({eos:{lists:{7:{name:{x:1},current:'junk',next:[1]}}},disguise:{time:'NaN',section:Infinity,engaged:'yes'}},[7,'x',1000],now)).length<2000,'Malformed input is tolerated');
assert.doesNotThrow(()=>telemetryState(null,null,now));
const moved={...state,disguise:{...state.disguise,time:99,sectionTime:19}};
assert.equal(stateSignature(telemetryState(moved,[7,9],now)),stateSignature(t),'Timer values do not trigger publishes');
assert.notEqual(stateSignature(telemetryState({...state,disguise:{...state.disguise,playmode:'Stop'}},[7,9],now)),stateSignature(t));
const cues=telemetryCues([{list:9,number:'2',part:0,name:'b',up:1000,down:-1},{list:7,number:'10',part:0,name:'x',up:5000,down:3000},{list:7,number:'2.5',part:0,name:'p',up:NaN,down:undefined},{list:7,number:'2.5',part:1,name:'part'},{list:7,number:'2',part:0,name:'a',up:0,down:0,secret:'s'}]);
assert.deepEqual(cues,[{list:7,number:'2',name:'a',up:0,down:0},{list:7,number:'2.5',name:'p',up:null,down:null},{list:7,number:'10',name:'x',up:5000,down:3000},{list:9,number:'2',name:'b',up:1000,down:null}],'Stable order, parts and unknown fields dropped, unset times null');
console.log('PASS: telemetry allowlist, no local/diagnostic data, point cues, bounds, malformed input, timer coalescing signature, stable catalogue');
