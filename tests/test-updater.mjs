// In-app updater against a fake GitHub (API + archive), plus the server's update routes.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';import {fileURLToPath} from 'node:url';
import {createUpdater,supervised,REPO} from '../updater.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cuedo-updater-'));
const write=(dir,file,text)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),text);};
const SHA='a'.repeat(40);
function release(files){const root=tmp(),top=path.join(root,'cuedo-'+SHA);for(const [f,t] of Object.entries(files))write(top,f,t);
 const archive=path.join(root,'release.tar.gz');assert.equal(spawnSync('tar',['-czf',archive,'-C',root,'cuedo-'+SHA]).status,0);return fs.readFileSync(archive);}
let reply={sha:SHA,commit:{message:'Faded up feedback\n\nDetails',committer:{date:'2026-10-22T10:00:00Z'}}},archive;
const github=http.createServer((req,res)=>{
 if(req.url===`/repos/${REPO}/commits/main`){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(reply));}
 if(req.url===`/${REPO}/tar.gz/${SHA}`)return res.end(archive);
 res.writeHead(404);res.end();
});github.listen(0,'127.0.0.1');await once(github,'listening');
const base='http://127.0.0.1:'+github.address().port;
let server;
try{
 assert.equal(supervised({}, 'win32'),true);assert.equal(supervised({XPC_SERVICE_NAME:'wiki.stage.cuedo'},'darwin'),true);
 assert.equal(supervised({INVOCATION_ID:'x'},'linux'),true);assert.equal(supervised({},'linux'),false);assert.equal(supervised({XPC_SERVICE_NAME:'other'},'darwin'),false);
 // Installed copy with settings, logs and runtime that must survive.
 const app=tmp();
 for(const [f,t] of Object.entries({'server.mjs':'old','app.js':'old','config.json':'{"port":13579,"showName":"Kept"}','server.log':'log','runtime/node':'runtime','scripts/setup.mjs':'old'}))write(app,f,t);
 archive=release({'server.mjs':'new','app.js':'new','scripts/setup.mjs':'new','vendor/ws/x.js':'new','config.json':'{"port":1}','runtime/node':'evil','cloud/public/index.html':'site','tests/x.mjs':'t','test-foo.mjs':'t','new.log':'l'});
 let restarted=0;const u=createUpdater({appDir:app,api:base,codeload:base,restart:()=>restarted++});
 let s=await u.check();
 assert.equal(s.latest.commit,SHA);assert.equal(s.latest.message,'Faded up feedback','First line of the message only');assert.equal(s.installed,null);assert.equal(s.upToDate,false);
 s=await u.update();assert.equal(s.state,'restarting');
 const read=f=>fs.readFileSync(path.join(app,f),'utf8');
 assert.equal(read('server.mjs'),'new');assert.equal(read('app.js'),'new');assert.equal(read('scripts/setup.mjs'),'new');assert.equal(read('vendor/ws/x.js'),'new');
 assert.equal(read('config.json'),'{"port":13579,"showName":"Kept"}','Settings kept');assert.equal(read('runtime/node'),'runtime','Runtime kept');assert.equal(read('server.log'),'log');
 for(const f of ['cloud','tests','test-foo.mjs','new.log'])assert.ok(!fs.existsSync(path.join(app,f)),f+' not installed');
 assert.equal(JSON.parse(read('installed.json')).commit,SHA);
 await wait(700);assert.equal(restarted,1,'Restarts after updating');
 assert.equal((await u.check()).upToDate,true);
 // Bad replies change nothing.
 reply={sha:'not-a-sha'};assert.match((await u.check()).error,/Unexpected reply/);
 await assert.rejects(u.update(),/Unexpected reply/);
 reply={sha:SHA,commit:{message:'x'}};archive=release({'README.md':'not cuedo'});
 await assert.rejects(u.update(),/not a cuedo release/);assert.equal(read('server.mjs'),'new','Invalid archive changes nothing');
 // A git checkout is never overwritten.
 fs.mkdirSync(path.join(app,'.git'));await assert.rejects(u.update(),/git checkout/);
 // Server routes: local Settings only; this repository is a git checkout, so Update refuses.
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 const cfgDir=tmp();fs.writeFileSync(path.join(cfgDir,'config.json'),JSON.stringify({port,eosHost:'127.0.0.1',eosPort:1,cueLists:[1,2],controlList:2,director:'http://127.0.0.1:1',transportUid:'1',revision:1}));
 server=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,CUEDO_CONFIG:path.join(cfgDir,'config.json'),CUEDO_UPDATE_API:base,CUEDO_UPDATE_CODELOAD:base},stdio:'ignore'});
 const url='http://127.0.0.1:'+port;for(let i=0;i<50;i++){try{await fetch(url+'/api/update');break;}catch{await wait(100);}}
 assert.equal((await fetch(url+'/api/update')).status,200);
 const post=(p,headers={origin:url,'content-type':'application/json'})=>fetch(url+p,{method:'POST',headers,body:'{}'});
 assert.equal((await post('/api/update/check',{'content-type':'application/json'})).status,403,'No Origin');
 assert.equal((await post('/api/update',{origin:'https://cues.stage.wiki','content-type':'application/json'})).status,403,'Public website cannot update');
 const checked=await(await post('/api/update/check')).json();assert.equal(checked.latest.commit,SHA);
 const refused=await post('/api/update');assert.equal(refused.status,400);assert.match((await refused.json()).error,/git checkout/);
 console.log('PASS: check, update keeps settings/runtime/logs, skips dev files, records commit, restarts, rejects bad replies and non-cuedo archives, never overwrites a git checkout, local-only routes');
}catch(e){console.error(e);process.exitCode=1;}
finally{server?.kill();github.close();}
