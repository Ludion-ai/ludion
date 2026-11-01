import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const OUT='/w/_le2e/out',X='/w/_le2e/export';
fs.rmSync(X,{recursive:true,force:true});for(const d of ['runs','logs','scripts'])fs.mkdirSync(`${X}/${d}`,{recursive:true});
for(const n of ['a1','a2','a3','b1','b2','c','w','f1','f2']){const dir=`${OUT}/${n}/data`;const o={};for(const f of fs.readdirSync(dir).sort())o[f.replace('.json','')]=JSON.parse(fs.readFileSync(`${dir}/${f}`,'utf8'));fs.writeFileSync(`${X}/runs/${n}.json`,JSON.stringify(o));}
const timing={};
for(const n of fs.readdirSync(OUT).sort()){const rp=`${OUT}/${n}/report.json`;if(!fs.existsSync(rp))continue;const txt=execFileSync('node',['/w/_le2e/report.mjs',n],{encoding:'utf8'});timing[n]={...JSON.parse(txt),wall:fs.readFileSync(`${OUT}/${n}/wall.txt`,'utf8').trim()};fs.copyFileSync(`${OUT}/${n}/log.txt`,`${X}/logs/${n}.txt`);}
fs.writeFileSync(`${X}/timing.json`,JSON.stringify(timing,null,1)+'\n');
fs.copyFileSync('/w/_le2e/minimums.csv',`${X}/minimums.csv`);
fs.writeFileSync(`${X}/times-c.json`,fs.readFileSync('/w/_le2e/times-c.json'));
fs.writeFileSync(`${X}/times-w.json`,fs.readFileSync('/w/_le2e/times-w.json'));
fs.writeFileSync(`${X}/added-moments.json`,fs.readFileSync('/w/_le2e/added.json'));
for(const s of ['run.sh','report.mjs','compare.mjs','times.mjs','times-w.mjs','select.mjs','final.mjs','mutate.sh','export.mjs'])fs.copyFileSync(`/w/_le2e/${s}`,`${X}/scripts/${s}`);
