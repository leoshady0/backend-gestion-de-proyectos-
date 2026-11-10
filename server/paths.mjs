import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {access} from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
export const stateDirectory=kind=>path.join(path.resolve(process.env.BACKEND_STATE_DIR||path.join(root,'../.gestion-proyectos-local')),kind);
export async function frontendDirectory(required=false){
 const directory=path.resolve(process.env.FRONTEND_DIR||path.join(root,'../frontend/dist'));
 try{await access(path.join(directory,'connected.html'));return directory}catch{if(required||process.env.FRONTEND_DIR)throw Error('No se encontró el frontend. Definí FRONTEND_DIR con la ruta absoluta a frontend/dist.');return undefined}
}
