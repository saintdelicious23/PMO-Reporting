DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='phases_id_project_unique') THEN
    ALTER TABLE phases ADD CONSTRAINT phases_id_project_unique UNIQUE(id,project_id);
  END IF;
END $$;

ALTER TABLE deliverables DROP CONSTRAINT IF EXISTS deliverables_phase_id_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='deliverables_phase_project_fkey') THEN
    ALTER TABLE deliverables ADD CONSTRAINT deliverables_phase_project_fkey
      FOREIGN KEY(phase_id,project_id) REFERENCES phases(id,project_id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE projects DROP COLUMN IF EXISTS lead_department;

INSERT INTO schema_migrations(version) VALUES (11) ON CONFLICT (version) DO NOTHING;
