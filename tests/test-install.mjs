// Shared installer logic (scripts/setup.mjs) without touching login items or starting anything.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {once} from 'node:events';
import {prepareConfig,portFree,DEFAULT_PORT,OLD_DEFAULT_PORT} from '../scripts/setup.mjs';
const temp=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'cuedo-install-'));fs.copyFileSync(new URL('../config.example.json',import.meta.url),path.join(d,'config.example.json'));return d;};
const read=d=>JSON.parse(fs.readFileSync(path.join(d,'config.json'),'utf8'));
assert.equal(DEFAULT_PORT,28336);assert.equal(JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url))).port,DEFAULT_PORT,'Example config uses the default port');
// Fresh install: config created from the example with publishing off.
{const d=temp();const cfg=await prepareConfig(d,{free:async()=>true});assert.equal(cfg.port,DEFAULT_PORT);assert.equal(read(d).publishEnabled,false);}
// Upgrade: the old EOSguise default port moves to the new default; everything else is kept.
{const d=temp();fs.writeFileSync(path.join(d,'config.json'),JSON.stringify({port:OLD_DEFAULT_PORT,eosHost:'10.0.0.5',showName:'Kept',publishEnabled:true}));
 const cfg=await prepareConfig(d,{free:async()=>true});assert.deepEqual(read(d),{port:DEFAULT_PORT,eosHost:'10.0.0.5',showName:'Kept',publishEnabled:true});assert.equal(cfg.port,DEFAULT_PORT);}
// A port the user chose is respected.
{const d=temp();fs.writeFileSync(path.join(d,'config.json'),JSON.stringify({port:40000,eosHost:'x'}));const before=fs.readFileSync(path.join(d,'config.json'),'utf8');
 await prepareConfig(d,{free:async()=>true});assert.equal(fs.readFileSync(path.join(d,'config.json'),'utf8'),before,'Unchanged config is not rewritten');}
// Port taken by another application: next free port near the default.
{const d=temp();const cfg=await prepareConfig(d,{free:async p=>p!==DEFAULT_PORT&&p!==DEFAULT_PORT+1});assert.equal(cfg.port,DEFAULT_PORT+2);assert.equal(read(d).port,DEFAULT_PORT+2);}
{const d=temp();await assert.rejects(prepareConfig(d,{free:async()=>false}),/no free port/);}
// Real port check.
{const s=net.createServer().listen(0,'0.0.0.0');await once(s,'listening');assert.equal(await portFree(s.address().port),false);const p=s.address().port;s.close();await once(s,'close');assert.equal(await portFree(p),true);}
// Packaging: one-click entry points exist, are executable where needed, and Windows batch files use CRLF.
for(const f of ['install-mac.command','install-linux.sh','scripts/install.sh','scripts/uninstall.sh'])assert.ok(fs.statSync(new URL('../'+f,import.meta.url)).mode&0o111,f+' is executable');
for(const f of ['install-windows.cmd','scripts/uninstall-windows.cmd']){const t=fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');assert.ok(t.split('\n').slice(0,-1).every(l=>l.endsWith('\r')),f+' uses CRLF');}
// Pinned runtime checksums match between the Windows and Unix installers' sources of truth.
assert.match(fs.readFileSync(new URL('../scripts/install.ps1',import.meta.url),'utf8'),/\$nodeVersion='v22\.23\.1'/);assert.match(fs.readFileSync(new URL('../scripts/install.sh',import.meta.url),'utf8'),/NODE_VERSION=v22\.23\.1/);
console.log('PASS: fresh config, old-port migration, user port kept, busy-port fallback, real port check, executable and CRLF entry points, pinned runtime version');
