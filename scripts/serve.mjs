import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2'};
export function createStaticServer(directory){
 const root=resolve(directory);
 return createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-cache');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end('Método não permitido');return;}
  try{
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
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
  const server=createStaticServer(resolve(dirname(fileURLToPath(import.meta.url)),'../dist'));
  server.on('error',error=>{console.error('Servidor: '+error.message);process.exitCode=1;});
  server.listen(port,host,()=>{console.log('Prospecta em http://'+host+':'+server.address().port);console.log('Ctrl+C para encerrar.');});
 }
}
