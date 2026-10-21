import fs from 'node:fs';
import {displayName} from './cloud-identity.mjs';
export function validateSettings(input,current){
 const next={...current};
 const director=new URL(input.director.includes('://')?input.director:'http://'+input.director);
 if(!['http:','https:'].includes(director.protocol)||director.username||director.password||director.pathname!=='/'||director.search||director.hash)throw Error('Enter the Director address without a path');
 next.director=director.origin;
 if(typeof input.eosHost!=='string'||!input.eosHost||!/^([a-zA-Z0-9.-]+|[a-fA-F0-9:]+)$/.test(input.eosHost))throw Error('Enter a valid Eos host');
 next.eosHost=input.eosHost;
 next.eosPort=Number(input.eosPort);if(!Number.isInteger(next.eosPort)||next.eosPort<1||next.eosPort>65535)throw Error('Eos port must be 1 to 65535');
 next.cueLists=input.cueLists?.map(Number);if(next.cueLists?.length!==2||next.cueLists.some(n=>!Number.isInteger(n)||n<1||n>999)||new Set(next.cueLists).size!==2)throw Error('Choose two different cue lists from 1 to 999');
 next.controlList=Number(input.controlList);if(!next.cueLists.includes(next.controlList))throw Error('Control list must be one of the displayed cue lists');
 next.transportUid=String(input.transportUid||'');if(!/^\d+$/.test(next.transportUid))throw Error('Choose a transport');
 delete next.lanAddress;delete next.additionalAddresses;
 next.revision=(current.revision||0)+1;return next;
}
export function validateCloudSettings(input){
 if(typeof input?.enabled!=='boolean')throw Error('Choose whether to publish');
 const raw=typeof input.showName==='string'?input.showName:'';
 const showName=raw.trim()?displayName(raw):'';
 if(showName===null)throw Error('Show name must be 120 characters or fewer');
 if(input.enabled&&!showName)throw Error('Enter a show name to publish');
 return {publishEnabled:input.enabled,showName};
}
export function saveSettings(next,file=new URL('./config.json',import.meta.url)){
 const tmp=new URL('./config.next.json',file);fs.writeFileSync(tmp,JSON.stringify(next,null,2));fs.renameSync(tmp,file);
}
