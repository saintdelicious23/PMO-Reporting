CREATE TABLE IF NOT EXISTS portfolio_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  title text NOT NULL,
  tagline text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO portfolio_settings (id, title, tagline)
VALUES (
  1,
  'Projekti koji moraju ostati u jasnom fokusu.',
  'Strateški projekti, regulatorne obaveze i operativna unapređenja — razdvojeno, ali upravljano iz jednog pregleda.'
)
ON CONFLICT (id) DO NOTHING;
