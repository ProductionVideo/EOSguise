// Show identity shared by the EOSguise runtime and the Cues website.
// cloud/public/js/identity.js must stay byte-identical (tests/test-cloud-identity.mjs checks).
export const MAX_NAME_LENGTH=120;
// NFKC, trim and collapse whitespace. Returns null when empty or too long.
export function displayName(input){
 if(typeof input!=='string')return null;
 const name=input.normalize('NFKC').trim().replace(/\s+/g,' ');
 return name&&name.length<=MAX_NAME_LENGTH?name:null;
}
export const canonicalName=name=>name.toLowerCase();
export const isShowId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
// SHA-256 of the UTF-8 canonical name as lowercase hex. Names are identifiers, not secrets.
export async function showIdFor(input){
 const name=displayName(input);
 if(!name)throw Error('Show name must be 1 to '+MAX_NAME_LENGTH+' characters');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalName(name)));
 return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
