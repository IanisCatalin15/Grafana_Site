-- Add "Planned" category to router_timeline_reports (existing DBs).
-- Example:
--   docker exec -i gfn_postgres psql -U grafana_new_user -d grafana_incidents \
--     < backend/sql/migrate-router-timeline-planned.sql

alter table router_timeline_reports
  drop constraint if exists router_timeline_reports_category_check;

alter table router_timeline_reports
  add constraint router_timeline_reports_category_check
  check (category in ('Network', 'Power Outage', 'Planned', 'Other'));
