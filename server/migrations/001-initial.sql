-- Portable initial schema: SQLite development / PostgreSQL staging.
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','responsable','consulta')),
 password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 csrf_hash TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL REFERENCES users(id), created_at BIGINT NOT NULL, archived_at BIGINT,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('todo','doing','done')),
 priority TEXT NOT NULL CHECK(priority IN ('Alta','Media','Baja')), owner_id TEXT REFERENCES users(id),
 due_date TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, deleted_at BIGINT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
CREATE TABLE IF NOT EXISTS project_requests (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('create','delete')), project_id TEXT REFERENCES projects(id),
 payload TEXT NOT NULL, project_version INTEGER, reason TEXT NOT NULL,
 requested_by TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 reviewed_by TEXT REFERENCES users(id), review_note TEXT, created_at BIGINT NOT NULL, reviewed_at BIGINT,
 CHECK((kind='create' AND project_id IS NULL) OR (kind='delete' AND project_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_deletion ON project_requests(project_id) WHERE kind='delete' AND status='pending';
CREATE TABLE IF NOT EXISTS project_records (
 project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL CHECK(kind IN ('schedule','costs')),
 payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL REFERENCES users(id), updated_at BIGINT NOT NULL,
 PRIMARY KEY(project_id,kind)
);
CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, details TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_time ON audit_events(created_at);
