ALTER TABLE portfolio_settings
  ADD COLUMN IF NOT EXISTS custom_views jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO schema_migrations(version) VALUES (8) ON CONFLICT (version) DO NOTHING;
