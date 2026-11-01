import fs from 'node:fs';
const OUT='/w/_le2e/out';
const load=(n)=>{const d={};const dir=`${OUT}/${n}/data`;for(const f of fs.readdirSync(dir))d[f.replace('.json','')]=JSON.parse(fs.readFileSync(`${dir}/${f}`,'utf8'));return d;};
const a1=load('a1'),a2=load('a2'),b=load('b1'),c=load('c'),w=load('w');
const tests=Object.keys(b);
const bMs=(i)=>100+300*(i+1);
// rows keyed by ms
const byMs=(j,fallback)=>new Map(j.rows.map((r,i)=>[r.ms??fallback(i),r]));
let wEqB=0,wDiff=0,overlap=0,overlapDiff=0,boxDiff=0;
const result={};
const summary={};
for(const t of tests){
 for(const x of [c[t],w[t]]) if(x&&JSON.stringify(x.boxes)!==JSON.stringify(b[t].boxes))boxDiff++;
 const B=byMs(b[t],bMs),W=byMs(w[t],bMs),C=c[t]?byMs(c[t],bMs):new Map();
 for(const [ms,r] of B){const o=W.get(ms);for(const n of Object.keys(r.values)){if(o.values[n]===r.values[n])wEqB++;else wDiff++;}}
 for(const [ms,r] of C){const o=W.get(ms);if(o){for(const n of Object.keys(r.values)){overlap++;if(o.values[n]!==r.values[n])overlapDiff++;}}}
 const all=new Map([...W,...C,...B]);
 const names=b[t].boxes.map(x=>x.name);
 const floor={},bMin={};
 for(const n of names){floor[n]=Math.min(...[...all.values()].map(r=>r.values[n]));bMin[n]=Math.min(...[...B.values()].map(r=>r.values[n]));}
 const need=names.filter(n=>bMin[n]>floor[n]);
 const left=new Set(need);const added=[];
 while(left.size){let best=null,bc=-1;for(const ms of [...all.keys()].sort((x,y)=>x-y)){const r=all.get(ms);const cnt=[...left].filter(n=>r.values[n]===floor[n]).length;if(cnt>bc){bc=cnt;best=ms}}const r=all.get(best);for(const n of [...left])if(r.values[n]===floor[n])left.delete(n);added.push(best);}
 added.sort((x,y)=>x-y);result[t]=added;
 // rule 3 and thresholds
 const needs=Object.fromEntries(b[t].boxes.map(x=>[x.name,x.needs]));
 const mA=(j,n)=>Math.min(...j.rows.map(r=>r.values[n]));
 const kinder=names.filter(n=>floor[n]>Math.min(mA(a1[t],n),mA(a2[t],n)));
 const below=names.filter(n=>floor[n]<needs[n]);
 summary[t]={boxes:names.length,bKinderThanFloor:need.length,added:added.length,addedMs:added,kinderThanA:kinder,belowThreshold:below,
  lowest:names.map(n=>[n,+floor[n].toFixed(4),+((floor[n]-needs[n])).toFixed(4)]).sort((x,y)=>x[2]-y[2])[0],
  beforeAfter:need.map(n=>[n,+bMin[n].toFixed(4),+floor[n].toFixed(4)])};
}
console.log(JSON.stringify({wEqB,wDiff,overlap,overlapDiff,boxDiff},null,0));
for(const t of tests)console.log(t,JSON.stringify(summary[t]));
fs.writeFileSync('/w/_le2e/added.json',JSON.stringify(result));
