ALTER TABLE projects ADD COLUMN IF NOT EXISTS priority_override_reason text;

ALTER TABLE status_reports ALTER COLUMN report_state SET DEFAULT 'final';
UPDATE status_reports SET report_state='final', finalized_at=COALESCE(finalized_at,created_at)
WHERE report_state='draft';

UPDATE portfolio_settings SET stale_after_days=7 WHERE id=1;

INSERT INTO schema_migrations(version) VALUES (13) ON CONFLICT (version) DO NOTHING;
