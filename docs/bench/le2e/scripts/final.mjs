import fs from 'node:fs';
const OUT='/w/_le2e/out';
const load=(n)=>{const d={};const dir=`${OUT}/${n}/data`;for(const f of fs.readdirSync(dir))d[f.replace('.json','')]=JSON.parse(fs.readFileSync(`${dir}/${f}`,'utf8'));return d;};
const A={a1:load('a1'),a2:load('a2'),a3:load('a3')};const b=load('b1'),b2=load('b2'),c=load('c'),w=load('w'),f1=load('f1'),f2=load('f2');
const tests=Object.keys(b);const bMs=i=>100+300*(i+1);
const byMs=(j)=>new Map(j.rows.map((r,i)=>[r.ms??bMs(i),r]));
const eq={f1f2:{tot:0,diff:0},fSource:{tot:0,diff:0,noSource:0},frames:{tot:0,off:0}};
const csv=['page,scheme,box,needs,large,a1_min,a2_min,a3_min,b_min,b_moments_ms,final_min,final_moments_ms,sweep_min,final_vs_a1a2a3'];
const sum={boxes:0,finalEqFloor:0,finalAboveFloor:0,belowNeeds:0,kinderA1A2:0,kinderA3:[],equalAll:0,lowerThanSomeA:0,bEqA1:0};
const lowest=[];
for(const t of tests){
 const F=byMs(f1[t]),F2=byMs(f2[t]),B=byMs(b[t]),W=byMs(w[t]),C=c[t]?byMs(c[t]):new Map();
 const src=new Map([...W,...C,...B]);
 for(const [ms,r] of F){const o=F2.get(ms);for(const n of Object.keys(r.values)){eq.f1f2.tot++;if(o.values[n]!==r.values[n])eq.f1f2.diff++;const s=src.get(ms);if(!s){eq.fSource.noSource++;continue}eq.fSource.tot++;if(s.values[n]!==r.values[n])eq.fSource.diff++;}}
 for(const j of [f1[t],f2[t]]){j.rows.forEach((r,i)=>{eq.frames.tot++;const prev=i?j.rows[i-1].drawsAfter:j.drawsAtStart;if(r.drawsAfter-prev!==1||r.tBefore!==r.tAfter||Math.abs(r.tAfter-r.ms/1000)>1e-9)eq.frames.off++;});}
 const scheme=f1[t].colorScheme,page=f1[t].path;
 for(const box of b[t].boxes){const n=box.name;sum.boxes++;
  const mn=(m)=>{let x=Infinity;const K=[];for(const [ms,r] of m){const v=r.values[n];if(v<x){x=v;K.length=0;K.push(ms)}else if(v===x)K.push(ms)}return{x,K}};
  const fm=mn(F),bm=mn(B),floor=Math.min(...[...src.values()].map(r=>r.values[n]));
  const am=Object.fromEntries(Object.entries(A).map(([k,a])=>[k,Math.min(...a[t].rows.map(r=>r.values[n]))]));
  if(fm.x===floor)sum.finalEqFloor++;else sum.finalAboveFloor++;
  if(fm.x<box.needs)sum.belowNeeds++;
  if(fm.x>Math.min(am.a1,am.a2))sum.kinderA1A2++;
  if(fm.x>am.a3)sum.kinderA3.push({t,n,final:fm.x,a3:am.a3,needs:box.needs});
  const all=fm.x===am.a1&&fm.x===am.a2&&fm.x===am.a3;if(all)sum.equalAll++;else sum.lowerThanSomeA++;
  if(bm.x===am.a1)sum.bEqA1++;
  lowest.push({t,n,final:fm.x,needs:box.needs,margin:fm.x-box.needs});
  csv.push([page,scheme,JSON.stringify(n),box.needs,box.large,am.a1,am.a2,am.a3,bm.x,JSON.stringify(bm.K.join(' ')),fm.x,JSON.stringify(fm.K.join(' ')),floor,all?'same in all three':'at or below all three'].join(','));
 }
}
console.log(JSON.stringify(eq));console.log(JSON.stringify(sum));
console.log('moments F',tests.map(t=>t+':'+f1[t].rows.length).join(' '));
console.log('lowest margin',JSON.stringify(lowest.sort((x,y)=>x.margin-y.margin).slice(0,4)));
const m=(j)=>{let n=0;for(const t of tests)n+=j[t].rows.length;return n};console.log('moments total a1',m(A.a1),'b',m(b),'f',m(f1),'w',m(w));
const ar=(a)=>{const d=[],s=[];for(const t of tests){a[t].rows.forEach((r,i)=>{d.push(r.drawsAfter-(i?a[t].rows[i-1].drawsAfter:0));s.push(r.tAfter)})}return{drawsMin:Math.min(...d),drawsMax:Math.max(...d),tMax:Math.max(...s)}};
console.log('A1',ar(A.a1),'A2',ar(A.a2),'A3',ar(A.a3));
const sumMs=(a,k)=>tests.reduce((p,t)=>p+a[t].rows.reduce((x,r)=>x+r[k],0),0)/1000;console.log('A1 stepS',sumMs(A.a1,'stepMs'),'shotS',sumMs(A.a1,'shotMs'),'F1 stepS',sumMs(f1,'stepMs'),'shotS',sumMs(f1,'shotMs'));
// repeatability among A runs
const dv=(x,y)=>{let d=0,tt=0,md=0,mt=0;for(const t of tests){x[t].rows.forEach((r,i)=>{for(const n of Object.keys(r.values)){tt++;if(y[t].rows[i].values[n]!==r.values[n])d++}});for(const bx of x[t].boxes){mt++;const n=bx.name;if(Math.min(...x[t].rows.map(r=>r.values[n]))!==Math.min(...y[t].rows.map(r=>r.values[n])))md++}}return{d,tt,md,mt}};
console.log('A1/A2',dv(A.a1,A.a2),'A1/A3',dv(A.a1,A.a3),'A2/A3',dv(A.a2,A.a3));
let lightConst=0,lightTot=0;for(const t of tests.filter(x=>x.endsWith('light'))){for(const bx of b[t].boxes){lightTot++;if(new Set(w[t].rows.map(r=>r.values[bx.name])).size===1)lightConst++}}console.log('light boxes constant over W',lightConst,'of',lightTot);
fs.writeFileSync('/w/_le2e/minimums.csv',csv.join('\n')+'\n');
