import {readFile,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
const migrationsURL=new URL('./migrations/',import.meta.url);
async function migrations(){const names=(await readdir(migrationsURL)).filter(n=>/^\d{3}-[a-z-]+\.sql$/.test(n)).sort();return Promise.all(names.map(async name=>({name,sql:await readFile(new URL(name,migrationsURL),'utf8')})))}
export async function openDatabase({filename=':memory:',databaseURL}={}){
 const steps=await migrations();
 if(databaseURL){
  // Driver is loaded only when IT provides an approved PostgreSQL instance.
  let pg;try{pg=await import('pg')}catch{throw Error('PostgreSQL requiere instalar el paquete pg antes de usar DATABASE_URL.');}
  const pool=new pg.default.Pool({connectionString:databaseURL,max:5});
  // Parameters are positional. SQL templates in this module's callers contain no literal question marks.
  const query=async(client,sql,args=[])=>{let index=0;return (await client.query(sql.replace(/\?/g,()=>'$'+(++index)),args)).rows};
  const migrationClient=await pool.connect();let migrationFailed=false;try{
   await migrationClient.query('BEGIN');await migrationClient.query('SELECT pg_advisory_xact_lock(180491)');
   await migrationClient.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)');
   const applied=new Set((await migrationClient.query('SELECT version FROM schema_migrations')).rows.map(r=>r.version));
   for(const step of steps)if(!applied.has(step.name)){await migrationClient.query(step.sql);await migrationClient.query('INSERT INTO schema_migrations (version,applied_at) VALUES ($1,$2)',[step.name,Date.now()])}
   await migrationClient.query('COMMIT');
  }catch(error){migrationFailed=true;await migrationClient.query('ROLLBACK');throw error}finally{migrationClient.release();if(migrationFailed)await pool.end()}
  return {query:(sql,args)=>query(pool,sql,args),transaction:async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn({dialect:'postgresql',query:(sql,args)=>query(client,sql,args)});await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}},close:()=>pool.end(),dialect:'postgresql'};
 }
 const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 sqlite.exec('BEGIN IMMEDIATE');try{sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)');const applied=new Set(sqlite.prepare('SELECT version FROM schema_migrations').all().map(r=>r.version));for(const step of steps)if(!applied.has(step.name)){sqlite.exec(step.sql);sqlite.prepare('INSERT INTO schema_migrations (version,applied_at) VALUES (?,?)').run(step.name,Date.now())}sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');sqlite.close();throw error}
 let queue=Promise.resolve();const exclusive=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result};
 const direct={dialect:'sqlite',query:async(sql,args=[])=>sqlite.prepare(sql).all(...args)};
 return {query:(sql,args)=>exclusive(()=>direct.query(sql,args)),transaction:fn=>exclusive(async()=>{sqlite.exec('BEGIN IMMEDIATE');try{const result=await fn(direct);sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}),close:()=>exclusive(()=>sqlite.close()),dialect:'sqlite'};
}
