// The explicit allowlist of what EOSguise publishes to the public Cues website.
// Everything else (config, addresses, hostnames, Director URL, transport UID, errors, logs) stays local.
const text=(value,max)=>typeof value==='string'?value.slice(0,max):typeof value==='number'&&Number.isFinite(value)?String(value).slice(0,max):'';
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const fade=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.round(value):null;
const cue=c=>c&&typeof c==='object'?{number:text(c.number,32),name:text(c.name,500),notes:text(c.notes,2000)}:null;

export function telemetryState(state,cueLists,now=Date.now()){
 const eos=state?.eos||{},d=state?.disguise||{};
 const order=[],lists={};
 for(const id of Array.isArray(cueLists)?cueLists.slice(0,2):[]){
  const n=Number(id);if(!Number.isInteger(n)||n<1||n>999||order.includes(n))continue;
  const l=eos.lists?.[n]||{};order.push(n);lists[n]={name:text(l.name,200),current:cue(l.current),next:cue(l.next)};
 }
 return {
  eos:{connected:eos.connected===true&&now-(eos.lastReceived||0)<15000,loading:Number(eos.loaded)<Number(eos.total),cueLists:order,lists},
  disguise:{connected:d.connected===true&&now-(d.updated||0)<5000,transport:text(d.transport,200),track:text(d.track,200),section:number(d.section),sectionName:text(d.sectionName,500),cue:text(d.cue,500),playmode:text(d.playmode,40),engaged:typeof d.engaged==='boolean'?d.engaged:null,output:number(d.output),time:number(d.time),sectionTime:number(d.sectionTime)}
 };
}
// Timer values change several times a second; they ride along with heartbeats instead of triggering publishes.
export function stateSignature(t){return JSON.stringify({...t,disguise:{...t.disguise,time:null,sectionTime:null}});}
// Stable catalogue: part 0 cues sorted by list then numeric cue number. Point cue numbers stay strings.
export function telemetryCues(values){
 const rows=[];
 for(const c of values||[])if(c&&c.part===0&&Number.isInteger(c.list))rows.push({list:c.list,number:text(c.number,32),name:text(c.name,500),up:fade(c.up),down:fade(c.down)});
 rows.sort((a,b)=>a.list-b.list||Number(a.number)-Number(b.number)||(a.number<b.number?-1:a.number>b.number?1:0));
 return rows;
}
