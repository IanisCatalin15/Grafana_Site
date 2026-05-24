/**
 * modules/incident-dedup.js
 *
 * Pure-ish helpers that classify, group and dedupe incident rows coming
 * from the gfn_api backend. Bundled with the cascade-suppression filter
 * (a peripheral incident is hidden while its store has a primary-link
 * outage), and the live unreported-vs-reported supersession logic.
 *
 * Closure-bound helpers in the original (liveDedupStoreCode reading the
 * row's store_code, filterCascadeIncidents reading PRIMARY_DOWN_BACKUP_UP_ALERT,
 * livePreparedReportedSolvedSupersessions reading reported/solved caches)
 * are exposed here as plain functions that take everything they need as args.
 *
 * Exposes `window.GFN_INCIDENT_DEDUP`. Late-binds cross-module deps
 * (device-format, ticket-links) via window lookups.
 */
(function () {
  'use strict';

  function _DF() {
    return (typeof window !== 'undefined' && window.GFN_DEVICE_FORMAT) || {};
  }
  function _TL() {
    return (typeof window !== 'undefined' && window.GFN_TICKET_LINKS) || {};
  }
  function _extractStoreCode(s) {
    const fn = _DF().extractStoreCode;
    return typeof fn === 'function' ? fn(s) : '';
  }
  function _normalizeDeviceTypeKey(s) {
    const fn = _DF().normalizeDeviceTypeKey;
    return typeof fn === 'function' ? fn(s) : String(s || '').trim().toLowerCase();
  }
  function _normalizeDeviceKey(s) {
    const fn = _DF().normalizeDeviceKey;
    return typeof fn === 'function' ? fn(s) : String(s || '').trim().toUpperCase();
  }
  function _toEpochMs(v) {
    const fn = _DF().toEpochMs;
    if (typeof fn === 'function') return fn(v);
    if (!v) return null;
    const dt = new Date(v);
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
  }
  function _ticketLookupCandidateNames(name, type) {
    const fn = _TL().ticketLookupCandidateNames;
    return typeof fn === 'function' ? fn(name, type) : [name];
  }
  function _extractCrmTaskIdFromTicketUrl(url) {
    const fn = _TL().extractCrmTaskIdFromTicketUrl;
    return typeof fn === 'function' ? fn(url) : '';
  }

  // ---- WAN cascade suppression constants ------------------------------------
  /** Grace after primary/backup link recovery before dependent device incidents count. */
  const WAN_DEPENDENT_RECOVERY_GRACE_MS = 15 * 60 * 1000;
  /** Prometheus alertname: primary down but backup ONT up — store still has WAN. */
  const PRIMARY_DOWN_BACKUP_UP_ALERT = 'DeviceOfflineRouterPrimary';
  /** Prometheus alertname: no usable WAN (e.g. P down + B down/none). */
  const STORE_WAN_BLACKOUT_ALERT = 'DeviceStoreNoInternet';

  /** Full-store WAN blackout uses primary-link rows only. */
  const CASCADE_DEPENDENT_TYPES = new Set([
    'price-checkers',
    'music',
    'inside-music',
    'outside-music',
    'switches-primary',
    'switches-secondary',
    'cash-register',
    'cash-register-1',
    'cash-register-2',
    'cash-register-3'
  ]);

  // ---- Device group maps -----------------------------------------------------
  const UNREPORTED_DEVICE_GROUP_TYPES = {
    primary: ['primary-link'],
    backup: ['backup-link'],
    switches: ['switches-primary', 'switches-secondary'],
    cash: ['cash-register', 'cash-register-1', 'cash-register-2', 'cash-register-3'],
    music: ['music', 'inside-music', 'outside-music'],
    price: ['price-checkers']
  };
  const UNREPORTED_DEVICE_GROUP_IDS = Object.keys(UNREPORTED_DEVICE_GROUP_TYPES);
  // Flat reverse-lookup so deviceGroupIdForType is O(1) instead of O(N×M).
  const DEVICE_TYPE_TO_GROUP_ID = (() => {
    const m = Object.create(null);
    for (const gid of UNREPORTED_DEVICE_GROUP_IDS) {
      const arr = UNREPORTED_DEVICE_GROUP_TYPES[gid] || [];
      for (const t of arr) m[t] = gid;
    }
    return m;
  })();

  const LIVE_GROUPED_DEVICE_TYPES = {
    switches: [
      { key: 'switches-primary', label: 'Primary Switches' },
      { key: 'switches-secondary', label: 'Secondary Switches' }
    ],
    'cash-registers': [
      { key: 'cash-register-1', label: 'Cash Registers 1' },
      { key: 'cash-register-2', label: 'Cash Registers 2' },
      { key: 'cash-register-3', label: 'Cash Registers 3' }
    ],
    music: [
      { key: 'inside-music', label: 'Inside Music' },
      { key: 'outside-music', label: 'Outside Music' }
    ]
  };

  // ---- Row-shape helpers -----------------------------------------------------
  /** API rows are snake_case; tolerate camelCase if a client ever sends it. */
  function incidentRowDeviceType(row) {
    if (!row) return '';
    const dt = row.device_type;
    if (dt != null && String(dt).trim() !== '') return String(dt).trim();
    const camel = row.deviceType;
    if (camel != null && String(camel).trim() !== '') return String(camel).trim();
    return '';
  }

  function deviceGroupIdForType(deviceType) {
    const dt = (typeof deviceType === 'string' ? deviceType : String(deviceType || '')).trim();
    if (!dt) return null;
    if (DEVICE_TYPE_TO_GROUP_ID[dt]) return DEVICE_TYPE_TO_GROUP_ID[dt];
    const norm = _normalizeDeviceTypeKey(dt);
    return (norm && DEVICE_TYPE_TO_GROUP_ID[norm]) || null;
  }

  function countRowsForDeviceGroup(rows, groupId) {
    const list = Array.isArray(rows) ? rows : [];
    if (groupId === 'all') return list.length;
    const types = UNREPORTED_DEVICE_GROUP_TYPES[groupId];
    if (!Array.isArray(types) || !types.length) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r) continue;
      if (deviceGroupIdForType(incidentRowDeviceType(r)) === groupId) n++;
    }
    return n;
  }

  // ---- Cascade suppression: hide peripheral incidents during WAN outage ----
  function filterCascadeIncidents(rows) {
    const allRows = Array.isArray(rows) ? rows : [];
    if (!allRows.length) return allRows;

    // First pass: bucket primary-link rows by store + memoise start/end ms
    // onto the row (avoids reparsing dates on every dependent-row check).
    const linkRowsByStore = Object.create(null);
    const nowMs = Date.now();
    let hasAnyLink = false;
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      if (incidentRowDeviceType(row) !== 'primary-link') continue;
      if (String(row.source_alert || '').trim() === PRIMARY_DOWN_BACKUP_UP_ALERT) continue;
      const store = String(row.store_code || '').toUpperCase();
      if (!store) continue;
      const startMs = _toEpochMs(row.offline_started_at);
      if (startMs === null) continue;
      let endMs;
      if (row.offline_ended_at) {
        const e = _toEpochMs(row.offline_ended_at);
        if (e === null) continue;
        endMs = e + WAN_DEPENDENT_RECOVERY_GRACE_MS;
      } else {
        endMs = nowMs;
      }
      row._cascStart = startMs;
      row._cascEnd = endMs;
      const bucket = linkRowsByStore[store];
      if (bucket) bucket.push(row); else linkRowsByStore[store] = [row];
      hasAnyLink = true;
    }
    if (!hasAnyLink) return allRows;

    const out = [];
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      if (!CASCADE_DEPENDENT_TYPES.has(incidentRowDeviceType(row))) {
        out.push(row);
        continue;
      }
      const store = String(row.store_code || '').toUpperCase();
      const links = linkRowsByStore[store];
      if (!links) {
        out.push(row);
        continue;
      }
      const rowStartMs = _toEpochMs(row.offline_started_at);
      if (rowStartMs === null) {
        out.push(row);
        continue;
      }
      let masked = false;
      for (let j = 0; j < links.length; j++) {
        const link = links[j];
        if (rowStartMs >= link._cascStart && rowStartMs <= link._cascEnd) {
          masked = true;
          break;
        }
      }
      if (!masked) out.push(row);
    }
    return out;
  }

  // ---- Live unreported / reported dedup -------------------------------------
  function liveDedupStoreCode(row) {
    const sc = String((row && row.store_code) || '').trim().toUpperCase();
    if (sc) return sc;
    return _extractStoreCode((row && row.device_name) || '');
  }

  function liveIncidentDedupKeySet(row) {
    const store = liveDedupStoreCode(row);
    const dtype = _normalizeDeviceTypeKey(incidentRowDeviceType(row));
    const name = String((row && row.device_name) || '').trim();
    const keys = new Set();
    if (!store || !name) return keys;
    for (const c of _ticketLookupCandidateNames(name, dtype)) {
      const k = _normalizeDeviceKey(c);
      if (k) keys.add(`${store}|${k}`);
    }
    const rawK = _normalizeDeviceKey(name);
    if (rawK) keys.add(`${store}|${rawK}`);
    return keys;
  }

  function liveDedupKeySetsOverlap(a, b) {
    for (const x of a) {
      if (b.has(x)) return true;
    }
    return false;
  }

  function liveReportedSolvedRowResolvedEndMs(row) {
    if (!row) return null;
    const rtr = row.report_to_resolve_minutes;
    const reportMs = _toEpochMs(row.created_at);
    if (reportMs != null && rtr != null && Number.isFinite(Number(rtr)) && Number(rtr) >= 0) {
      return reportMs + Number(rtr) * 60000;
    }
    return (
      _toEpochMs(row.offline_ended_at) ??
      _toEpochMs(row.incident_offline_ended_at) ??
      _toEpochMs(row.resolved_at) ??
      _toEpochMs(row.closed_at) ??
      _toEpochMs(row.incident_resolved_at)
    );
  }

  /** Same Prometheus/DB episode: tolerate small timestamp skew between unreported vs solved. */
  const LIVE_UNREPORTED_DEDUP_OFFLINE_START_ALIGN_MS = 20 * 60 * 1000;

  function _isTagOnlyReportedRow(row) {
    const fn = _DF().isTagOnlyReportedIncident;
    return typeof fn === 'function' ? fn(row) : false;
  }

  function liveReportedSolvedSupersedesUnreportedOpen(otherRow, unreportedRow) {
    const st = String((otherRow && otherRow.incident_status) || '').trim().toLowerCase();
    const uStart = _toEpochMs(unreportedRow && unreportedRow.offline_started_at);
    if (uStart == null) return false;
    if (st === 'open') return true;
    if (_isTagOnlyReportedRow(otherRow) && (st === 'open' || !st)) return true;
    // Manual CRM rows can represent the same still-open outage even when they
    // do not have an incident_status/offline window yet. The caller has already
    // proven that store+device keys overlap, so a ticketed manual row should
    // hide matching Unreported rows instead of double-counting the same device.
    if (
      !st &&
      otherRow &&
      String(otherRow.ticket_url || '').trim() &&
      String(otherRow.report_source || '').trim() === 'crm_manual'
    ) {
      return true;
    }
    const endMs = liveReportedSolvedRowResolvedEndMs(otherRow);
    if (endMs != null && endMs >= uStart) return true;
    const sStart =
      _toEpochMs(otherRow && otherRow.incident_offline_started_at) ??
      _toEpochMs(otherRow && otherRow.offline_started_at);
    if (sStart == null) return false;
    if (Math.abs(sStart - uStart) <= LIVE_UNREPORTED_DEDUP_OFFLINE_START_ALIGN_MS) return true;
    if (endMs != null && uStart >= sStart && uStart <= endMs) return true;
    return false;
  }

  /**
   * Build the per-(reported|solved)-row dedup key set once per refresh.
   * Caller passes in the cached `liveReportedRowsCache` + `liveSolvedRowsCache`.
   */
  function livePreparedReportedSolvedSupersessions(liveReportedRowsCache, liveSolvedRowsCache) {
    const otherRows = (liveReportedRowsCache || []).concat(liveSolvedRowsCache || []);
    const out = [];
    for (let i = 0; i < otherRows.length; i++) {
      const row = otherRows[i];
      const keys = liveIncidentDedupKeySet(row);
      if (keys.size) out.push({ keys, row });
    }
    return out;
  }

  /**
   * Is this unreported row already superseded by a row from the
   * reported/solved caches? Caller supplies `prepared` (built above)
   * and a `getDeviceTicketLinkFn(name, type)` closure so we don't need to
   * pass the whole closure state here.
   */
  function liveUnreportedSupersedesReportedOrSolved(unreportedRow, prepared, getDeviceTicketLinkFn) {
    const uKeys = liveIncidentDedupKeySet(unreportedRow);
    if (!uKeys.size) return false;
    const uName = String((unreportedRow && unreportedRow.device_name) || '').trim();
    const uTPersisted = String((unreportedRow && unreportedRow._ticket_url) || '').trim();
    const uT = uTPersisted
      || (typeof getDeviceTicketLinkFn === 'function'
          ? getDeviceTicketLinkFn(uName, incidentRowDeviceType(unreportedRow))
          : '');
    const uTask = uT ? _extractCrmTaskIdFromTicketUrl(uT) : '';
    for (let si = 0; si < prepared.length; si++) {
      const { keys, row } = prepared[si];
      if (!liveDedupKeySetsOverlap(uKeys, keys)) continue;
      const oT = String((row && row.ticket_url) || '').trim();
      if (uTask && oT && uTask === _extractCrmTaskIdFromTicketUrl(oT)) return true;
      if (liveReportedSolvedSupersedesUnreportedOpen(row, unreportedRow)) return true;
    }
    return false;
  }

  window.GFN_INCIDENT_DEDUP = {
    WAN_DEPENDENT_RECOVERY_GRACE_MS,
    PRIMARY_DOWN_BACKUP_UP_ALERT,
    STORE_WAN_BLACKOUT_ALERT,
    CASCADE_DEPENDENT_TYPES,
    UNREPORTED_DEVICE_GROUP_TYPES,
    UNREPORTED_DEVICE_GROUP_IDS,
    DEVICE_TYPE_TO_GROUP_ID,
    LIVE_GROUPED_DEVICE_TYPES,
    LIVE_UNREPORTED_DEDUP_OFFLINE_START_ALIGN_MS,
    incidentRowDeviceType,
    deviceGroupIdForType,
    countRowsForDeviceGroup,
    filterCascadeIncidents,
    liveDedupStoreCode,
    liveIncidentDedupKeySet,
    liveDedupKeySetsOverlap,
    liveReportedSolvedRowResolvedEndMs,
    liveReportedSolvedSupersedesUnreportedOpen,
    livePreparedReportedSolvedSupersessions,
    liveUnreportedSupersedesReportedOrSolved
  };
})();
