import assert from 'node:assert/strict';import http from 'node:http';import {once} from 'node:events';
import {WebSocketServer} from '../vendor/ws/wrapper.mjs';import {createLive,discover,objectPath,properties} from '../disguise-live.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));let director,wsServer,live;
try{
 const closed=http.createServer().listen(0,'127.0.0.1');await once(closed,'listening');const dead='http://127.0.0.1:'+closed.address().port;closed.close();
 assert.equal(objectPath('12123513483926918423'),'getByUID(0xa83f5f47cf1f5517)');
 await assert.rejects(discover(dead),e=>e.message==='Cannot reach Director at '+dead+' (ECONNREFUSED)');
 director=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:{code:0},result:[{uid:'111',name:'show'}]}));});director.listen(0,'127.0.0.1');await once(director,'listening');
 // A Director that never answers ping frames and rejects one property expression.
 wsServer=new WebSocketServer({server:director,autoPong:false});let connections=0;
 wsServer.on('connection',ws=>{connections++;ws.on('message',b=>{const q=JSON.parse(b);if(q.subscribe.object!=='getByUID(0x6f)'){ws.send(JSON.stringify({error:'Unable to subscribe to object: InvalidCharacter'}));return;}const subs=q.subscribe.properties.map((p,i)=>({id:i+1,propertyPath:p.replace(/^object\./,'').replace(/,/g,', ')}));
  ws.send(JSON.stringify({error:'sectionName: NoneType has no attribute getNote'}));ws.send(JSON.stringify({subscriptions:subs}));
  const values={time:5,engaged:true,output:1,playmode:'Play'};const send=()=>ws.readyState===1&&ws.send(JSON.stringify({valuesChanged:q.subscribe.properties.map((p,i)=>({id:String(i+1),value:values[Object.keys(properties).find(k=>properties[k]===p)]})).filter(v=>v.value!==undefined)}));send();const t=setInterval(send,1000);ws.on('close',()=>clearInterval(t));});});
 let state;live=createLive({director:'http://127.0.0.1:'+director.address().port,transportUid:'111'},s=>{state=s;},{retryMs:200,heartbeatMs:500});
 await wait(8000);
 assert.equal(state.connected,true,'stays connected without pong and with a property error');assert.equal(connections,1,'no reconnect loop');assert.match(state.warning,/NoneType/);
 console.log('PASS: unreachable Director reason, property errors are non-fatal, liveness without pong, reformatted property paths and string ids.');
}catch(e){console.error(e);process.exitCode=1;}finally{live?.stop();wsServer?.close();director?.close();}
