/**
 * modules/constants.js
 *
 * App-wide immutable constants extracted from script.js so the closure
 * inside runGfnPanel doesn't have to redeclare them. Pure values only.
 *
 * Loaded as a classic script (NOT an ES module) BEFORE script.js, exposed
 * via `window.GFN_CONSTANTS`. The runGfnPanel closure rebinds each entry
 * to a local `const` so the (very large) body keeps working unchanged.
 */
(function () {
  'use strict';

  // ---- localStorage keys -----------------------------------------------------
  const STORAGE_KEY_DEVICE = 'grafana_custom_panel_device_type';
  const STORAGE_KEY_SORT = 'grafana_custom_panel_sort_mode';
  const STORAGE_KEY_OFFLINE_VIEW = 'grafana_custom_panel_offline_view';
  const STORAGE_KEY_OFFLINE_SORT = 'grafana_custom_panel_offline_sort_mode';
  const STORAGE_KEY_OFFLINE_SORT_COLUMN = 'grafana_custom_panel_offline_sort_column';
  const STORAGE_KEY_OFFLINE_SORT_DIRECTION = 'grafana_custom_panel_offline_sort_direction';
  const STORAGE_KEY_DEVICE_STATUS_SNAPSHOT = 'grafana_custom_panel_device_status_snapshot';
  const STORAGE_KEY_DASHBOARD_PAGE = 'grafana_custom_panel_dashboard_page';
  const STORAGE_KEY_PRIMARY_DOWN_SINCE = 'grafana_custom_panel_primary_down_since';
  const STORAGE_KEY_NIGHT_FREEZE_STATE = 'grafana_custom_panel_night_freeze_state';
  const STORAGE_KEY_LIVE_UNREPORTED_DURATION_SORT = 'grafana_custom_panel_live_unreported_duration_sort';
  // Saved historical date-selector filter (?from=&to=) — only applied on the
  // date-aware views: Offline Time Report, Live Incidents, Incident & Reporting.
  // Stored as JSON: { from: string, to: string }.
  const STORAGE_KEY_SAVED_DATE_FILTER = 'grafana_custom_panel_saved_date_filter';

  // Default "live" range used when navigating away from a date-aware view so
  // the Live device grids never get pinned to a historical window.
  const DEFAULT_LIVE_DATE_FROM = 'now-12h';
  const DEFAULT_LIVE_DATE_TO = 'now';

  // ---- Monitoring window (Europe/Bucharest wall clock) -----------------------
  const PRIMARY_DOWN_GRACE_MINUTES = 15;
  const MONITORING_START_MINUTES = 7 * 60 + 10;
  const MONITORING_END_MINUTES = 21 * 60;

  // ---- Time-range picker labels ---------------------------------------------
  const TIME_RANGE_LABELS = {
    'now-12h': { short: '12h', full: 'Live - Last 12 hours', isLive: true },
    'now-24h': { short: '24h', full: 'Live - Last 24 hours', isLive: true },
    'now-2d':  { short: '2d',  full: 'Live - Last 2 days',   isLive: true },
    'now-7d':  { short: '7d',  full: 'Live - Last 7 days',   isLive: true },
    'now-30d': { short: '30d', full: 'Live - Last 30 days',  isLive: true },
    'now-90d': { short: '90d', full: 'Live - Last 90 days',  isLive: true },
    'today':     { short: 'Today',     full: 'Today (07:00 - 21:00)',     isLive: false },
    'yesterday': { short: 'Yesterday', full: 'Yesterday (07:00 - 21:00)', isLive: false }
  };

  // ---- Grafana series refIds -> device type mapping -------------------------
  const DEVICE_PARSERS = {
    'A': { type: 'routers', threshold: 2, subtype: 'ont' },
    'M': { type: 'project-routers', threshold: 2 },
    'B': { type: 'switches-primary', threshold: 1 },
    'C': { type: 'switches-secondary', threshold: 1 },
    'D': { type: 'admin-pc', threshold: 1 },
    'E': { type: 'cash-register-1', threshold: 1 },
    'F': { type: 'cash-register-2', threshold: 1 },
    'G': { type: 'cash-register-3', threshold: 1 },
    'H': { type: 'inside-music', threshold: 1 },
    'I': { type: 'outside-music', threshold: 1 },
    'J': { type: 'printer', threshold: 1 },
    'K': { type: 'price-checkers', threshold: 1 }
  };

  // ---- Report tags (CRM) -----------------------------------------------------
  const INTERNET_REPORT_TAGS = ['power-outage', 'network-issue', 'planned'];
  const INTERNET_REPORT_TAGS_NO_TICKET_REQUIRED = ['power-outage', 'planned'];
  const DEVICE_REPORT_TAGS = ['troubleshooting', 'partial-replacement', 'full-replacement'];
  const LIVE_INCIDENT_TAG_FILTER_IDS = [
    'power-outage',
    'network-issue',
    'planned',
    'troubleshooting',
    'partial-replacement',
    'full-replacement'
  ];

  // ---- Device-type sets used across the UI -----------------------------------
  const REPORTABLE_DEVICE_TYPES = [
    'price-checkers',
    'inside-music',
    'outside-music',
    'cash-register-1',
    'cash-register-2',
    'cash-register-3',
    'primary-link',
    'backup-link'
  ];

  const LIVE_UNREPORTED_DEVICE_TYPE = 'unreported';

  // ---- Card sort priority (priority filter) ----------------------------------
  const PRIORITY_ORDER = { 'inactive': 1, 'warning': 2, 'active': 3 };

  // ---- Panel runtime singleton key (cross-tick state on window) --------------
  const PANEL_RUNTIME_KEY = '__GFN_PANEL_RUNTIME__';

  // ---- Paging / fetch limits -------------------------------------------------
  const UNREPORTED_LIVE_PAGE_SIZE = 200;
  const UNREPORTED_REPORTING_PAGE_SIZE = 300;
  const REPORTED_TABLE_PAGE_SIZE = 300;
  const LIVE_REPORTED_SOLVED_PAGE_SIZE = 120;
  const LIVE_RENDER_MAX_PER_SECTION = 120;
  const LOAD_MORE_MIN_TOTAL = 100;

  window.GFN_CONSTANTS = {
    STORAGE_KEY_DEVICE,
    STORAGE_KEY_SORT,
    STORAGE_KEY_OFFLINE_VIEW,
    STORAGE_KEY_OFFLINE_SORT,
    STORAGE_KEY_OFFLINE_SORT_COLUMN,
    STORAGE_KEY_OFFLINE_SORT_DIRECTION,
    STORAGE_KEY_DEVICE_STATUS_SNAPSHOT,
    STORAGE_KEY_DASHBOARD_PAGE,
    STORAGE_KEY_PRIMARY_DOWN_SINCE,
    STORAGE_KEY_NIGHT_FREEZE_STATE,
    STORAGE_KEY_LIVE_UNREPORTED_DURATION_SORT,
    STORAGE_KEY_SAVED_DATE_FILTER,
    DEFAULT_LIVE_DATE_FROM,
    DEFAULT_LIVE_DATE_TO,
    PRIMARY_DOWN_GRACE_MINUTES,
    MONITORING_START_MINUTES,
    MONITORING_END_MINUTES,
    TIME_RANGE_LABELS,
    DEVICE_PARSERS,
    INTERNET_REPORT_TAGS,
    INTERNET_REPORT_TAGS_NO_TICKET_REQUIRED,
    DEVICE_REPORT_TAGS,
    LIVE_INCIDENT_TAG_FILTER_IDS,
    REPORTABLE_DEVICE_TYPES,
    LIVE_UNREPORTED_DEVICE_TYPE,
    PRIORITY_ORDER,
    PANEL_RUNTIME_KEY,
    UNREPORTED_LIVE_PAGE_SIZE,
    UNREPORTED_REPORTING_PAGE_SIZE,
    REPORTED_TABLE_PAGE_SIZE,
    LIVE_REPORTED_SOLVED_PAGE_SIZE,
    LIVE_RENDER_MAX_PER_SECTION,
    LOAD_MORE_MIN_TOTAL
  };
})();
