CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_display_name_unique ON app_users(lower(display_name));

INSERT INTO app_users(id,display_name)
VALUES('00000000-0000-4000-8000-000000000001','Lokalni korisnik')
ON CONFLICT DO NOTHING;

ALTER TABLE portfolio_settings
  ADD COLUMN IF NOT EXISTS active_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL;
UPDATE portfolio_settings SET active_user_id='00000000-0000-4000-8000-000000000001'
WHERE active_user_id IS NULL;

ALTER TABLE status_reports ADD COLUMN IF NOT EXISTS version_number integer;
WITH versions AS (
  SELECT id,row_number() OVER(PARTITION BY project_id,period_start,period_end ORDER BY created_at,id)::integer AS version_number
  FROM status_reports
)
UPDATE status_reports s SET version_number=v.version_number FROM versions v
WHERE s.id=v.id AND s.version_number IS NULL;
ALTER TABLE status_reports ALTER COLUMN version_number SET NOT NULL;
ALTER TABLE status_reports ALTER COLUMN version_number SET DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS status_reports_period_version_unique
  ON status_reports(project_id,period_start,period_end,version_number);

INSERT INTO schema_migrations(version) VALUES (12) ON CONFLICT (version) DO NOTHING;
