CREATE TABLE schedule_saves (
 project_id TEXT NOT NULL REFERENCES projects(id),
 version INTEGER NOT NULL CHECK (version > 0),
 author_name TEXT NOT NULL,
 saved_at BIGINT NOT NULL,
 PRIMARY KEY (project_id, version)
);

INSERT INTO schedule_saves (project_id, version, author_name, saved_at)
SELECT r.project_id, r.version, u.name, r.updated_at
FROM project_records r JOIN users u ON u.id = r.updated_by
WHERE r.kind = 'schedule';
