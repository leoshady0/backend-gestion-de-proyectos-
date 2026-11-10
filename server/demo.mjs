import {stateDirectory,frontendDirectory} from './paths.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {bootstrapAdmin,service} from './service.mjs';
import {createApi} from './http.mjs';
export async function prepareDemo(directory){
 await mkdir(directory,{recursive:true});const db=await openDatabase({filename:path.join(directory,'demo.sqlite')});
 const credentialFile=path.join(directory,'test-accounts.json');
 try{
  if(!(await db.query('SELECT id FROM users LIMIT 1')).length){
   const accounts=[['admin','admin@example.test','Administrador de prueba'],['responsable','responsable@example.test','Responsable de prueba'],['consulta','gerencia@example.test','Gerencia de prueba']].map(([role,email,name])=>({role,email,name,password:randomBytes(18).toString('base64url')}));
   // Fictitious local demo accounts only; never exposed by HTTP or stored in the repository.
   await writeFile(credentialFile,JSON.stringify(accounts,null,2),{mode:0o600,flag:'wx'});
   const admin=await bootstrapAdmin(db,accounts[0]);
   await db.transaction(async tx=>{
    const manager=await service(tx,admin,'POST','/api/users',accounts[1]),reader=await service(tx,admin,'POST','/api/users',accounts[2]);
    const create=body=>service(tx,admin,'POST','/api/projects',body),task=(p,body)=>service(tx,admin,'POST',`/api/projects/${p.id}/tasks`,body);
    const p1=await create({name:'Renovación de oficinas',description:'Proyecto ficticio para probar tareas, responsables y costos.',due_date:'2026-12-15'});
    for(const [name,status,priority] of [['Relevar las necesidades','done','Alta'],['Preparar la propuesta','doing','Alta'],['Coordinar proveedores','todo','Media'],['Verificar la entrega','todo','Baja']])await task(p1,{name,status,priority,owner_id:manager.id,due_date:'2026-12-10'});
    await service(tx,admin,'PUT',`/api/projects/${p1.id}/costs`,{version:0,payload:{currency:'PYG',quotes:[{id:'quote-demo',concept:'Materiales de prueba',supplier:'Proveedor ficticio',amount:1500000,date:'2026-11-10',category:'Base',notes:'Datos ficticios',approved:true}],expenses:[{id:'expense-demo',concept:'Compra de prueba',supplier:'Proveedor ficticio',amount:450000,date:'2026-11-10',category:'Base',status:'Pendiente',invoice:'PRUEBA-001',notes:'Sin comprobante real'}],suppliers:[],conclusion:'Ejemplo para revisar el resumen económico.'}});
    await service(tx,admin,'PUT',`/api/projects/${p1.id}/schedule`,{version:0,payload:{start:'2026-11-10',unit:'days',calendarDays:30,weeks:5,rows:[{id:'activity-demo',name:'Preparación de oficinas',group:false,activeDays:[1,2,3,4,5]}],incidents:[]}});
    const p2=await create({name:'Plan de mantenimiento',description:'Ejemplo para consultar el avance desde dos dispositivos.',due_date:'2026-12-01'});
    await task(p2,{name:'Revisar instalaciones',status:'doing',owner_id:manager.id});await task(p2,{name:'Preparar el informe',status:'todo',owner_id:manager.id});
    const p3=await create({name:'Entrega de equipamiento',description:'Ejemplo terminado para descargar el informe de cierre.',due_date:'2026-11-10'});await task(p3,{name:'Verificar entrega',status:'done',owner_id:manager.id});
    await service(tx,manager,'POST','/api/requests',{kind:'create',project:{name:'Nueva sala de reuniones',description:'Proyecto ficticio pendiente de autorización.'},reason:'Solicitud de ejemplo para probar la aprobación.'});
    void reader;
   });
  }
  const accounts=JSON.parse(await readFile(credentialFile,'utf8'));return {db,accounts};
 }catch(error){await db.close();throw error}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.env.NODE_ENV==='production'||process.env.DATABASE_URL)throw Error('La demostración solo puede usar su base local separada, sin DATABASE_URL.');
 const directory=stateDirectory('demo');const {db,accounts}=await prepareDemo(directory);
 const accessFile=path.join(directory,'Cuentas-de-prueba.md');
 await writeFile(accessFile,'# Accesos locales de prueba\n\nAplicación: http://127.0.0.1:8092/\n\nSolo datos ficticios. Estas claves son exclusivas de la demostración local; no reutilizarlas en producción.\n\n'+accounts.map(a=>'## '+a.name+'\n\nCorreo: `'+a.email+'`\n\nContraseña: `'+a.password+'`\n').join('\n')+'\nCerrá sesión antes de entrar con otro perfil. Las pestañas del mismo navegador comparten sesión.\n',{mode:0o600});
 const port=Number(process.env.DEMO_PORT||8092);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Puerto inválido.');
 const api=await createApi({db,port,staticRoot:await frontendDirectory(true)});
 console.log('Aplicación conectada de prueba:',api.url,'| Credenciales locales:',accessFile);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await api.close();await db.close();process.exit(0)});
}
