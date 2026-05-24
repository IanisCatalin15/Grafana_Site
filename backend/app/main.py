import asyncio
import json
import os
import re
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import psycopg2
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool


DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("Missing DATABASE_URL environment variable")

MIN_INCIDENT_DURATION_PERSIST_MINUTES = 10
"""Cleanup-on-close threshold (minutes). When an incident transitions to online
WITHOUT a CRM ticket and lasted under this many minutes, the row is deleted so
brief flaps don't pollute Reporting/Live counters. Incidents that lasted
>= this threshold are preserved as 'unreported' historical evidence even
without a ticket. Incidents with crm_ticket_url are always preserved."""

POST_PRIMARY_RECOVERY_SUPPRESS_MINUTES = 10
"""Cooldown window (minutes) after a store's WAN comes back online during which
new peripheral incidents (cash registers, music, price checkers, switches) are
suppressed at the API layer. Devices that were obviously offline because the
store had no internet (e.g. after a power outage) shouldn't immediately reopen
fresh incidents while everything is still booting back up. Mirrors the
store:wan_post_recovery_suppress_peripherals recording rule in Prometheus."""

INCIDENT_REOPEN_FLAP_WINDOW_MINUTES = 15
"""If a device comes back offline within this window after closing, reopen the
same incident row so downtime remains continuous instead of creating a new row."""

NIGHT_GAP_REOPEN_MIN_HOURS = 5
NIGHT_GAP_REOPEN_MAX_HOURS = 14
"""When Prometheus does not scrape overnight (~21:00-07:10 Europe/Bucharest), a
RESOLVED followed next morning by FIRING must not split one physical outage into
two DB rows. If the last close matches this overnight gap, reopen the same row."""
BUCHAREST_TZ = ZoneInfo("Europe/Bucharest")
# Daily Prometheus scrape window (wall clock, Europe/Bucharest) — same as Grafana panel.
MONITORING_START_MINUTES_BUCHAREST = 7 * 60 + 10  # 07:10
MONITORING_END_MINUTES_BUCHAREST = 21 * 60  # 21:00

# Prometheus alertname: primary ONT down but backup ONT up (store still has WAN).
PRIMARY_DOWN_BACKUP_UP_ALERT = "DeviceOfflineRouterPrimary"
STORE_WAN_BLACKOUT_ALERT = "DeviceStoreNoInternet"
BACKUP_LINK_ALERT = "DeviceOfflineRouterBackup"

INTERNET_REPORT_TAGS = {"power-outage", "network-issue", "planned"}
INTERNET_REPORT_TAGS_NO_TICKET_REQUIRED = frozenset({"power-outage", "planned"})
DEVICE_REPORT_TAGS = {"troubleshooting", "partial-replacement", "full-replacement"}


# =============================================================================
# Server-Sent Events: push DB-mutation notifications to subscribed UI clients.
#
# Replaces UI polling. Whenever Alertmanager opens/closes an incident or an
# operator edits a ticket from the UI, we publish a small JSON event
# ({"type": "...", "data": {...}}). All connected /api/events/stream
# subscribers receive it and trigger a single targeted refetch of the live
# incidents view.
#
# Implementation notes:
#   - _main_event_loop is captured at FastAPI startup so sync handlers (running
#     in the threadpool) can schedule a fanout via call_soon_threadsafe.
#   - Subscribers use bounded queues; if a client falls behind we drop events
#     for that subscriber rather than block the whole API.
#   - Heartbeat every 5s keeps proxies/intermediaries from closing the conn
#     and, more importantly, lets the server detect dead clients quickly so
#     subscribers don't pile up.
# =============================================================================

_main_event_loop: Optional[asyncio.AbstractEventLoop] = None
_event_subscribers: Set["asyncio.Queue[str]"] = set()


def broadcast_event(event_type: str, payload: Optional[dict] = None) -> None:
    """Fan out an SSE event to every connected UI client. Safe from sync code."""
    loop = _main_event_loop
    if loop is None or not _event_subscribers:
        return
    msg = json.dumps({
        "type": event_type,
        "data": payload or {},
        "ts": int(time.time() * 1000),
    })

    def _fanout() -> None:
        for q in list(_event_subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

    try:
        loop.call_soon_threadsafe(_fanout)
    except RuntimeError:
        pass


app = FastAPI(title="Grafana New Reports API", version="1.0.0")

cors_origins = [item.strip() for item in os.getenv("CORS_ORIGIN", "").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Tell browsers to cache preflight results for 10 minutes. Without this each
    # JSON-body POST/PUT/DELETE issues a fresh OPTIONS, which doubled our
    # round-trips on UIs that mutate frequently (ticket save / delete bursts).
    max_age=600,
)


# Pool-ul evită overhead-ul TCP+auth Postgres la fiecare request. uvicorn rulează
# handlerele sync pe un threadpool; fără pool, sub burst (UI deschide 6 endpoint-uri
# în paralel × multiple browsere) ajungem să saturăm fie threadpool-ul aşteptând
# psycopg2.connect, fie max_connections-ul Postgres-ului.
DB_POOL_MIN = int(os.getenv("DB_POOL_MIN") or "4")
DB_POOL_MAX = int(os.getenv("DB_POOL_MAX") or "40")
_db_pool: Optional[ThreadedConnectionPool] = None


def _get_db_pool() -> ThreadedConnectionPool:
    """Lazy-init the global Postgres connection pool. Re-creates on closure."""
    global _db_pool
    if _db_pool is None or _db_pool.closed:
        _db_pool = ThreadedConnectionPool(
            minconn=DB_POOL_MIN,
            maxconn=DB_POOL_MAX,
            dsn=DATABASE_URL,
        )
    return _db_pool


@contextmanager
def db_cursor():
    pool = _get_db_pool()
    conn = pool.getconn()
    try:
        # Recover from any half-broken state left by a previous error in the
        # caller (psycopg2 leaves the conn in 'in-transaction' if commit/rollback
        # was skipped). rollback() is a cheap no-op when there's nothing pending.
        try:
            conn.rollback()
        except Exception:
            pass
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            yield conn, cursor
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        pool.putconn(conn)


def parse_store_from_device_name(device_name: str) -> Optional[str]:
    normalized = (device_name or "").strip().lower()
    if normalized.startswith("ar") and len(normalized) >= 6:
        return normalized[:6].upper()
    return None


def normalize_report_tag(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def is_internet_issue_ticket(device_type: Optional[str], device_name: Optional[str]) -> bool:
    dt = (device_type or "").strip().lower()
    dn = (device_name or "").strip().upper()
    if dt in {"primary-link", "backup-link"}:
        return True
    return dn.endswith("-INTERNET")


def is_internet_tag_only_report_allowed(
    report_tag: str, device_type: Optional[str], device_name: Optional[str]
) -> bool:
    """Internet Down with power-outage or planned may be filed without a CRM ticket URL."""
    if not is_internet_issue_ticket(device_type, device_name):
        return False
    return normalize_report_tag(report_tag) in INTERNET_REPORT_TAGS_NO_TICKET_REQUIRED


def _sql_incident_is_reported(alias: Optional[str] = "di") -> str:
    """SQL predicate: incident counts as operator-reported (CRM URL or tag-only internet report)."""
    prefix = f"{alias}." if alias else ""
    return f"""(
      coalesce({prefix}crm_ticket_url, '') <> ''
      or (
        {prefix}reported_at is not null
        and coalesce({prefix}report_tag, '') in ('power-outage', 'planned')
        and (
          coalesce({prefix}device_type, '') in ('primary-link', 'backup-link')
          or right(upper(coalesce({prefix}device_name, '')), 9) = '-INTERNET'
        )
      )
    )"""


def validate_report_tag_or_raise(report_tag: str, device_type: Optional[str], device_name: Optional[str]) -> str:
    tag = normalize_report_tag(report_tag)
    if not tag:
        raise HTTPException(status_code=400, detail="reportTag is required")
    allowed = INTERNET_REPORT_TAGS if is_internet_issue_ticket(device_type, device_name) else DEVICE_REPORT_TAGS
    if tag not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid reportTag '{tag}' for this device type")
    return tag


def normalize_store_code(value: Optional[str]) -> str:
    """AR + 4 digits (e.g. 86 → AR0086, AR12 → AR0012), aligned with device_incidents."""
    raw = (value or "").strip()
    if not raw:
        return ""
    compact = raw.upper().replace(" ", "")
    m = re.fullmatch(r"AR(\d+)", compact, flags=re.IGNORECASE)
    if m:
        return "AR" + m.group(1).zfill(4)
    digits = re.sub(r"\D", "", raw)
    if digits.isdigit() and len(digits) >= 1:
        return "AR" + digits.zfill(4)
    return compact


def normalize_row(row):
    if not row:
        return row
    normalized = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            normalized[key] = value.astimezone(timezone.utc).isoformat()
        else:
            normalized[key] = value
    return normalized


def normalize_days(days: int, minimum: int = 1, maximum: int = 365) -> int:
    if days < minimum:
        return minimum
    if days > maximum:
        return maximum
    return days


def parse_epoch_ms(value: Optional[int]) -> Optional[datetime]:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(value / 1000.0, tz=timezone.utc)
    except Exception:
        return None


class TicketPayload(BaseModel):
    ticketUrl: Optional[str] = ""
    ticketId: Optional[str] = None
    deviceType: Optional[str] = None
    storeCode: Optional[str] = None
    actorName: Optional[str] = None
    reportTag: Optional[str] = None


class IncidentEventPayload(BaseModel):
    storeCode: str
    deviceName: str
    deviceType: str
    status: str
    eventTime: Optional[datetime] = None
    sourceAlert: Optional[str] = None


def parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    raw = raw.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


@app.get("/health")
def health():
    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute("select 1")
            cursor.fetchone()
        return {"ok": True}
    except HTTPException:
        raise
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.on_event("startup")
def _capture_event_loop():
    """Capture the FastAPI event loop so sync handlers can schedule SSE fanout."""
    global _main_event_loop
    try:
        _main_event_loop = asyncio.get_event_loop()
    except RuntimeError:
        _main_event_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_main_event_loop)


_SSE_MAX_SUBSCRIBERS = 200


@app.get("/api/events/stream")
async def events_stream(request: Request):
    """SSE feed of incident/ticket mutations. Consumed by the dashboard UI in
    place of polling. Sends an initial ':connected' comment, real events as
    'data: {...}', and a ':heartbeat' comment every 5s to keep the connection
    alive through proxies and to detect dead clients quickly. Subscribers use
    a bounded queue to avoid back-pressuring the API when a client falls
    behind. Hard cap on total subscribers to avoid runaway accumulation if
    clients fail to close cleanly across many page reloads."""

    if len(_event_subscribers) >= _SSE_MAX_SUBSCRIBERS:
        # Drop the oldest subscriber to make room — better to disconnect one
        # stale client than to refuse new connections after burst reloads.
        try:
            stale = next(iter(_event_subscribers))
            _event_subscribers.discard(stale)
            try:
                stale.put_nowait("__close__")
            except asyncio.QueueFull:
                pass
        except StopIteration:
            pass

    queue: "asyncio.Queue[str]" = asyncio.Queue(maxsize=200)
    _event_subscribers.add(queue)

    async def gen():
        try:
            yield ":connected\n\n"
            while True:
                # Tighter heartbeat cadence (5s instead of 15s) lets us notice
                # client disconnects faster — request.is_disconnected() is only
                # checked between iterations, so a long timeout means stale
                # subscribers linger and accumulate after burst page refreshes.
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=5.0)
                    if msg == "__close__":
                        break
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ":heartbeat\n\n"
                if await request.is_disconnected():
                    break
        finally:
            _event_subscribers.discard(queue)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.on_event("startup")
def ensure_ticket_owner_column():
    try:
        with db_cursor() as (conn, cursor):
            cursor.execute("alter table crm_device_tickets add column if not exists owner_name text")
            cursor.execute("alter table crm_device_tickets add column if not exists report_tag text")
            cursor.execute("alter table device_incidents add column if not exists owner_name text")
            cursor.execute("alter table device_incidents add column if not exists source_alert text")
            cursor.execute("alter table device_incidents add column if not exists report_tag text")
            # When the CRM ticket was opened / closed. Used by the reporting
            # SQL for time-to-report / time-to-resolve metrics. Backfilled
            # from crm_device_tickets.created_at for legacy rows.
            cursor.execute("alter table device_incidents add column if not exists reported_at timestamptz")
            cursor.execute("alter table device_incidents add column if not exists resolved_at timestamptz")
            cursor.execute(
                """
                update device_incidents di
                set reported_at = t.created_at
                from crm_device_tickets t
                where di.reported_at is null
                  and t.device_name = di.device_name
                  and coalesce(di.crm_ticket_url, '') <> ''
                """
            )
            cursor.execute(
                """
                update device_incidents
                set resolved_at = offline_ended_at
                where resolved_at is null
                  and incident_status = 'closed'
                  and coalesce(crm_ticket_url, '') <> ''
                """
            )
            cursor.execute(
                "create index if not exists idx_device_incidents_reported_at on device_incidents (reported_at desc)"
            )
            cursor.execute(
                "create index if not exists idx_device_incidents_resolved_at on device_incidents (resolved_at desc)"
            )
            cursor.execute(
                f"""
                create or replace view v_incidents_unreported as
                select
                  di.id,
                  di.store_code,
                  di.device_name,
                  di.device_type,
                  di.offline_started_at,
                  di.offline_ended_at,
                  di.duration_minutes,
                  di.incident_status,
                  di.crm_ticket_url,
                  di.crm_ticket_id,
                  di.source_alert,
                  case
                    when di.incident_status = 'closed' and not ({_sql_incident_is_reported('di')}) then 'Online but downtime unreported'
                    when di.incident_status = 'open' and not ({_sql_incident_is_reported('di')}) then 'Offline and unreported'
                    when ({_sql_incident_is_reported('di')}) then 'Reported'
                    else 'Unknown'
                  end as report_state
                from device_incidents di
                where not ({_sql_incident_is_reported('di')})
                  and (
                    di.incident_status = 'open'
                    or coalesce(di.duration_minutes, 0) >= %s
                  )
                """,
                (MIN_INCIDENT_DURATION_PERSIST_MINUTES,),
            )
            cursor.execute("alter table device_incidents drop column if exists connectivity_report_id")
            cursor.execute("drop table if exists connectivity_reports cascade")
            conn.commit()
    except Exception as exc:
        raise RuntimeError(f"Schema migration failed: {exc}") from exc


