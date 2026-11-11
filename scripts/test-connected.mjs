import {frontendDirectory} from '../server/paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
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
  await t.test('Vista móvil enmarcada solo dentro del mismo origen',async()=>{
   const preview=await fetch(api.url+'/mobile-preview');assert.equal(preview.status,200);assert((await preview.text()).includes('src="/mobile-app"'));
   const framed=await fetch(api.url+'/mobile-app');assert.equal(framed.status,200);assert.match(framed.headers.get('content-security-policy'),/frame-ancestors 'self'/);
   const main=await fetch(api.url+'/');assert.match(main.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  });
  await t.test('No expone bases, credenciales ni archivos del servidor',async()=>{
   for(const route of ['/test-accounts.json','/demo.sqlite','/Cuentas-de-prueba.md','/server/demo.mjs','/.git/config','/package.json','/../../server/service.mjs'])assert.equal((await fetch(api.url+route)).status,404,route);
   assert.equal((await fetch(api.url+'/api/projects')).status,401);
  });
  const login=async account=>{const r=await fetch(api.url+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:account.email,password:account.password})});assert.equal(r.status,200);const body=await r.json();assert.equal(body.user.role,account.role);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:body.csrf_token}};
  let session,manager,reader,attachmentId,proof;
  await t.test('Los tres perfiles inician sesión y ven los mismos proyectos de prueba',async()=>{
   for(const account of demo.accounts){const s=await login(account);const response=await fetch(api.url+'/api/projects',{headers:{cookie:s.cookie}});const projects=await response.json();assert.equal(projects.length,3);if(account.role==='admin')session=s;else if(account.role==='responsable')manager=s;else reader=s;}
  });
  let id;
  await t.test('Los cambios del frontend pueden persistir con el mismo origen y CSRF',async()=>{
   const list=await fetch(api.url+'/api/projects',{headers:{cookie:session.cookie}});const projects=await list.json();const p=projects[0];id=p.id;
   const write=await fetch(api.url+'/api/projects/'+p.id,{method:'PATCH',headers:{cookie:session.cookie,'content-type':'application/json','x-csrf-token':session.csrf,origin:api.url},body:JSON.stringify({version:p.version,name:'Proyecto persistido desde la prueba conectada'})});assert.equal(write.status,200);
   const read=await fetch(api.url+'/api/projects/'+p.id,{headers:{cookie:session.cookie}});assert.equal((await read.json()).name,'Proyecto persistido desde la prueba conectada');
  });
  await t.test('Comprobantes privados vinculados a un gasto existente',async()=>{
   const costsUrl=api.url+'/api/projects/'+id+'/costs',filesUrl=costsUrl+'/attachments';
   const costRecord=await (await fetch(costsUrl,{headers:{cookie:session.cookie}})).json();
   const expenseId=costRecord.payload.expenses[0].id;
   const {default:closeReport}=await import(pathToFileURL(path.join(await frontendDirectory(true),'project-close-report.js')));
   proof=Buffer.from(closeReport.projectClosePDF({id,name:'Prueba'},[{name:'Tarea',status:'done'}]));
   const filename='Factura número 01.pdf';
   const upload=(actor,bytes=proof,changes={})=>fetch(filesUrl,{method:'POST',headers:{
    cookie:actor.cookie,'x-csrf-token':actor.csrf,'content-type':'application/octet-stream',
    'x-file-name':encodeURIComponent(filename),'x-expense-id':expenseId,'x-file-category':'Factura',...changes
   },body:bytes});
   assert.equal((await upload(reader)).status,403);
   assert.equal((await upload(manager,proof,{'x-csrf-token':'invalid'})).status,403);
   assert.equal((await upload(manager,proof,{'x-expense-id':'gasto-inexistente'})).status,404);
   assert.equal((await upload(manager,Buffer.from('texto'))).status,415);
   assert.equal((await upload(manager,Buffer.alloc(10*1024*1024+1))).status,413);
   const saved=await upload(manager);assert.equal(saved.status,200);
   const metadata=await saved.json();attachmentId=metadata.id;assert.equal(metadata.name,filename);
   const fileUrl=filesUrl+'/'+attachmentId;
   assert.equal((await fetch(fileUrl)).status,401);
   const wrongProject=api.url+'/api/projects/'+(await (await fetch(api.url+'/api/projects',{headers:{cookie:reader.cookie}})).json())[1].id;
   assert.equal((await fetch(wrongProject+'/costs/attachments/'+attachmentId,{headers:{cookie:reader.cookie}})).status,404);
   const download=await fetch(fileUrl,{headers:{cookie:reader.cookie}});
   assert.equal(download.status,200);
   assert.equal(download.headers.get('content-type'),'application/pdf');
   assert.match(download.headers.get('content-disposition'),/^attachment; filename\*=UTF-8''/);
   assert.deepEqual(Buffer.from(await download.arrayBuffer()),proof);
   const listed=await (await fetch(costsUrl,{headers:{cookie:reader.cookie}})).json();
   assert.deepEqual(listed.attachments,[metadata]);
   const removeExpense=await fetch(costsUrl,{method:'PUT',headers:{cookie:session.cookie,'x-csrf-token':session.csrf,'content-type':'application/json'},body:JSON.stringify({version:listed.version,payload:{...listed.payload,expenses:[]}})});
   assert.equal(removeExpense.status,409);
  });
  await api.close();api=null;await db.close();db=null;
  await t.test('Reiniciar la demostración conserva datos y cuentas, sin volver a sembrar',async()=>{
   const again=await prepareDemo(directory);db=again.db;assert.deepEqual(again.accounts,demo.accounts);assert.equal((await db.query('SELECT id FROM projects')).length,3);assert.equal((await db.query('SELECT name FROM projects WHERE id=?',[id]))[0].name,'Proyecto persistido desde la prueba conectada');
   const [attachment]=await db.query('SELECT content FROM expense_attachments WHERE project_id=? AND id=?',[id,attachmentId]);
   assert.deepEqual(Buffer.from(attachment.content),proof);
  });
 }finally{if(api)await api.close();if(db)await db.close();await rm(directory,{recursive:true,force:true});}
});
