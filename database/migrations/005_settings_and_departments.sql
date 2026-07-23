ALTER TABLE portfolio_settings
  ADD COLUMN IF NOT EXISTS default_view text NOT NULL DEFAULT 'detailed',
  ADD COLUMN IF NOT EXISTS default_group text NOT NULL DEFAULT 'category',
  ADD COLUMN IF NOT EXISTS default_sort_key text NOT NULL DEFAULT 'name',
  ADD COLUMN IF NOT EXISTS default_sort_direction text NOT NULL DEFAULT 'asc',
  ADD COLUMN IF NOT EXISTS pdf_view text NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS pdf_group text NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS pdf_include_inactive boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stale_after_days integer NOT NULL DEFAULT 7;

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS departments_name_unique_idx ON departments (lower(name));
CREATE INDEX IF NOT EXISTS departments_position_idx ON departments (position, lower(name));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='projects' AND column_name='lead_department'
  ) THEN
    EXECUTE $migration$
      INSERT INTO departments (id, name, position)
      SELECT md5('reporting-department:' || lead_department)::uuid,
             lead_department,
             row_number() OVER (ORDER BY lower(lead_department))::integer
      FROM (
        SELECT DISTINCT lead_department
        FROM projects
        WHERE lead_department IS NOT NULL
          AND btrim(lead_department) <> ''
          AND lead_department <> 'Izbrisano'
      ) existing
      ON CONFLICT DO NOTHING
    $migration$;
  END IF;
END $$;