@app.get("/api/tickets/{device_name}")
def price_checker_ticket_name_alias(device_name: str) -> Optional[str]:
    """ARxxxx-Pn <-> ARxxxx-PCn so PUT /tickets matches incidents regardless of variant."""
    raw = (device_name or "").strip()
    m = re.match(r"^(AR\d+)-(P|PC)(\d+)$", raw, re.IGNORECASE)
    if not m:
        return None
    store = m.group(1).upper()
    prefix = m.group(2).upper()
    num = m.group(3)
    return f"{store}-{'PC' if prefix == 'P' else 'P'}{num}"


def get_ticket(device_name: str):
    normalized_device = device_name.strip()
    if not normalized_device:
        raise HTTPException(status_code=400, detail="deviceName is required")

    alias_device = ""
    m = re.match(r"^(AR\d+)-(P|PC)(\d+)$", normalized_device, re.IGNORECASE)
    if m:
        store = m.group(1).upper()
        prefix = m.group(2).upper()
        num = m.group(3)
        alias_device = f"{store}-{'PC' if prefix == 'P' else 'P'}{num}"

    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute(
                """
                select id, store_code, device_name, device_type, owner_name, report_tag, ticket_url, ticket_id, created_at, updated_at
                from crm_device_tickets
                where upper(device_name) = upper(%s)
                   or (%s <> '' and upper(device_name) = upper(%s))
                order by
                  case when upper(device_name) = upper(%s) then 0 else 1 end,
                  updated_at desc nulls last,
                  created_at desc nulls last
                limit 1
                """,
                (normalized_device, alias_device, alias_device, normalized_device),
            )
            row = cursor.fetchone()
        return {"ticket": normalize_row(row) if row else None}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def _apply_tag_only_internet_report_to_incident(
    cursor,
    *,
    normalized_device: str,
    device_name_alias: Optional[str],
    device_type: Optional[str],
    store_code: Optional[str],
    actor_name: str,
    report_tag: str,
) -> Optional[int]:
    """Mark an internet incident reported by tag only (no CRM URL)."""
    cursor.execute(
        """
        with target as (
          select id
          from device_incidents
          where (
              upper(device_name) = upper(%s)
              or (%s is not null and upper(device_name) = upper(%s))
              or (
                  coalesce(%s, '') <> ''
                  and upper(store_code) = upper(%s)
                  and coalesce(device_type, '') = coalesce(%s, '')
              )
            )
            and coalesce(crm_ticket_url, '') = ''
          order by
            case when incident_status = 'open' then 0 else 1 end,
            offline_started_at desc
          limit 1
        )
        update device_incidents di
        set
          owner_name = coalesce(nullif(trim(%s), ''), di.owner_name),
          report_tag = coalesce(%s, di.report_tag),
          reported_at = coalesce(di.reported_at, now()),
          updated_at = now()
        from target
        where di.id = target.id
        returning di.id
        """,
        (
            normalized_device,
            device_name_alias,
            device_name_alias,
            device_type,
            store_code,
            device_type,
            actor_name,
            report_tag,
        ),
    )
    linked = cursor.fetchone()
    if linked and linked.get("id") is not None:
        return int(linked["id"])
    if not store_code or not device_type:
        return None
    cursor.execute(
        """
        insert into device_incidents (
          store_code, device_name, device_type,
          offline_started_at, incident_status,
          owner_name, report_tag, reported_at, source_alert
        )
        values (%s, %s, %s, now(), 'open', %s, %s, now(), 'operator')
        on conflict (store_code, device_name, incident_status)
        where incident_status = 'open'
        do update set
          owner_name = coalesce(excluded.owner_name, device_incidents.owner_name),
          report_tag = coalesce(excluded.report_tag, device_incidents.report_tag),
          reported_at = coalesce(device_incidents.reported_at, excluded.reported_at),
          updated_at = now()
        returning id
        """,
        (store_code, normalized_device, device_type, actor_name, report_tag),
    )
    inserted = cursor.fetchone()
    return int(inserted["id"]) if inserted and inserted.get("id") is not None else None


