import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const child=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
let output='';
const timeout=setTimeout(()=>child.kill(),15000);
try{
 const origin=await new Promise((resolve,reject)=>{
  child.stdout.on('data',chunk=>{output+=chunk.toString();const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});
  child.on('error',reject);child.on('exit',code=>reject(new Error('Servidor encerrou antes de iniciar: '+code)));
 });
 const home=await fetch(origin+'/');assert.equal(home.status,200);assert.match(await home.text(),/search-form/);
 const module=await fetch(origin+'/app.mjs');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
 const cities=await fetch(origin+'/cities.json');assert.equal(cities.status,200);assert.ok((await cities.json()).length>=5000);
 for(const file of ['leaflet.js','leaflet.css','maplibre-gl.js','maplibre-gl.css','leaflet-maplibre-gl.js','leaflet-vectorgrid.js']){
  const resource=await fetch(origin+'/vendor/'+file,{method:'HEAD'});assert.equal(resource.status,200,file);assert.ok(Number(resource.headers.get('content-length'))>0,file);
 }
 console.log('Inicialização local verificada: interface, módulos, municípios e bibliotecas disponíveis.');
}finally{clearTimeout(timeout);if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}}
