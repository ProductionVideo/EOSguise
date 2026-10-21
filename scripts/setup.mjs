// Shared install steps for Windows, macOS and Linux. The platform installers copy cuedo into its
// per-user folder and provide a Node runtime, then run this with that runtime:
//   node scripts/setup.mjs             configure, register to start at login, start, open the browser
//   node scripts/setup.mjs --uninstall stop and remove the login item (settings and files are kept)
// Test-only: --no-open or CUEDO_NO_OPEN=1 skips opening the browser.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';
import {execFileSync,spawn,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';

export const DEFAULT_PORT=28336;       // "CUEDO" on a phone keypad; IANA-unassigned and below every OS's ephemeral range.
export const OLD_DEFAULT_PORT=38304;   // EOSguise default, migrated on install.
const LABEL='wiki.stage.cuedo';
const appDir=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const node=process.execPath,serverFile=path.join(appDir,'server.mjs');
const args=new Set(process.argv.slice(2));
const log=message=>console.log('cuedo: '+message);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const run=(cmd,argv,options={})=>spawnSync(cmd,argv,{encoding:'utf8',windowsHide:true,...options});
const psQuote=s=>"'"+String(s).replace(/'/g,"''")+"'";

// ---------- Config and port ----------
export function portFree(port,host='0.0.0.0'){
 return new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.once('listening',()=>s.close(()=>resolve(true)));s.listen(port,host);});
}
async function isCuedo(port){
 try{const r=await fetch(`http://127.0.0.1:${port}/api/state`,{signal:AbortSignal.timeout(1500)});const s=await r.json();return ['cuedo','eosguise'].includes(s.app);}catch{return false;}
}
export async function prepareConfig(dir=appDir,{free=portFree}={}){
 const file=path.join(dir,'config.json');
 if(!fs.existsSync(file))fs.copyFileSync(path.join(dir,'config.example.json'),file);
 const cfg=JSON.parse(fs.readFileSync(file,'utf8'));let changed=false;
 if(!Number.isInteger(cfg.port)||cfg.port===OLD_DEFAULT_PORT){cfg.port=DEFAULT_PORT;changed=true;}
 // Another application on the port: use the next free one rather than failing.
 if(!await free(cfg.port)){
  let next=null;for(let p=DEFAULT_PORT;p<DEFAULT_PORT+64&&next===null;p++)if(p!==cfg.port&&await free(p))next=p;
  if(next===null)throw Error(`Port ${cfg.port} is in use and no free port was found near ${DEFAULT_PORT}. Free a port and run the installer again.`);
  log(`port ${cfg.port} is used by another application; using ${next} instead.`);cfg.port=next;changed=true;
 }
 if(changed){const tmp=file+'.next';fs.writeFileSync(tmp,JSON.stringify(cfg,null,2));fs.renameSync(tmp,file);}
 return cfg;
}

