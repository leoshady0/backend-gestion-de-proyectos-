import {frontendDirectory} from '../server/paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareDemo} from '../server/demo.mjs';
import {createApi} from '../server/http.mjs';
test('Aplicación conectada: archivos públicos acotados, cuentas ficticias y persistencia',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'connected-project-test-'));let db,api;
 try{
  const demo=await prepareDemo(directory);db=demo.db;
  api=await createApi({db,port:0,staticRoot:await frontendDirectory(true)});
  await t.test('Sirve la interfaz y todos sus recursos con CSP y sin credenciales',async()=>{
   const r=await fetch(api.url+'/');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
   const html=await r.text();for(const a of demo.accounts)assert(!html.includes(a.password));
   assert(html.includes('connected.js'));assert(html.includes('login-form'));
   for(const asset of ['/connected.js','/connected.css','/style.css','/forja-icon.svg','/costs-report.js','/project-close-report.js']){const response=await fetch(api.url+asset);assert.equal(response.status,200,asset)}
   const head=await fetch(api.url+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  });
  await t.test('No expone bases, credenciales ni archivos del servidor',async()=>{
   for(const route of ['/test-accounts.json','/demo.sqlite','/Cuentas-de-prueba.md','/server/demo.mjs','/.git/config','/package.json','/../../server/service.mjs'])assert.equal((await fetch(api.url+route)).status,404,route);
   assert.equal((await fetch(api.url+'/api/projects')).status,401);
  });
  const login=async account=>{const r=await fetch(api.url+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:account.email,password:account.password})});assert.equal(r.status,200);const body=await r.json();assert.equal(body.user.role,account.role);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:body.csrf_token}};
  let session;
  await t.test('Los tres perfiles inician sesión y ven los mismos proyectos de prueba',async()=>{
   for(const account of demo.accounts){const s=await login(account);const response=await fetch(api.url+'/api/projects',{headers:{cookie:s.cookie}});const projects=await response.json();assert.equal(projects.length,3);if(account.role==='admin')session=s;}
  });
  let id;
  await t.test('Los cambios del frontend pueden persistir con el mismo origen y CSRF',async()=>{
   const list=await fetch(api.url+'/api/projects',{headers:{cookie:session.cookie}});const projects=await list.json();const p=projects[0];id=p.id;
   const write=await fetch(api.url+'/api/projects/'+p.id,{method:'PATCH',headers:{cookie:session.cookie,'content-type':'application/json','x-csrf-token':session.csrf,origin:api.url},body:JSON.stringify({version:p.version,name:'Proyecto persistido desde la prueba conectada'})});assert.equal(write.status,200);
   const read=await fetch(api.url+'/api/projects/'+p.id,{headers:{cookie:session.cookie}});assert.equal((await read.json()).name,'Proyecto persistido desde la prueba conectada');
  });
  await api.close();api=null;await db.close();db=null;
  await t.test('Reiniciar la demostración conserva datos y cuentas, sin volver a sembrar',async()=>{
   const again=await prepareDemo(directory);db=again.db;assert.deepEqual(again.accounts,demo.accounts);assert.equal((await db.query('SELECT id FROM projects')).length,3);assert.equal((await db.query('SELECT name FROM projects WHERE id=?',[id]))[0].name,'Proyecto persistido desde la prueba conectada');
  });
 }finally{if(api)await api.close();if(db)await db.close();await rm(directory,{recursive:true,force:true});}
});
