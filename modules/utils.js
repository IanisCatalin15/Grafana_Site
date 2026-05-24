/**
 * modules/utils.js
 *
 * Pure helpers extracted from script.js. No closure dependencies on the
 * Grafana panel runtime — these functions take everything they need as
 * arguments.
 *
 * Loaded as a classic script (NOT an ES module) — exposes the helpers on
 * `window.GFN_UTILS` so script.js can rebind them without needing `import`
 * statements. Native ESM through Cloudflare turned out flaky (the proxy
 * doesn't forward subresource fetches reliably), so we use the global
 * namespace pattern instead.
 */
(function () {
  'use strict';

// HTML escape for XSS safety
// Lookup-table escape: ~10-20× faster than the createElement round-trip
// used previously. Called ~3k times per live render (300 cards × ~10 fields),
// so the round-trip cost was dominant.
const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};
const HTML_ESCAPE_RE = /[&<>"']/g;

function escapeHtml(str) {
  if (str == null) return '';
  const s = typeof str === 'string' ? str : String(str);
  if (!HTML_ESCAPE_RE.test(s)) return s;
  HTML_ESCAPE_RE.lastIndex = 0;
  return s.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch]);
}

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Downtime / duration from total minutes: 1d 2h 3m (omit zero parts; never raw hundreds of minutes). */
function formatTime(minutes) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0));
  if (total <= 0) return '0';
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  return parts.length ? parts.join(' ') : '0';
}

