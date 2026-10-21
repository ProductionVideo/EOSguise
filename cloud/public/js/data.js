// Realtime Database access for the dashboard: SDK listeners (one WebSocket per tab) for reading,
// REST for Delete so the listing only changes after the server confirms. Pinned SDK version.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getDatabase,connectDatabaseEmulator,ref,onValue} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

export function connect(config){
 const db=getDatabase(initializeApp({apiKey:config.apiKey,appId:config.appId,projectId:config.projectId,databaseURL:config.databaseURL}));
 // Local testing only: the deployed firebase-config.json has no emulator entry.
 const emulator=typeof config.emulator==='string'?config.emulator.match(/^(127\.0\.0\.1|localhost):(\d+)$/):null;
 if(emulator)connectDatabaseEmulator(db,emulator[1],Number(emulator[2]));
 const namespace=new URL(config.databaseURL).hostname.split('.')[0];
 return {
  // Returns an unsubscribe function. Permission errors cancel the listener; it is retried after retryMs.
  listen(path,onData,onError,retryMs=10000){
   let stop=null,timer=null,closed=false;
   const start=()=>{stop=onValue(ref(db,path),snap=>onData(snap.val()),error=>{onError?.(error);if(!closed)timer=setTimeout(start,retryMs);});};
   start();
   return ()=>{closed=true;clearTimeout(timer);stop?.();};
  },
  restURL(path){return emulator?`http://${emulator[1]}:${emulator[2]}/${path}.json?ns=${namespace}`:new URL('/'+path+'.json',config.databaseURL).href;}
 };
}
