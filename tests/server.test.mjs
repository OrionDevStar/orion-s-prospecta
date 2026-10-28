import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createStaticServer } from '../scripts/serve.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'prospecta-server-')),root=join(dir,'public');
 await mkdir(root);await writeFile(join(root,'index.html'),'<h1>Prospecta</h1>');await writeFile(join(root,'app.mjs'),'export const ready = true;');await writeFile(join(dir,'secret.txt'),'outside');
 const server=createStaticServer(root);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(dir,{recursive:true,force:true});});
 return 'http://127.0.0.1:'+server.address().port;
}
test('local server serves the app and modules with browser-compatible MIME types',async t=>{
 const base=await fixture(t),home=await fetch(base+'/');
 assert.equal(home.status,200);assert.match(home.headers.get('content-type'),/text\/html/);assert.match(await home.text(),/Prospecta/);
 const module=await fetch(base+'/app.mjs');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
 const head=await fetch(base+'/app.mjs',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('local server refuses writes and does not expose files outside dist',async t=>{
 const base=await fixture(t),outside=await fetch(base+'/..%2fsecret.txt');
 assert.equal(outside.status,403);
 const post=await fetch(base+'/',{method:'POST',body:'no'});assert.equal(post.status,405);
 const missing=await fetch(base+'/missing');assert.equal(missing.status,404);
});