@app.put("/api/tickets/{device_name}")
def put_ticket(
    device_name: str,
    payload: TicketPayload,
    mark_incident: bool = Query(default=True),
):
    normalized_device = device_name.strip()
    ticket_url = (payload.ticketUrl or "").strip()
    ticket_id = (payload.ticketId or "").strip() or None
    device_type = (payload.deviceType or "").strip() or None
    store_code = (payload.storeCode or "").strip() or parse_store_from_device_name(normalized_device)
    actor_name = (payload.actorName or "").strip()
    report_tag = validate_report_tag_or_raise(payload.reportTag, device_type, normalized_device)
    device_name_alias = price_checker_ticket_name_alias(normalized_device)
    tag_only_report = is_internet_tag_only_report_allowed(report_tag, device_type, normalized_device) and not ticket_url

    if not normalized_device or not actor_name:
        raise HTTPException(status_code=400, detail="deviceName and actorName are required")
    if not ticket_url and not tag_only_report:
        raise HTTPException(status_code=400, detail="deviceName, ticketUrl and actorName are required")
    if ticket_url:
        parsed = urlparse(ticket_url)
        if parsed.scheme not in ("http", "https"):
            raise HTTPException(status_code=400, detail="ticketUrl must start with http:// or https://")

    try:
        with db_cursor() as (conn, cursor):
            if tag_only_report:
                if not mark_incident:
                    raise HTTPException(
                        status_code=400,
                        detail="Tag-only internet reports must be linked to an incident",
                    )
                _apply_tag_only_internet_report_to_incident(
                    cursor,
                    normalized_device=normalized_device,
                    device_name_alias=device_name_alias,
                    device_type=device_type,
                    store_code=store_code,
                    actor_name=actor_name,
                    report_tag=report_tag,
                )
                conn.commit()
                broadcast_event(
                    "ticket_linked",
                    {
                        "source": "operator",
                        "device_name": normalized_device,
                        "device_type": device_type,
                        "store_code": store_code,
                        "ticket_url": "",
                        "report_tag": report_tag,
                        "tag_only": True,
                    },
                )
                return {
                    "ticket": normalize_row(
                        {
                            "store_code": store_code,
                            "device_name": normalized_device,
                            "device_type": device_type,
                            "owner_name": actor_name,
                            "report_tag": report_tag,
                            "ticket_url": "",
                            "ticket_id": None,
                        }
                    )
                }

            cursor.execute(
                """
                select ticket_url
                from crm_device_tickets
                where upper(device_name) = upper(%s)
                limit 1
                """,
                (normalized_device,),
            )
            _crm_prev_row = cursor.fetchone()
            crm_ticket_before = ((_crm_prev_row or {}).get("ticket_url") or "").strip()

            cursor.execute(
                """
                insert into crm_device_tickets (store_code, device_name, device_type, owner_name, report_tag, ticket_url, ticket_id)
                values (%s, %s, %s, %s, %s, %s, %s)
                on conflict (device_name)
                do update set
                  store_code = excluded.store_code,
                  device_type = excluded.device_type,
                  owner_name = coalesce(crm_device_tickets.owner_name, excluded.owner_name),
                  report_tag = excluded.report_tag,
                  ticket_url = excluded.ticket_url,
                  ticket_id = excluded.ticket_id,
                  updated_at = now()
                returning id, store_code, device_name, device_type, owner_name, report_tag, ticket_url, ticket_id, created_at, updated_at
                """,
                (store_code, normalized_device, device_type, actor_name, report_tag, ticket_url, ticket_id),
            )
            row = cursor.fetchone()
            if not mark_incident:
                # Non Internet / CRM-only saves: `solve_ticket` deletes crm_device_tickets but
                # leaves a closed device_incidents row with crm_ticket_url. Re-upserting CRM
                # without syncing that row leaves mismatched URLs so the reported UNION
                # (crm rows with no matching incident by ticket_url) surfaces a duplicate
                # in Reported while Solved still shows the closed row.
                if crm_ticket_before:
                    cursor.execute(
                        """
                        with target as (
                          select id
                          from device_incidents
                          where incident_status = 'closed'
                            and (
                              upper(device_name) = upper(%s)
                              or (%s is not null and upper(device_name) = upper(%s))
                              or (
                                  coalesce(%s, '') <> ''
                                  and upper(store_code) = upper(%s)
                                  and coalesce(device_type, '') = coalesce(%s, '')
                              )
                            )
                            and (
                              coalesce(crm_ticket_url, '') = %s
                              or coalesce(crm_ticket_url, '') = %s
                            )
                          order by coalesce(offline_ended_at, updated_at) desc, id desc
                          limit 1
                        )
                        update device_incidents di
                        set
                          crm_ticket_url = %s,
                          crm_ticket_id = %s,
                          owner_name = coalesce(nullif(trim(%s), ''), di.owner_name),
                          report_tag = coalesce(%s, di.report_tag),
                          updated_at = now()
                        from target
                        where di.id = target.id
                        """,
                        (
                            normalized_device,
                            device_name_alias,
                            device_name_alias,
                            device_type,
                            store_code,
                            device_type,
                            crm_ticket_before,
                            ticket_url,
                            ticket_url,
                            ticket_id,
                            actor_name,
                            report_tag,
                        ),
                    )
                else:
                    cursor.execute(
                        """
                        with target as (
                          select id
                          from device_incidents
                          where incident_status = 'closed'
                            and (
                              upper(device_name) = upper(%s)
                              or (%s is not null and upper(device_name) = upper(%s))
                              or (
                                  coalesce(%s, '') <> ''
                                  and upper(store_code) = upper(%s)
                                  and coalesce(device_type, '') = coalesce(%s, '')
                              )
                            )
                            and coalesce(crm_ticket_url, '') <> ''
                          order by coalesce(offline_ended_at, updated_at) desc, id desc
                          limit 1
                        )
                        update device_incidents di
                        set
                          crm_ticket_url = %s,
                          crm_ticket_id = %s,
                          owner_name = coalesce(nullif(trim(%s), ''), di.owner_name),
                          report_tag = coalesce(%s, di.report_tag),
                          updated_at = now()
                        from target
                        where di.id = target.id
                        """,
                        (
                            normalized_device,
                            device_name_alias,
                            device_name_alias,
                            device_type,
                            store_code,
                            device_type,
                            ticket_url,
                            ticket_id,
                            actor_name,
                            report_tag,
                        ),
                    )
            if mark_incident:
                # 0) Row that already has this CRM link (OPEN only). We intentionally
                #    avoid claiming closed rows here, so the same ticket URL can be linked
                #    to additional incidents (same device on another downtime window).
                #    Closed-row edits are handled by dedicated branches below.
                cursor.execute(
                    """
                    with target as (
                      select id
                      from device_incidents
                      where (
                          upper(device_name) = upper(%s)
                          or (%s is not null and upper(device_name) = upper(%s))
                        )
                        and (
                          coalesce(crm_ticket_url, '') = %s
                          or (
                              coalesce(%s::text, '') <> ''
                              and coalesce(crm_ticket_url, '') = %s
                          )
                        )
                        and incident_status = 'open'
                      order by
                        case when incident_status = 'open' then 0 else 1 end,
                        id desc
                      limit 1
                    )
                    update device_incidents di
                    set
                      crm_ticket_url = %s,
                      crm_ticket_id = %s,
                      owner_name = coalesce(di.owner_name, %s),
                      report_tag = coalesce(%s, di.report_tag),
                      reported_at = coalesce(di.reported_at, now()),
                      updated_at = now()
                    from target
                    where di.id = target.id
                    returning di.id
                    """,
                    (
                        normalized_device,
                        device_name_alias,
                        device_name_alias,
                        ticket_url,
                        crm_ticket_before,
                        crm_ticket_before,
                        ticket_url,
                        ticket_id,
                        actor_name,
                        report_tag,
                    ),
                )
                linked = cursor.fetchone()
                if not linked:
                    cursor.execute(
                        """
                        with target as (
                          select id
                          from device_incidents
                          where (
                              upper(device_name) = upper(%s)
                              or (%s is not null and upper(device_name) = upper(%s))
                              or (
                                  coalesce(%s, '') <> ''
                                  and upper(store_code) = upper(%s)
                                  and coalesce(device_type, '') = coalesce(%s, '')
                              )
                            )
                            and coalesce(crm_ticket_url, '') = ''
                          order by
                            case
                              when upper(device_name) = upper(%s) or (%s is not null and upper(device_name) = upper(%s)) then 0
                              when coalesce(%s, '') <> '' and upper(store_code) = upper(%s) and coalesce(device_type, '') = coalesce(%s, '') then 1
                              else 2
                            end,
                            case when incident_status = 'open' then 0 else 1 end,
                            offline_started_at desc
                          limit 1
                        )
                        update device_incidents di
                        set
                          crm_ticket_url = %s,
                          crm_ticket_id = %s,
                          owner_name = coalesce(di.owner_name, %s),
                          report_tag = coalesce(%s, di.report_tag),
                          reported_at = coalesce(di.reported_at, now()),
                          updated_at = now()
                        from target
                        where di.id = target.id
                        returning di.id
                        """,
                        (
                            normalized_device,
                            device_name_alias,
                            device_name_alias,
                            device_type,
                            store_code,
                            device_type,
                            normalized_device,
                            device_name_alias,
                            device_name_alias,
                            device_type,
                            store_code,
                            device_type,
                            ticket_url,
                            ticket_id,
                            actor_name,
                            report_tag,
                        ),
                    )
                    linked = cursor.fetchone()
                # Edit flow: if the incident is already reported (has crm_ticket_url),
                # update that existing row instead of creating a new one below.
                if not linked:
                    cursor.execute(
                        """
                        with target as (
                          select id
                          from device_incidents
                          where (
                              upper(device_name) = upper(%s)
                              or (%s is not null and upper(device_name) = upper(%s))
                              or (
                                  coalesce(%s, '') <> ''
                                  and upper(store_code) = upper(%s)
                                  and coalesce(device_type, '') = coalesce(%s, '')
                              )
                            )
                            and coalesce(crm_ticket_url, '') <> ''
                            and incident_status = 'open'
                          order by
                            case
                              when upper(device_name) = upper(%s) or (%s is not null and upper(device_name) = upper(%s)) then 0
                              when coalesce(%s, '') <> '' and upper(store_code) = upper(%s) and coalesce(device_type, '') = coalesce(%s, '') then 1
                              else 2
                            end,
                            coalesce(reported_at, offline_started_at) desc
                          limit 1
                        )
                        update device_incidents di
                        set
                          crm_ticket_url = %s,
                          crm_ticket_id = %s,
                          owner_name = coalesce(di.owner_name, %s),
                          report_tag = coalesce(%s, di.report_tag),
                          reported_at = coalesce(di.reported_at, now()),
                          updated_at = now()
                        from target
                        where di.id = target.id
                        returning di.id
                        """,
                        (
                            normalized_device,
                            device_name_alias,
                            device_name_alias,
                            device_type,
                            store_code,
                            device_type,
                            normalized_device,
                            device_name_alias,
                            device_name_alias,
                            device_type,
                            store_code,
                            device_type,
                            ticket_url,
                            ticket_id,
                            actor_name,
                            report_tag,
                        ),
                    )
                    linked = cursor.fetchone()
                # Edit on already-solved rows: branches above only target open incidents
                # or unreported. Without this, PUT falls through to INSERT and creates a
                # duplicate open incident (or extra row) when the operator edits tag/URL
                # from the Live "Solved" / historical view.
                if not linked:
                    cursor.execute(
                        """
                        with target as (
                          select id
                          from device_incidents
                          where (
                              upper(device_name) = upper(%s)
                              or (%s is not null and upper(device_name) = upper(%s))
                              or (
                                  coalesce(%s, '') <> ''
                                  and upper(store_code) = upper(%s)
                                  and coalesce(device_type, '') = coalesce(%s, '')
                              )
                            )
                            and coalesce(crm_ticket_url, '') = %s
                          order by
                            case when incident_status = 'open' then 0 else 1 end,
                            coalesce(offline_ended_at, updated_at) desc,
                            id desc
                          limit 1
                        )
                        update device_incidents di
                        set
                          crm_ticket_url = %s,
                          crm_ticket_id = %s,
                          owner_name = coalesce(di.owner_name, %s),
                          report_tag = coalesce(%s, di.report_tag),
                          reported_at = coalesce(di.reported_at, now()),
                          updated_at = now()
                        from target
                        where di.id = target.id
                        returning di.id
                        """,
                        (
                            normalized_device,
                            device_name_alias,
                            device_name_alias,
                            device_type,
                            store_code,
                            device_type,
                            ticket_url,
                            ticket_url,
                            ticket_id,
                            actor_name,
                            report_tag,
                        ),
                    )
                    linked = cursor.fetchone()
                # CRM URL was changed while device_incidents still holds the previous URL
                # (typical when editing a solved row). Match on the pre-upsert URL only.
                if (
                    not linked
                    and crm_ticket_before
                    and crm_ticket_before != ticket_url.strip()
                ):
                    cursor.execute(
                        """
                        with target as (
                          select id
                          from device_incidents
                          where (
                              upper(device_name) = upper(%s)
                              or (%s is not null and upper(device_name) = upper(%s))
                              or (
                                  coalesce(%s, '') <> ''
                                  and upper(store_code) = upper(%s)
                                  and coalesce(device_type, '') = coalesce(%s, '')
                              )
                            )
                            and coalesce(crm_ticket_url, '') = %s
                          order by
                            case when incident_status = 'open' then 0 else 1 end,
                            coalesce(offline_ended_at, updated_at) desc,
                            id desc
                          limit 1
                        )
                        update device_incidents di
                        set
                          crm_ticket_url = %s,
                          crm_ticket_id = %s,
                          owner_name = coalesce(di.owner_name, %s),
                          report_tag = coalesce(%s, di.report_tag),
                          reported_at = coalesce(di.reported_at, now()),
                          updated_at = now()
                        from target
                        where di.id = target.id
                        returning di.id
                        """,
                        (
                            normalized_device,
                            device_name_alias,
                            device_name_alias,
                            device_type,
                            store_code,
                            device_type,
                            crm_ticket_before,
                            ticket_url,
                            ticket_id,
                            actor_name,
                            report_tag,
                        ),
                    )
                    linked = cursor.fetchone()
                # If no open/no-ticket incident matched, the operator is filing
                # a ticket for a device the pipeline hasn't seen offline yet
                # (rare race / pre-emptive workflow). Insert a fresh row so the
                # report immediately surfaces in /api/reporting/reported with a
                # real created_at instead of vanishing into a manual-ticket-only
                # branch in the SQL.
                if not linked and store_code and device_type:
                    cursor.execute(
                        """
                        insert into device_incidents (
                          store_code, device_name, device_type,
                          offline_started_at, incident_status,
                          crm_ticket_url, crm_ticket_id,
                          owner_name, report_tag, reported_at, source_alert
                        )
                        values (%s, %s, %s, now(), 'open', %s, %s, %s, %s, now(), 'operator')
                        on conflict (store_code, device_name, incident_status)
                        where incident_status = 'open'
                        do update set
                          crm_ticket_url = excluded.crm_ticket_url,
                          crm_ticket_id  = coalesce(excluded.crm_ticket_id, device_incidents.crm_ticket_id),
                          owner_name     = coalesce(excluded.owner_name, device_incidents.owner_name),
                          report_tag     = coalesce(excluded.report_tag, device_incidents.report_tag),
                          reported_at    = coalesce(device_incidents.reported_at, excluded.reported_at),
                          updated_at     = now()
                        """,
                        (
                            store_code, normalized_device, device_type,
                            ticket_url, ticket_id, actor_name, report_tag,
                        ),
                    )
            conn.commit()
        broadcast_event("ticket_linked", {
            "source": "operator",
            "device_name": normalized_device,
            "device_type": device_type,
            "store_code": store_code,
            "ticket_url": ticket_url,
        })
        return {"ticket": normalize_row(row)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/api/tickets/{device_name}")
def delete_ticket(device_name: str, actorName: str = Query(default="")):
    normalized_device = device_name.strip()
    if not normalized_device:
        raise HTTPException(status_code=400, detail="deviceName is required")
    actor_name = actorName.strip()
    if not actor_name:
        raise HTTPException(status_code=400, detail="actorName is required")

    try:
        with db_cursor() as (conn, cursor):
            cursor.execute(
                """
                select owner_name, ticket_url, store_code, device_type, device_name
                from crm_device_tickets
                where upper(device_name) = upper(%s)
                limit 1
                """,
                (normalized_device,),
            )
            existing = cursor.fetchone()

            if not existing or not (existing.get("ticket_url") or "").strip():
                cursor.execute(
                    f"""
                    update device_incidents
                    set
                      report_tag = null,
                      reported_at = null,
                      owner_name = null,
                      updated_at = now()
                    where upper(device_name) = upper(%s)
                      and coalesce(crm_ticket_url, '') = ''
                      and reported_at is not null
                      and coalesce(report_tag, '') in ('power-outage', 'planned')
                      and (
                        coalesce(device_type, '') in ('primary-link', 'backup-link')
                        or right(upper(coalesce(device_name, '')), 9) = '-INTERNET'
                      )
                    """,
                    (normalized_device,),
                )
                tag_only_cleared = cursor.rowcount or 0
                if tag_only_cleared:
                    conn.commit()
                    broadcast_event(
                        "ticket_deleted",
                        {
                            "source": "operator",
                            "device_name": normalized_device,
                            "tag_only_cleared": tag_only_cleared,
                        },
                    )
                    return {
                        "ok": True,
                        "tickets_deleted": 0,
                        "incidents_cleared": tag_only_cleared,
                        "incidents_deleted": 0,
                    }

            cursor.execute("delete from crm_device_tickets where upper(device_name) = upper(%s)", (normalized_device,))
            tickets_deleted = cursor.rowcount or 0

            incidents_cleared = 0
            incidents_deleted = 0
            if existing and existing.get("ticket_url"):
                ticket_url = existing.get("ticket_url")
                store_code = (existing.get("store_code") or "").strip()
                device_type = (existing.get("device_type") or "").strip()
                db_device_name = (existing.get("device_name") or normalized_device).strip()
                # Non Internet Issues are stored as manual operator incidents.
                # When deleting their ticket, remove those incident rows entirely
                # so they do NOT reappear in "unreported".
                cursor.execute(
                    """
                    delete from device_incidents
                    where coalesce(crm_ticket_url, '') = coalesce(%s, '')
                      and coalesce(source_alert, '') in ('operator', 'operator_manual_solved')
                      and (
                        upper(device_name) = upper(%s)
                        or (
                          coalesce(%s, '') <> ''
                          and upper(store_code) = upper(%s)
                          and coalesce(device_type, '') = coalesce(%s, '')
                        )
                      )
                    """,
                    (ticket_url, db_device_name, device_type, store_code, device_type),
                )
                incidents_deleted = cursor.rowcount or 0
                # Reporting "Reported" views read crm_ticket_url from device_incidents.
                # Clear the linked incident markers when deleting a ticket record.
                cursor.execute(
                    """
                    update device_incidents
                    set
                      crm_ticket_url = '',
                      crm_ticket_id = null,
                      owner_name = null,
                      report_tag = null,
                      updated_at = now()
                    where coalesce(crm_ticket_url, '') = coalesce(%s, '')
                      and (
                        upper(device_name) = upper(%s)
                        or (
                          coalesce(%s, '') <> ''
                          and upper(store_code) = upper(%s)
                          and coalesce(device_type, '') = coalesce(%s, '')
                        )
                      )
                      and coalesce(source_alert, '') not in ('operator', 'operator_manual_solved')
                    """,
                    (ticket_url, db_device_name, device_type, store_code, device_type),
                )
                incidents_cleared = cursor.rowcount or 0
            else:
                # Some reported rows can exist only in device_incidents (no crm_device_tickets row).
                cursor.execute(
                    """
                    delete from device_incidents
                    where upper(device_name) = upper(%s)
                      and coalesce(crm_ticket_url, '') <> ''
                      and coalesce(source_alert, '') in ('operator', 'operator_manual_solved')
                    """,
                    (normalized_device,),
                )
                incidents_deleted = cursor.rowcount or 0
                cursor.execute(
                    """
                    update device_incidents
                    set
                      crm_ticket_url = '',
                      crm_ticket_id = null,
                      owner_name = null,
                      report_tag = null,
                      updated_at = now()
                    where upper(device_name) = upper(%s)
                      and coalesce(crm_ticket_url, '') <> ''
                      and coalesce(source_alert, '') not in ('operator', 'operator_manual_solved')
                    """,
                    (normalized_device,),
                )
                incidents_cleared = cursor.rowcount or 0
            conn.commit()
        broadcast_event("ticket_deleted", {
            "source": "operator",
            "device_name": normalized_device,
            "tickets_deleted": tickets_deleted,
            "incidents_cleared": incidents_cleared,
            "incidents_deleted": incidents_deleted,
        })
        return {
            "ok": True,
            "tickets_deleted": tickets_deleted,
            "incidents_cleared": incidents_cleared,
            "incidents_deleted": incidents_deleted,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/tickets/{device_name}/solve")
def solve_ticket(device_name: str, actorName: str = Query(default="")):
    normalized_device = device_name.strip()
    if not normalized_device:
        raise HTTPException(status_code=400, detail="deviceName is required")
    actor_name = actorName.strip()
    if not actor_name:
        raise HTTPException(status_code=400, detail="actorName is required")

    try:
        with db_cursor() as (conn, cursor):
            cursor.execute(
                """
                select owner_name, ticket_url, store_code, device_type, device_name, created_at, report_tag
                from crm_device_tickets
                where upper(device_name) = upper(%s)
                limit 1
                """,
                (normalized_device,),
            )
            ticket_row = cursor.fetchone()
            if not ticket_row:
                raise HTTPException(status_code=404, detail="Ticket not found")

            existing_owner = (ticket_row.get("owner_name") or "").strip()
            ticket_url = (ticket_row.get("ticket_url") or "").strip()
            if not ticket_url:
                raise HTTPException(status_code=400, detail="Ticket URL is required to solve report")
            store_code = (ticket_row.get("store_code") or "").strip()
            device_type = (ticket_row.get("device_type") or "").strip()
            db_device_name = (ticket_row.get("device_name") or normalized_device).strip()
            ticket_created_at = ticket_row.get("created_at")
            report_tag = normalize_report_tag(ticket_row.get("report_tag"))

            cursor.execute(
                """
                update device_incidents
                set
                  incident_status = 'closed',
                  offline_ended_at = coalesce(offline_ended_at, now()),
                  duration_minutes = greatest(
                    0,
                    floor(extract(epoch from (coalesce(offline_ended_at, now()) - offline_started_at)) / 60)
                  )::int,
                  updated_at = now()
                where incident_status = 'open'
                  and coalesce(crm_ticket_url, '') = coalesce(%s, '')
                  and (
                    upper(device_name) = upper(%s)
                    or (
                      coalesce(%s, '') <> ''
                      and upper(store_code) = upper(%s)
                      and coalesce(device_type, '') = coalesce(%s, '')
                    )
                  )
                returning id
                """,
                (ticket_url, db_device_name, device_type, store_code, device_type),
            )
            closed_rows = cursor.fetchall()

            if not closed_rows:
                cursor.execute(
                    """
                    insert into device_incidents (
                      store_code, device_name, device_type,
                      offline_started_at, offline_ended_at, duration_minutes,
                      incident_status, crm_ticket_url, crm_ticket_id,
                      owner_name, report_tag, reported_at, source_alert
                    )
                    values (
                      %s, %s, %s,
                      coalesce(%s::timestamptz, now()),
                      now(),
                      greatest(0, floor(extract(epoch from (now() - coalesce(%s::timestamptz, now()))) / 60))::int,
                      'closed', %s, null, %s, %s, coalesce(%s::timestamptz, now()), 'operator_manual_solved'
                    )
                    """,
                    (
                        store_code,
                        db_device_name,
                        device_type,
                        ticket_created_at,
                        ticket_created_at,
                        ticket_url,
                        existing_owner or actor_name,
                        report_tag or None,
                        ticket_created_at,
                    ),
                )

            cursor.execute("delete from crm_device_tickets where upper(device_name) = upper(%s)", (normalized_device,))
            conn.commit()

        broadcast_event("ticket_solved", {
            "source": "operator",
            "device_name": normalized_device,
            "store_code": store_code,
            "device_type": device_type,
            "ticket_url": ticket_url,
        })
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/tickets/{device_name}/reopen")
def reopen_ticket(device_name: str, actorName: str = Query(default="")):
    """Move a solved (closed) ticketed incident back to open so it appears under Reported."""
    normalized_device = device_name.strip()
    if not normalized_device:
        raise HTTPException(status_code=400, detail="deviceName is required")
    actor_name = actorName.strip()
    if not actor_name:
        raise HTTPException(status_code=400, detail="actorName is required")
    device_name_alias = price_checker_ticket_name_alias(normalized_device)

    try:
        with db_cursor() as (conn, cursor):
            cursor.execute(
                """
                select ticket_url, store_code, device_type, device_name
                from crm_device_tickets
                where upper(device_name) = upper(%s)
                   or (%s is not null and upper(device_name) = upper(%s))
                order by
                  case when upper(device_name) = upper(%s) then 0 else 1 end,
                  updated_at desc nulls last
                limit 1
                """,
                (normalized_device, device_name_alias, device_name_alias, normalized_device),
            )
            crm = cursor.fetchone()
            if not crm:
                raise HTTPException(status_code=404, detail="Ticket not found")
            ticket_url = (crm.get("ticket_url") or "").strip()
            if not ticket_url:
                raise HTTPException(status_code=400, detail="Ticket URL is required to reopen")
            store_code = (crm.get("store_code") or "").strip()
            device_type = (crm.get("device_type") or "").strip()
            db_device_name = (crm.get("device_name") or normalized_device).strip()

            cursor.execute(
                """
                select id
                from device_incidents
                where incident_status = 'open'
                  and upper(store_code) = upper(%s)
                  and (
                    upper(device_name) = upper(%s)
                    or (%s is not null and upper(device_name) = upper(%s))
                  )
                limit 1
                """,
                (store_code, db_device_name, device_name_alias, device_name_alias),
            )
            if cursor.fetchone():
                raise HTTPException(
                    status_code=409,
                    detail="An open incident already exists for this device; close or edit it first",
                )

            cursor.execute(
                """
                with target as (
                  select id
                  from device_incidents di
                  where di.incident_status = 'closed'
                    and coalesce(di.crm_ticket_url, '') = %s
                    and (
                      upper(di.device_name) = upper(%s)
                      or (%s is not null and upper(di.device_name) = upper(%s))
                      or (
                        coalesce(%s, '') <> ''
                        and upper(di.store_code) = upper(%s)
                        and coalesce(di.device_type, '') = coalesce(%s, '')
                      )
                    )
                    and (
                      coalesce(di.source_alert, '') = 'operator_manual_solved'
                      or (
                        coalesce(di.source_alert, '') = 'operator'
                        and not (
                          di.offline_started_at is not null
                          and di.offline_started_at < coalesce(di.reported_at, di.updated_at)
                        )
                      )
                    )
                  order by coalesce(di.offline_ended_at, di.updated_at) desc, di.id desc
                  limit 1
                )
                update device_incidents di
                set
                  incident_status = 'open',
                  offline_ended_at = null,
                  duration_minutes = null,
                  updated_at = now()
                from target
                where di.id = target.id
                returning di.id, di.device_name, di.crm_ticket_url, di.incident_status
                """,
                (
                    ticket_url,
                    db_device_name,
                    device_name_alias,
                    device_name_alias,
                    device_type,
                    store_code,
                    device_type,
                ),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        "No closed Non Internet incident with this CRM link to reopen "
                        "(reopen is only for Non Internet Issue reports)"
                    ),
                )
            conn.commit()
        broadcast_event("ticket_reopened", {
            "source": "operator",
            "device_name": db_device_name,
            "store_code": store_code,
            "device_type": device_type,
            "ticket_url": ticket_url,
        })
        return {"ok": True, "incident": normalize_row(row)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def _alertmanager_label_key_lists() -> Tuple[List[str], List[str], List[str]]:
    def split(env_name: str, default: str) -> List[str]:
        raw = os.getenv(env_name, default)
        return [p.strip() for p in raw.split(",") if p.strip()]

    return (
        split("ALERTMANAGER_STORE_LABELS", "store_code,store"),
        split("ALERTMANAGER_DEVICE_LABELS", "device_name,device,instance"),
        split("ALERTMANAGER_DEVICE_TYPE_LABELS", "device_type,type"),
    )


def _first_label_value(labels: Dict[str, Any], keys: List[str]) -> str:
    for k in keys:
        if k in labels and labels[k] is not None:
            v = str(labels[k]).strip()
            if v:
                return v
    return ""


def _alertmanager_alert_event_time(alert_status: str, raw: dict) -> datetime:
    starts_at = parse_iso_datetime(str(raw.get("startsAt") or "").strip())
    ends_at = parse_iso_datetime(str(raw.get("endsAt") or "").strip())
    if alert_status == "firing":
        return starts_at or datetime.now(timezone.utc)
    if ends_at and ends_at.year >= 1972:
        return ends_at
    return starts_at or datetime.now(timezone.utc)


def _is_wan_cascade_dependent_type(device_type: str) -> bool:
    """Devices that are usually unreachable when the store WAN primary is down (panel cascade)."""
    dt = (device_type or "").strip().lower()
    if dt in {
        "price-checkers",
        "music",
        "inside-music",
        "outside-music",
        "switches-primary",
        "switches-secondary",
    }:
        return True
    return dt.startswith("cash-register")


def _resolve_wan_primary_device_name(
    store_code: str,
    device_name: Optional[str],
    source_alert: Optional[str],
) -> str:
    """Full WAN blackout → ARxxxx-INTERNET; primary-only (backup up) → ARxxxx-PRIMARY."""
    dn = (device_name or "").strip().upper()
    sa = (source_alert or "").strip()
    if sa == STORE_WAN_BLACKOUT_ALERT or dn.endswith("-INTERNET"):
        return f"{store_code}-INTERNET"
    return f"{store_code}-PRIMARY"


def _is_internet_blackout_primary_device(device_name: str, source_alert: Optional[str]) -> bool:
    dn = (device_name or "").strip().upper()
    sa = (source_alert or "").strip()
    return sa == STORE_WAN_BLACKOUT_ALERT or dn.endswith("-INTERNET")


def _upgrade_open_primary_to_internet_blackout(
    cursor,
    store_code: str,
    source_alert: Optional[str],
) -> None:
    """Merge open ARxxxx-PRIMARY into ARxxxx-INTERNET when full-store WAN is lost."""
    internet = f"{store_code}-INTERNET"
    primary = f"{store_code}-PRIMARY"
    cursor.execute(
        """
        update device_incidents
        set
          device_name = %s,
          source_alert = coalesce(%s, source_alert),
          updated_at = now()
        where store_code = %s
          and device_type = 'primary-link'
          and incident_status = 'open'
          and upper(device_name) = %s
          and coalesce(crm_ticket_url, '') = ''
        """,
        (internet, source_alert, store_code, primary),
    )


def _close_open_internet_primary_when_primary_only(
    cursor,
    store_code: str,
    event_time: datetime,
) -> None:
    """Primary-down-with-backup-up replaces a prior full-WAN INTERNET row."""
    cursor.execute(
        """
        update device_incidents
        set
          offline_ended_at = %s,
          incident_status = 'closed',
          duration_minutes = greatest(0, floor(extract(epoch from (%s::timestamptz - offline_started_at)) / 60))::int,
          updated_at = now()
        where store_code = %s
          and device_type = 'primary-link'
          and incident_status = 'open'
          and upper(device_name) = %s
          and coalesce(crm_ticket_url, '') = ''
        """,
        (event_time, event_time, store_code, f"{store_code}-INTERNET"),
    )


def _open_primary_is_full_store_wan_loss(cursor, store_code: str) -> bool:
    """
    True if an open primary-link row means the whole store lost usable WAN
    (DeviceStoreNoInternet or legacy rows), not primary-down-with-backup-up.
    """
    cursor.execute(
        """
        select coalesce(source_alert, '') as sa, upper(coalesce(device_name, '')) as dn
        from device_incidents
        where store_code = %s
          and device_type = 'primary-link'
          and incident_status = 'open'
        limit 1
        """,
        (store_code,),
    )
    row = cursor.fetchone()
    if not row:
        return False
    sa = (row.get("sa") or "").strip()
    dn = (row.get("dn") or "").strip()
    if sa == PRIMARY_DOWN_BACKUP_UP_ALERT:
        return False
    if sa == STORE_WAN_BLACKOUT_ALERT or dn.endswith("-INTERNET"):
        return True
    return True


def _is_within_post_primary_recovery_cooldown(
    cursor,
    store_code: str,
    device_type: str,
    status: str,
    event_time: datetime,
) -> bool:
    if status != "offline":
        return False
    if not _is_wan_cascade_dependent_type(device_type):
        return False

    cursor.execute(
        """
        select offline_ended_at
        from device_incidents
        where store_code = %s
          and device_type in ('primary-link', 'backup-link')
          and incident_status = 'closed'
          and offline_ended_at is not null
        order by offline_ended_at desc
        limit 1
        """,
        (store_code,),
    )
    row = cursor.fetchone()
    ended_at = (row or {}).get("offline_ended_at") if row else None
    if not ended_at:
        return False
    return event_time <= (ended_at + timedelta(minutes=POST_PRIMARY_RECOVERY_SUPPRESS_MINUTES))


def _try_close_open_wan_link_unreported_fallback(
    cursor,
    store_code: str,
    device_type: str,
    event_time: datetime,
    source_alert: Optional[str],
) -> Optional[dict]:
    """
    Close one open unreported WAN row for (store, device_type) when the exact
    (store_code, device_name, device_type) update matched nothing.

    Alertmanager \"resolved\" payloads sometimes omit or change `device_name` vs the
    firing alert while labels still identify the link type — then the DB row
    (e.g. AR0021-PRIMARY) never closes and Incidents stays \"offline\" after the
    upstream alert already recovered.
    """
    sa = (source_alert or "").strip()
    if device_type == "primary-link":
        if sa not in (STORE_WAN_BLACKOUT_ALERT, PRIMARY_DOWN_BACKUP_UP_ALERT):
            return None
    elif device_type == "backup-link":
        if sa != BACKUP_LINK_ALERT:
            return None
    else:
        return None

    cursor.execute(
        """
        with pick as (
          select id
          from device_incidents
          where store_code = %s
            and device_type = %s
            and incident_status = 'open'
            and coalesce(crm_ticket_url, '') = ''
          order by offline_started_at asc
          limit 1
        )
        update device_incidents d
        set
          offline_ended_at = %s,
          incident_status = 'closed',
          duration_minutes = greatest(0, floor(extract(epoch from (%s::timestamptz - d.offline_started_at)) / 60))::int,
          updated_at = now()
        from pick
        where d.id = pick.id
        returning d.*
        """,
        (store_code, device_type, event_time, event_time),
    )
    return cursor.fetchone()


def _aware_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _offline_ended_at_qualifies_for_night_gap_merge(ended_at: datetime, new_offline_at: datetime) -> bool:
    """True if offline_ended_at plausibly marks scrape/monitoring gap, not a daytime recovery."""
    e = _aware_utc(ended_at).astimezone(BUCHAREST_TZ)
    n = _aware_utc(new_offline_at).astimezone(BUCHAREST_TZ)
    e_m = e.hour * 60 + e.minute
    if e_m >= MONITORING_END_MINUTES_BUCHAREST:
        return True
    if e_m < MONITORING_START_MINUTES_BUCHAREST and n.date() > e.date():
        return True
    return False


def _new_offline_in_daily_monitoring_window_bucharest(new_offline_at: datetime) -> bool:
    """Aligned with panel: Prometheus live window 07:10 <= local wall time < 21:00."""
    loc = _aware_utc(new_offline_at).astimezone(BUCHAREST_TZ)
    minutes = loc.hour * 60 + loc.minute
    return MONITORING_START_MINUTES_BUCHAREST <= minutes < MONITORING_END_MINUTES_BUCHAREST


# First morning scrapes / Alertmanager often fire at 07:00 local; panel window starts 07:10.
MORNING_REOPEN_MERGE_START_MINUTES_BUCHAREST = 7 * 60  # 07:00


def _new_offline_qualifies_for_overnight_reopen_merge_bucharest(new_offline_at: datetime) -> bool:
    """Wider than the live panel window: allow 07:00 so night-gap reopen matches real Prometheus timing."""
    loc = _aware_utc(new_offline_at).astimezone(BUCHAREST_TZ)
    minutes = loc.hour * 60 + loc.minute
    return MORNING_REOPEN_MERGE_START_MINUTES_BUCHAREST <= minutes < MONITORING_END_MINUTES_BUCHAREST


def _event_time_in_bucharest_monitoring_dead_zone(dt: datetime) -> bool:
    """Outside daily scrape window — RESOLVED here usually means Prometheus stopped, not recovery."""
    return not _new_offline_in_daily_monitoring_window_bucharest(dt)


def _offline_ended_at_is_synthetic_scrape_stop_bucharest(ended_at: datetime) -> bool:
    """Incident closed at/after 21:00 local: almost always monitoring pause, not device recovery."""
    loc = _aware_utc(ended_at).astimezone(BUCHAREST_TZ)
    return loc.hour * 60 + loc.minute >= MONITORING_END_MINUTES_BUCHAREST


def _unreported_device_identity_key(row: Dict[str, Any]) -> str:
    return (row.get("device_name") or "").strip().upper()


def _unreported_real_open_device_keys(rows: List[Dict[str, Any]]) -> Set[str]:
    """Devices that already have a genuine open row in this page (not overlay-reopened)."""
    out: Set[str] = set()
    for row in rows:
        if (row.get("incident_status") or "").strip().lower() != "open":
            continue
        key = _unreported_device_identity_key(row)
        if key:
            out.add(key)
    return out


def _reporting_overlay_unreported_row_as_unresolved_if_synthetic_evening_close(
    row: Dict[str, Any],
    *,
    devices_with_real_open: Optional[Set[str]] = None,
) -> Dict[str, Any]:
    """List/API: show unreported rows still ongoing when end time is the evening scrape cut-off."""
    out = dict(row)
    if (out.get("incident_status") or "").strip().lower() != "closed":
        return out
    ended = out.get("offline_ended_at")
    if not ended or not isinstance(ended, datetime):
        return out
    if not _offline_ended_at_is_synthetic_scrape_stop_bucharest(ended):
        return out
    key = _unreported_device_identity_key(out)
    if devices_with_real_open and key and key in devices_with_real_open:
        return out
    out["incident_status"] = "open"
    out["offline_ended_at"] = None
    out["duration_minutes"] = None
    return out


def _unreported_row_sort_key(row: Dict[str, Any]) -> Tuple[int, float]:
    st = (row.get("incident_status") or "").strip().lower()
    prio = 0 if st == "open" else 1
    started = row.get("offline_started_at")
    if isinstance(started, datetime):
        return (prio, -started.timestamp())
    return (prio, 0.0)


def _should_reopen_after_monitoring_night_gap(ended_at: datetime, new_offline_at: datetime) -> bool:
    if ended_at is None:
        return False
    e = _aware_utc(ended_at)
    n = _aware_utc(new_offline_at)
    if n <= e:
        return False
    gap = n - e
    min_td = timedelta(hours=NIGHT_GAP_REOPEN_MIN_HOURS)
    max_td = timedelta(hours=NIGHT_GAP_REOPEN_MAX_HOURS)
    if gap < min_td or gap > max_td:
        return False
    if not _offline_ended_at_qualifies_for_night_gap_merge(ended_at, new_offline_at):
        return False
    if not _new_offline_qualifies_for_overnight_reopen_merge_bucharest(new_offline_at):
        return False
    return True


def _dedupe_unreported_open_wan_link_rows(cursor, store_code: str, device_type: str) -> None:
    """Keep a single open unreported row per (store, WAN link type); drop newer duplicates."""
    if device_type not in ("primary-link", "backup-link"):
        return
    cursor.execute(
        """
        delete from device_incidents d
        using (
          SELECT id
          FROM (
            SELECT id,
              row_number() OVER (
                PARTITION BY store_code, device_type
                ORDER BY offline_started_at ASC, id ASC
              ) AS rn
            FROM device_incidents
            WHERE store_code = %s
              AND incident_status = 'open'
              AND device_type = %s
              AND coalesce(crm_ticket_url, '') = ''
          ) ranked
          WHERE rn > 1
        ) drop_ids
        WHERE d.id = drop_ids.id
        """,
        (store_code, device_type),
    )


def apply_incident_event(
    store_code: str,
    device_name: str,
    device_type: str,
    status: str,
    event_time: datetime,
    source_alert: Optional[str] = None,
) -> dict:
    """Open or close a device_incidents row (same rules as POST /api/incidents/events)."""
    norm_source_alert = (source_alert or "").strip() or None
    store_code = (store_code or "").strip().upper()
    device_type = (device_type or "").strip()
    if device_type == "primary-link":
        device_name = _resolve_wan_primary_device_name(store_code, device_name, norm_source_alert)
    elif device_type == "backup-link":
        device_name = f"{store_code}-BACKUP"
    else:
        device_name = (device_name or "").strip()
    with db_cursor() as (conn, cursor):
        if _is_within_post_primary_recovery_cooldown(cursor, store_code, device_type, status, event_time):
            return {"incident": None, "action": "suppressed_post_primary_recovery_cooldown"}

        if status == "offline":
            # If primary is already down for the same store, suppress backup incident noise.
            if device_type == "backup-link":
                cursor.execute(
                    """
                    select 1
                    from device_incidents
                    where store_code = %s
                      and device_type = 'primary-link'
                      and incident_status = 'open'
                    limit 1
                    """,
                    (store_code,),
                )
                if cursor.fetchone():
                    return {"incident": None, "action": "suppressed_backup_while_primary_open"}

            # While the store has no usable WAN (not primary-down-with-backup-up), do not open
            # dependent floor-device incidents (Alertmanager inhibit + UI filterCascadeIncidents).
            if _is_wan_cascade_dependent_type(device_type) and _open_primary_is_full_store_wan_loss(
                cursor, store_code
            ):
                return {"incident": None, "action": "suppressed_dependent_while_primary_wan_open"}

            # If primary goes down, keep only primary for that store (close any open backup incident).
            if device_type == "primary-link":
                if _is_internet_blackout_primary_device(device_name, norm_source_alert):
                    _upgrade_open_primary_to_internet_blackout(
                        cursor, store_code, norm_source_alert
                    )
                elif device_name.upper().endswith("-PRIMARY"):
                    _close_open_internet_primary_when_primary_only(
                        cursor, store_code, event_time
                    )
                cursor.execute(
                    """
                    update device_incidents
                    set
                      offline_ended_at = %s,
                      incident_status = 'closed',
                      duration_minutes = greatest(0, floor(extract(epoch from (%s::timestamptz - offline_started_at)) / 60))::int,
                      updated_at = now()
                    where store_code = %s
                      and device_type = 'backup-link'
                      and incident_status = 'open'
                    """,
                    (event_time, event_time, store_code),
                )
                # Fold dependent device noise into the WAN outage (unreported rows only).
                cursor.execute(
                    """
                    update device_incidents
                    set
                      offline_ended_at = %s,
                      incident_status = 'closed',
                      duration_minutes = greatest(0, floor(extract(epoch from (%s::timestamptz - offline_started_at)) / 60))::int,
                      updated_at = now()
                    where store_code = %s
                      and incident_status = 'open'
                      and coalesce(crm_ticket_url, '') = ''
                      and (
                        device_type = 'price-checkers'
                        or device_type = 'music'
                        or device_type in ('inside-music', 'outside-music')
                        or device_type in ('switches-primary', 'switches-secondary')
                        or device_type ilike 'cash-register%%'
                      )
                    """,
                      (event_time, event_time, store_code),
                )

            if device_type in ("primary-link", "backup-link"):
                _dedupe_unreported_open_wan_link_rows(cursor, store_code, device_type)
                cursor.execute(
                    """
                    update device_incidents
                    set device_name = %s, updated_at = now()
                    where store_code = %s
                      and device_type = %s
                      and incident_status = 'open'
                      and coalesce(crm_ticket_url, '') = ''
                      and device_name is distinct from %s
                    """,
                    (device_name, store_code, device_type, device_name),
                )

            # Flap merge: when the same unreported incident recovered and drops
            # again shortly after, continue the previous downtime window.
            cursor.execute(
                """
                with recent_closed as (
                  select id
                  from device_incidents
                  where store_code = %s
                    and device_name = %s
                    and device_type = %s
                    and incident_status = 'closed'
                    and coalesce(crm_ticket_url, '') = ''
                    and offline_ended_at is not null
                    and %s::timestamptz >= offline_ended_at
                    and %s::timestamptz <= offline_ended_at + (%s * interval '1 minute')
                  order by offline_ended_at desc, id desc
                  limit 1
                )
                update device_incidents d
                set
                  incident_status = 'open',
                  offline_ended_at = null,
                  duration_minutes = null,
                  source_alert = coalesce(%s, d.source_alert),
                  updated_at = now()
                from recent_closed
                where d.id = recent_closed.id
                returning d.*
                """,
                (
                    store_code,
                    device_name,
                    device_type,
                    event_time,
                    event_time,
                    INCIDENT_REOPEN_FLAP_WINDOW_MINUTES,
                    norm_source_alert,
                ),
            )
            reopened = cursor.fetchone()
            if reopened:
                conn.commit()
                return {"incident": normalize_row(reopened), "action": "reopened_within_flap_window"}

            # Overnight monitoring gap: Prometheus/Alertmanager often closes at ~21:00
            # and re-fires at ~07:00 for the same outage — continue the same row.
            cursor.execute(
                """
                select id, offline_ended_at
                from device_incidents
                where store_code = %s
                  and device_name = %s
                  and device_type = %s
                  and incident_status = 'closed'
                  and coalesce(crm_ticket_url, '') = ''
                  and offline_ended_at is not null
                  and offline_ended_at < %s::timestamptz
                order by offline_ended_at desc, id desc
                limit 1
                """,
                (store_code, device_name, device_type, event_time),
            )
            last_close = cursor.fetchone()
            if last_close and _should_reopen_after_monitoring_night_gap(
                last_close["offline_ended_at"], event_time
            ):
                cursor.execute(
                    """
                    update device_incidents
                    set
                      incident_status = 'open',
                      offline_ended_at = null,
                      duration_minutes = null,
                      source_alert = coalesce(%s, source_alert),
                      updated_at = now()
                    where id = %s
                    returning *
                    """,
                    (norm_source_alert, last_close["id"]),
                )
                merged = cursor.fetchone()
                if merged:
                    conn.commit()
                    return {
                        "incident": normalize_row(merged),
                        "action": "reopened_after_overnight_monitoring_gap",
                    }

            cursor.execute(
                """
                insert into device_incidents (
                  store_code, device_name, device_type, offline_started_at, incident_status, source_alert
                )
                values (%s, %s, %s, %s, 'open', %s)
                on conflict (store_code, device_name, incident_status)
                where incident_status = 'open'
                do update set
                  updated_at = now(),
                  source_alert = coalesce(excluded.source_alert, device_incidents.source_alert)
                returning *
                """,
                (store_code, device_name, device_type, event_time, norm_source_alert),
            )
            row = cursor.fetchone()
            conn.commit()
            return {"incident": normalize_row(row), "action": "opened_or_deduplicated"}

        # Overnight scrape gap: for WAN links only, RESOLVED outside the live panel window
        # usually means Prometheus stopped, not a real recovery — keep the row open.
        # Peripherals (price checkers, switches, music, cash registers) still close here;
        # otherwise Alertmanager `resolved` at e.g. 22:00 never updates DB and the UI shows
        # stale "open" rows while metrics already show the device up.
        if device_type in ("primary-link", "backup-link") and _event_time_in_bucharest_monitoring_dead_zone(
            event_time
        ):
            return {"incident": None, "action": "suppressed_close_during_monitoring_gap"}

        # Cleanup-on-close policy: if the device comes back online and the operator
        # never linked a CRM ticket AND the outage lasted under
        # MIN_INCIDENT_DURATION_PERSIST_MINUTES, drop the row entirely so short
        # flaps don't pollute Reporting/Live counters. Outages >= threshold stay
        # as historical "unreported" evidence; reported incidents (with
        # crm_ticket_url) are always preserved and closed normally below.
        cursor.execute(
            """
            delete from device_incidents
            where store_code = %s
              and device_name = %s
              and device_type = %s
              and incident_status = 'open'
              and coalesce(crm_ticket_url, '') = ''
              and greatest(0, floor(extract(epoch from (%s::timestamptz - offline_started_at)) / 60))::int < %s
            returning id
            """,
            (
                store_code,
                device_name,
                device_type,
                event_time,
                MIN_INCIDENT_DURATION_PERSIST_MINUTES,
            ),
        )
        if cursor.fetchone():
            conn.commit()
            return {"incident": None, "action": "discarded_short_unreported"}

        cursor.execute(
            """
            update device_incidents
            set
              offline_ended_at = %s,
              incident_status = 'closed',
              duration_minutes = greatest(0, floor(extract(epoch from (%s::timestamptz - offline_started_at)) / 60))::int,
              updated_at = now()
            where store_code = %s
              and device_name = %s
              and device_type = %s
              and incident_status = 'open'
            returning *
            """,
            (event_time, event_time, store_code, device_name, device_type),
        )
        row = cursor.fetchone()
        if not row:
            row = _try_close_open_wan_link_unreported_fallback(
                cursor, store_code, device_type, event_time, norm_source_alert
            )
            action = "closed_wan_fallback" if row else "no_open_incident"
        else:
            action = "closed"
        conn.commit()
        return {"incident": normalize_row(row) if row else None, "action": action}


@app.post("/api/incidents/events")
def incident_event(payload: IncidentEventPayload):
    store_code = payload.storeCode.strip().upper()
    device_name = payload.deviceName.strip()
    device_type = payload.deviceType.strip()
    status = payload.status.strip().lower()
    event_time = payload.eventTime or datetime.now(timezone.utc)

    if not store_code or not device_name or not device_type:
        raise HTTPException(status_code=400, detail="storeCode, deviceName and deviceType are required")
    if status not in ("offline", "online"):
        raise HTTPException(status_code=400, detail="status must be offline or online")

    try:
        src = (payload.sourceAlert or "").strip() or None
        result = apply_incident_event(store_code, device_name, device_type, status, event_time, source_alert=src)
        broadcast_event("incident_changed", {
            "source": "alertmanager",
            "store_code": store_code,
            "device_name": device_name,
            "device_type": device_type,
            "status": status,
            "action": (result or {}).get("action"),
        })
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/incidents/alertmanager")
async def incident_alertmanager_webhook(
    request: Request,
    x_webhook_token: Optional[str] = Header(default=None, alias="X-Webhook-Token"),
    authorization: Optional[str] = Header(default=None),
):
    """
    Alertmanager webhook (v4). Maps each alert to POST /api/incidents/events semantics:
    - alert status firing  -> offline (opens incident, startsAt -> offline_started_at)
    - alert status resolved -> online (closes incident)

    Configure Prometheus labels on the rule (recommended): store_code, device_name, device_type.
    Override label names via env ALERTMANAGER_STORE_LABELS, ALERTMANAGER_DEVICE_LABELS,
    ALERTMANAGER_DEVICE_TYPE_LABELS (comma-separated keys, first match wins).
    Optional: ALERTMANAGER_WEBHOOK_TOKEN — send X-Webhook-Token, or Authorization: Bearer <token>.
    """
    expected = (os.getenv("ALERTMANAGER_WEBHOOK_TOKEN") or "").strip()
    if expected:
        from_header = (x_webhook_token or "").strip()
        bearer = ""
        auth = (authorization or "").strip()
        if auth.lower().startswith("bearer "):
            bearer = auth[7:].strip()
        if from_header != expected and bearer != expected:
            raise HTTPException(
                status_code=401,
                detail="invalid or missing webhook token (X-Webhook-Token or Authorization: Bearer)",
            )

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")

    alerts = body.get("alerts")
    if not isinstance(alerts, list):
        raise HTTPException(status_code=400, detail="body must contain an alerts array")

    common = body.get("commonLabels")
    if not isinstance(common, dict):
        common = {}

    store_keys, device_keys, dtype_keys = _alertmanager_label_key_lists()
    default_dtype = (os.getenv("ALERTMANAGER_DEFAULT_DEVICE_TYPE") or "generic").strip() or "generic"

    results: List[dict] = []
    skipped: List[dict] = []

    for raw in alerts:
        if not isinstance(raw, dict):
            skipped.append({"reason": "alert is not an object"})
            continue

        alert_labels = raw.get("labels")
        if not isinstance(alert_labels, dict):
            alert_labels = {}
        alert_annotations = raw.get("annotations")
        if not isinstance(alert_annotations, dict):
            alert_annotations = {}

        labels: Dict[str, Any] = {**common, **alert_labels}

        astatus = str(raw.get("status") or "").lower()
        if astatus not in ("firing", "resolved"):
            skipped.append({"reason": "alert status not firing/resolved", "labels": labels})
            continue

        evt_status = "offline" if astatus == "firing" else "online"
        event_time = _alertmanager_alert_event_time(astatus, raw)

        device_name = _first_label_value(labels, device_keys)
        if not device_name:
            # Some Prometheus alerts keep device identity in annotations only.
            device_name = _first_label_value(
                alert_annotations,
                ["device_name", "device", "instance", "target", "hostname"],
            )
        if not device_name:
            skipped.append({"reason": "missing device label", "labels": labels})
            continue

        raw_store = _first_label_value(labels, store_keys)
        store_code = normalize_store_code(raw_store) if raw_store else ""
        if not store_code:
            store_code = parse_store_from_device_name(device_name) or ""
        if not store_code:
            skipped.append({"reason": "missing store (label or derivable from device_name)", "labels": labels})
            continue
        store_code = store_code.strip().upper()

        device_type = _first_label_value(labels, dtype_keys) or default_dtype
        device_type = device_type.strip()
        device_name = device_name.strip()

        alert_nm = (labels.get("alertname") or "").strip() or None
        if alert_nm == STORE_WAN_BLACKOUT_ALERT and store_code:
            device_name = f"{store_code}-INTERNET"
            device_type = "primary-link"
        try:
            out = apply_incident_event(
                store_code, device_name, device_type, evt_status, event_time, source_alert=alert_nm
            )
            results.append(
                {
                    "storeCode": store_code,
                    "deviceName": device_name,
                    "deviceType": device_type,
                    "mappedStatus": evt_status,
                    **out,
                }
            )
        except Exception as exc:
            skipped.append(
                {
                    "storeCode": store_code,
                    "deviceName": device_name,
                    "error": str(exc),
                }
            )

    if results:
        broadcast_event("incident_changed", {
            "source": "alertmanager_webhook",
            "processed": len(results),
            "groupKey": body.get("groupKey"),
        })

    return {
        "ok": True,
        "receiver": body.get("receiver"),
        "groupKey": body.get("groupKey"),
        "processed": len(results),
        "skipped": len(skipped),
        "results": results,
        "skippedDetails": skipped,
    }


@app.get("/api/reporting/overview")
def reporting_overview(
    days: int = Query(default=30, ge=1, le=365),
    from_ms: Optional[int] = Query(default=None),
    to_ms: Optional[int] = Query(default=None),
):
    days = normalize_days(days)
    from_ts = parse_epoch_ms(from_ms)
    to_ts = parse_epoch_ms(to_ms)
    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute(
                f"""
                with base as (
                  select *
                  from device_incidents
                  where offline_started_at <= coalesce(%s::timestamptz, now())
                    and (
                      offline_ended_at is null
                      or offline_ended_at >= coalesce(%s::timestamptz, now() - (%s * interval '1 day'))
                      or {_SYNTHETIC_EVENING_CLOSE_SQL}
                    )
                )
                select
                  count(*) as incidents_total,
                  count(*) filter (where incident_status = 'open') as incidents_open,
                  count(*) filter (where incident_status = 'closed') as incidents_closed,
                  count(*) filter (
                    where not ({_sql_incident_is_reported('')})
                      and (
                        incident_status = 'open'
                        or coalesce(duration_minutes, 0) >= %s
                      )
                  ) as incidents_unreported,
                  count(*) filter (
                    where ({_sql_incident_is_reported('')})
                  ) as incidents_reported,
                  round(avg(duration_minutes) filter (where incident_status = 'closed'), 2) as mttr_minutes
                from base
                """,
                (to_ts, from_ts, days, MIN_INCIDENT_DURATION_PERSIST_MINUTES),
            )
            row = cursor.fetchone()
        return {"overview": normalize_row(row), "days": days, "from_ms": from_ms, "to_ms": to_ms}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


_SYNTHETIC_EVENING_CLOSE_SQL = f"""
(
  incident_status = 'closed'
  and offline_ended_at is not null
  and (
    extract(hour from timezone('Europe/Bucharest', offline_ended_at))::int * 60
    + extract(minute from timezone('Europe/Bucharest', offline_ended_at))::int
  ) >= {MONITORING_END_MINUTES_BUCHAREST}
)
"""


_UNREPORTED_LIST_WHERE = f"""
                from device_incidents
                where offline_started_at <= coalesce(%s::timestamptz, now())
                  and (
                    offline_ended_at is null
                    or offline_ended_at >= coalesce(%s::timestamptz, now() - (%s * interval '1 day'))
                    or {_SYNTHETIC_EVENING_CLOSE_SQL}
                  )
                  and not ({_sql_incident_is_reported('')})
                  and (
                    incident_status = 'open'
                    or coalesce(duration_minutes, 0) >= %s
                  )
"""


@app.get("/api/reporting/unreported")
def reporting_unreported(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=200, ge=1, le=2000),
    offset: int = Query(default=0, ge=0, le=100000),
    from_ms: Optional[int] = Query(default=None),
    to_ms: Optional[int] = Query(default=None),
):
    days = normalize_days(days)
    from_ts = parse_epoch_ms(from_ms)
    to_ts = parse_epoch_ms(to_ms)
    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute(
                f"""
                select count(*)::bigint as n
                {_UNREPORTED_LIST_WHERE}
                """,
                (to_ts, from_ts, days, MIN_INCIDENT_DURATION_PERSIST_MINUTES),
            )
            total_row = cursor.fetchone()
            total = int(total_row["n"]) if total_row and total_row.get("n") is not None else 0

            cursor.execute(
                f"""
                select
                  id as incident_id,
                  store_code,
                  device_name,
                  device_type,
                  incident_status,
                  offline_started_at,
                  offline_ended_at,
                  duration_minutes,
                  source_alert,
                  report_tag
                {_UNREPORTED_LIST_WHERE}
                order by
                  case when incident_status = 'open' then 0 else 1 end,
                  offline_started_at desc
                limit %s offset %s
                """,
                (to_ts, from_ts, days, MIN_INCIDENT_DURATION_PERSIST_MINUTES, limit, offset),
            )
            rows = cursor.fetchall()
        raw_rows = [dict(row) for row in rows]
        real_open_device_keys = _unreported_real_open_device_keys(raw_rows)
        overlaid = [
            _reporting_overlay_unreported_row_as_unresolved_if_synthetic_evening_close(
                row,
                devices_with_real_open=real_open_device_keys,
            )
            for row in raw_rows
        ]
        overlaid.sort(key=_unreported_row_sort_key)
        returned = len(overlaid)
        has_more = (offset + returned) < total
        return {
            "rows": [normalize_row(row) for row in overlaid],
            "days": days,
            "from_ms": from_ms,
            "to_ms": to_ms,
            "total": total,
            "limit": limit,
            "offset": offset,
            "returned": returned,
            "has_more": has_more,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# Single CTE that materialises one "reported" row per incident with all fields the
# UI cares about. Pulls owner/reported_at directly from device_incidents (operators
# write them there via /api/tickets), so no LATERAL JOIN against crm_device_tickets
# per row — that join was the dominant cost on this endpoint.
#
# Three flavours, controlled by `mode`:
#   - "open"   → only currently-open ticketed incidents (Live page → Reported).
#                Plus operator-filed tickets without a matching incident.
#   - "all"    → open + closed ticketed incidents (Reporting page → Reported
#                Tickets — full ledger of every report ever filed in window).
#                Plus operator-filed tickets without a matching incident.
#   - "closed" → only closed ticketed incidents (Live page → Solved /
#                Reporting page → Solved). NO manual-ticket UNION because a
#                solved row by definition has an offline_ended_at.
#
# report_source: `source_alert = 'operator'` is set on synthetic INSERT when PUT
# /tickets finds no incident (e.g. name mismatch). Price-checker P vs PC aliases
# are matched so we usually UPDATE the real alert-driven row instead. If operator
# is still set, real outages have offline_started_at before reported_at; synthetic
# rows use ~identical timestamps.
def _reported_rows_cte(mode: str) -> str:
    if mode == "closed":
        status_clause = "and di.incident_status = 'closed'"
    elif mode == "open":
        status_clause = "and di.incident_status = 'open'"
    elif mode == "all":
        status_clause = ""
    else:
        raise ValueError(f"Unknown reported CTE mode: {mode!r}")
    only_open = mode != "closed"
    resolve_clause = (
        "case when di.incident_status = 'closed' and di.offline_ended_at is not null then "
        "greatest(0, floor(extract(epoch from (di.offline_ended_at - coalesce(di.reported_at, di.updated_at))) / 60))::int "
        "else null end"
    )
    base_select = f"""
          select
            di.store_code,
            di.device_name,
            di.device_type,
            di.owner_name,
            di.report_tag,
            di.crm_ticket_url as ticket_url,
            coalesce(di.reported_at, di.updated_at) as created_at,
            di.updated_at,
            di.offline_started_at as incident_offline_started_at,
            coalesce(di.reported_at, di.updated_at) as incident_reported_at,
            greatest(
              0,
              floor(extract(epoch from (coalesce(di.reported_at, di.updated_at) - di.offline_started_at)) / 60)
            )::int as time_to_report_minutes,
            {resolve_clause} as report_to_resolve_minutes,
            di.id as incident_id,
            di.incident_status,
            di.source_alert,
            case
              when coalesce(di.source_alert, '') = 'operator_manual_solved'
                then 'crm_manual'::text
              when coalesce(di.source_alert, '') = 'operator'
                and di.offline_started_at is not null
                and di.offline_started_at < coalesce(di.reported_at, di.updated_at)
                then 'crm'::text
              when coalesce(di.source_alert, '') = 'operator'
                then 'crm_manual'::text
              else 'crm'::text
            end as report_source
          from device_incidents di
          where di.offline_started_at <= coalesce(%s::timestamptz, now())
            and (
              di.offline_ended_at is null
              or di.offline_ended_at >= coalesce(%s::timestamptz, now() - (%s * interval '1 day'))
            )
            and ({_sql_incident_is_reported('di')})
            {status_clause}
    """
    if not only_open:
        return f"""
        with rows_cte as (
          select *, count(*) over () as total_count
          from (
            {base_select}
          ) base
        )
        """
    # Reported tab also surfaces tickets that have no matching incident yet —
    # operator pre-files a CRM URL for a device the pipeline has never seen
    # offline. Without this branch the freshly-saved ticket would be invisible
    # until Alertmanager opens an incident and put_ticket links the URL onto it.
    return f"""
        with rows_cte as (
          select *, count(*) over () as total_count
          from (
            {base_select}
            union all
            select
              t.store_code,
              t.device_name,
              t.device_type,
              nullif(trim(t.owner_name), '') as owner_name,
              t.report_tag,
              t.ticket_url,
              t.created_at,
              t.updated_at,
              null::timestamptz as incident_offline_started_at,
              t.created_at as incident_reported_at,
              null::int as time_to_report_minutes,
              null::int as report_to_resolve_minutes,
              null::bigint as incident_id,
              null::text as incident_status,
              null::text as source_alert,
              'crm_manual'::text as report_source
            from crm_device_tickets t
            where t.created_at <= coalesce(%s::timestamptz, now())
              and t.created_at >= coalesce(%s::timestamptz, now() - (%s * interval '1 day'))
              and coalesce(t.ticket_url, '') <> ''
              and not exists (
                select 1 from device_incidents di2
                where coalesce(di2.crm_ticket_url, '') = coalesce(t.ticket_url, '')
                  and upper(di2.device_name) = upper(t.device_name)
              )
          ) base
        )
        """


def _paginated_reporting_response(
    rows: List[dict],
    days: int,
    from_ms: Optional[int],
    to_ms: Optional[int],
    limit: int,
    offset: int,
) -> dict:
    """Same response shape as before. total/has_more are read from the count(*) over()
    that travels alongside the page rows so the heavy CTE only runs once."""
    total = int(rows[0]["total_count"]) if rows and rows[0].get("total_count") is not None else 0
    out_rows = [normalize_row({k: v for k, v in row.items() if k != "total_count"}) for row in rows]
    returned = len(out_rows)
    return {
        "rows": out_rows,
        "days": days,
        "from_ms": from_ms,
        "to_ms": to_ms,
        "total": total,
        "limit": limit,
        "offset": offset,
        "returned": returned,
        "has_more": (offset + returned) < total,
    }


_REPORTED_STATUS_MODES = {"open", "all", "closed"}


@app.get("/api/reporting/reported")
def reporting_reported(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=200, ge=1, le=2000),
    offset: int = Query(default=0, ge=0, le=100000),
    from_ms: Optional[int] = Query(default=None),
    to_ms: Optional[int] = Query(default=None),
    status: str = Query(default="open"),
):
    """Reported tickets.

    `status=open`  → Live page Reported section (default). Only currently
                     offline incidents that have been reported.
    `status=all`   → Reporting page Reported Tickets table. Full ledger of
                     reports filed in the window, regardless of whether the
                     incident is still open or has since been resolved.
    `status=closed`→ Same as /api/reporting/solved (kept for symmetry).
    """
    if status not in _REPORTED_STATUS_MODES:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(_REPORTED_STATUS_MODES)}")
    days = normalize_days(days)
    from_ts = parse_epoch_ms(from_ms)
    to_ts = parse_epoch_ms(to_ms)
    # "closed" mode doesn't UNION manual tickets, so it only needs 3 binds.
    if status == "closed":
        binds: tuple = (to_ts, from_ts, days, limit, offset)
    else:
        # 6 placeholders: 3 for the device_incidents window + 3 for the
        # crm_device_tickets manual-ticket window (same range bounds).
        binds = (to_ts, from_ts, days, to_ts, from_ts, days, limit, offset)
    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute(
                f"""
                {_reported_rows_cte(mode=status)}
                select * from rows_cte
                order by created_at desc nulls last
                limit %s offset %s
                """,
                binds,
            )
            rows = cursor.fetchall()
        return _paginated_reporting_response(rows, days, from_ms, to_ms, limit, offset)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/reporting/solved")
