ALTER TABLE projects ADD COLUMN IF NOT EXISTS lifecycle_before_block text
  CHECK (lifecycle_before_block IN ('planning','active','on_hold','completed','cancelled'));

INSERT INTO schema_migrations(version) VALUES (15) ON CONFLICT (version) DO NOTHING;
