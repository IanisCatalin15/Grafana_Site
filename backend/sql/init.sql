create table if not exists crm_device_tickets (
  id bigserial primary key,
  store_code text,
  device_name text not null unique,
  device_type text,
  owner_name text,
  ticket_url text not null,
  ticket_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_device_tickets_store on crm_device_tickets (store_code);
create index if not exists idx_crm_device_tickets_device_type on crm_device_tickets (device_type);

create table if not exists device_incidents (
  id bigserial primary key,
  store_code text not null,
  device_name text not null,
  device_type text not null,
  offline_started_at timestamptz not null,
  offline_ended_at timestamptz,
  duration_minutes integer,
  incident_status text not null check (incident_status in ('open', 'closed')) default 'open',
  crm_ticket_url text,
  crm_ticket_id text,
  owner_name text,
  notes text,
  source_alert text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_device_incidents_open
  on device_incidents (store_code, device_name, incident_status)
  where incident_status = 'open';

create index if not exists idx_device_incidents_store on device_incidents (store_code);
create index if not exists idx_device_incidents_device_type on device_incidents (device_type);
create index if not exists idx_device_incidents_started_at on device_incidents (offline_started_at desc);
create index if not exists idx_device_incidents_status on device_incidents (incident_status);

create or replace view v_kpi_incident_summary as
with base as (
  select *
  from device_incidents
  where offline_started_at >= now() - interval '30 days'
)
select
  count(*) as incidents_30d,
  count(*) filter (where incident_status = 'open') as incidents_open,
  count(*) filter (where incident_status = 'closed') as incidents_closed,
  round(avg(duration_minutes) filter (where incident_status = 'closed'), 2) as mttr_minutes_30d,
  round(
    100.0 * count(*) filter (where coalesce(crm_ticket_url, '') <> '')
    / nullif(count(*), 0),
    2
  ) as ticket_coverage_pct_30d
from base;

create or replace view v_kpi_by_store_30d as
select
  store_code,
  count(*) as incidents_30d,
  sum(coalesce(duration_minutes, 0)) as downtime_minutes_30d,
  round(avg(duration_minutes) filter (where incident_status = 'closed'), 2) as mttr_minutes_30d,
  round(
    100.0 * count(*) filter (where coalesce(crm_ticket_url, '') <> '')
    / nullif(count(*), 0),
    2
  ) as ticket_coverage_pct_30d
from device_incidents
where offline_started_at >= now() - interval '30 days'
group by store_code
order by downtime_minutes_30d desc;

create or replace view v_kpi_by_device_type_30d as
select
  device_type,
  count(*) as incidents_30d,
  sum(coalesce(duration_minutes, 0)) as downtime_minutes_30d,
  round(avg(duration_minutes) filter (where incident_status = 'closed'), 2) as mttr_minutes_30d
from device_incidents
where offline_started_at >= now() - interval '30 days'
group by device_type
order by incidents_30d desc;

create or replace view v_incidents_unreported as
select
  id,
  store_code,
  device_name,
  device_type,
  offline_started_at,
  offline_ended_at,
  duration_minutes,
  incident_status,
  crm_ticket_url,
  crm_ticket_id,
  case
    when incident_status = 'closed' and coalesce(crm_ticket_url, '') = '' then 'Online but downtime unreported'
    when incident_status = 'open' and coalesce(crm_ticket_url, '') = '' then 'Offline and unreported'
    when coalesce(crm_ticket_url, '') <> '' then 'Reported'
    else 'Unknown'
  end as report_state
from device_incidents
where coalesce(crm_ticket_url, '') = ''
  and (
    incident_status = 'open'
    or coalesce(duration_minutes, 0) >= 0
  );

-- Router Status Timeline: operator reports on store downtime (separate from CRM tickets).
create table if not exists router_timeline_reports (
  id              bigserial primary key,
  store_code      text not null,
  category        text not null check (category in ('Network', 'Power Outage', 'Planned', 'Other')),
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