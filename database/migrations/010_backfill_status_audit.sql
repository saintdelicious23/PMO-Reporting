INSERT INTO audit_events(id,entity_type,entity_id,action,actor_name,summary,changed_fields,occurred_at)
SELECT
  md5('status-audit:' || sr.id::text)::uuid,
  'project',
  sr.project_id,
  'status_snapshot',
  'Lokalni korisnik',
  COALESCE(sr.summary, 'Sačuvan statusni presek.'),
  jsonb_build_object(
    'health', jsonb_build_object('before', NULL, 'after', sr.health),
    'trend', jsonb_build_object('before', NULL, 'after', sr.trend),
    'progress', jsonb_build_object('before', NULL, 'after', sr.progress),
    'forecastFinish', jsonb_build_object('before', NULL, 'after', sr.forecast_finish),
    'nextMilestone', jsonb_build_object('before', NULL, 'after', sr.next_milestone),
    'nextMilestoneDate', jsonb_build_object('before', NULL, 'after', sr.next_milestone_date),
    'blockerState', jsonb_build_object('before', NULL, 'after', sr.blocker_state),
    'topBlocker', jsonb_build_object('before', NULL, 'after', sr.top_blocker),
    'decisionRequired', jsonb_build_object('before', NULL, 'after', sr.decision_required),
    'decisionText', jsonb_build_object('before', NULL, 'after', sr.decision_text),
    'decisionDueDate', jsonb_build_object('before', NULL, 'after', sr.decision_due_date),
    'managementAttention', jsonb_build_object('before', NULL, 'after', sr.management_attention)
  ),
  sr.created_at
FROM status_reports sr
ON CONFLICT (id) DO NOTHING;

INSERT INTO schema_migrations(version) VALUES (10) ON CONFLICT (version) DO NOTHING;
