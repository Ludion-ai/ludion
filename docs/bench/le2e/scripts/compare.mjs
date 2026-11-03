import fs from 'node:fs';
const OUT='/w/_le2e/out';
const load=(n)=>{const d={};for(const f of fs.readdirSync(`${OUT}/${n}/data`)){const j=JSON.parse(fs.readFileSync(`${OUT}/${n}/data/${f}`,'utf8'));d[f.replace('.json','')]=j;}return d;};
const arms=Object.fromEntries(process.argv.slice(2).map(n=>[n,load(n)]));
const names=Object.keys(arms);
const tests=Object.keys(arms[names[0]]);
const mins=(j)=>{const out={};for(const b of j.boxes){let m=Infinity;const K=[];for(const r of j.rows){const v=r.values[b.name];if(v<m){m=v;K.length=0;K.push(r.k)}else if(v===m)K.push(r.k)}out[b.name]={m,K,needs:b.needs,distinct:new Set(j.rows.map(r=>r.values[b.name])).size}}return out};
const sameV=(a,b)=>{let diff=0,tot=0;for(const t of tests){for(const r of a[t].rows){const o=b[t].rows[r.k];for(const n of Object.keys(r.values)){tot++;if(o.values[n]!==r.values[n])diff++}}}return {tot,diff}};
const sameBoxes=(a,b)=>tests.filter(t=>JSON.stringify(a[t].boxes)!==JSON.stringify(b[t].boxes));
for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){console.log(names[i],names[j],'v',JSON.stringify(sameV(arms[names[i]],arms[names[j]])),'boxesDiffer',JSON.stringify(sameBoxes(arms[names[i]],arms[names[j]])))}
for(const n of names){const a=arms[n];console.log('==',n);
 for(const t of tests){const j=a[t];const R=j.rows;const dd=R.map((r,i)=>r.drawsAfter-(i?R[i-1].drawsAfter:0));const during=R.map(r=>r.drawsAfter-r.drawsBefore);
 const st=R.map(r=>r.stepMs),sh=R.map(r=>r.shotMs);const sum=x=>x.reduce((p,c)=>p+c,0);
 const M=mins(j);const low=Object.entries(M).sort((x,y)=>x[1].m-y[1].m)[0];
 const fail=Object.entries(M).filter(([,v])=>v.m<v.needs).length;
 console.log(t,'boxes',j.boxes.length,'totalS',(j.totalMs/1000).toFixed(1),'stepS',(sum(st)/1000).toFixed(1),'shotS',(sum(sh)/1000).toFixed(1),'tFirst',R[0].tAfter.toFixed(3),'tLast',R[R.length-1].tAfter.toFixed(3),'drawsPerMoment',Math.min(...dd),Math.max(...dd),'drawsDuringShot',Math.min(...during),Math.max(...during),'tMoved',R.filter(r=>r.tBefore!==r.tAfter).length,'lowest',low[0],low[1].m.toFixed(4),'needs',low[1].needs,'atK',low[1].K.length,'fail',fail);
 }}
// not kinder
const pairs=[];
if(names.length>2){const [a1,a2,b]=names.map(n=>arms[n]);let worse=[];let eq=0,lower=0,tot=0;
 for(const t of tests){const ma1=mins(a1[t]),ma2=mins(a2[t]),mb=mins(b[t]);for(const n of Object.keys(mb)){tot++;const am=Math.min(ma1[n].m,ma2[n].m);if(mb[n].m>am)worse.push({t,n,b:mb[n].m,a1:ma1[n].m,a2:ma2[n].m,needs:mb[n].needs});else if(mb[n].m===am)eq++;else lower++;}}
 console.log('notKinder total',tot,'equal',eq,'lower',lower,'kinder',worse.length);for(const w of worse)console.log(JSON.stringify(w));
 let a12=0,ta=0;for(const t of tests){const x=mins(a1[t]),y=mins(a2[t]);for(const n of Object.keys(x)){ta++;if(x[n].m!==y[n].m)a12++;}}console.log('A1 vs A2 m differ',a12,'of',ta);
}
