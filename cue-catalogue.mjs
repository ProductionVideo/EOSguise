// Keep the published list intact until every requested cue index has arrived.
export class CueCatalogue {
 // version changes whenever the published rows may have changed (used by the cloud publisher).
 constructor(){this.rows=new Map();this.pending=new Map();this.complete=new Set();this.version=0;}
 clear(){this.version++;this.rows.clear();this.pending.clear();this.complete.clear();}
 reconnect(lists){
  this.pending.clear();this.version++;
  const active=new Set(lists.map(Number));
  for(const [key,cue] of this.rows)if(!active.has(cue.list))this.rows.delete(key);
  for(const list of this.complete)if(!active.has(list))this.complete.delete(list);
 }
 begin(list,count){
  this.pending.set(Number(list),{count,rows:new Map(),indices:new Set()});
  if(count===0)this.commit(Number(list));
 }
 add(cue,index){
  const pending=this.pending.get(cue.list);
  if(!pending)return;
  pending.rows.set(`${cue.list}/${cue.number}/${cue.part}`,cue);
  pending.indices.add(index);
  if(pending.indices.size>=pending.count)this.commit(cue.list);
 }
 commit(list){
  const pending=this.pending.get(list);
  for(const [key,cue] of this.rows)if(cue.list===list)this.rows.delete(key);
  for(const [key,cue] of pending.rows)this.rows.set(key,cue);
  this.pending.delete(list);
  this.complete.add(list);
  this.version++;
 }
 lookup(list,number){
  for(const cue of this.rows.values())if(cue.list===Number(list)&&cue.part===0&&Number(cue.number)===Number(number))return 'found';
  return this.complete.has(Number(list))&&!this.pending.has(Number(list))?'missing':'loading';
 }
 values(){return this.rows.values();}
}
// Eos reports cue list labels as "<list number> <name>" ("1 Main"); keep just the name.
export function listLabel(label,n){
 return String(label??'').replace(new RegExp('^\\s*'+Number(n)+'(?:\\s*[:.\\-–]\\s*|\\s+)'),'').trim();
}