def reporting_solved(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=200, ge=1, le=2000),
    offset: int = Query(default=0, ge=0, le=100000),
    from_ms: Optional[int] = Query(default=None),
    to_ms: Optional[int] = Query(default=None),
):
    days = normalize_days(days)
    from_ts = parse_epoch_ms(from_ms)
    to_ts = parse_epoch_ms(to_ms)
    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute(
                f"""
                {_reported_rows_cte(mode='closed')}
                select * from rows_cte
                order by updated_at desc nulls last
                limit %s offset %s
                """,
                (to_ts, from_ts, days, limit, offset),
            )
            rows = cursor.fetchall()
        return _paginated_reporting_response(rows, days, from_ms, to_ms, limit, offset)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


_TIME_TO_REPORT_EXPR = (
    "case when di.reported_at is null then null else greatest("
    "0, floor(extract(epoch from (di.reported_at - di.offline_started_at)) / 60)"
    ")::int end"
)
_REPORT_TO_RESOLVE_EXPR = (
    "case when di.incident_status = 'closed' and di.offline_ended_at is not null and di.reported_at is not null "
    "then greatest(0, floor(extract(epoch from (di.offline_ended_at - di.reported_at)) / 60))::int "
    "else null end"
)
_OPEN_DOWNTIME_EXPR = (
    "case when incident_status = 'open' then greatest(0, floor(extract(epoch from (now() - offline_started_at)) / 60))::int "
    "else coalesce(duration_minutes, 0) end"
)


