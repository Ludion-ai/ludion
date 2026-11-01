import fs from 'node:fs';
const out={};
for(const s of ['light','dark']){for(const [p,n] of [['_',600],['_start_',300],['_ja_',600],['_ja_start_',300]]){out[p+s]=Array.from({length:n},(_,k)=>100+300*(k+1));}}
fs.writeFileSync('/w/_le2e/times-w.json',JSON.stringify(out));
console.log(Object.keys(out).map(k=>k+':'+out[k].length+':'+out[k][out[k].length-1]).join(' '));
