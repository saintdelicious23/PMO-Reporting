DROP INDEX IF EXISTS status_reports_period_version_unique;

WITH versions AS (
  SELECT id,row_number() OVER(PARTITION BY project_id ORDER BY created_at,id)::integer AS version_number
  FROM status_reports
)
UPDATE status_reports s SET version_number=v.version_number
FROM versions v
WHERE s.id=v.id;

CREATE UNIQUE INDEX IF NOT EXISTS status_reports_project_version_unique
  ON status_reports(project_id,version_number);

INSERT INTO schema_migrations(version) VALUES (14) ON CONFLICT (version) DO NOTHING;