_INTERNET_ISSUE_SQL = """
    (
      lower(coalesce(di.device_type, '')) in ('primary-link', 'backup-link')
      or upper(coalesce(di.device_name, '')) like '%%-INTERNET'
    )
"""


@app.get("/api/reporting/internet-power-outage")
def reporting_internet_power_outage(
    days: int = Query(default=30, ge=1, le=365),
    from_ms: Optional[int] = Query(default=None),
    to_ms: Optional[int] = Query(default=None),
    tag: str = Query(default="power-outage"),
):
    """Internet Down incidents/tickets tagged power-outage or planned overlapping the report window.

    Used by Offline Time Report to subtract credited outage minutes from Prometheus
    internet downtime (ref Z) when operators filed a power-outage report, and to
    surface planned maintenance minutes in tooltips.
    """
    report_tag = str(tag or "power-outage").strip().lower()
    if report_tag not in INTERNET_REPORT_TAGS_NO_TICKET_REQUIRED:
        raise HTTPException(
            status_code=400,
            detail=f"tag must be one of: {', '.join(sorted(INTERNET_REPORT_TAGS_NO_TICKET_REQUIRED))}",
        )
    days = normalize_days(days)
    from_ts = parse_epoch_ms(from_ms)
    to_ts = parse_epoch_ms(to_ms)
    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute(
                f"""
                select
                  di.store_code,
                  di.device_name,
                  di.device_type,
                  di.report_tag,
                  di.offline_started_at,
                  di.offline_ended_at,
                  di.incident_status
                from device_incidents di
                where lower(trim(coalesce(di.report_tag, ''))) = %s
                  and {_INTERNET_ISSUE_SQL}
                  and di.offline_started_at is not null
                  and di.offline_started_at <= coalesce(%s::timestamptz, now())
                  and (
                    di.offline_ended_at is null
                    or di.offline_ended_at >= coalesce(%s::timestamptz, now() - (%s * interval '1 day'))
                  )
                order by di.offline_started_at desc
                """,
                (report_tag, to_ts, from_ts, days),
            )
            rows = cursor.fetchall()
        return {
            "rows": [normalize_row(row) for row in rows],
            "days": days,
            "from_ms": from_ms,
            "to_ms": to_ms,
            "tag": report_tag,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/reporting/top-stores")
def reporting_top_stores(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=50, ge=1, le=500),
    from_ms: Optional[int] = Query(default=None),
    to_ms: Optional[int] = Query(default=None),
):
    days = normalize_days(days)
    from_ts = parse_epoch_ms(from_ms)
    to_ts = parse_epoch_ms(to_ms)
    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute(
                f"""
                with base as (
                  select
                    di.*,
                    {_TIME_TO_REPORT_EXPR} as time_to_report_minutes,
                    {_REPORT_TO_RESOLVE_EXPR} as report_to_resolve_minutes
                  from device_incidents di
                  where di.offline_started_at <= coalesce(%s::timestamptz, now())
                    and (
                      di.offline_ended_at is null
                      or di.offline_ended_at >= coalesce(%s::timestamptz, now() - (%s * interval '1 day'))
                    )
                )
                select
                  store_code,
                  count(*) as incidents,
                  sum({_OPEN_DOWNTIME_EXPR}) as downtime_minutes,
                  round(avg(duration_minutes) filter (where incident_status = 'closed'), 2) as mttr_minutes,
                  round(avg(time_to_report_minutes) filter (where time_to_report_minutes is not null), 2) as time_to_report_avg_minutes,
                  round(avg(report_to_resolve_minutes) filter (where report_to_resolve_minutes is not null), 2) as report_to_resolve_avg_minutes
                from base
                group by store_code
                order by downtime_minutes desc
                limit %s
                """,
                (to_ts, from_ts, days, limit),
            )
            rows = cursor.fetchall()
        return {"rows": [normalize_row(row) for row in rows], "days": days, "from_ms": from_ms, "to_ms": to_ms}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/reporting/top-device-categories")
