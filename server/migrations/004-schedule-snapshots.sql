ALTER TABLE schedule_saves ADD COLUMN payload TEXT;

-- Older saves retained metadata only. The current schedule can be recovered in full.
UPDATE schedule_saves
SET payload = (
 SELECT r.payload FROM project_records r
 WHERE r.project_id = schedule_saves.project_id
   AND r.kind = 'schedule'
   AND r.version = schedule_saves.version
)
WHERE EXISTS (
 SELECT 1 FROM project_records r
 WHERE r.project_id = schedule_saves.project_id
   AND r.kind = 'schedule'
   AND r.version = schedule_saves.version
);
