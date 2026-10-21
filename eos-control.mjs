import net from 'node:net';
import {message,slip,parser} from './osc.mjs';
export function packet(cue,list=2){
 if(!/^\d{1,5}(?:\.\d{1,3})?$/.test(cue))throw Error('Enter a valid cue');
 const str=s=>{const b=Buffer.alloc(Math.ceil((Buffer.byteLength(s)+1)/4)*4);b.write(s);return b;};
 const raw=Buffer.concat([str('/eos/newcmd'),str(',s'),str(`Go_To_Cue ${list} / ${cue} Enter`)]);
 return Buffer.from([192,...[...raw].flatMap(b=>b===192?[219,220]:b===219?[219,221]:[b]),192]);
}
export function transmit(data,host,port){return new Promise((resolve,reject)=>{
 const s=net.createConnection({host,port});const token='cuedo-'+Date.now()+'-'+Math.random().toString(16).slice(2);let phase='ready',done=false;
 const finish=error=>{if(done)return;done=true;clearTimeout(timer);s.destroy();error?reject(error):resolve();};
 const timer=setTimeout(()=>finish(Error('Eos did not acknowledge connection traffic')),5000);
 s.on('error',finish);s.on('close',()=>{if(!done)finish(Error('Eos connection closed before acknowledgement'));});
 s.on('connect',()=>s.write(slip(message('/eos/ping',[token+'-ready']))));
 s.on('data',parser(({address,args})=>{
  if(address!=='/eos/out/ping')return;
  if(phase==='ready'&&args[0]===token+'-ready'){
   phase='sent';s.write(data);s.write(slip(message('/eos/ping',[token+'-sent'])));
  }else if(phase==='sent'&&args[0]===token+'-sent')finish();
 }));
});}
