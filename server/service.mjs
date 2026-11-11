import {randomUUID} from 'node:crypto';
import {allow,roles,fields,text,email,day,version,fail,passwordHash,publicUser,isUniqueError} from './security.mjs';
const editors=['admin','responsable'];
const scheduleSnapshotLimit=15;
const attachmentTypes={
 pdf:{mediaType:'application/pdf',signature:'255044462d'},
 xlsx:{mediaType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',signature:'504b0304',member:Buffer.from('xl/workbook.xml')},
 xls:{mediaType:'application/vnd.ms-excel',signature:'d0cf11e0a1b11ae1',member:Buffer.from('Workbook','utf16le'),alternate:Buffer.from('Book','utf16le')}
};
function expenseAttachmentType(name,content){
 const extension=name.split('.').pop().toLowerCase();
 if(!name.includes('.')||!Object.hasOwn(attachmentTypes,extension)||!Buffer.isBuffer(content))fail(415,'Elegí un archivo PDF o Excel (.xlsx o .xls).');
 const {mediaType,signature,member,alternate}=attachmentTypes[extension];
 if(content.subarray(0,signature.length/2).toString('hex')!==signature||
    (member&&!content.includes(member)&&!(alternate&&content.includes(alternate))))fail(415,'El contenido del archivo no coincide con su formato PDF o Excel.');
 return mediaType;
}
function expenseAttachments(db,projectId){
 return db.query('SELECT id,expense_id,name,category,size_bytes,created_at FROM expense_attachments WHERE project_id=? ORDER BY created_at,id',[projectId]);
}
const one=async(db,sql,args=[])=>{const row=(await db.query(sql,args))[0];if(!row)fail(404,'Registro no encontrado.');return row};
export async function audit(db,user,action,type,id,details={}){await db.query('INSERT INTO audit_events (id,actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)',[randomUUID(),user?.id||null,action,type,id,JSON.stringify(details),Date.now()]);}
function projectInput(body){fields(body,['name','description','due_date']);return {name:text(body.name,'nombre',160,true),description:text(body.description??'','descripción',5000),due_date:day(body.due_date)}}
async function insertProject(db,user,body){const p=projectInput(body),id=randomUUID();await db.query('INSERT INTO projects (id,name,description,due_date,created_by,created_at) VALUES (?,?,?,?,?,?)',[id,p.name,p.description,p.due_date,user.id,Date.now()]);await audit(db,user,'project.created','project',id);return one(db,'SELECT * FROM projects WHERE id=?',[id])}
export async function bootstrapAdmin(db,body){const hash=await passwordHash(body.password);return db.transaction(async tx=>{if(tx.dialect==='postgresql')await tx.query('SELECT pg_advisory_xact_lock(180492)');if((await tx.query('SELECT id FROM users LIMIT 1')).length)fail(409,'La instalación ya tiene usuarios.');const id=randomUUID();await tx.query('INSERT INTO users (id,email,name,role,password_hash,created_at) VALUES (?,?,?,?,?,?)',[id,email(body.email),text(body.name,'nombre',120,true),'admin',hash,Date.now()]);await audit(tx,{id},'installation.bootstrapped','user',id);return publicUser(await one(tx,'SELECT * FROM users WHERE id=?',[id]))})}
async function liveProject(db,id){return one(db,'SELECT * FROM projects WHERE id=? AND archived_at IS NULL'+(db.dialect==='postgresql'?' FOR UPDATE':''),[id])}
async function touchProject(db,id){await db.query('UPDATE projects SET version=version+1 WHERE id=?',[id])}
export async function service(db,user,method,path,body){
 const parts=path.split('/').filter(Boolean).slice(1);const [resource,id,child]=parts;
 if(resource==='users'){
  allow(user,['admin']);
  if(method==='GET'&&!id)return (await db.query('SELECT * FROM users ORDER BY name')).map(publicUser);
  if(method==='POST'&&!id){fields(body,['email','name','role','password']);if(!roles.includes(body.role))fail(400,'Perfil inválido.');const hash=await passwordHash(body.password),uid=randomUUID();try{await db.query('INSERT INTO users (id,email,name,role,password_hash,created_at) VALUES (?,?,?,?,?,?)',[uid,email(body.email),text(body.name,'nombre',120,true),body.role,hash,Date.now()])}catch(e){if(isUniqueError(e))fail(409,'Ese correo ya está registrado.');throw e}await audit(db,user,'user.created','user',uid,{role:body.role});return publicUser(await one(db,'SELECT * FROM users WHERE id=?',[uid]));}
  if(method==='PATCH'&&id&&!child){fields(body,['version','name','role','active','password']);version(body.version);if(body.role!==undefined&&!roles.includes(body.role))fail(400,'Perfil inválido.');if(body.active!==undefined&&typeof body.active!=='boolean')fail(400,'Estado inválido.');
   await db.query("UPDATE users SET version=version WHERE role='admin' AND active=1");
   const current=await one(db,'SELECT * FROM users WHERE id=?',[id]);const role=body.role??current.role,active=body.active===undefined?current.active:Number(body.active);
   if(current.role==='admin'&&current.active&&(!active||role!=='admin')&&(await db.query("SELECT id FROM users WHERE role='admin' AND active=1")).length<=1)fail(409,'Debe quedar al menos un administrador activo.');
   const hash=body.password===undefined?current.password_hash:await passwordHash(body.password);
   const updated=await db.query('UPDATE users SET name=?,role=?,active=?,password_hash=?,version=version+1 WHERE id=? AND version=? RETURNING *',[body.name===undefined?current.name:text(body.name,'nombre',120,true),role,active,hash,id,body.version]);if(!updated.length)fail(409,'El usuario cambió. Recargá antes de guardar.');
   await db.query('DELETE FROM sessions WHERE user_id=?',[id]);await audit(db,user,'user.updated','user',id,{role,active:!!active,password_changed:body.password!==undefined});return publicUser(updated[0]);
  }
 }
 if(resource==='directory'&&method==='GET'&&!id)return db.query('SELECT id,name FROM users WHERE active=1 ORDER BY name');
 if(resource==='projects'){
  if(method==='GET'&&!id)return db.query('SELECT * FROM projects WHERE archived_at IS NULL ORDER BY created_at');
  if(method==='POST'&&!id){allow(user,['admin']);return insertProject(db,user,body)}
  if(id){
   if(child==='restore'&&method==='POST'&&parts.length===3){allow(user,['admin']);fields(body,['version','reason']);const restored=await db.query('UPDATE projects SET archived_at=NULL,version=version+1 WHERE id=? AND version=? AND archived_at IS NOT NULL RETURNING *',[id,version(body.version)]);if(!restored.length)fail(409,'No existe una versión archivada coincidente.');await audit(db,user,'project.restored','project',id,{reason:text(body.reason,'motivo',2000,true)});return restored[0]}
   const p=await liveProject(db,id);
   if(method==='GET'&&!child)return p;
   if(method==='PATCH'&&!child){allow(user,editors);fields(body,['version','name','description','due_date']);const input=projectInput({name:body.name??p.name,description:body.description??p.description,due_date:body.due_date??p.due_date});const rows=await db.query('UPDATE projects SET name=?,description=?,due_date=?,version=version+1 WHERE id=? AND version=? AND archived_at IS NULL RETURNING *',[input.name,input.description,input.due_date,id,version(body.version)]);if(!rows.length)fail(409,'El proyecto cambió. Recargá antes de guardar.');await audit(db,user,'project.updated','project',id);return rows[0]}
   if(method==='DELETE'&&!child){allow(user,['admin']);fields(body,['version','reason']);const rows=await db.query('UPDATE projects SET archived_at=?,version=version+1 WHERE id=? AND version=? AND archived_at IS NULL RETURNING id',[Date.now(),id,version(body.version)]);if(!rows.length)fail(409,'El proyecto cambió.');await audit(db,user,'project.archived','project',id,{reason:text(body.reason,'motivo',2000,true)});return {archived:true}}
   if(child==='tasks'&&parts.length===3){
    if(method==='GET')return db.query('SELECT * FROM tasks WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at',[id]);
    if(method==='POST'){allow(user,editors);const t=await taskInput(db,body),tid=randomUUID();await db.query('INSERT INTO tasks (id,project_id,name,description,status,priority,owner_id,due_date,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[tid,id,t.name,t.description,t.status,t.priority,t.owner_id,t.due_date,Date.now()]);await touchProject(db,id);await audit(db,user,'task.created','task',tid,{project_id:id});return one(db,'SELECT * FROM tasks WHERE id=?',[tid])}
   }
   if(child==='closure'&&method==='GET'&&parts.length===3){const tasks=await db.query('SELECT * FROM tasks WHERE project_id=? AND deleted_at IS NULL',[id]);if(!tasks.length||tasks.some(t=>t.status!=='done'))fail(409,'Completa todas las tareas antes del cierre.');await audit(db,user,'project.closure_snapshot','project',id);return {project:p,tasks,records:(await db.query('SELECT * FROM project_records WHERE project_id=?',[id])).map(r=>({...r,payload:JSON.parse(r.payload)})),attachments:await expenseAttachments(db,id),generated_at:new Date().toISOString()}}
   if(child==='schedule'&&parts[3]==='versions'&&parts.length===5&&method==='GET'){
    const requestedVersion=Number(parts[4]);
    if(!/^\d+$/.test(parts[4])||!Number.isSafeInteger(requestedVersion)||requestedVersion<1)fail(400,'Versión inválida.');
    const saved=await one(db,'SELECT version, author_name, saved_at, payload FROM schedule_saves WHERE project_id=? AND version=?',[id,requestedVersion]);
    if(saved.payload===null)fail(404,'Esta versión solo conserva el registro de actualización.');
    return {...saved,project_name:p.name,payload:JSON.parse(saved.payload)};
   }
   if(child==='costs'&&parts[3]==='attachments'){
    if(method==='GET'&&parts.length===5)return one(db,'SELECT name,media_type,content FROM expense_attachments WHERE project_id=? AND id=?',[id,parts[4]]);
    if(method==='POST'&&parts.length===4){
     allow(user,editors);
     const expenseId=body.expenseId;
     const [record]=await db.query("SELECT payload FROM project_records WHERE project_id=? AND kind='costs'",[id]);
     if(!record||!JSON.parse(record.payload).expenses.some(expense=>expense.id===expenseId))fail(404,'El gasto no existe en este proyecto.');
     const name=text(body.name,'nombre del archivo',240,true),{category,content}=body;
     if(/[\u0000-\u001f\u007f/\\]/u.test(name))fail(400,'Nombre de archivo inválido.');
     if(!['Comparativo','Factura','Otro'].includes(category))fail(400,'Tipo de comprobante inválido.');
     const mediaType=expenseAttachmentType(name,content);
     const attachmentId=randomUUID(),createdAt=Date.now();
     await db.query('INSERT INTO expense_attachments (id,project_id,expense_id,name,category,media_type,size_bytes,content,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[attachmentId,id,expenseId,name,category,mediaType,content.length,content,user.id,createdAt]);
     await touchProject(db,id);
     await audit(db,user,'costs.attachment_added','project',id,{expense_id:expenseId,attachment_id:attachmentId,category});
     return {id:attachmentId,expense_id:expenseId,name,category,size_bytes:content.length,created_at:createdAt};
    }
   }
   if(['schedule','costs'].includes(child)&&parts.length===3){
    if(method==='GET'){
     const [row]=await db.query('SELECT * FROM project_records WHERE project_id=? AND kind=?',[id,child]);
     const record=row?{...row,payload:JSON.parse(row.payload)}:{payload:null,version:0};
     if(child==='schedule')record.history=await db.query('SELECT version, author_name, saved_at, CASE WHEN payload IS NULL THEN 0 ELSE 1 END AS has_snapshot FROM schedule_saves WHERE project_id=? ORDER BY version DESC',[id]);
     if(child==='costs')record.attachments=await expenseAttachments(db,id);
     return record;
    }
    if(method==='PUT'){allow(user,editors);fields(body,['version','payload']);if(!Number.isInteger(body.version)||body.version<0)fail(400,'Versión inválida.');validateRecord(child,body.payload);const existing=(await db.query('SELECT version, payload FROM project_records WHERE project_id=? AND kind=?',[id,child]))[0];if((existing?.version??0)!==body.version)fail(409,'El registro cambió. Recargá antes de guardar.');
     let budgetChange;
     if(child==='costs'){
      const previous=existing?JSON.parse(existing.payload):null;
      const next=body.payload;
      const expenseIds=new Set(next.expenses.map(expense=>expense.id));
      if(previous?.expenses.some(expense=>!expenseIds.has(expense.id))){
       const linked=await db.query('SELECT DISTINCT expense_id FROM expense_attachments WHERE project_id=?',[id]);
       if(linked.some(attachment=>!expenseIds.has(attachment.expense_id)))fail(409,'El gasto tiene comprobantes asociados.');
      }
      const before=approvedBudget(previous), after=approvedBudget(next);
      const previousCurrency=previous?.currency??next.currency;
      if(previous?.approvedBudget!==next.approvedBudget||before!==after||((before!==0||previous?.approvedBudget!==undefined)&&previousCurrency!==next.currency)){
       if(user.role!=='admin')fail(403,'Solo un administrador puede modificar el presupuesto aprobado.');
       budgetChange={previous_amount:before,previous_currency:previousCurrency,amount:after,currency:next.currency};
      }
     }
     const payload=JSON.stringify(body.payload), savedAt=Date.now(), nextVersion=body.version+1;
     if(existing){const rows=await db.query('UPDATE project_records SET payload=?,version=version+1,updated_by=?,updated_at=? WHERE project_id=? AND kind=? AND version=? RETURNING version',[payload,user.id,savedAt,id,child,body.version]);if(!rows.length)fail(409,'El registro cambió.')}else{try{await db.query('INSERT INTO project_records (project_id,kind,payload,updated_by,updated_at) VALUES (?,?,?,?,?)',[id,child,payload,user.id,savedAt])}catch(e){if(isUniqueError(e))fail(409,'El registro cambió.');throw e}}
     if(child==='schedule'){
      await db.query('INSERT INTO schedule_saves (project_id,version,author_name,saved_at,payload) VALUES (?,?,?,?,?)',[id,nextVersion,user.name,savedAt,payload]);
      await db.query('UPDATE schedule_saves SET payload=NULL WHERE project_id=? AND version<=? AND payload IS NOT NULL',[id,nextVersion-scheduleSnapshotLimit]);
     }
     await touchProject(db,id);await audit(db,user,'record.updated',child,id);
     if(budgetChange)await audit(db,user,'costs.budget_updated','project',id,budgetChange);
     return {version:nextVersion,payload:body.payload};
    }
   }
  }
 }
 if(resource==='tasks'&&id&&!child){const task=await one(db,'SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL',[id]);await liveProject(db,task.project_id);allow(user,editors);
  if(method==='PATCH'){fields(body,['version','name','description','status','priority','owner_id','due_date']);const {version:ignored,...changes}=body,t=await taskInput(db,{...task,...changes},true);const rows=await db.query('UPDATE tasks SET name=?,description=?,status=?,priority=?,owner_id=?,due_date=?,version=version+1 WHERE id=? AND version=? RETURNING *',[t.name,t.description,t.status,t.priority,t.owner_id,t.due_date,id,version(body.version)]);if(!rows.length)fail(409,'La tarea cambió. Recargá antes de guardar.');await touchProject(db,task.project_id);await audit(db,user,'task.updated','task',id,{project_id:task.project_id});return rows[0]}
  if(method==='DELETE'){fields(body,['version']);const rows=await db.query('UPDATE tasks SET deleted_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL RETURNING id',[Date.now(),id,version(body.version)]);if(!rows.length)fail(409,'La tarea cambió.');await touchProject(db,task.project_id);await audit(db,user,'task.archived','task',id,{project_id:task.project_id});return {archived:true}}
 }
 if(resource==='requests'){
  if(method==='GET'&&!id){allow(user,editors);return user.role==='admin'?db.query('SELECT * FROM project_requests ORDER BY created_at'):db.query('SELECT * FROM project_requests WHERE requested_by=? ORDER BY created_at',[user.id])}
  if(method==='POST'&&!id){allow(user,editors);fields(body,['kind','project_id','project','reason']);if(!['create','delete'].includes(body.kind))fail(400,'Tipo de solicitud inválido.');const rid=randomUUID();let payload={},pid=null,pversion=null;
   if(body.kind==='create'){if(body.project_id!==undefined)fail(400,'No indiques proyecto existente.');payload=projectInput(body.project)}else{pid=text(body.project_id,'proyecto',100,true);const p=await liveProject(db,pid);pversion=p.version;if(body.project!==undefined)fail(400,'No se admite contenido de proyecto en una eliminación.');}
   try{await db.query('INSERT INTO project_requests (id,kind,project_id,payload,project_version,reason,requested_by,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[rid,body.kind,pid,JSON.stringify(payload),pversion,text(body.reason,'motivo',2000,true),user.id,'pending',Date.now()])}catch(e){if(isUniqueError(e))fail(409,'Ya existe una solicitud de eliminación pendiente.');throw e}await audit(db,user,'request.created','request',rid,{kind:body.kind,project_id:pid});return one(db,'SELECT * FROM project_requests WHERE id=?',[rid])}
  if(method==='POST'&&id&&['approve','reject'].includes(child)&&parts.length===3){allow(user,['admin']);fields(body,['note']);const request=await one(db,'SELECT * FROM project_requests WHERE id=?',[id]);
   const rows=await db.query("UPDATE project_requests SET status=?,reviewed_by=?,review_note=?,reviewed_at=? WHERE id=? AND status='pending' RETURNING id",[child==='approve'?'approved':'rejected',user.id,text(body.note??'','nota',2000),Date.now(),id]);if(!rows.length)fail(409,'La solicitud ya fue resuelta.');let project=null;
   if(child==='approve'){if(request.kind==='create')project=await insertProject(db,user,JSON.parse(request.payload));else{const archived=await db.query('UPDATE projects SET archived_at=?,version=version+1 WHERE id=? AND version=? AND archived_at IS NULL RETURNING id',[Date.now(),request.project_id,request.project_version]);if(!archived.length)fail(409,'El proyecto cambió desde la solicitud. Rechazá esta solicitud y pedí una nueva.');await audit(db,user,'project.archived','project',request.project_id,{request_id:id})}}
   await audit(db,user,'request.'+(child==='approve'?'approved':'rejected'),'request',id);return {request:await one(db,'SELECT * FROM project_requests WHERE id=?',[id]),project};
  }
 }
 if(resource==='audit'&&method==='GET'&&!id){allow(user,['admin']);return db.query('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 200')}
 fail(404,'Ruta no encontrada.');
}
async function taskInput(db,body,merged=false){if(!merged)fields(body,['name','description','status','priority','owner_id','due_date']);const status=body.status??'todo',priority=body.priority??'Media';if(!['todo','doing','done'].includes(status)||!['Alta','Media','Baja'].includes(priority))fail(400,'Estado o prioridad inválidos.');let owner=body.owner_id??null;if(owner!==null){text(owner,'responsable',100,true);await one(db,'SELECT id FROM users WHERE id=? AND active=1',[owner])}return {name:text(body.name,'nombre',160,true),description:text(body.description??'','descripción',5000),status,priority,owner_id:owner,due_date:day(body.due_date)}}
function approvedBudget(costs){
 return costs?.approvedBudget??(costs?.quotes.reduce((cents,quote)=>cents+(quote.approved?Math.round(quote.amount*100):0),0)??0)/100;
}
function validateRecord(kind,payload){
 if(kind==='costs'){
  fields(payload,['currency','quotes','expenses','suppliers','conclusion','approvedBudget']);if(!['PYG','USD','EUR','ARS','BRL'].includes(payload.currency))fail(400,'Moneda inválida.');text(payload.conclusion??'','conclusión',5000);
  const budget=payload.approvedBudget;
  if(budget!==undefined&&(!Number.isFinite(budget)||budget<0||budget>1e12||Math.abs(budget*100-Math.round(budget*100))>.01))fail(400,'Presupuesto aprobado inválido.');
  for(const key of ['quotes','expenses','suppliers'])if(!Array.isArray(payload[key])||payload[key].length>1000)fail(400,'Listado inválido.');
  const ids=new Set();for(const [key,rows] of [['quotes',payload.quotes],['expenses',payload.expenses],['suppliers',payload.suppliers]])for(const row of rows){const id=text(row.id,'id',100,true);if(ids.has(id))fail(400,'Identificador duplicado.');ids.add(id);
   if(key==='suppliers'){fields(row,['id','name','taxId','contact']);text(row.name,'proveedor',120,true);text(row.taxId??'','identificación',60);text(row.contact??'','contacto',160);continue}
   fields(row,key==='quotes'?['id','concept','supplier','amount','date','category','notes','approved']:['id','concept','supplier','amount','date','category','notes','status','invoice']);text(row.concept,'concepto',160,true);text(row.supplier??'','proveedor',120);day(row.date);text(row.notes??'','notas',2000);if(!Number.isFinite(row.amount)||row.amount<=0||row.amount>1e12||Math.abs(row.amount*100-Math.round(row.amount*100))>.01)fail(400,'Importe inválido.');if(!['Base','Adicional'].includes(row.category))fail(400,'Categoría inválida.');if(key==='expenses'){if(!['Pagado','Pendiente'].includes(row.status))fail(400,'Estado de pago inválido.');text(row.invoice??'','factura',80)}else if(typeof row.approved!=='boolean')fail(400,'Selección de cotización inválida.');
  }
  const approved=new Set();for(const row of payload.quotes.filter(q=>q.approved)){const k=row.category+'|'+row.concept.trim().toLowerCase();if(approved.has(k))fail(400,'Solo una cotización seleccionada por concepto y categoría.');approved.add(k)}
 }else{
  fields(payload,['start','unit','calendarDays','weeks','rows','incidents']);day(payload.start);if(!['days','weeks'].includes(payload.unit)||!Number.isInteger(payload.calendarDays)||payload.calendarDays<1||payload.calendarDays>3660||!Array.isArray(payload.rows)||payload.rows.length>500||!Array.isArray(payload.incidents)||payload.incidents.length>2000)fail(400,'Cronograma inválido.');
  const ids=new Set(), activityIds=new Set(), groupIds=new Set();
  for(const row of payload.rows){
   fields(row,['id','name','group','activeDays','active','status','groupId']);
   const id=text(row.id,'id',100,true);
   if(ids.has(id))fail(400,'Actividad duplicada.');
   ids.add(id);
   text(row.name,'actividad',200,true);
   if(typeof row.group!=='boolean'||!Array.isArray(row.activeDays)||row.activeDays.length>3660||row.activeDays.some(d=>!Number.isInteger(d)||d<1||d>payload.calendarDays)||new Set(row.activeDays).size!==row.activeDays.length)fail(400,'Días de actividad inválidos.');
   if(row.status!==undefined&&!['todo','doing','done','delayed'].includes(row.status))fail(400,'Estado de actividad inválido.');
   if(row.group)groupIds.add(id);
   else activityIds.add(id);
  }
  for(const row of payload.rows){
   if(row.groupId==null)continue;
   if(row.group||!groupIds.has(row.groupId))fail(400,'El rubro de la actividad no existe en este cronograma.');
  }
  const incidentIds=new Set();
  for(const event of payload.incidents){
   fields(event,['id','date','type','text','author','createdAt','activityId']);
   const id=text(event.id,'id',100,true);
   if(incidentIds.has(id))fail(400,'Incidencia duplicada.');
   incidentIds.add(id);
   day(event.date);
   if(!['rain','delay','incident','change','note'].includes(event.type))fail(400,'Incidencia inválida.');
   if(event.activityId!==undefined&&!activityIds.has(event.activityId))fail(400,'La actividad de la incidencia no existe en este cronograma.');
   text(event.text,'detalle',3000,true);
   text(event.author,'autor',120,true);
  }
 }
}
