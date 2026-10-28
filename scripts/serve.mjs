import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createPlacesService, PlacesError } from './places.mjs';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export async function loadPlacesConfig(root=projectRoot,environment=process.env){
 let values={};
 try{values=parseEnv(await readFile(resolve(root,'.env'),'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw new Error('Não foi possível ler o arquivo .env.');}
 const setting=name=>Object.hasOwn(environment,name)?environment[name]:values[name];
 const numeric=name=>{const value=setting(name);return value===undefined||String(value).trim()===''?undefined:Number(value);};
 return {apiKey:String(setting('PLACESAPI')||'').trim(),usageFile:resolve(root,'.local/places-usage.json'),monthlyLimit:numeric('PLACES_MONTHLY_LIMIT'),dailyLimit:numeric('PLACES_DAILY_LIMIT')};
}

function json(res,status,value){const body=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)});res.end(body);}
function localApiRequest(req){
 const remote=req.socket.remoteAddress;
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))return false;
 try{
  const host=new URL('http://'+req.headers.host);
  if(!['127.0.0.1','localhost','[::1]'].includes(host.hostname)||Number(host.port||80)!==req.socket.localPort)return false;
  if(req.headers.origin&&new URL(req.headers.origin).origin!==host.origin)return false;
  return req.headers['sec-fetch-site']!=='cross-site';
 }catch{return false;}
}
async function readJson(req){
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>8192){const error=new Error('A consulta excede o tamanho permitido.');error.httpStatus=413;throw error;}chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const error=new Error('Envie uma consulta JSON válida.');error.httpStatus=400;throw error;}
}
async function placesApi(req,res,pathname,service){
 if(!localApiRequest(req)){json(res,403,{error:{code:'LOCAL_ONLY',message:'A integração Google aceita somente consultas locais da própria aplicação.'}});return;}
 const statusRoute=pathname==='/api/places/status',verifyRoute=pathname==='/api/places/verify';
 if(!statusRoute&&!verifyRoute){json(res,404,{error:{code:'NOT_FOUND',message:'Consulta não encontrada.'}});return;}
 if(req.method!==(statusRoute?'GET':'POST')){res.setHeader('Allow',statusRoute?'GET':'POST');json(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'Método não permitido.'}});return;}
 if(!statusRoute&&(req.headers['x-prospecta-request']!=='places-v1'||!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))){json(res,403,{error:{code:'REQUEST_REQUIRED',message:'Inicie a verificação pela aplicação.'}});return;}
 try{
  if(statusRoute){json(res,200,service?await service.status():{enabled:false,message:'Configure PLACESAPI no .env e reinicie o servidor.'});return;}
  if(!service){json(res,503,{error:{code:'NOT_CONFIGURED',message:'Configure PLACESAPI no .env e reinicie o servidor.'}});return;}
  const body=await readJson(req);
  json(res,200,await service.verify(body?.candidate));
 }catch(error){
  const known=error instanceof PlacesError;
  const clientError=[400,413].includes(error.httpStatus)&&!known;
  let usage;if(known&&service){try{usage=await service.status();}catch{/* Unconfirmed consumption must remain blocked. */}}
  json(res,known?error.httpStatus:clientError?error.httpStatus:503,{error:{code:known?error.code:clientError?'INVALID_REQUEST':'SERVICE_UNAVAILABLE',message:known||clientError?error.message:'A verificação está indisponível. Nenhuma resposta ou credencial do Google foi exposta.'},...(usage?{usage}:{})});
 }
}

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2'};
export function createStaticServer(directory,{placesService}={}){
 const root=resolve(directory);
 return createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-cache');
  try{
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   if(pathname.startsWith('/api/places/')){await placesApi(req,res,pathname,placesService);return;}
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end('Método não permitido');return;}
   if(pathname.split('/').some(part=>part.startsWith('.'))){res.writeHead(403);res.end('Acesso negado');return;}
   if(pathname.includes('\0')){res.writeHead(400);res.end();return;}
   let target=resolve(root,'.'+pathname);
   if(target!==root&&!target.startsWith(root+sep)){res.writeHead(403);res.end('Acesso negado');return;}
   if((await stat(target)).isDirectory())target=resolve(target,'index.html');
   const actual=await realpath(target),actualRoot=await realpath(root);
   if(actual!==actualRoot&&!actual.startsWith(actualRoot+sep)){res.writeHead(403);res.end('Acesso negado');return;}
   if(!(await stat(actual)).isFile()){res.writeHead(404);res.end('Arquivo não encontrado');return;}
   const bytes=await readFile(actual);
   res.writeHead(200,{'Content-Type':MIME[extname(actual).toLowerCase()]||'application/octet-stream','Content-Length':bytes.length});
   res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){
   if(error instanceof URIError){res.writeHead(400);res.end('Endereço inválido');}
   else if(error.code==='ENOENT'||error.code==='ENOTDIR'){res.writeHead(404);res.end('Arquivo não encontrado');}
   else{res.writeHead(500);res.end('Não foi possível servir o arquivo');}
  }
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT??3000),host=process.env.HOST||'127.0.0.1';
 if(!Number.isInteger(port)||port<0||port>65535){console.error('PORT deve ser uma porta válida.');process.exitCode=1;}
 else{
  const placesConfig=await loadPlacesConfig();
  const placesService=createPlacesService(placesConfig);
  const server=createStaticServer(resolve(projectRoot,'dist'),{placesService});
  server.on('error',error=>{console.error('Servidor: '+error.message);process.exitCode=1;});
  server.listen(port,host,()=>{console.log('Prospecta em http://'+host+':'+server.address().port);console.log(placesConfig.apiKey?'Google Places configurado. Consultas locais com limite de segurança; chave mantida no servidor.':'Google Places opcional: configure PLACESAPI no .env para habilitar.');console.log('Ctrl+C para encerrar.');});
 }
}
