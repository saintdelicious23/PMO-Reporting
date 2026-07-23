UPDATE status_reports SET blocker_state='none' WHERE blocker_state='undefined';
ALTER TABLE status_reports DROP CONSTRAINT IF EXISTS status_reports_blocker_state_check;
ALTER TABLE status_reports ALTER COLUMN blocker_state SET DEFAULT 'none';
ALTER TABLE status_reports ADD CONSTRAINT status_reports_blocker_state_check
  CHECK (blocker_state IN ('none','blocked'));

DROP TABLE IF EXISTS decision_gates;
DROP TABLE IF EXISTS milestones;
DROP TABLE IF EXISTS deliverables;
DROP TABLE IF EXISTS phases;

ALTER TABLE status_reports
  DROP COLUMN IF EXISTS period_type,
  DROP COLUMN IF EXISTS report_kind,
  DROP COLUMN IF EXISTS report_state,
  DROP COLUMN IF EXISTS period_start,
  DROP COLUMN IF EXISTS period_end,
  DROP COLUMN IF EXISTS finalized_at;

INSERT INTO schema_migrations(version) VALUES (16) ON CONFLICT (version) DO NOTHING;
