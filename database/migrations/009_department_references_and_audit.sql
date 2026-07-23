ALTER TABLE projects ADD COLUMN IF NOT EXISTS lead_department_id uuid REFERENCES departments(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='projects' AND column_name='lead_department'
  ) THEN
    EXECUTE $migration$
      UPDATE projects p
      SET lead_department_id = d.id
      FROM departments d
      WHERE p.lead_department_id IS NULL
        AND lower(p.lead_department) = lower(d.name)
    $migration$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS projects_lead_department_id_idx ON projects(lead_department_id);

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS actor_name text NOT NULL DEFAULT 'Lokalni korisnik',
  ADD COLUMN IF NOT EXISTS summary text;

CREATE INDEX IF NOT EXISTS audit_events_entity_date_idx
  ON audit_events(entity_type, entity_id, occurred_at DESC);

INSERT INTO schema_migrations(version) VALUES (9) ON CONFLICT (version) DO NOTHING;
