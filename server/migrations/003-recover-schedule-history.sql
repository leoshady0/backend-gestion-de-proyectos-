-- Assign versions only where the audit trail accounts for every prior save.
WITH audited AS (
 SELECT r.project_id, r.version AS current_version, u.name AS author_name,
        a.created_at AS saved_at,
        ROW_NUMBER() OVER (PARTITION BY r.project_id ORDER BY a.created_at, a.id) AS version,
        COUNT(*) OVER (PARTITION BY r.project_id) AS save_count
 FROM project_records r
 JOIN audit_events a ON a.entity_id = r.project_id
 JOIN users u ON u.id = a.actor_id
 WHERE r.kind = 'schedule' AND a.entity_type = 'schedule' AND a.action = 'record.updated'
)
INSERT INTO schedule_saves (project_id, version, author_name, saved_at)
SELECT a.project_id, a.version, a.author_name, a.saved_at
FROM audited a
WHERE a.save_count = a.current_version
  AND NOT EXISTS (
   SELECT 1 FROM schedule_saves s WHERE s.project_id = a.project_id AND s.version = a.version
  );