/** Hours + minutes only (no days) — for tooltips, e.g. 25h 30m. */
function formatHoursMinutesOnly(totalMinutes) {
  const total = Math.max(0, Math.floor(Number(totalMinutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Internet uptime tooltip: store-hours window, Prometheus downtime (ref Z), power outage from DB reports. */
function offlineInternetRawDowntimeMinutes(row) {
  const raw = row?.internetDownScheduled;
  return raw != null && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

function offlineInternetPowerOutageFromDbMinutes(row) {
  const reported = row?.internetPowerOutageReportMinutes;
  return reported != null && Number.isFinite(reported) ? Math.max(0, Math.floor(reported)) : 0;
}

function offlineInternetPlannedFromDbMinutes(row) {
  const reported = row?.internetPlannedReportMinutes;
  return reported != null && Number.isFinite(reported) ? Math.max(0, Math.floor(reported)) : 0;
}

function offlineInternetUptimeTooltipLines(expectedMinutes, downtimeMinutes, powerOutageMinutes, plannedMinutes) {
  const lines = [
    `Expected Uptime: ${formatHoursMinutesOnly(expectedMinutes)}`,
    `Downtime: ${formatHoursMinutesOnly(downtimeMinutes)}`,
    `Power Outage: ${formatHoursMinutesOnly(powerOutageMinutes)}`
  ];
  const planned = Math.max(0, Math.floor(Number(plannedMinutes) || 0));
  if (planned > 0) {
    lines.push(`Planned: ${formatHoursMinutesOnly(planned)}`);
  }
  return lines.join('\n');
}

function offlineInternetUptimeTooltip(row, storeHoursMinutesInRange) {
  const cap = Math.max(0, Math.floor(Number(storeHoursMinutesInRange) || 0));
  if (cap <= 0) {
    return 'No store-hours in the selected time range.';
  }
  return offlineInternetUptimeTooltipLines(
    cap,
    offlineInternetRawDowntimeMinutes(row),
    offlineInternetPowerOutageFromDbMinutes(row),
    offlineInternetPlannedFromDbMinutes(row)
  );
}

function offlineInternetUptimeTooltipTotal(
  nStores,
  sumRawDowntimeMinutes,
  storeHoursMinutesInRange,
  sumPowerOutageFromDbMinutes,
  sumPlannedFromDbMinutes
) {
  const cap = Math.max(0, Math.floor(Number(storeHoursMinutesInRange) || 0));
  if (cap <= 0) {
    return 'No store-hours in the selected time range.';
  }
  const n = Math.max(0, Math.floor(Number(nStores) || 0));
  const downtime = Math.max(0, Math.floor(Number(sumRawDowntimeMinutes) || 0));
  const po = Math.max(0, Math.floor(Number(sumPowerOutageFromDbMinutes) || 0));
  const planned = Math.max(0, Math.floor(Number(sumPlannedFromDbMinutes) || 0));
  const body = offlineInternetUptimeTooltipLines(cap, downtime, po, planned);
  return n > 0 ? `TOTAL (${n} stores)\n${body}` : body;
}

function offlinePrimaryUptimeTooltip(row, storeHoursMinutesInRange, ont) {
  if (ont && ont.primary === 'none') {
    return 'No primary WAN configured (N/A).';
  }
  const cap = Math.max(0, Math.floor(Number(storeHoursMinutesInRange) || 0));
  if (cap <= 0) {
    return 'No store-hours in the selected time range.';
  }
  const raw = row?.primaryDownScheduled;
  const offM = raw != null && Number.isFinite(raw) ? Math.max(0, raw) : 0;
  return `Primary down: ${formatHoursMinutesOnly(offM)} of ${formatHoursMinutesOnly(cap)} store-hours in range`;
}

function offlinePrimaryUptimeTooltipTotal(nStoresWithPrimary, sumPrimaryDownScheduled, storeHoursMinutesInRange) {
  const n = Math.max(0, Math.floor(Number(nStoresWithPrimary) || 0));
  const cap = Math.max(0, Math.floor(Number(storeHoursMinutesInRange) || 0));
  const sum = Math.max(0, Math.floor(Number(sumPrimaryDownScheduled) || 0));
  if (cap <= 0) {
    return 'No store-hours in the selected time range.';
  }
  if (n <= 0) {
    return 'No stores with a primary WAN in this list (N/A).';
  }
  return `Primary down total (${n} stores with primary): ${formatHoursMinutesOnly(sum)} · ${formatHoursMinutesOnly(cap)} store-hours each`;
}

function offlineBackupUptimeTooltip(row, storeHoursMinutesInRange, ont) {
  if (ont && ont.backup === 'none') {
    return 'No backup configured (N/A).';
  }
  const cap = Math.max(0, Math.floor(Number(storeHoursMinutesInRange) || 0));
  if (cap <= 0) {
    return 'No store-hours in the selected time range.';
  }
  const raw = row?.backupDownScheduled;
  const offM = raw != null && Number.isFinite(raw) ? Math.max(0, raw) : 0;
  return `Backup down: ${formatHoursMinutesOnly(offM)} of ${formatHoursMinutesOnly(cap)} store-hours in range`;
}

function offlineBackupUptimeTooltipTotal(nStoresWithBackup, sumBackupDownScheduled, storeHoursMinutesInRange) {
  const n = Math.max(0, Math.floor(Number(nStoresWithBackup) || 0));
  const cap = Math.max(0, Math.floor(Number(storeHoursMinutesInRange) || 0));
  const sum = Math.max(0, Math.floor(Number(sumBackupDownScheduled) || 0));
  if (cap <= 0) {
    return 'No store-hours in the selected time range.';
  }
  if (n <= 0) {
    return 'No stores with a backup WAN in this list (N/A).';
  }
  return `Backup down total (${n} stores with backup): ${formatHoursMinutesOnly(sum)} · ${formatHoursMinutesOnly(cap)} store-hours each`;
}

// Reuse Intl.DateTimeFormat instances. `Date.prototype.toLocaleString`
// creates a fresh formatter every call (relatively expensive). Sharing
// the formatter across calls saves a noticeable chunk on big lists.
const DTF_LONG = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
  ? new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    })
  : null;
const DTF_COMPACT = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
  ? new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false
    })
  : null;

function formatDateTime(date) {
  return DTF_LONG
    ? DTF_LONG.format(date)
    : date.toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
}

function extractStoreCode(value) {
  const match = String(value || '').trim().match(/^(ar\d+)/i);
  return match ? match[1].toUpperCase() : '';
}

/** Matches backend normalize_store_code: AR + 4 digits (e.g. 86 → AR0086). */
function formatStoreCodeFromInput(code) {
  const raw = String(code || '').trim();
  if (!raw) return '';
  const compact = raw.toUpperCase().replace(/\s/g, '');
  const arMatch = /^AR(\d+)$/.exec(compact);
  if (arMatch) {
    return 'AR' + arMatch[1].padStart(4, '0');
  }
  const digits = raw.replace(/\D/g, '');
  if (digits && /^\d+$/.test(digits)) {
    return 'AR' + digits.padStart(4, '0');
  }
  return compact;
}

function isManualReportedRow(r) {
  return String(r?.report_source || '').toLowerCase() === 'crm_manual';
}

// Memo by raw ISO string: a single render typically formats the
// same offline_started_at/_ended_at hundreds of times across the
// unreported / reported / solved sections. Capped to keep memory
// bounded across many renders.
const ISO_DT_CACHE = new Map();
const ISO_DT_CACHE_MAX = 1024;

function formatIsoDateTime(value) {
  if (!value) return '-';
  const cached = ISO_DT_CACHE.get(value);
  if (cached !== undefined) return cached;
  const dt = new Date(value);
  const out = Number.isNaN(dt.getTime()) ? '-' : formatDateTime(dt);
  if (ISO_DT_CACHE.size >= ISO_DT_CACHE_MAX) {
    const firstKey = ISO_DT_CACHE.keys().next().value;
    ISO_DT_CACHE.delete(firstKey);
  }
  ISO_DT_CACHE.set(value, out);
  return out;
}

  window.GFN_UTILS = {
    escapeHtml,
    escapeAttr,
    formatTime,
    formatHoursMinutesOnly,
    offlineInternetUptimeTooltip,
    offlineInternetUptimeTooltipTotal,
    offlinePrimaryUptimeTooltip,
    offlinePrimaryUptimeTooltipTotal,
    offlineBackupUptimeTooltip,
    offlineBackupUptimeTooltipTotal,
    formatDateTime,
    DTF_COMPACT,
    extractStoreCode,
    formatStoreCodeFromInput,
    isManualReportedRow,
    formatIsoDateTime,
    ISO_DT_CACHE_MAX: 1024
  };
})();
