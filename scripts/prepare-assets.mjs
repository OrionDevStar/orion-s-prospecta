import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, MUNICIPIOS_BASE } from './assets-manifest.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const force=process.argv.includes('--force');
export function parseSourceJson(bytes){return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}
async function exists(path){try{return (await stat(path)).isFile()&&(await stat(path)).size>0;}catch{return false;}}
async function atomicWrite(path,body){await mkdir(dirname(path),{recursive:true});const temporary=path+'.tmp-'+process.pid;await writeFile(temporary,body);await rename(temporary,path);}
async function get(url){const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Download falhou ('+response.status+'): '+url);const data=Buffer.from(await response.arrayBuffer());if(!data.length||data.length>15*1024*1024)throw new Error('Tamanho inesperado: '+url);return data;}
async function prepare(){
 let downloaded=0;
 for(const asset of ASSETS){
  const path=resolve(root,asset.path);
  if(!path.startsWith(root+sep))throw new Error('Caminho de asset inválido.');
  if(!force&&await exists(path))continue;
  const bytes=asset.content!==undefined?Buffer.from(asset.content,'utf8'):await get(asset.url);
  await atomicWrite(path,bytes);downloaded++;console.log('Preparado: '+asset.path);
 }
 const cityPath=resolve(root,'cities.json');
 if(force||!await exists(cityPath)){
  const states=parseSourceJson(await get(MUNICIPIOS_BASE+'json/estados.json'));
  const municipalities=parseSourceJson(await get(MUNICIPIOS_BASE+'json/municipios.json'));
  if(!Array.isArray(states)||!Array.isArray(municipalities)||municipalities.length<5000)throw new Error('Base municipal inválida.');
  const byCode=new Map(states.map(s=>[s.codigo_uf,s.uf]));
  const cities=municipalities.map(c=>({id:c.codigo_ibge,name:c.nome,uf:byCode.get(c.codigo_uf),lat:c.latitude,lon:c.longitude,ddd:c.ddd}));
  for(const c of cities)if(!c.id||!c.name||!c.uf||!Number.isFinite(c.lat)||Math.abs(c.lat)>90||!Number.isFinite(c.lon)||Math.abs(c.lon)>180)throw new Error('Registro municipal inválido.');
  await atomicWrite(cityPath,JSON.stringify(cities));downloaded++;console.log('Preparadas '+cities.length+' cidades.');
 }
 // Falhar antes de iniciar o servidor caso algum arquivo esteja vazio.
 for(const asset of ASSETS)if(!await exists(resolve(root,asset.path)))throw new Error('Asset não disponível: '+asset.path);
 const cities=parseSourceJson(await readFile(cityPath));
 if(!Array.isArray(cities)||!cities.length)throw new Error('Base de cidades vazia.');
 console.log(downloaded?'Arquivos externos prontos.':'Arquivos externos já disponíveis; nenhum download necessário.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))prepare().catch(error=>{console.error('Não foi possível preparar o Prospecta: '+error.message);console.error('Confira sua conexão e tente npm start novamente.');process.exitCode=1;});
