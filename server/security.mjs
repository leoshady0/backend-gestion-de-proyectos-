import {randomBytes,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);export const roles=['admin','responsable','consulta'];
export class ApiError extends Error{constructor(status,message){super(message);this.status=status}}
export const fail=(status,message)=>{throw new ApiError(status,message)};
export const token=()=>randomBytes(32).toString('base64url');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export async function passwordHash(password){validatePassword(password);const salt=randomBytes(16).toString('hex');const hash=await derive(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024});return 'scrypt$'+salt+'$'+hash.toString('hex')}
export async function passwordVerify(password,stored){const [,salt,expected]=stored.split('$');const result=await derive(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024});const bytes=Buffer.from(expected,'hex');return bytes.length===result.length&&timingSafeEqual(bytes,result)}
export function validatePassword(p){if(typeof p!=='string'||p.length<14||p.length>128)fail(400,'Usa una contraseña de 14 a 128 caracteres.');}
export function text(value,name,max=1000,required=false){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)||required&&!value.trim())fail(400,'Campo inválido: '+name);return value.trim()}
export function email(value){const v=text(value,'email',254,true).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))fail(400,'Correo inválido.');return v}
export function fields(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail(400,'Hay campos no permitidos.');return value}
export function version(value){if(!Number.isInteger(value)||value<1)fail(400,'La versión es obligatoria.');return value}
export function day(value=''){const v=text(value,'fecha',10);if(v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v))fail(400,'Fecha inválida.');return v}
export function allow(user,permitted){if(!permitted.includes(user.role))fail(403,'No tenés permiso para esta operación.');}
export const publicUser=u=>({id:u.id,email:u.email,name:u.name,role:u.role,active:!!u.active,version:u.version});
export const isUniqueError=e=>e.code==='23505'||/UNIQUE constraint failed/.test(e.message);
