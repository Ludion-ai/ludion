import fs from 'node:fs';
const name=process.argv[2];
const r=JSON.parse(fs.readFileSync(`/w/_le2e/out/${name}/report.json`,'utf8'));
const by={};let tests=0,sum=0,status={};
const walk=(s,file)=>{for(const x of s.suites||[])walk(x,x.file||file);for(const sp of s.specs||[])for(const t of sp.tests||[])for(const res of t.results||[]){const f=sp.file||file;by[f]??={n:0,ms:0};by[f].n++;by[f].ms+=res.duration;tests++;sum+=res.duration;status[res.status]=(status[res.status]||0)+1;
 if(process.argv[3]==='each')console.log(`${f}:${sp.line} ${sp.title} ${res.status} ${(res.duration/1000).toFixed(1)}s`)}};
walk(r);
console.log(JSON.stringify({name,wallSeconds:+(r.stats.duration/1000).toFixed(1),expected:r.stats.expected,unexpected:r.stats.unexpected,skipped:r.stats.skipped,flaky:r.stats.flaky,workers:r.config?.metadata?.actualWorkers,tests,sumTestSeconds:+(sum/1000).toFixed(1),status,byFile:Object.fromEntries(Object.entries(by).map(([k,v])=>[k,{n:v.n,seconds:+(v.ms/1000).toFixed(1)}]))},null,1));
