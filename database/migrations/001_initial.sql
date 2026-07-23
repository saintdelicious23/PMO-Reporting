CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS project_number_seq START 1;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  project_number integer NOT NULL DEFAULT nextval('project_number_seq') UNIQUE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('strategic','mandatory','operational_improvement')),
  lead_department text,
  owner text NOT NULL,
  sponsor text,
  coordinator text,
  delivery_lead text,
  lifecycle_status text NOT NULL DEFAULT 'planning' CHECK (lifecycle_status IN ('planning','active','on_hold','blocked','completed','cancelled')),
  description text,
  objective text,
  outcome text,
  baseline_finish date,
  forecast_finish date,
  mandatory_deadline date,
  value_score smallint NOT NULL DEFAULT 0 CHECK (value_score BETWEEN 0 AND 4),
  urgency_score smallint NOT NULL DEFAULT 0 CHECK (urgency_score BETWEEN 0 AND 5),
  consequence_score smallint NOT NULL DEFAULT 0 CHECK (consequence_score BETWEEN 0 AND 4),
  final_priority text NOT NULL DEFAULT 'low' CHECK (final_priority IN ('low','medium','high','very_high','critical')),
  management_attention boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS status_reports (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_type text NOT NULL DEFAULT 'weekly' CHECK (period_type IN ('weekly','monthly','quarterly','semiannual','annual')),
  report_kind text NOT NULL DEFAULT 'regular' CHECK (report_kind IN ('regular','extraordinary')),
  report_state text NOT NULL DEFAULT 'draft' CHECK (report_state IN ('draft','final')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  health text NOT NULL CHECK (health IN ('green','amber','red','critical')),
  trend text NOT NULL DEFAULT 'stable' CHECK (trend IN ('improving','stable','declining')),
  progress numeric(5,2) CHECK (progress BETWEEN 0 AND 100),
  forecast_finish date,
  next_milestone text,
  next_milestone_date date,
  blocker_state text NOT NULL DEFAULT 'undefined' CHECK (blocker_state IN ('undefined','none','blocked')),
  top_blocker text,
  decision_required boolean NOT NULL DEFAULT false,
  decision_text text,
  decision_due_date date,
  management_attention boolean NOT NULL DEFAULT false,
  summary text,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS status_reports_project_date_idx ON status_reports(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS phases (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','on_hold','cancelled')),
  owner text,
  planned_start date,
  planned_finish date,
  actual_start date,
  actual_finish date,
  progress_override numeric(5,2) CHECK (progress_override BETWEEN 0 AND 100),
  weight numeric(8,3) CHECK (weight > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliverables (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id uuid REFERENCES phases(id) ON DELETE SET NULL,
  name text NOT NULL,
  owner text,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','on_hold','cancelled')),
  planned_finish date,
  actual_finish date,
  acceptance_criteria text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS milestones (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id uuid REFERENCES phases(id) ON DELETE SET NULL,
  name text NOT NULL,
  planned_date date,
  forecast_date date,
  actual_date date,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','achieved','missed','cancelled','obsolete')),
  owner text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_gates (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id uuid REFERENCES phases(id) ON DELETE SET NULL,
  name text NOT NULL,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','go','conditional_go','no_go')),
  decision_date date,
  decision_owner text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  changed_fields jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT (version) DO NOTHING;
