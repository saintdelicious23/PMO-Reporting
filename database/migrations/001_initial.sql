CREATE SEQUENCE project_number_seq START 1;

CREATE TABLE app_users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  username text,
  password_hash text,
  is_admin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_users_display_name_unique ON app_users(lower(display_name));
CREATE UNIQUE INDEX app_users_username_unique ON app_users(lower(username)) WHERE username IS NOT NULL;

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_sessions_user_idx ON user_sessions(user_id);
CREATE INDEX user_sessions_expiry_idx ON user_sessions(expires_at);

CREATE TABLE departments (
  id uuid PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX departments_code_ci_unique ON departments(lower(code));
CREATE UNIQUE INDEX departments_name_ci_unique ON departments(lower(name));
CREATE INDEX departments_position_idx ON departments(position, lower(name));

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  project_number integer NOT NULL UNIQUE,
  project_code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('strategic','mandatory','operational_improvement')),
  lead_department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  lifecycle_status text NOT NULL DEFAULT 'planning'
    CHECK (lifecycle_status IN ('planning','active','on_hold','blocked','completed','cancelled')),
  lifecycle_before_block text
    CHECK (lifecycle_before_block IN ('planning','active','on_hold','completed','cancelled')),
  description text,
  objective text,
  outcome text,
  planned_start date,
  actual_start date,
  baseline_finish date,
  forecast_finish date,
  mandatory_deadline date,
  value_score smallint NOT NULL DEFAULT 0 CHECK (value_score BETWEEN 0 AND 4),
  urgency_score smallint NOT NULL DEFAULT 0 CHECK (urgency_score BETWEEN 0 AND 5),
  consequence_score smallint NOT NULL DEFAULT 0 CHECK (consequence_score BETWEEN 0 AND 4),
  final_priority text NOT NULL DEFAULT 'low'
    CHECK (final_priority IN ('low','medium','high','very_high','critical')),
  management_attention boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX projects_project_code_ci_unique ON projects(lower(project_code));
CREATE INDEX projects_lead_department_idx ON projects(lead_department_id);

CREATE TABLE project_role_assignments (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('sponsor','owner','coordinator','executor')),
  person_name text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX project_role_assignment_unique
  ON project_role_assignments(project_id, role, lower(person_name));
CREATE INDEX project_role_assignment_project_idx
  ON project_role_assignments(project_id, role, position);
CREATE UNIQUE INDEX project_role_primary_unique
  ON project_role_assignments(project_id, role) WHERE is_primary;

CREATE TABLE status_reports (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  health text NOT NULL CHECK (health IN ('green','amber','red','critical')),
  trend text NOT NULL DEFAULT 'stable' CHECK (trend IN ('improving','stable','declining')),
  progress numeric(5,2) CHECK (progress BETWEEN 0 AND 100),
  forecast_finish date,
  next_milestone text,
  next_milestone_date date,
  blocker_state text NOT NULL DEFAULT 'none' CHECK (blocker_state IN ('none','blocked')),
  top_blocker text,
  decision_required boolean NOT NULL DEFAULT false,
  decision_text text,
  decision_due_date date,
  management_attention boolean NOT NULL DEFAULT false,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, version_number)
);
CREATE INDEX status_reports_project_date_idx ON status_reports(project_id, created_at DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('project','department','status_report')),
  entity_id uuid NOT NULL,
  action text NOT NULL,
  actor_name text NOT NULL DEFAULT 'Lokalni korisnik',
  summary text,
  changed_fields jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_entity_date_idx
  ON audit_events(entity_type, entity_id, occurred_at DESC);

CREATE TABLE portfolio_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  title text NOT NULL,
  tagline text NOT NULL,
  default_view text NOT NULL DEFAULT 'detailed',
  default_group text NOT NULL DEFAULT 'category'
    CHECK (default_group IN ('category','department','all')),
  default_sort_key text NOT NULL DEFAULT 'name',
  default_sort_direction text NOT NULL DEFAULT 'asc'
    CHECK (default_sort_direction IN ('asc','desc')),
  pdf_view text NOT NULL DEFAULT 'current',
  pdf_group text NOT NULL DEFAULT 'current'
    CHECK (pdf_group IN ('current','category','department','all')),
  pdf_include_inactive boolean NOT NULL DEFAULT true,
  header_graphic text,
  view_columns jsonb NOT NULL DEFAULT
    '{"detailed":["name","id","projectNumber","category","lifecycleStatus","health","trend","owner","sponsor","coordinator","deliveryLead","department","description","objective","outcome","valueScore","urgencyScore","consequenceScore","finalPriority","progress","plannedStart","actualStart","baselineFinish","forecastFinish","mandatoryDeadline","nextMilestone","nextMilestoneDate","blockerState","blocker","decisionRequired","decisionText","decisionDueDate","managementAttention","isDemo","lastUpdatedAt"],"engaged":["name","health","trend","owner","deliveryLead","finalPriority","progress","forecastFinish","nextMilestoneDate","blocker"],"executive":["name","health","owner","deliveryLead","finalPriority","progress","forecastFinish","blocker"],"goldfish":["name","health","owner","deliveryLead","blocker"]}'::jsonb,
  custom_views jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_users(id, display_name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Lokalni korisnik');

INSERT INTO portfolio_settings(
  id, title, tagline
) VALUES (
  1,
  'Portfolio projekata',
  'Upravljačko izveštavanje'
);
