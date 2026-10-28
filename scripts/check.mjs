import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS } from './assets-manifest.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let count=0;
for(const folder of ['dist','scripts','tests']){
 const path=resolve(root,folder);
 for(const entry of await readdir(path,{withFileTypes:true})){
  if(!entry.isFile()||!entry.name.endsWith('.mjs'))continue;
  const result=spawnSync(process.execPath,['--check',resolve(path,entry.name)],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
  count++;
 }
}
const html=await readFile(resolve(root,'dist/index.html'),'utf8');
for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
 const ref=match[1];
 if(/^(?:https?:|#|\.\/$)/.test(ref))continue;
 if(ASSETS.some(a=>a.path===ref))continue;
 try{if(!(await stat(resolve(root,'dist',ref))).isFile())throw new Error();}
 catch{throw new Error('Referência local não encontrada: '+ref);}
}
console.log(count+' módulos com sintaxe válida; referências locais conferidas.');
