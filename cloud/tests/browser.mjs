// Minimal headless Chrome driver over the DevTools protocol, using cuedo's vendored ws.
import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import WebSocket from '../../vendor/ws/wrapper.mjs';

const candidates=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'];
export const chromePath=candidates.find(p=>p&&fs.existsSync(p));
const wait=ms=>new Promise(r=>setTimeout(r,ms));

export async function launch(){
 if(!chromePath)throw Error('Chrome not found; set CHROME_PATH');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cues-chrome-'));
 const proc=spawn(chromePath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{stdio:'ignore'});
 let port;for(let i=0;i<100&&!port;i++){try{port=fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0];}catch{await wait(100);}}
 if(!port)throw Error('Chrome did not start');
 return {
  async page({width=1200,height=900}={}){
   const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
   const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
   let id=0;const pending=new Map(),errors=[];
   ws.on('message',raw=>{const m=JSON.parse(raw);
    if(m.id&&pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(Error(m.error.message)):resolve(m.result);}
    else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    else if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry.text);
    else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));
   });
   const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
   await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Network.enable');
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
   const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
   return {
    send,evaluate,errors,
    goto:async url=>{await send('Page.navigate',{url});await wait(300);},
    waitFor:async(expression,timeout=10000)=>{const end=Date.now()+timeout;let last;while(Date.now()<end){try{last=await evaluate(expression);if(last)return last;}catch{}await wait(100);}throw Error('Timed out waiting for: '+expression+' (last: '+JSON.stringify(last)+')');},
    text:selector=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent??null`),
    screenshot:async file=>fs.writeFileSync(file,Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64')),
    offline:offline=>send('Network.emulateNetworkConditions',{offline,latency:0,downloadThroughput:-1,uploadThroughput:-1}),
    close:()=>ws.close()
   };
  },
  close(){proc.kill();try{fs.rmSync(dir,{recursive:true,force:true});}catch{}}
 };
}
