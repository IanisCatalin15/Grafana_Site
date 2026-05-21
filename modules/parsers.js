/**
 * modules/parsers.js
 *
 * Pure-ish parsers for the Grafana panel `data.series` shape (built by
 * /prom-adapter.js from Prometheus queries). Also bundles the small
 * uptime/ONT helpers that work on parsed rows + the panel time range.
 *
 * Functions that need to walk the cached `dataMap` (router-driven helpers)
 * accept that dataMap as an explicit argument so this module stays free
 * of runGfnPanel closure state. The thin caller wrappers inside script.js
 * just forward the local dataMap reference.
 */
(function () {
  'use strict';

  // ---- WAN uptime denominator schedule (07:00-21:00 Europe/Bucharest) ------
  const OFFLINE_UPTIME_SCHEDULE = {
    tz: 'Europe/Bucharest',
    openHour: 7,
    openMinute: 0,
    closeHour: 21,
    closeMinute: 0
  };

  // ---- refId -> offline-metric column key (panel side) ---------------------
  const OFFLINE_METRICS = {
    'L': 'bothDown', 'N': 'backup', 'O': 'cr1', 'P': 'cr2',
    'Q': 'cr3', 'R': 'nuc', 'S': 'm1', 'T': 'm2', 'U': 'pc',
    'X': 'primaryDownScheduled', 'Y': 'backupDownScheduled',
    'Z': 'internetDownScheduled'
  };
  const PC_OVER15_DETAILS_REFID = 'W';

  // Late-bound: device-format may not be wired yet when we evaluate the
  // module body. Cross-call lookups via window are cheap and never stale.
  function _extractStoreCode(name) {
    const fmt = (typeof window !== 'undefined' && window.GFN_DEVICE_FORMAT) || null;
    if (fmt && typeof fmt.extractStoreCode === 'function') return fmt.extractStoreCode(name);
    const m = String(name || '').trim().match(/^(ar\d+)/i);
    return m ? m[1].toUpperCase() : '';
  }

  // ---- Per-series parsers ---------------------------------------------------
  function genericParser(series, activeThreshold) {
    if (!series || !series.fields || !series.fields[1]) return null;

    const valueField = series.fields[1];
    const labels = valueField.labels || {};
    let deviceName = (
      (valueField.labels && (valueField.labels.store || valueField.labels.location)) ||
      valueField.name ||
      'Unknown'
    ).trim();

    if (series.refId === 'K' && valueField.labels && valueField.labels.hostname) {
      const match = valueField.labels.hostname.match(/^([^.]+)/);
      if (match) deviceName = match[1].toUpperCase().trim();
    }

    let status = 'inactive';
    let value = 0;
    const isProject = series.refId === 'M';

    if (valueField.values && valueField.values.length > 0) {
      const rawValue = valueField.values.get(valueField.values.length - 1);
      if (rawValue !== null && typeof rawValue === 'number') {
        value = rawValue;
        if (series.refId === 'K' || series.refId === 'H' || series.refId === 'I') {
          status = value === 0 ? 'inactive' : 'active';
        } else if (value >= activeThreshold) {
          status = 'active';
        } else if (value === 1 && activeThreshold > 1) {
          status = 'warning';
        } else {
          status = 'inactive';
        }
      }
    }
    return { name: deviceName, value, status, isProject, labels };
  }

  function getOfflineMetricData(series, metricType) {
    if (!series || !series.fields || !series.fields[1]) return null;
    const valueField = series.fields[1];
    // Only accept rows that carry a real `store` label. Scalar fallbacks from
    // PromQL `... or vector(0)` come back with no labels and would otherwise
    // get typed as the refId letter (P/Q/R/...), polluting the offline table.
    const storeName = valueField.labels && valueField.labels.store;
    if (!storeName) return null;
    let timeOffline = 0;
    if (valueField.values.length > 0) {
      const val = valueField.values.get(valueField.values.length - 1);
      if (val !== null) timeOffline = Math.round(val);
    }
    return { store: storeName, metricType, timeOffline };
  }

  function getPcOver15DetailData(series) {
    if (!series || !series.fields || !series.fields[1]) return null;
    const valueField = series.fields[1];
    const labels = valueField.labels || {};
    const storeName = labels.store || valueField.name || 'Unknown';
    const hostRaw = labels.hostname || labels.instance || labels.device || valueField.name || '';

    let rawValue = 0;
    if (valueField.values.length > 0) {
      const val = valueField.values.get(valueField.values.length - 1);
      if (val !== null && val !== undefined) rawValue = Number(val);
    }
    if (!Number.isFinite(rawValue) || rawValue <= 0) return null;

    const hostMatch = String(hostRaw).match(/^([^.]+)/);
    const deviceName = hostMatch ? hostMatch[1] : String(hostRaw || '').trim();
    if (!deviceName) return null;

    return { store: storeName, deviceName };
  }

  // ---- Panel time-range helpers --------------------------------------------
  function getPanelTimeRangeMs(data) {
    const r = data && data.request && data.request.range;
    if (!r || r.from == null || r.to == null) return null;
    const fromMs = typeof r.from.valueOf === 'function' ? r.from.valueOf() : new Date(r.from).getTime();
    const toMs = typeof r.to.valueOf === 'function' ? r.to.valueOf() : new Date(r.to).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return null;
    return { fromMs, toMs };
  }

  /**
   * Count 1-minute buckets in [fromMs, toMs) that fall inside store schedule
   * (half-open [open, close)).
   */
  function scheduledMinutesInRange(fromMs, toMs, sched) {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;
    const openM = sched.openHour * 60 + sched.openMinute;
    const closeM = sched.closeHour * 60 + sched.closeMinute;
    if (closeM <= openM) return 0;
    const step = 60000;
    let t0 = fromMs - (fromMs % step);
    if (t0 < fromMs) t0 += step;
    let n = 0;
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: sched.tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    for (let t = t0; t < toMs; t += step) {
      const parts = fmt.formatToParts(new Date(t));
      const h = parseInt(parts.find((p) => p.type === 'hour').value, 10);
      const m = parseInt(parts.find((p) => p.type === 'minute').value, 10);
      const minuteOfDay = h * 60 + m;
      if (minuteOfDay >= openM && minuteOfDay < closeM) n++;
    }
    return n;
  }

  function formatUptimePercent(pct) {
    if (pct == null || Number.isNaN(pct)) return 'N/A';
    return `${Math.round(pct)}%`;
  }

  function uptimePercentCellClass(pct) {
    if (pct == null || Number.isNaN(pct)) return 'uptime-cell-na';
    if (pct < 90) return 'uptime-cell uptime-cell--bad';
    if (pct < 98) return 'uptime-cell uptime-cell--warn';
    return 'uptime-cell uptime-cell--ok';
  }

  // ---- ONT lookup helpers (offline `store` label vs router `name`) ---------
  function normalizeOntLookupKey(label) {
    return String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function compactOntLookupKey(label) {
    return String(label || '').trim().toLowerCase().replace(/\s+/g, '');
  }

  /**
   * Builds { primary, backup } per store key from router ONT labels.
   * Keys include AR#### (uppercase) + normalized + compact name so Office /
   * WH rows map the same way as AR stores.
   * `dataMap` is the runGfnPanel local cache; passed in to avoid coupling.
   */
  function buildRouterOntByStore(dataMap) {
    const out = Object.create(null);
    const ingest = (devices) => {
      if (!Array.isArray(devices)) return;
      for (let i = 0; i < devices.length; i++) {
        const d = devices[i];
        const name = String((d && d.name) || '').trim();
        if (!name) continue;
        const ont = {
          primary: (d && d.ontPrimaryStatus) || 'unknown',
          backup: (d && d.ontBackupStatus) || 'unknown'
        };
        const code = _extractStoreCode(name);
        if (code) out[code] = ont;
        const nk = normalizeOntLookupKey(name);
        if (nk) out[nk] = ont;
        const ck = compactOntLookupKey(name);
        if (ck) out[ck] = ont;
      }
    };
    if (dataMap) {
      ingest(dataMap.routers);
      ingest(dataMap['project-routers']);
    }
    return out;
  }

  function lookupOntForOfflineStore(storeLabel, ontByStore) {
    if (!ontByStore) return null;
    const raw = String(storeLabel || '').trim();
    if (!raw) return null;
    const code = _extractStoreCode(raw);
    if (code && ontByStore[code]) return ontByStore[code];
    const nk = normalizeOntLookupKey(raw);
    if (nk && ontByStore[nk]) return ontByStore[nk];
    const ck = compactOntLookupKey(raw);
    if (ck && ontByStore[ck]) return ontByStore[ck];
    return null;
  }

  /**
   * Mutates `rows` adding primaryUptimePct / backupUptimePct / internetUptimePct
   * from scheduled-down minutes (refs X / Y / Z) over the panel time range.
   * Missing values (null) are treated as 0 down minutes → 100% uptime when S > 0.
   * `ontByStore[*].primary === 'none'` (or backup) blanks that column (N/A).
   */
  function applyInternetUptimeToOfflineRows(rows, fromMs, toMs, ontByStore) {
    const list = Array.isArray(rows) ? rows : [];
    const S = scheduledMinutesInRange(fromMs, toMs, OFFLINE_UPTIME_SCHEDULE);
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row) continue;
      if (S <= 0) {
        row.primaryUptimePct = null;
        row.backupUptimePct = null;
        row.internetUptimePct = null;
        continue;
      }
      const pd = row.primaryDownScheduled;
      const bd = row.backupDownScheduled;
      const id = row.internetDownScheduled;
      const pdEff = pd != null && Number.isFinite(pd) ? Math.max(0, pd) : 0;
      const bdEff = bd != null && Number.isFinite(bd) ? Math.max(0, bd) : 0;
      const idEff = id != null && Number.isFinite(id) ? Math.max(0, id) : 0;
      const ont = lookupOntForOfflineStore(row.store, ontByStore);
      if (ont && ont.primary === 'none') {
        row.primaryUptimePct = null;
      } else {
        row.primaryUptimePct = (Math.max(0, S - pdEff) / S) * 100;
      }
      if (ont && ont.backup === 'none') {
        row.backupUptimePct = null;
      } else {
        row.backupUptimePct = (Math.max(0, S - bdEff) / S) * 100;
      }
      row.internetUptimePct = (Math.max(0, S - idEff) / S) * 100;
    }
  }

  /**
   * Merge ONT label info (Query A) onto every router row in `dataMap['routers']`
   * + `dataMap['project-routers']`. Sets ontPrimaryStatus / ontBackupStatus /
   * combinedStatus / status. Mutates in place.
   */
  /**
   * No usable WAN: P down + B down/none, or P none + B down (e.g. AR0045 P Down + B Down).
   */
  function isInternetDownRouter(d) {
    if (!d) return false;
    const pStat = String(d.ontPrimaryStatus || '').toLowerCase();
    const bStat = String(d.ontBackupStatus || '').toLowerCase();
    const pTxt = String(d.ontPrimaryText || '').toLowerCase();
    const bTxtRaw = String(d.ontBackupText != null ? d.ontBackupText : 'UNKNOWN').trim();
    const bTxt = bTxtRaw.toLowerCase();
    const primaryIsDown = pStat === 'down' || /\bdown\b/.test(pTxt);
    const primaryIsNone = pStat === 'none' || /\bnone\b/.test(pTxt);
    const hasBackupOnt = bTxtRaw.toUpperCase() !== 'NONE';
    const backupIsNone = bStat === 'none' || bTxtRaw.toUpperCase() === 'NONE';
    const backupIsDown = hasBackupOnt && (bStat === 'down' || /\bdown\b/.test(bTxt));
    return (
      (primaryIsDown && (backupIsDown || backupIsNone)) ||
      (primaryIsNone && backupIsDown)
    );
  }

  function combineRouterStatuses(dataMap) {
    const normalizeOntLabel = (label) => {
      if (label === null || label === undefined) {
        return { status: 'unknown', text: 'UNKNOWN', className: 'status-unknown' };
      }
      const normalized = String(label).trim().toLowerCase();
      if (normalized === 'up' || normalized === 'online' || /\bup\b/.test(normalized)) {
        return { status: 'up', text: 'UP', className: 'status-up' };
      }
      if (normalized === 'down' || normalized === 'offline' || /\bdown\b/.test(normalized)) {
        return { status: 'down', text: 'Down', className: 'status-down' };
      }
      if (normalized === 'none' || normalized === 'n/a' || normalized === 'na' || /\bnone\b/.test(normalized)) {
        return { status: 'none', text: 'NONE', className: 'status-none' };
      }
      return { status: 'unknown', text: 'UNKNOWN', className: 'status-unknown' };
    };

    const applyOntLabels = (ont) => {
      const labels = ont.labels || {};
      const primaryLabelRaw =
        labels.ONT_Primary != null ? labels.ONT_Primary :
        labels.ont_primary != null ? labels.ont_primary :
        labels.ONTPrimary != null ? labels.ONTPrimary :
        labels.ontPrimary;
      const backupLabelRaw =
        labels.ONT_Backup != null ? labels.ONT_Backup :
        labels.ont_backup != null ? labels.ont_backup :
        labels.ONTBackup != null ? labels.ONTBackup :
        labels.ontBackup;

      const primaryInfo = normalizeOntLabel(primaryLabelRaw);
      const backupInfo = normalizeOntLabel(backupLabelRaw);

      ont.ontPrimaryStatus = primaryInfo.status;
      ont.ontPrimaryText = primaryInfo.text;
      ont.ontPrimaryClass = primaryInfo.className;

      ont.ontBackupStatus = backupInfo.status;
      ont.ontBackupText = backupInfo.text;
      ont.ontBackupClass = backupInfo.className;

      const primaryStatus = primaryInfo.status;
      const backupStatus = backupInfo.status;

      if (primaryStatus === 'up') {
        ont.ontStatus = 'primary';
        ont.ontLabel = 'Primary';
        ont.ontClass = 'status-primary';
        ont.combinedStatus = 'active';
      } else if (
        (primaryStatus === 'down' && backupStatus === 'up') ||
        (primaryStatus === 'none' && backupStatus === 'up')
      ) {
        ont.ontStatus = 'backup';
        ont.ontLabel = 'Backup';
        ont.ontClass = 'status-backup';
        ont.combinedStatus = 'warning';
      } else {
        // Includes P Down + B NONE (no backup available) => store is offline.
        ont.ontStatus = 'down';
        ont.ontLabel = 'Down';
        ont.ontClass = 'status-down';
        ont.combinedStatus = 'inactive';
      }

      ont.status = ont.combinedStatus;
    };

    if (!dataMap) return;
    if (Array.isArray(dataMap.routers)) dataMap.routers.forEach(applyOntLabels);
    if (Array.isArray(dataMap['project-routers'])) dataMap['project-routers'].forEach(applyOntLabels);
  }

  function knownStoreCodesSet(dataMap) {
    const out = new Set();
    const addFrom = (list) => {
      (Array.isArray(list) ? list : []).forEach((item) => {
        const code = _extractStoreCode(item && item.name);
        if (code) out.add(code);
      });
    };
    if (dataMap) {
      addFrom(dataMap.routers);
      addFrom(dataMap['project-routers']);
    }
    return out;
  }

  window.GFN_PARSERS = {
    OFFLINE_UPTIME_SCHEDULE,
    OFFLINE_METRICS,
    PC_OVER15_DETAILS_REFID,
    genericParser,
    getOfflineMetricData,
    getPcOver15DetailData,
    getPanelTimeRangeMs,
    scheduledMinutesInRange,
    formatUptimePercent,
    uptimePercentCellClass,
    normalizeOntLookupKey,
    compactOntLookupKey,
    isInternetDownRouter,
    buildRouterOntByStore,
    lookupOntForOfflineStore,
    applyInternetUptimeToOfflineRows,
    combineRouterStatuses,
    knownStoreCodesSet
  };
})();
