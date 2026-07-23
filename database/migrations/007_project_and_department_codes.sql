ALTER TABLE departments ADD COLUMN IF NOT EXISTS code text;

WITH ranked AS (
  SELECT id, 'SEK-' || lpad(row_number() OVER (ORDER BY position, lower(name))::text, 2, '0') AS generated_code
  FROM departments
)
UPDATE departments d SET code = ranked.generated_code FROM ranked
WHERE d.id = ranked.id AND d.code IS NULL;

ALTER TABLE departments ALTER COLUMN code SET NOT NULL;
ALTER TABLE departments ALTER COLUMN code SET DEFAULT ('SEK-' || upper(substr(md5(random()::text), 1, 8)));
CREATE UNIQUE INDEX IF NOT EXISTS departments_code_ci_unique ON departments (lower(code));

ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_code text;
UPDATE projects SET project_code = 'PRJ-' || lpad(project_number::text, 4, '0') WHERE project_code IS NULL;
ALTER TABLE projects ALTER COLUMN project_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS projects_project_code_ci_unique ON projects (lower(project_code));

INSERT INTO schema_migrations(version) VALUES (7) ON CONFLICT (version) DO NOTHING;
