CREATE TABLE expense_attachments (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 expense_id TEXT NOT NULL,
 name TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('Comparativo','Factura','Otro')),
 media_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 content BYTEA NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at BIGINT NOT NULL
);
CREATE INDEX expense_attachments_project ON expense_attachments(project_id, expense_id);
