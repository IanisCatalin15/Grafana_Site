-- Router Status Timeline tables (run once on existing DBs; init.sql only runs on first Postgres boot).
-- Example:
--   docker exec -i gfn_postgres psql -U grafana_new_user -d grafana_incidents < backend/sql/migrate-router-timeline.sql

create table if not exists router_timeline_reports (
  id              bigserial primary key,
  store_code      text not null,
  category        text not null check (category in ('Network', 'Power Outage', 'Other')),
  description     text not null,
  reporter_name   text not null,
  reporter_login  text not null default '',
  reported_at     timestamptz not null default now(),
  timeline_start  timestamptz,
  timeline_end    timestamptz,
  resolved        boolean not null default false,
  resolved_auto   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_router_timeline_reports_store
  on router_timeline_reports (store_code);
create index if not exists idx_router_timeline_reports_reported_at
  on router_timeline_reports (reported_at desc);
create index if not exists idx_router_timeline_reports_resolved
  on router_timeline_reports (resolved);

create table if not exists router_timeline_report_updates (
  id              bigserial primary key,
  report_id       bigint not null references router_timeline_reports(id) on delete cascade,
  author_name     text not null,
  author_login    text not null default '',
  body            text not null check (char_length(trim(body)) >= 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_router_timeline_report_updates_report
  on router_timeline_report_updates (report_id, created_at desc);
