import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(['.git','node_modules'].includes(item.name))continue;const file=path.join(dir,item.name);if(item.isDirectory()){walk(file);continue}if(/\.(sqlite\w*|db|pem|key|log|pdf)$/i.test(file)||['test-accounts.json','Cuentas-de-prueba.md'].includes(item.name)||item.name.startsWith('.env'))throw Error('Archivo excluido: '+file);const content=fs.readFileSync(file,'utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(content))throw Error('Posible secreto: '+file);if(/\.(mjs|js|cjs)$/.test(file))execFileSync(process.execPath,['--check',file],{stdio:'pipe'})}}
walk(root);if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).private!==true)throw Error('El paquete debe ser privado.');console.log('Sintaxis, exclusiones y revisión preventiva: OK.');