def reporting_top_device_categories(
    days: int = Query(default=30, ge=1, le=365),
    from_ms: Optional[int] = Query(default=None),
    to_ms: Optional[int] = Query(default=None),
):
    """Aggregate incidents in the reporting window by fixed device category.

    Only `device_incidents` rows whose offline window overlaps the report
    range are considered (same date logic as `/api/reporting/top-stores`).

    NOTE: the per-category `incidents` count returned here is the *raw* number
    of incident rows in window — it intentionally does **not** apply the
    client-side display filters the UI runs over the Unreported list
    (cascade-mask, per-type displayed-downtime threshold, stale-open-while-
    live-up). The Reporting page recomputes the `incidents` field on the
    client from the same filtered rows the lists render so the displayed
    count matches "Unreported + Reported + Solved" exactly. The other metric
    fields (downtime, mttr, time-to-report, report-to-resolve) are still
    derived here from the full set of in-window incidents so server-side
    aggregations remain comparable across pages.
    """
    days = normalize_days(days)
    from_ts = parse_epoch_ms(from_ms)
    to_ts = parse_epoch_ms(to_ms)
    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute(
                f"""
                with base as (
                  select
                    di.*,
                    {_TIME_TO_REPORT_EXPR} as time_to_report_minutes,
                    {_REPORT_TO_RESOLVE_EXPR} as report_to_resolve_minutes,
                    case
                      when device_type = 'primary-link' then 'Primary'
                      when device_type = 'backup-link' then 'Backup'
                      when device_type = 'price-checkers' then 'Price Checkers'
                      when device_type in ('music', 'inside-music', 'outside-music') then 'Music'
                      when device_type ilike 'cash-register%%' then 'Cash Registers'
                      when device_type in ('switches-primary', 'switches-secondary') then 'Switches'
                      else null
                    end as device_category
                  from device_incidents di
                  where di.offline_started_at <= coalesce(%s::timestamptz, now())
                    and (
                      di.offline_ended_at is null
                      or di.offline_ended_at >= coalesce(%s::timestamptz, now() - (%s * interval '1 day'))
                    )
                ),
                agg as (
                  select
                    device_category,
                    count(*)::bigint as incidents,
                    sum({_OPEN_DOWNTIME_EXPR})::bigint as downtime_minutes,
                    round(avg(duration_minutes) filter (where incident_status = 'closed'), 2) as mttr_minutes,
                    round(avg(time_to_report_minutes) filter (where time_to_report_minutes is not null), 2) as time_to_report_avg_minutes,
                    round(avg(report_to_resolve_minutes) filter (where report_to_resolve_minutes is not null), 2) as report_to_resolve_avg_minutes
                  from base
                  where device_category is not null
                  group by device_category
                ),
                cats as (
                  select * from (
                    values
                      ('Primary', 1),
                      ('Backup', 2),
                      ('Price Checkers', 3),
                      ('Music', 4),
                      ('Cash Registers', 5),
                      ('Switches', 6)
                  ) as x(device_category, sort_order)
                )
                select
                  c.device_category,
                  coalesce(a.incidents, 0)::bigint as incidents,
                  coalesce(a.downtime_minutes, 0)::bigint as downtime_minutes,
                  a.mttr_minutes,
                  a.time_to_report_avg_minutes,
                  a.report_to_resolve_avg_minutes
                from cats c
                left join agg a on a.device_category = c.device_category
                order by c.sort_order
                """,
                (to_ts, from_ts, days),
            )
            rows = cursor.fetchall()
        return {"rows": [normalize_row(row) for row in rows], "days": days, "from_ms": from_ms, "to_ms": to_ms}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/reporting/owner-workload")
