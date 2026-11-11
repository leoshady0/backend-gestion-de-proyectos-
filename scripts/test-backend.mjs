import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../server/database.mjs';
import {bootstrapAdmin} from '../server/service.mjs';
import {createApi} from '../server/http.mjs';
const password=()=>randomBytes(24).toString('base64url');
test('Backend: autenticación, permisos, aprobaciones, concurrencia y conservación',async t=>{
 const db=await openDatabase();const adminPassword=password();const admin=await bootstrapAdmin(db,{email:'admin@example.test',name:'Administrador de prueba',password:adminPassword});
 const api=await createApi({db,port:0});t.after(async()=>{await api.close();await db.close()});
 async function call(actor,method,route,body,extra={}){const headers={...(actor?{cookie:actor.cookie,'x-csrf-token':actor.csrf}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...extra};const r=await fetch(api.url+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),headers:r.headers}}
 async function login(email,pass){const r=await call(null,'POST','/api/login',{email,password:pass});assert.equal(r.status,200);assert(!JSON.stringify(r.body).includes('password_hash'));assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.body.csrf_token,user:r.body.user}}
 const a=await login('admin@example.test',adminPassword);let manager,reader,managerPassword=password(),readerPassword=password(),p,task,request;
 await t.test('Sin acceso anónimo ni registro público',async()=>{assert.equal((await call(null,'GET','/api/projects')).status,401);assert.equal((await call(null,'POST','/api/register',{})).status,401);assert.equal((await call(a,'GET','/api/me')).body.user.role,'admin')});
 await t.test('Solo administrador crea usuarios; no hay escalamiento por campos extra',async()=>{
  const m=await call(a,'POST','/api/users',{email:'manager@example.test',name:'Responsable de prueba',role:'responsable',password:managerPassword});assert.equal(m.status,200);
  const r=await call(a,'POST','/api/users',{email:'reader@example.test',name:'Consulta de prueba',role:'consulta',password:readerPassword});assert.equal(r.status,200);
  manager=await login('manager@example.test',managerPassword);reader=await login('reader@example.test',readerPassword);
  assert.equal((await call(manager,'POST','/api/users',{email:'x@example.test',name:'X',role:'admin',password:password()})).status,403);
  assert.equal((await call(reader,'GET','/api/users')).status,403);assert.equal((await call(a,'PATCH','/api/users/'+admin.id,{version:1,role:'consulta'})).status,409);
  assert.equal((await call(manager,'PATCH','/api/users/'+manager.user.id,{version:1,role:'admin'})).status,403);
 });
 await t.test('Protección CSRF, origen y campos no permitidos',async()=>{
  assert.equal((await call(a,'POST','/api/projects',{name:'X'},{'x-csrf-token':''})).status,403);
  assert.equal((await call(a,'POST','/api/projects',{name:'X'},{origin:'https://untrusted.example.test'})).status,403);
  assert.equal((await call(a,'POST','/api/projects',{name:'X',created_by:admin.id})).status,400);
  assert.equal((await call(a,'POST','/api/projects',{name:'X',due_date:'2026-02-31'})).status,400);
  assert.equal((await call(a,'GET','/api/projects?admin=true')).status,400);
 });
 await t.test('Responsable solicita creación, administrador aprueba una sola vez',async()=>{
  assert.equal((await call(manager,'POST','/api/projects',{name:'No autorizado'})).status,403);
  const r=await call(manager,'POST','/api/requests',{kind:'create',project:{name:'Proyecto ficticio',description:'Prueba local'},reason:'Prueba de aprobación'});assert.equal(r.status,200);request=r.body;
  assert.equal((await call(manager,'POST',`/api/requests/${request.id}/approve`,{})).status,403);
  assert.equal((await call(reader,'GET','/api/requests')).status,403);
  const approved=await call(a,'POST',`/api/requests/${request.id}/approve`,{note:'Autorizado para prueba'});assert.equal(approved.status,200);p=approved.body.project;
  assert.equal((await call(a,'POST',`/api/requests/${request.id}/approve`,{})).status,409);
 });
 await t.test('Consulta ve todos los proyectos pero no interviene',async()=>{
  assert.equal((await call(reader,'GET','/api/projects')).body.length,1);assert.equal((await call(reader,'GET',`/api/projects/${p.id}`)).status,200);
  assert.equal((await call(reader,'PATCH',`/api/projects/${p.id}`,{version:1,name:'Cambio'})).status,403);
  assert.equal((await call(reader,'POST',`/api/projects/${p.id}/tasks`,{name:'Cambio'})).status,403);
  assert.equal((await call(reader,'POST','/api/requests',{kind:'delete',project_id:p.id,reason:'No autorizado'})).status,403);
 });
 await t.test('Tareas, asignaciones, conflictos y cierre completo',async()=>{
  assert.equal((await call(a,'GET',`/api/projects/${p.id}/closure`)).status,409);
  const r=await call(manager,'POST',`/api/projects/${p.id}/tasks`,{name:'Verificar instalación',owner_id:manager.user.id});assert.equal(r.status,200);task=r.body;
  assert.equal((await call(manager,'POST',`/api/projects/${p.id}/tasks`,{name:'Inválida',role:'admin'})).status,400);
  assert.equal((await call(a,'GET',`/api/projects/${p.id}/closure`)).status,409);
  assert.equal((await call(reader,'PATCH',`/api/tasks/${task.id}`,{version:1,status:'done'})).status,403);
  const update=await call(manager,'PATCH',`/api/tasks/${task.id}`,{version:1,status:'done'});assert.equal(update.status,200);task=update.body;
  assert.equal((await call(manager,'PATCH',`/api/tasks/${task.id}`,{version:1,status:'doing'})).status,409);
  assert.equal((await call(reader,'GET',`/api/projects/${p.id}/closure`)).body.tasks[0].status,'done');
  const reopened=await call(manager,'PATCH',`/api/tasks/${task.id}`,{version:task.version,status:'doing'});assert.equal(reopened.status,200);task=reopened.body;
  assert.equal((await call(reader,'GET',`/api/projects/${p.id}/closure`)).status,409);
 });
 await t.test('Dos cambios simultáneos no se sobrescriben',async()=>{
  const current=(await call(a,'GET',`/api/projects/${p.id}`)).body;
  const outcomes=await Promise.all([call(a,'PATCH',`/api/projects/${p.id}`,{version:current.version,name:'Cambio A'}),call(manager,'PATCH',`/api/projects/${p.id}`,{version:current.version,name:'Cambio B'})]);
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
 });
 await t.test('Costos validados sin flujo de aprobación de gastos',async()=>{
  const costs={currency:'PYG',quotes:[],expenses:[{id:'expense-test',concept:'Materiales ficticios',supplier:'Proveedor de prueba',amount:100000,date:'2026-11-10',category:'Base',status:'Pendiente',invoice:'TEST'}],suppliers:[],conclusion:'Prueba'};
  assert.equal((await call(reader,'PUT',`/api/projects/${p.id}/costs`,{version:0,payload:costs})).status,403);
  assert.equal((await call(manager,'PUT',`/api/projects/${p.id}/costs`,{version:0,payload:costs})).status,200);
  assert.equal((await call(manager,'PUT',`/api/projects/${p.id}/costs`,{version:0,payload:costs})).status,409);
  const bad=structuredClone(costs);bad.expenses[0].amount=-1;assert.equal((await call(manager,'PUT',`/api/projects/${p.id}/costs`,{version:1,payload:bad})).status,400);
  assert.equal((await call(reader,'GET',`/api/projects/${p.id}/costs`)).body.payload.currency,'PYG');
  const costsUrl='/api/projects/'+p.id+'/costs';
  const approvedQuote={id:'quote-test',concept:'Materiales ficticios',amount:180000,date:'2026-11-10',category:'Base',approved:true};
  assert.equal((await call(manager,'PUT',costsUrl,{version:1,payload:{...costs,quotes:[approvedQuote]}})).status,403);
  assert.equal((await call(manager,'PUT',costsUrl,{version:1,payload:{...costs,approvedBudget:0}})).status,403);
  assert.equal((await call(a,'PUT',costsUrl,{version:1,payload:{...costs,approvedBudget:-1}})).status,400);
  const withBudget={...costs,approvedBudget:0};
  assert.equal((await call(a,'PUT',costsUrl,{version:1,payload:withBudget})).status,200);
  assert.equal((await call(manager,'PUT',costsUrl,{version:2,payload:costs})).status,403);
  assert.equal((await call(manager,'PUT',costsUrl,{version:2,payload:{...withBudget,currency:'USD'}})).status,403);
  assert.equal((await call(manager,'PUT',costsUrl,{version:2,payload:{...withBudget,expenses:[]}})).status,200);
  assert.equal((await call(a,'PUT',costsUrl,{version:3,payload:{...withBudget,expenses:[],approvedBudget:200000}})).status,200);
  assert.equal((await call(reader,'GET',costsUrl)).body.payload.approvedBudget,200000);
  const budgetAudit=(await call(a,'GET','/api/audit')).body.find(event=>event.action==='costs.budget_updated'&&JSON.parse(event.details).amount===200000);
  assert.equal(budgetAudit.entity_id,p.id);
  assert.deepEqual(JSON.parse(budgetAudit.details),{previous_amount:0,previous_currency:'PYG',amount:200000,currency:'PYG'});

  assert.equal((await call(manager,'POST','/api/expenses/x/approve',{})).status,404);
 });
 await t.test('Cronogramas y control de versión',async()=>{
  const schedule={start:'2026-11-01',unit:'days',calendarDays:10,rows:[{id:'r1',name:'Actividad ficticia',group:false,activeDays:[1,2]}],incidents:[]};
  assert.equal((await call(manager,'PUT',`/api/projects/${p.id}/schedule`,{version:0,payload:schedule})).status,200);
  const bad=structuredClone(schedule);bad.rows[0].activeDays=[11];assert.equal((await call(manager,'PUT',`/api/projects/${p.id}/schedule`,{version:1,payload:bad})).status,400);
  const updated=structuredClone(schedule);
  updated.calendarDays=24;
  updated.rows[0].activeDays=Array.from({length:18},(_,index)=>index+3);
  updated.rows[0].status='delayed';
  updated.incidents=[{id:'incident-1',type:'delay',activityId:'r1',date:'2026-11-12',text:'Demora de prueba',author:manager.user.name}];
  const invalid=structuredClone(updated);invalid.incidents[0].activityId='missing';
  assert.equal((await call(manager,'PUT',`/api/projects/${p.id}/schedule`,{version:1,payload:invalid})).status,400);
  assert.equal((await call(manager,'PUT',`/api/projects/${p.id}/schedule`,{version:1,payload:updated})).status,200);
  assert.equal((await call(manager,'PUT',`/api/projects/${p.id}/schedule`,{version:1,payload:schedule})).status,409);
  const saved=(await call(manager,'GET',`/api/projects/${p.id}/schedule`)).body;
  assert.deepEqual(saved.payload,updated);
  assert.deepEqual(saved.history.map(entry=>entry.version),[2,1]);
  assert(saved.history.every(entry=>entry.author_name===manager.user.name&&Number(entry.saved_at)>0));
  assert.equal((await call(reader,'GET',`/api/projects/${p.id}/schedule/versions/1`)).body.payload.rows[0].activeDays.length,2);
  updated.rows.unshift({id:'civil',name:'Trabajos civiles',group:true,activeDays:[]});
  updated.rows[1].groupId='civil';
  const invalidGroup=structuredClone(updated);invalidGroup.rows[1].groupId='missing';
  assert.equal((await call(manager,'PUT',`/api/projects/${p.id}/schedule`,{version:2,payload:invalidGroup})).status,400);
  for(let version=2;version<17;version++){
   updated.rows[1].name='Actividad de la versión '+(version+1);
   assert.equal((await call(manager,'PUT',`/api/projects/${p.id}/schedule`,{version,payload:updated})).status,200);
  }
  const retained=(await call(reader,'GET',`/api/projects/${p.id}/schedule`)).body.history;
  assert.equal(retained.length,17);
  assert.deepEqual(retained.filter(entry=>entry.has_snapshot).map(entry=>entry.version),Array.from({length:15},(_,index)=>17-index));
  assert.equal((await call(reader,'GET',`/api/projects/${p.id}/schedule/versions/2`)).status,404);
  const oldest=(await call(reader,'GET',`/api/projects/${p.id}/schedule/versions/3`)).body;
  assert.equal(oldest.payload.rows[1].name,'Actividad de la versión 3');
  assert.equal(oldest.payload.rows[1].groupId,'civil');
 });
 await t.test('Eliminación requiere permiso; solicitud caduca si el proyecto cambia',async()=>{
  const current=(await call(a,'GET',`/api/projects/${p.id}`)).body;
  assert.equal((await call(manager,'DELETE',`/api/projects/${p.id}`,{version:current.version,reason:'Prueba'})).status,403);
  const r=await call(manager,'POST','/api/requests',{kind:'delete',project_id:p.id,reason:'Prueba de eliminación'});assert.equal(r.status,200);request=r.body;
  assert.equal((await call(manager,'POST','/api/requests',{kind:'delete',project_id:p.id,reason:'Duplicada'})).status,409);
  assert.equal((await call(manager,'PATCH',`/api/projects/${p.id}`,{version:current.version,name:'Proyecto actualizado'})).status,200);
  assert.equal((await call(a,'POST',`/api/requests/${request.id}/approve`,{})).status,409);
  assert.equal((await call(a,'GET','/api/requests')).body.find(x=>x.id===request.id).status,'pending');
  assert.equal((await call(a,'POST',`/api/requests/${request.id}/reject`,{note:'Cambió el alcance'})).status,200);
  const next=await call(manager,'POST','/api/requests',{kind:'delete',project_id:p.id,reason:'Nueva solicitud'});
  assert.equal((await call(a,'POST',`/api/requests/${next.body.id}/approve`,{})).status,200);
  assert.equal((await call(reader,'GET',`/api/projects/${p.id}`)).status,404);
  assert.equal((await call(manager,'PATCH',`/api/tasks/${task.id}`,{version:task.version,status:'done'})).status,404);
  assert((await db.query('SELECT archived_at FROM projects WHERE id=?',[p.id]))[0].archived_at);assert.equal((await db.query('SELECT id FROM tasks WHERE project_id=?',[p.id])).length,1);
 });
 await t.test('Restauración administrativa del proyecto archivado',async()=>{
  const archived=(await db.query('SELECT version FROM projects WHERE id=?',[p.id]))[0];
  assert.equal((await call(manager,'POST',`/api/projects/${p.id}/restore`,{version:archived.version,reason:'Prueba'})).status,403);
  assert.equal((await call(a,'POST',`/api/projects/${p.id}/restore`,{version:archived.version,reason:'Restauración de prueba'})).status,200);
  assert.equal((await call(reader,'GET',`/api/projects/${p.id}/tasks`)).body.length,1);
 });
 await t.test('Sesiones revocables, expiración y auditoría sin secretos',async()=>{
  assert.equal((await call(a,'PATCH',`/api/users/${reader.user.id}`,{version:reader.user.version,active:false})).status,200);
  assert.equal((await call(reader,'GET','/api/projects')).status,401);
  const log=await call(a,'GET','/api/audit');assert.equal(log.status,200);assert(log.body.some(e=>e.action==='request.approved'));assert(log.body.some(e=>e.action==='project.archived'));
  const serialized=JSON.stringify(log.body);assert(!serialized.includes(adminPassword));assert(!serialized.includes(managerPassword));assert(!serialized.includes(a.csrf));assert(!serialized.includes('password_hash'));
  await db.query('UPDATE sessions SET expires_at=0 WHERE user_id=?',[manager.user.id]);assert.equal((await call(manager,'GET','/api/me')).status,401);
  assert.equal((await call(a,'POST','/api/logout',{})).status,200);assert.equal((await call(a,'GET','/api/projects')).status,401);
 });
 await t.test('Datos persistentes al reabrir SQLite',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'project-api-test-'));try{const file=path.join(dir,'test.sqlite');const d1=await openDatabase({filename:file});await bootstrapAdmin(d1,{email:'persist@example.test',name:'Prueba',password:password()});await d1.close();const d2=await openDatabase({filename:file});try{assert.equal((await d2.query('SELECT email FROM users'))[0].email,'persist@example.test')}finally{await d2.close()}}finally{await rm(dir,{recursive:true,force:true})}
 });
});
test('Protección de intentos y cuerpos inválidos',async t=>{const db=await openDatabase();const api=await createApi({db,port:0});t.after(async()=>{await api.close();await db.close()});
 const malformed=await fetch(api.url+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:'{'});assert.equal(malformed.status,400);
 const type=await fetch(api.url+'/api/login',{method:'POST',body:'x'});assert.equal(type.status,415);
 const big=await fetch(api.url+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:'X'.repeat(262145)})});assert.equal(big.status,413);
 let status;for(let i=0;i<11;i++){const r=await fetch(api.url+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'unknown@example.test',password:'invalid'})});status=r.status;if(i===0)assert.equal(status,401)}assert.equal(status,429);
});
