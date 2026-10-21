// Test/development server for cloud/public: applies firebase.json headers and rewrites, and serves a
// firebase-config.json that points at the local database emulator. Never used in production.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const root=new URL('../public/',import.meta.url),hosting=JSON.parse(fs.readFileSync(new URL('../firebase.json',import.meta.url))).hosting;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'};
export function serve({port=0,databaseOrigin='http://127.0.0.1:9000'}={}){
 const headers=hosting.headers[0].headers.map(({key,value})=>[key,key==='Content-Security-Policy'?value.replace('connect-src ','connect-src '+databaseOrigin+' '+databaseOrigin.replace('http','ws')+' '):value]);
 const server=http.createServer((req,res)=>{
  const p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  for(const [k,v] of headers)res.setHeader(k,v);
  if(p==='/firebase-config.json'){res.setHeader('Content-Type','application/json');const real=JSON.parse(fs.readFileSync(new URL('firebase-config.json',root)));return res.end(JSON.stringify({...real,emulator:new URL(databaseOrigin).host}));}
  let file=path.normalize(p).replace(/^(\.\.[/\\])+/,'');
  let full=new URL('.'+file,root);
  if(file.endsWith('/')||!fs.existsSync(full)||fs.statSync(full).isDirectory())full=new URL('index.html',root);
  res.setHeader('Content-Type',types[path.extname(full.pathname)]||'application/octet-stream');
  res.end(fs.readFileSync(full));
 });
 return new Promise(r=>server.listen(port,'127.0.0.1',()=>r(server)));
}
if(import.meta.url===`file://${process.argv[1]}`){const s=await serve({port:Number(process.argv[2]||5050)});console.log('http://127.0.0.1:'+s.address().port);}