def reporting_owner_workload(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=50, ge=1, le=500),
    from_ms: Optional[int] = Query(default=None),
    to_ms: Optional[int] = Query(default=None),
):
    days = normalize_days(days)
    from_ts = parse_epoch_ms(from_ms)
    to_ts = parse_epoch_ms(to_ms)
    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute(
                """
                with reported_incidents as (
                  select
                    di.owner_name,
                    coalesce(di.reported_at, di.updated_at) as reported_at
                  from device_incidents di
                  where di.offline_started_at <= coalesce(%s::timestamptz, now())
                    and (
                      di.offline_ended_at is null
                      or di.offline_ended_at >= coalesce(%s::timestamptz, now() - (%s * interval '1 day'))
                    )
                    and coalesce(di.crm_ticket_url, '') <> ''
                  union all
                  select
                    nullif(trim(t.owner_name), '') as owner_name,
                    t.created_at as reported_at
                  from crm_device_tickets t
                  where t.created_at <= coalesce(%s::timestamptz, now())
                    and t.created_at >= coalesce(%s::timestamptz, now() - (%s * interval '1 day'))
                    and coalesce(t.ticket_url, '') <> ''
                    and not exists (
                      select 1 from device_incidents di2
                      where coalesce(di2.crm_ticket_url, '') = coalesce(t.ticket_url, '')
                        and (
                          upper(di2.device_name) = upper(t.device_name)
                          or (
                            upper(di2.store_code) = upper(t.store_code)
                            and coalesce(di2.device_type, '') = coalesce(t.device_type, '')
                          )
                        )
                    )
                )
                select
                  coalesce(nullif(trim(owner_name), ''), 'Unassigned') as owner_name,
                  count(*)::bigint as ticket_count,
                  max(reported_at) as last_update
                from reported_incidents
                group by coalesce(nullif(trim(owner_name), ''), 'Unassigned')
                order by ticket_count desc, last_update desc
                limit %s
                """,
                (to_ts, from_ts, days, to_ts, from_ts, days, limit),
            )
            rows = cursor.fetchall()
        return {"rows": [normalize_row(row) for row in rows], "days": days, "from_ms": from_ms, "to_ms": to_ms}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# =============================================================================
