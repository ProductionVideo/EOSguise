// Parsing and display rules for data read from the public database. Every value is untrusted.
import {isShowId} from './identity.js';
export const FRESH_MS=30000,OFFLINE_MS=120000,MAX_CUES=100000,MAX_EXTRAPOLATE_MS=12000;
const str=(v,max)=>typeof v==='string'?v.slice(0,max):'';
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);

export function parseSummary(id,v){
 if(!isShowId(id)||!isObject(v))return null;
 const name=str(v.name,120).trim();if(!name)return null;
 return {id,name,updatedAt:num(v.updatedAt),eosConnected:v.eosConnected===true,disguiseConnected:v.disguiseConnected===true};
}
export function parseSummaries(tree){
 const rows=[];if(isObject(tree))for(const id of Object.keys(tree)){const s=parseSummary(id,tree[id]);if(s)rows.push(s);}
 return rows;
}
const cue=c=>isObject(c)?{number:str(c.number,32),name:str(c.name,500),notes:str(c.notes,2000)}:null;
export function parseState(json){
 let raw;try{raw=typeof json==='string'?JSON.parse(json):undefined;}catch{}
 if(!isObject(raw))return {error:'Show status could not be read'};
 const e=isObject(raw.eos)?raw.eos:{},d=isObject(raw.disguise)?raw.disguise:{};
 const cueLists=(Array.isArray(e.cueLists)?e.cueLists:[]).filter(n=>Number.isInteger(n)&&n>=1&&n<=999).slice(0,2);
 const lists={};for(const n of cueLists){const l=isObject(e.lists)&&isObject(e.lists[n])?e.lists[n]:{};lists[n]={name:str(l.name,200),current:cue(l.current),next:cue(l.next)};}
 return {
  eos:{connected:e.connected===true,loading:e.loading===true,cueLists,lists},
  disguise:{connected:d.connected===true,transport:str(d.transport,200),track:str(d.track,200),section:num(d.section),sectionName:str(d.sectionName,500),cue:str(d.cue,500),playmode:str(d.playmode,40),engaged:typeof d.engaged==='boolean'?d.engaged:null,output:num(d.output),time:num(d.time),sectionTime:num(d.sectionTime)}
 };
}
export function parseCues(json){
 let raw;try{raw=typeof json==='string'?JSON.parse(json):undefined;}catch{}
 if(!Array.isArray(raw))return {error:'Cue list could not be read',rows:[]};
 if(raw.length>MAX_CUES)return {error:'Cue list is too large to display',rows:[]};
 const rows=[];let skipped=0;
 for(const c of raw){
  const fade=v=>num(v)!==null&&v>=0?v:null;
  if(isObject(c)&&Number.isInteger(c.list)&&c.list>=1&&c.list<=999&&typeof c.number==='string'&&c.number&&c.number.length<=32)rows.push({list:c.list,number:c.number,name:str(c.name,500),up:fade(c.up),down:fade(c.down)});
  else skipped++;
 }
 return {rows,skipped};
}
export function freshness(updatedAt,serverNow){
 if(!Number.isFinite(updatedAt))return 'offline';
 const age=serverNow-updatedAt;
 return age<=FRESH_MS?'fresh':age<=OFFLINE_MS?'stale':'offline';
}
export function ageText(ms){
 if(!Number.isFinite(ms))return 'never';
 const s=Math.max(0,Math.round(ms/1000));
 if(s<5)return 'just now';if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+' min ago';if(s<86400)return Math.floor(s/3600)+' h ago';
 return Math.floor(s/86400)+' d ago';
}
// Short age for single-line rows: "now", "12s", "3m", "2h", "4d".
export function shortAge(ms){
 if(!Number.isFinite(ms))return 'never';
 const s=Math.max(0,Math.round(ms/1000));
 return s<5?'now':s<60?s+'s':s<3600?Math.floor(s/60)+'m':s<86400?Math.floor(s/3600)+'h':Math.floor(s/86400)+'d';
}
export function clock(seconds){
 if(!Number.isFinite(seconds))return '…';
 const t=Math.max(0,Math.floor(seconds));
 return [Math.floor(t/3600),Math.floor(t/60)%60,t%60].map(x=>String(x).padStart(2,'0')).join(':');
}
// Eos-style fade time: "5", "2.5", "1:30", and "up / down" when they differ.
const seconds=ms=>{const s=Math.round(ms/100)/10;return s<60?String(s):Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0')+(s%1?String(Math.round(s%1*10)/10).slice(1):'');};
export function fadeText(up,down){
 if(!(num(up)!==null&&up>=0))return '';
 return num(down)!==null&&down>=0&&down!==up?seconds(up)+' / '+seconds(down):seconds(up);
}
export const PLAYMODES={HoldSection:'Holding at section end',PlaySection:'Play to section end',Play:'Playing',Stop:'Stopped',LoopSection:'Loop section'};
export const OUTPUTS={0:'Faded down',1:'Faded up',2:'Hold'};
const ADVANCING=new Set(['Play','PlaySection','LoopSection']);
// Timing advances only while the data is fresh and the browser is connected, and never more than one heartbeat.
export function liveSeconds(value,{playmode,ageMs,live}){
 if(!Number.isFinite(value))return null;
 return live&&ADVANCING.has(playmode)&&ageMs>0?value+Math.min(ageMs,MAX_EXTRAPOLATE_MS)/1000:value;
}
export function filterShows(rows,query){
 const q=query.trim().toLowerCase();
 return q?rows.filter(s=>s.name.toLowerCase().includes(q)):rows.slice();
}
export function sortShows(rows,mode){
 return rows.sort(mode==='name'?(a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id):(a,b)=>(b.updatedAt??-1)-(a.updatedAt??-1)||a.name.localeCompare(b.name));
}
// Cue lists are shown as "List A 7 Main". Eos labels arrive as "<number> <name>" ("7 Main"), and
// placeholder names only repeat the number, so both are reduced to just the name ('' when none).
export function listName(name,n){
 const t=String(name??'').trim().replace(new RegExp('^'+Number(n)+'(?:\\s*[:.\\-–]\\s*|\\s+)'),'');
 return !t||t===String(n)||/^cue ?list \d+$/i.test(t)?'':t;
}
