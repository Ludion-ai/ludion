import fs from 'node:fs';
const OUT='/w/_le2e/out';
const load=(n)=>Object.fromEntries(fs.readdirSync(`${OUT}/${n}/data`).map(f=>[f.replace('.json',''),JSON.parse(fs.readFileSync(`${OUT}/${n}/data/${f}`,'utf8'))]));
const a1=load('a1'),a2=load('a2'),b=load('b1');
const mins=(j,n)=>{let m=Infinity;const K=[];for(const r of j.rows){const v=r.values[n];if(v<m){m=v;K.length=0;K.push(r)}else if(v===m)K.push(r)}return{m,K}};
const out={};const detail=[];
for(const t of Object.keys(b)){for(const box of b[t].boxes){const mb=mins(b[t],box.name).m;for(const [name,a] of [['a1',a1],['a2',a2]]){const ma=mins(a[t],box.name);if(ma.m<mb){for(const r of ma.K){const ms=[];const from=r.tBefore*1000,to=r.tAfter*1000;for(let x=from;x<to;x+=33)ms.push(Math.ceil(x));ms.push(Math.ceil(to));(out[t]??=new Set());ms.forEach(x=>out[t].add(x));detail.push({t,box:box.name,run:name,k:r.k,from:+from.toFixed(1),to:+to.toFixed(1),pts:ms.length,a:ma.m,b:mb});}}}}}
const res=Object.fromEntries(Object.entries(out).map(([k,v])=>[k,[...v].sort((x,y)=>x-y)]));
fs.writeFileSync('/w/_le2e/times-c.json',JSON.stringify(res));
console.log(detail.map(d=>JSON.stringify(d)).join('\n'));
for(const[k,v]of Object.entries(res))console.log(k,v.length,JSON.stringify(v));
// B moments: exact time and one draw each
let bad=0,tot=0;for(const t of Object.keys(b)){const R=b[t].rows;R.forEach((r,i)=>{tot++;const want=(100+300*(i+1))/1000;if(Math.abs(r.tAfter-want)>1e-9||r.tBefore!==r.tAfter||(i>0&&r.drawsAfter-R[i-1].drawsAfter!==1))bad++;});}
console.log('B moments',tot,'off',bad);
console.log('A max t', Math.max(...Object.values(a1).flatMap(j=>j.rows.map(r=>r.tAfter))),Math.max(...Object.values(a2).flatMap(j=>j.rows.map(r=>r.tAfter))));
