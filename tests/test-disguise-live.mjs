import assert from 'node:assert/strict';import http from 'node:http';import {once} from 'node:events';
import {WebSocketServer} from '../vendor/ws/wrapper.mjs';import {createLive,discover,properties} from '../disguise-live.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));let director,wsServer,live;
try{
 const closed=http.createServer().listen(0,'127.0.0.1');await once(closed,'listening');const dead='http://127.0.0.1:'+closed.address().port;closed.close();
 await assert.rejects(discover(dead),e=>e.message==='Cannot reach Director at '+dead+' (ECONNREFUSED)');
 director=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:{code:0},result:[{uid:'111',name:'show'}]}));});director.listen(0,'127.0.0.1');await once(director,'listening');
 // A Director that never answers ping frames and rejects one property expression.
 wsServer=new WebSocketServer({server:director,autoPong:false});let connections=0;
 wsServer.on('connection',ws=>{connections++;ws.on('message',b=>{const q=JSON.parse(b);const subs=q.subscribe.properties.map((p,i)=>({id:i+1,propertyPath:p}));
  ws.send(JSON.stringify({error:'sectionName: NoneType has no attribute getNote'}));ws.send(JSON.stringify({subscriptions:subs}));
  const values={time:5,engaged:true,output:1,playmode:'Play'};const send=()=>ws.readyState===1&&ws.send(JSON.stringify({valuesChanged:subs.filter(s=>Object.keys(values).some(k=>properties[k]===s.propertyPath)).map(s=>({id:s.id,value:values[Object.keys(properties).find(k=>properties[k]===s.propertyPath)]}))}));send();const t=setInterval(send,1000);ws.on('close',()=>clearInterval(t));});});
 let state;live=createLive({director:'http://127.0.0.1:'+director.address().port,transportUid:'111'},s=>{state=s;},{retryMs:200,heartbeatMs:500});
 await wait(8000);
 assert.equal(state.connected,true,'stays connected without pong and with a property error');assert.equal(connections,1,'no reconnect loop');assert.match(state.warning,/NoneType/);
 console.log('PASS: unreachable Director reason, property errors are non-fatal, liveness without pong.');
}catch(e){console.error(e);process.exitCode=1;}finally{live?.stop();wsServer?.close();director?.close();}