# Router Status Timeline — operator reports + update notes (Grafana_site page).
# =============================================================================

ROUTER_TIMELINE_CATEGORIES = frozenset({"Network", "Power Outage", "Planned", "Other"})


def _validate_router_timeline_category(category: str) -> str:
    cat = (category or "").strip()
    if cat not in ROUTER_TIMELINE_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"category must be one of {sorted(ROUTER_TIMELINE_CATEGORIES)}",
        )
    return cat


def _router_timeline_updates_subquery() -> str:
    return """
        coalesce(
          (
            select json_agg(
              json_build_object(
                'id', u.id,
                'author_name', u.author_name,
                'author_login', u.author_login,
                'body', u.body,
                'created_at', u.created_at,
                'updated_at', u.updated_at
              )
              order by u.created_at desc
            )
            from router_timeline_report_updates u
            where u.report_id = r.id
          ),
          '[]'::json
        ) as updates
    """


def _serialize_router_timeline_report(row: dict) -> dict:
    if not row:
        return row
    out = normalize_row(row)
    updates = out.pop("updates", None)
    if isinstance(updates, str):
        try:
            updates = json.loads(updates)
        except Exception:
            updates = []
    if not isinstance(updates, list):
        updates = []
    out["updates"] = [normalize_row(u) if isinstance(u, dict) else u for u in updates]
    return out


class RouterTimelineReportCreate(BaseModel):
    storeCode: str
    category: str
    description: str
    reporterName: str
    reporterLogin: Optional[str] = ""
    reportedAtMs: Optional[int] = None
    timelineStartMs: Optional[int] = None
    timelineEndMs: Optional[int] = None
    resolved: bool = False


class RouterTimelineReportUpdate(BaseModel):
    storeCode: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    reporterName: Optional[str] = None
    reporterLogin: Optional[str] = None
    reportedAtMs: Optional[int] = None
    timelineStartMs: Optional[int] = None
    timelineEndMs: Optional[int] = None
    resolved: Optional[bool] = None
    resolvedAuto: Optional[bool] = None


class RouterTimelineResolvedPatch(BaseModel):
    resolved: bool = True
    resolvedAuto: bool = False


class RouterTimelineUpdateCreate(BaseModel):
    authorName: str
    authorLogin: Optional[str] = ""
    body: str


class RouterTimelineUpdatePatch(BaseModel):
    authorName: Optional[str] = None
    authorLogin: Optional[str] = None
    body: Optional[str] = None


@app.get("/api/router-timeline/reports")
def router_timeline_list_reports():
    try:
        with db_cursor() as (_conn, cursor):
            cursor.execute(
                f"""
                select
                  r.id,
                  r.store_code,
                  r.category,
                  r.description,
                  r.reporter_name,
                  r.reporter_login,
                  r.reported_at,
                  r.timeline_start,
                  r.timeline_end,
                  r.resolved,
                  r.resolved_auto,
                  r.created_at,
                  r.updated_at,
                  {_router_timeline_updates_subquery()}
                from router_timeline_reports r
                order by r.reported_at desc, r.id desc
                """
            )
            rows = cursor.fetchall()
        return {"reports": [_serialize_router_timeline_report(row) for row in rows]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/router-timeline/reports")
def router_timeline_create_report(payload: RouterTimelineReportCreate):
    store_code = normalize_store_code(payload.storeCode)
    if not store_code:
        raise HTTPException(status_code=400, detail="storeCode is required")
    category = _validate_router_timeline_category(payload.category)
    description = (payload.description or "").strip()
    if len(description) < 5:
        raise HTTPException(status_code=400, detail="description must be at least 5 characters")
    reporter_name = (payload.reporterName or "").strip() or "Unknown User"
    reporter_login = (payload.reporterLogin or "").strip()
    reported_at = parse_epoch_ms(payload.reportedAtMs) or datetime.now(timezone.utc)
    timeline_start = parse_epoch_ms(payload.timelineStartMs)
    timeline_end = parse_epoch_ms(payload.timelineEndMs)
    try:
        with db_cursor() as (conn, cursor):
            cursor.execute(
                """
                insert into router_timeline_reports (
                  store_code, category, description, reporter_name, reporter_login,
                  reported_at, timeline_start, timeline_end, resolved, resolved_auto
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, false)
                returning id
                """,
                (
                    store_code,
                    category,
                    description,
                    reporter_name,
                    reporter_login,
                    reported_at,
                    timeline_start,
                    timeline_end,
                    bool(payload.resolved),
                ),
            )
            row = cursor.fetchone()
            report_id = row["id"]
            created = _fetch_router_timeline_report(cursor, report_id)
            conn.commit()
        broadcast_event("router_timeline_changed", {"action": "create", "report_id": report_id})
        return _serialize_router_timeline_report(created)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def _fetch_router_timeline_report(cursor, report_id: int):
    cursor.execute(
        f"""
        select
          r.id,
          r.store_code,
          r.category,
          r.description,
          r.reporter_name,
          r.reporter_login,
          r.reported_at,
          r.timeline_start,
          r.timeline_end,
          r.resolved,
          r.resolved_auto,
          r.created_at,
          r.updated_at,
          {_router_timeline_updates_subquery()}
        from router_timeline_reports r
        where r.id = %s
        """,
        (report_id,),
    )
    return cursor.fetchone()


@app.patch("/api/router-timeline/reports/{report_id}")
def router_timeline_update_report(report_id: int, payload: RouterTimelineReportUpdate):
    try:
        with db_cursor() as (conn, cursor):
            existing = _fetch_router_timeline_report(cursor, report_id)
            if not existing:
                raise HTTPException(status_code=404, detail="Report not found")

            store_code = normalize_store_code(payload.storeCode) if payload.storeCode is not None else existing["store_code"]
            if not store_code:
                raise HTTPException(status_code=400, detail="storeCode is required")
            category = (
                _validate_router_timeline_category(payload.category)
                if payload.category is not None
                else existing["category"]
            )
            description = (
                (payload.description or "").strip()
                if payload.description is not None
                else existing["description"]
            )
            if len(description) < 1:
                raise HTTPException(status_code=400, detail="description is required")
            reporter_name = (
                (payload.reporterName or "").strip() or existing["reporter_name"]
                if payload.reporterName is not None
                else existing["reporter_name"]
            )
            reporter_login = (
                (payload.reporterLogin or "").strip()
                if payload.reporterLogin is not None
                else existing["reporter_login"]
            )
            reported_at = (
                parse_epoch_ms(payload.reportedAtMs)
                if payload.reportedAtMs is not None
                else existing["reported_at"]
            )
            timeline_start = (
                parse_epoch_ms(payload.timelineStartMs)
                if payload.timelineStartMs is not None
                else existing["timeline_start"]
            )
            timeline_end = (
                parse_epoch_ms(payload.timelineEndMs)
                if payload.timelineEndMs is not None
                else existing["timeline_end"]
            )
            resolved = existing["resolved"] if payload.resolved is None else bool(payload.resolved)
            resolved_auto = (
                existing["resolved_auto"]
                if payload.resolvedAuto is None
                else bool(payload.resolvedAuto)
            )

            cursor.execute(
                """
                update router_timeline_reports
                set store_code = %s,
                    category = %s,
                    description = %s,
                    reporter_name = %s,
                    reporter_login = %s,
                    reported_at = %s,
                    timeline_start = %s,
                    timeline_end = %s,
                    resolved = %s,
                    resolved_auto = %s,
                    updated_at = now()
                where id = %s
                """,
                (
                    store_code,
                    category,
                    description,
                    reporter_name,
                    reporter_login,
                    reported_at,
                    timeline_start,
                    timeline_end,
                    resolved,
                    resolved_auto,
                    report_id,
                ),
            )
            updated = _fetch_router_timeline_report(cursor, report_id)
            conn.commit()
        broadcast_event("router_timeline_changed", {"action": "update", "report_id": report_id})
        return _serialize_router_timeline_report(updated)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.patch("/api/router-timeline/reports/{report_id}/resolved")
def router_timeline_patch_resolved(report_id: int, payload: RouterTimelineResolvedPatch):
    try:
        with db_cursor() as (conn, cursor):
            cursor.execute(
                """
                update router_timeline_reports
                set resolved = %s,
                    resolved_auto = %s,
                    updated_at = now()
                where id = %s
                returning id
                """,
                (bool(payload.resolved), bool(payload.resolvedAuto), report_id),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Report not found")
            updated = _fetch_router_timeline_report(cursor, report_id)
            conn.commit()
        broadcast_event("router_timeline_changed", {"action": "resolve", "report_id": report_id})
        return _serialize_router_timeline_report(updated)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/api/router-timeline/reports/{report_id}")
def router_timeline_delete_report(report_id: int):
    try:
        with db_cursor() as (conn, cursor):
            cursor.execute(
                "delete from router_timeline_reports where id = %s returning id",
                (report_id,),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Report not found")
            conn.commit()
        broadcast_event("router_timeline_changed", {"action": "delete", "report_id": report_id})
        return {"ok": True, "id": report_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/router-timeline/reports/{report_id}/updates")
def router_timeline_add_update(report_id: int, payload: RouterTimelineUpdateCreate):
    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="body is required")
    author_name = (payload.authorName or "").strip() or "Unknown User"
    author_login = (payload.authorLogin or "").strip()
    try:
        with db_cursor() as (conn, cursor):
            cursor.execute("select id from router_timeline_reports where id = %s", (report_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Report not found")
            cursor.execute(
                """
                insert into router_timeline_report_updates (
                  report_id, author_name, author_login, body
                )
                values (%s, %s, %s, %s)
                returning id
                """,
                (report_id, author_name, author_login, body),
            )
            update_id = cursor.fetchone()["id"]
            updated = _fetch_router_timeline_report(cursor, report_id)
            conn.commit()
        broadcast_event(
            "router_timeline_changed",
            {"action": "update_note", "report_id": report_id, "update_id": update_id},
        )
        return _serialize_router_timeline_report(updated)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.patch("/api/router-timeline/reports/{report_id}/updates/{update_id}")
def router_timeline_edit_update(report_id: int, update_id: int, payload: RouterTimelineUpdatePatch):
    body = (payload.body or "").strip() if payload.body is not None else None
    if body is not None and not body:
        raise HTTPException(status_code=400, detail="body is required")
    try:
        with db_cursor() as (conn, cursor):
            cursor.execute(
                """
                select id, author_name, author_login, body
                from router_timeline_report_updates
                where id = %s and report_id = %s
                """,
                (update_id, report_id),
            )
            existing = cursor.fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Update not found")
            author_name = (
                (payload.authorName or "").strip() or existing["author_name"]
                if payload.authorName is not None
                else existing["author_name"]
            )
            author_login = (
                (payload.authorLogin or "").strip()
                if payload.authorLogin is not None
                else existing["author_login"]
            )
            new_body = body if body is not None else existing["body"]
            cursor.execute(
                """
                update router_timeline_report_updates
                set author_name = %s,
                    author_login = %s,
                    body = %s,
                    updated_at = now()
                where id = %s and report_id = %s
                """,
                (author_name, author_login, new_body, update_id, report_id),
            )
            updated = _fetch_router_timeline_report(cursor, report_id)
            conn.commit()
        broadcast_event(
            "router_timeline_changed",
            {"action": "edit_note", "report_id": report_id, "update_id": update_id},
        )
        return _serialize_router_timeline_report(updated)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/api/router-timeline/reports/{report_id}/updates/{update_id}")
def router_timeline_delete_update(report_id: int, update_id: int):
    try:
        with db_cursor() as (conn, cursor):
            cursor.execute(
                """
                delete from router_timeline_report_updates
                where id = %s and report_id = %s
                returning id
                """,
                (update_id, report_id),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Update not found")
            updated = _fetch_router_timeline_report(cursor, report_id)
            conn.commit()
        broadcast_event(
            "router_timeline_changed",
            {"action": "delete_note", "report_id": report_id, "update_id": update_id},
        )
        return _serialize_router_timeline_report(updated)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

