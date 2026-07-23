ALTER TABLE portfolio_settings DROP COLUMN IF EXISTS stale_after_days;

INSERT INTO schema_migrations(version) VALUES (17) ON CONFLICT (version) DO NOTHING;
