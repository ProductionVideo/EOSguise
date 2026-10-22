// In-app updater: replaces the application files with the latest commit on main of the cuedo repository,
// keeping settings, logs and the runtime, then restarts. GitHub responses are data: only a 40-hex commit
// ID and a bounded message/date are read from the API, and the archive must contain the cuedo server.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';

export const REPO='ProductionVideo/cuedo',BRANCH='main';
// Never overwritten or copied by an update.
const KEEP_TOP=new Set(['.git','cloud','tests','branding','runtime','node_modules','config.json','config.next.json','installed.json']);
const skip=name=>/^test-.*\.mjs$/.test(name)||/\.(log|jsonl)$/.test(name)||name==='.DS_Store';

// Supervised installs restart the server when it exits: Windows supervisor (run.ps1), macOS LaunchAgent, systemd.
export function supervised(env=process.env,platform=process.platform){
 return platform==='win32'||env.XPC_SERVICE_NAME==='wiki.stage.cuedo'||!!env.INVOCATION_ID;
}
function copyTree(from,to,top=true){
 for(const entry of fs.readdirSync(from,{withFileTypes:true})){
  if((top&&KEEP_TOP.has(entry.name))||skip(entry.name))continue;
  const src=path.join(from,entry.name),dst=path.join(to,entry.name);
  if(entry.isDirectory()){fs.mkdirSync(dst,{recursive:true});copyTree(src,dst,false);}
  else if(entry.isFile()){fs.copyFileSync(src,dst);try{fs.chmodSync(dst,fs.statSync(src).mode&0o777);}catch{}}
 }
}
export function createUpdater({appDir,api=process.env.CUEDO_UPDATE_API||'https://api.github.com',codeload=process.env.CUEDO_UPDATE_CODELOAD||'https://codeload.github.com',restart}={}){
 const record=path.join(appDir,'installed.json');
 let status={state:'idle',error:'',latest:null,checkedAt:0};
 const installed=()=>{try{const v=JSON.parse(fs.readFileSync(record,'utf8'));return /^[0-9a-f]{40}$/.test(v.commit)?{commit:v.commit,updatedAt:Number(v.updatedAt)||0}:null;}catch{return null;}};
 async function latest(){
  const r=await fetch(`${api}/repos/${REPO}/commits/${BRANCH}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'cuedo-updater'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error(r.status===403||r.status===429?'GitHub rate limit reached; try again later':'GitHub returned HTTP '+r.status);
  const p=await r.json();
  if(typeof p?.sha!=='string'||!/^[0-9a-f]{40}$/.test(p.sha))throw Error('Unexpected reply from GitHub');
  const message=typeof p.commit?.message==='string'?p.commit.message.split('\n')[0].slice(0,200):'';
  const date=Date.parse(p.commit?.committer?.date||p.commit?.author?.date||'');
  return {commit:p.sha,message,date:Number.isFinite(date)?date:0};
 }
 const view=()=>({...status,installed:installed(),upToDate:!!status.latest&&installed()?.commit===status.latest.commit,repo:REPO,branch:BRANCH});
 async function check(){
  if(status.state==='updating')return view();
  try{status={...status,state:'idle',error:'',latest:await latest(),checkedAt:Date.now()};}
  catch(e){status={...status,state:'idle',error:e.name==='TimeoutError'?'GitHub did not respond':e.message};}
  return view();
 }
 async function update(){
  if(status.state==='updating')throw Error('An update is already running');
  if(fs.existsSync(path.join(appDir,'.git')))throw Error('This copy of cuedo is a git checkout; update it with git instead');
  status={...status,state:'updating',error:''};
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cuedo-update-'));
  try{
   const target=await latest();status={...status,latest:target};
   const r=await fetch(`${codeload}/${REPO}/tar.gz/${target.commit}`,{signal:AbortSignal.timeout(60000)});
   if(!r.ok)throw Error('Download failed (HTTP '+r.status+')');
   const archive=path.join(temp,'cuedo.tar.gz');fs.writeFileSync(archive,Buffer.from(await r.arrayBuffer()));
   const out=path.join(temp,'src');fs.mkdirSync(out);
   const x=spawnSync('tar',['-xzf',archive,'-C',out],{encoding:'utf8',windowsHide:true});
   if(x.status!==0)throw Error('Could not unpack the update: '+(x.stderr||'tar failed').trim().slice(0,200));
   const [top]=fs.readdirSync(out).map(n=>path.join(out,n)).filter(p=>fs.statSync(p).isDirectory());
   if(!top||!fs.existsSync(path.join(top,'server.mjs'))||!fs.existsSync(path.join(top,'scripts','setup.mjs')))throw Error('The download is not a cuedo release');
   copyTree(top,appDir);
   fs.writeFileSync(record,JSON.stringify({commit:target.commit,updatedAt:Date.now()},null,2));
   status={...status,state:'restarting'};
   setTimeout(()=>restart?.(),500);
   return view();
  }catch(e){status={...status,state:'idle',error:e.name==='TimeoutError'?'The download timed out':e.message};throw e;}
  finally{fs.rmSync(temp,{recursive:true,force:true});}
 }
 return {check,update,status:view};
}
// Restart after an update: exit and let the login item restart us, or start a replacement first when unsupervised.
export function restartProcess({appDir,env=process.env}={}){
 if(!supervised(env)){
  const out=fs.openSync(path.join(appDir,'server.log'),'a'),err=fs.openSync(path.join(appDir,'error.log'),'a');
  spawn(process.execPath,[path.join(appDir,'server.mjs')],{cwd:appDir,detached:true,stdio:['ignore',out,err],env}).unref();
 }
 process.exit(0);
}