// ---------- Login item per platform ----------
const windows={
 startup:()=>path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'Microsoft','Windows','Start Menu','Programs','Startup'),
 script:name=>path.join(appDir,'scripts','windows',name),
 ps(file){return run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',file]);},
 stop(){windows.ps(windows.script('stop.ps1'));},
 register(){
  for(const name of ['EOSguise.lnk','cuedo.lnk'])fs.rmSync(path.join(windows.startup(),name),{force:true});
  const ps=`$s=New-Object -ComObject WScript.Shell;$l=$s.CreateShortcut(${psQuote(path.join(windows.startup(),'cuedo.lnk'))});`+
   `$l.TargetPath=(Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe');`+
   `$l.Arguments=${psQuote(`-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${windows.script('start.ps1')}"`)};`+
   `$l.WorkingDirectory=${psQuote(appDir)};$l.WindowStyle=7;$l.Description='cuedo';$l.Save()`;
  const r=run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',ps]);
  if(r.status!==0)throw Error('Could not create the Startup shortcut: '+(r.stderr||'').trim());
 },
 start(){const r=windows.ps(windows.script('start.ps1'));if(r.status!==0)throw Error('cuedo did not start: '+(r.stderr||r.stdout||'').trim());},
 unregister(){windows.stop();for(const name of ['EOSguise.lnk','cuedo.lnk'])fs.rmSync(path.join(windows.startup(),name),{force:true});},
 open:url=>spawn('cmd.exe',['/c','start','""',url],{detached:true,stdio:'ignore',windowsHide:true}).unref(),
 summary:()=>`It starts automatically when you log in to Windows (Startup shortcut "cuedo").`
};
const mac={
 plist:()=>path.join(os.homedir(),'Library','LaunchAgents',LABEL+'.plist'),
 domain:()=>'gui/'+process.getuid(),
 stop(){run('launchctl',['bootout',mac.domain()+'/'+LABEL]);},
 register(){
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  fs.mkdirSync(path.dirname(mac.plist()),{recursive:true});
  fs.writeFileSync(mac.plist(),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>${LABEL}</string>
 <key>ProgramArguments</key><array><string>${esc(node)}</string><string>${esc(serverFile)}</string></array>
 <key>WorkingDirectory</key><string>${esc(appDir)}</string>
 <key>RunAtLoad</key><true/>
 <key>KeepAlive</key><true/>
 <key>ThrottleInterval</key><integer>3</integer>
 <key>StandardOutPath</key><string>${esc(path.join(appDir,'server.log'))}</string>
 <key>StandardErrorPath</key><string>${esc(path.join(appDir,'error.log'))}</string>
</dict></plist>
`);
 },
 async start(){
  // bootstrap can briefly fail while a previous instance is still being torn down.
  for(let i=0;i<10;i++){const r=run('launchctl',['bootstrap',mac.domain(),mac.plist()]);if(r.status===0)return;await wait(500);if(i===9)throw Error('launchctl could not start cuedo: '+(r.stderr||'').trim());}
 },
 unregister(){mac.stop();fs.rmSync(mac.plist(),{force:true});},
 open:url=>spawn('open',[url],{detached:true,stdio:'ignore'}).unref(),
 summary:()=>`It starts automatically when you log in (LaunchAgent ${LABEL}) and restarts if it stops.`
};
const linux={
 unit:()=>path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),'systemd','user','cuedo.service'),
 autostart:()=>path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),'autostart','cuedo.desktop'),
 systemd:()=>run('systemctl',['--user','show-environment']).status===0,
 stop(){if(linux.systemd())run('systemctl',['--user','stop','cuedo']);run('pkill',['-f','--',serverFile]);},
 register(){
  if(linux.systemd()){
   const q=s=>'"'+String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
   fs.mkdirSync(path.dirname(linux.unit()),{recursive:true});
   fs.writeFileSync(linux.unit(),`[Unit]
Description=cuedo show status
After=network-online.target

[Service]
ExecStart=${q(node)} ${q(serverFile)}
WorkingDirectory=${appDir}
Restart=always
RestartSec=3
StandardOutput=append:${path.join(appDir,'server.log')}
StandardError=append:${path.join(appDir,'error.log')}

[Install]
WantedBy=default.target
`);
   fs.rmSync(linux.autostart(),{force:true});
   run('systemctl',['--user','daemon-reload']);
   const r=run('systemctl',['--user','enable','cuedo']);if(r.status!==0)throw Error('systemctl could not enable cuedo: '+(r.stderr||'').trim());
  }else{
   // No systemd user session: XDG autostart at desktop login instead.
   fs.mkdirSync(path.dirname(linux.autostart()),{recursive:true});
   const sh=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
   fs.writeFileSync(linux.autostart(),`[Desktop Entry]
Type=Application
Name=cuedo
Comment=cuedo show status
Exec=sh -c ${JSON.stringify(`cd ${sh(appDir)} && exec ${sh(node)} ${sh(serverFile)} >>server.log 2>>error.log`)}
X-GNOME-Autostart-enabled=true
NoDisplay=true
`);
  }
 },
 start(){
  if(linux.systemd()){const r=run('systemctl',['--user','restart','cuedo']);if(r.status!==0)throw Error('systemctl could not start cuedo: '+(r.stderr||'').trim());return;}
  const out=fs.openSync(path.join(appDir,'server.log'),'a'),err=fs.openSync(path.join(appDir,'error.log'),'a');
  spawn(node,[serverFile],{cwd:appDir,detached:true,stdio:['ignore',out,err]}).unref();
 },
 unregister(){if(linux.systemd()){run('systemctl',['--user','disable','--now','cuedo']);fs.rmSync(linux.unit(),{force:true});run('systemctl',['--user','daemon-reload']);}run('pkill',['-f','--',serverFile]);fs.rmSync(linux.autostart(),{force:true});},
 open:url=>{if(process.env.DISPLAY||process.env.WAYLAND_DISPLAY)spawn('xdg-open',[url],{detached:true,stdio:'ignore'}).on('error',()=>{}).unref();},
 summary:()=>linux.systemd()?'It starts automatically when you log in (systemd user service "cuedo") and restarts if it stops. To start it at boot without logging in, run: sudo loginctl enable-linger $USER':'It starts automatically when you log in to the desktop (autostart entry "cuedo").'
};
const platform={win32:windows,darwin:mac,linux}[process.platform];

async function waitReady(port){
 for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/state`,{signal:AbortSignal.timeout(1000)});if((await r.json()).app==='cuedo')return true;}catch{}await wait(500);}
 return false;
}
async function install(){
 if(!platform)throw Error('Unsupported platform: '+process.platform);
 log('installed in '+appDir);
 platform.stop();await wait(500);
 const cfg=await prepareConfig();
 platform.register();await platform.start();
 if(!await waitReady(cfg.port))throw Error(`cuedo did not answer on port ${cfg.port}. See ${path.join(appDir,'error.log')}.`);
 const url=`http://127.0.0.1:${cfg.port}/`;
 log('running at '+url);log(platform.summary());
 log('On other devices on the show network, use this computer\'s address with port '+cfg.port+' (listed in Settings).');
 if(!args.has('--no-open')&&!process.env.CUEDO_NO_OPEN)platform.open(url);
}
async function uninstall(){
 if(!platform)throw Error('Unsupported platform: '+process.platform);
 platform.unregister();
 log('stopped and removed from login items. Settings and files remain in '+appDir+'; delete that folder to remove cuedo completely.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 (args.has('--uninstall')?uninstall():install()).catch(e=>{console.error('cuedo: '+e.message);process.exitCode=1;});
}
