ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

ALTER TABLE portfolio_settings
  ADD COLUMN IF NOT EXISTS header_graphic text,
  ADD COLUMN IF NOT EXISTS view_columns jsonb NOT NULL DEFAULT '{"detailed":["name","health","trend","owner","deliveryLead","department","finalPriority","progress","forecastFinish","nextMilestoneDate","blocker"],"engaged":["name","health","trend","owner","deliveryLead","finalPriority","progress","forecastFinish","nextMilestoneDate","blocker"],"executive":["name","health","owner","deliveryLead","finalPriority","progress","forecastFinish","blocker"],"goldfish":["name","health","owner","deliveryLead","blocker"]}'::jsonb;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

WITH first_application AS (
  INSERT INTO schema_migrations (version)
  VALUES (6)
  ON CONFLICT (version) DO NOTHING
  RETURNING version
)
UPDATE projects
SET is_demo = true
WHERE EXISTS (SELECT 1 FROM first_application);

UPDATE portfolio_settings
SET title = 'Portfolio projekata',
    tagline = 'Upravljačko izveštavanje'
WHERE title = 'Projekti koji moraju ostati u jasnom fokusu.';
