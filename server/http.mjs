import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ApiError,fail,fields,email,passwordVerify,passwordHash,digest,token,publicUser} from './security.mjs';
import {service,audit} from './service.mjs';
const lifetime=8*60*60*1000;
const maxAttachmentBytes=10*1024*1024;
async function readBody(req,limit,message){
 if(Number(req.headers['content-length'])>limit)fail(413,message);
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>limit)fail(413,message);chunks.push(chunk)}
 return Buffer.concat(chunks);
}
function attachmentHeader(req,key){
 try{return decodeURIComponent(req.headers[key]||'')}catch{fail(400,'Datos del adjunto inválidos.')}
}
export async function createApi({db,port=8091,staticRoot}){
 // Local development only. Production exposure waits for IT's identity, TLS and hosting decisions.
 const dummyHash=await passwordHash(token());const attempts=new Map();
 const limit=key=>{const now=Date.now();for(const [k,v]of attempts)if(v.until<=now)attempts.delete(k);const item=attempts.get(key)||{count:0,until:now+15*60*1000};item.count++;attempts.set(key,item);if(item.count>10)fail(429,'Demasiados intentos. Intentá nuevamente en 15 minutos.');};
 const server=http.createServer(async(req,res)=>{
  const requestId=randomUUID();res.setHeader('X-Request-ID',requestId);res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");res.setHeader('Referrer-Policy','no-referrer');
  const send=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value))};
  try{
   const origin='http://127.0.0.1:'+server.address().port;
   if(req.headers.host!==new URL(origin).host)fail(400,'Host no permitido.');
   if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')fail(403,'Origen no permitido.');
   const url=new URL(req.url,origin);if(url.search)fail(400,'Esta API no acepta parámetros de consulta.');
   let route;try{route=decodeURIComponent(url.pathname).replace(/\/$/,'')||'/'}catch{fail(400,'Ruta inválida.');}
   const assets={'/':'connected.html','/mobile-preview':'connected-mobile-preview.html','/mobile-app':'connected.html','/connected.js':'connected.js','/connected.css':'connected.css','/style.css':'style.css','/mobile.css':'mobile.css','/forja-icon.svg':'forja-icon.svg','/project-close-report.js':'project-close-report.js','/costs-report.js':'costs-report.js','/schedule-model.js':'schedule-model.js','/schedule-pdf.js':'schedule-pdf.js'};
   if(staticRoot&&Object.hasOwn(assets,route)){
    if(!['GET','HEAD'].includes(req.method))fail(405,'Método no permitido.');
    const file=assets[route],bytes=await readFile(path.join(staticRoot,file));
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
    res.setHeader('Content-Type',types[path.extname(file)]);res.setHeader('Content-Length',bytes.length);
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    // Only this alias may appear inside the same-origin phone preview; the main app and API remain unframeable.
    if(route==='/mobile-app')res.setHeader('Content-Security-Policy',res.getHeader('Content-Security-Policy').replace("frame-ancestors 'none'","frame-ancestors 'self'"));
    res.writeHead(200);res.end(req.method==='HEAD'?undefined:bytes);return;
   }
   if(!/^\/(health|api(?:\/[a-zA-Z0-9_-]+)*)$/.test(route))fail(404,'Ruta no encontrada.');
   if(route==='/health'&&req.method==='GET'){send(200,{status:'ok'});return}
   if(!['GET','POST','PATCH','PUT','DELETE'].includes(req.method))fail(405,'Método no permitido.');
   const attachmentRoute=/^\/api\/projects\/[a-zA-Z0-9_-]+\/costs\/attachments$/;
   const upload=req.method==='POST'&&attachmentRoute.test(route);
   let body={};if(req.method!=='GET'&&!upload){
    if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']||''))fail(415,'Usa application/json.');
    const bytes=await readBody(req,262144,'Solicitud demasiado grande.');
    try{body=JSON.parse(bytes.toString('utf8'))}catch{fail(400,'JSON inválido.');}if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Se requiere un objeto JSON.');
   }
   if(route==='/api/login'&&req.method==='POST'){
    limit('ip:'+req.socket.remoteAddress);fields(body,['email','password']);const address=email(body.email);limit('account:'+digest(address));if(typeof body.password!=='string'||body.password.length>128)fail(401,'Correo o contraseña incorrectos.');
    const user=(await db.query('SELECT * FROM users WHERE email=?',[address]))[0];const valid=await passwordVerify(body.password,user?.password_hash||dummyHash);if(!user||!user.active||!valid)fail(401,'Correo o contraseña incorrectos.');
    const raw=token(),csrf=digest('csrf:'+raw),expires=Date.now()+lifetime;
    await db.transaction(async tx=>{const live=(await tx.query('SELECT active,password_hash FROM users WHERE id=?',[user.id]))[0];if(!live?.active||live.password_hash!==user.password_hash)fail(401,'Correo o contraseña incorrectos.');await tx.query('DELETE FROM sessions WHERE expires_at<=?',[Date.now()]);await tx.query('INSERT INTO sessions (token_hash,user_id,csrf_hash,expires_at) VALUES (?,?,?,?)',[digest(raw),user.id,digest(csrf),expires]);await audit(tx,user,'session.created','user',user.id)});
    res.setHeader('Set-Cookie',`sid=${raw}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${lifetime/1000}`);send(200,{user:publicUser(user),csrf_token:csrf,expires_at:expires});return;
   }
   const match=(req.headers.cookie||'').split(';').map(c=>c.trim()).filter(c=>c.startsWith('sid='));const raw=match.length===1?match[0].slice(4):'';if(!/^[A-Za-z0-9_-]{43}$/.test(raw))fail(401,'Iniciá sesión.');
   if(upload){
    if(req.headers['content-type']!=='application/octet-stream')fail(415,'Formato de carga inválido.');
    const session=(await db.query('SELECT u.role,s.csrf_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',[digest(raw),Date.now()]))[0];
    if(!session)fail(401,'Sesión vencida o revocada.');
    if(!['admin','responsable'].includes(session.role)||typeof req.headers['x-csrf-token']!=='string'||digest(req.headers['x-csrf-token'])!==session.csrf_hash)fail(403,'No tenés permiso para subir el archivo.');
    body={name:attachmentHeader(req,'x-file-name'),expenseId:attachmentHeader(req,'x-expense-id'),category:req.headers['x-file-category'],content:await readBody(req,maxAttachmentBytes,'El archivo supera el límite de 10 MB.')};
   }
   const result=await db.transaction(async tx=>{
    const row=(await tx.query('SELECT u.*,s.csrf_hash,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',[digest(raw),Date.now()]))[0];if(!row)fail(401,'Sesión vencida o revocada.');
    if(req.method!=='GET'&&(typeof req.headers['x-csrf-token']!=='string'||digest(req.headers['x-csrf-token'])!==row.csrf_hash))fail(403,'Token CSRF inválido.');
    if(route==='/api/me'&&req.method==='GET')return {user:publicUser(row),csrf_token:digest('csrf:'+raw),expires_at:row.expires_at};
    if(route==='/api/logout'&&req.method==='POST'){fields(body,[]);await tx.query('DELETE FROM sessions WHERE token_hash=?',[digest(raw)]);await audit(tx,row,'session.revoked','user',row.id);return {signed_out:true}}
    return service(tx,row,req.method,route,body);
   });
   if(req.method==='GET'&&attachmentRoute.test(route.slice(0,route.lastIndexOf('/')))){
    const {name,media_type,content}=result;
    const encoded=encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
    res.setHeader('Content-Type',media_type);
    res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encoded);
    res.setHeader('Content-Length',content.length);
    res.writeHead(200);res.end(content);return;
   }
   if(route==='/api/logout')res.setHeader('Set-Cookie','sid=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');send(200,result);
  }catch(error){if(error instanceof ApiError){if(error.status===429)res.setHeader('Retry-After','900');send(error.status,{error:error.message,request_id:requestId})}else{console.error('API request failed',requestId,error.code||error.name);send(500,{error:'Error interno. No se guardaron los cambios de esta operación.',request_id:requestId})}}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.maxHeadersCount=40;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 return {server,url:'http://127.0.0.1:'+server.address().port,close:async()=>{server.closeIdleConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}};
}
