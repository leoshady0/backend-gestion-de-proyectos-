import {stateDirectory,frontendDirectory} from './paths.mjs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from './database.mjs';
import {bootstrapAdmin} from './service.mjs';
const localDir=stateDirectory('development');await mkdir(localDir,{recursive:true});
const password=process.env.BOOTSTRAP_PASSWORD;delete process.env.BOOTSTRAP_PASSWORD;
const db=await openDatabase({filename:path.join(localDir,'development.sqlite'),databaseURL:process.env.DATABASE_URL});
try{const admin=await bootstrapAdmin(db,{email:process.env.BOOTSTRAP_EMAIL,name:process.env.BOOTSTRAP_NAME,password});console.log('Administrador inicial creado:',admin.id)}finally{await db.close()}
