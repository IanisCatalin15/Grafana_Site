/**
 * modules/offline-power-outage.js
 *
 * Offline Time Report: Internet Down minutes credited to PostgreSQL reports
 * tagged power-outage or planned (overlap with panel range + store-hours schedule).
 */
(function () {
  'use strict';

  const POWER_OUTAGE_TAG = 'power-outage';
  const PLANNED_TAG = 'planned';

  function mergeIntervals(intervals) {
    const list = (intervals || [])
      .filter((iv) => iv && Number.isFinite(iv[0]) && Number.isFinite(iv[1]) && iv[1] > iv[0])
      .sort((a, b) => a[0] - b[0]);
    if (!list.length) return [];
    const out = [list[0].slice()];
    for (let i = 1; i < list.length; i++) {
      const cur = list[i];
      const last = out[out.length - 1];
      if (cur[0] <= last[1]) {
        last[1] = Math.max(last[1], cur[1]);
      } else {
        out.push(cur.slice());
      }
    }
    return out;
  }

  function parseIsoMs(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function storeKeyFromReportRow(row) {
    const DF = window.GFN_DEVICE_FORMAT || {};
    const extract = DF.extractStoreCode || function (v) {
      const m = String(v || '').trim().match(/^(ar\d+)/i);
      return m ? m[1].toUpperCase() : '';
    };
    const code = extract(row?.store_code || row?.storeCode || '');
    if (code) return code;
    return extract(row?.device_name || row?.deviceName || '');
  }

  function isInternetIssueRow(row) {
    const DF = window.GFN_DEVICE_FORMAT || {};
    if (typeof DF.isInternetIssueType === 'function') {
      return DF.isInternetIssueType(row?.device_type || row?.deviceType, row?.device_name || row?.deviceName);
    }
    const dt = String(row?.device_type || row?.deviceType || '').trim().toLowerCase();
    const dn = String(row?.device_name || row?.deviceName || '').trim().toUpperCase();
    return dt === 'primary-link' || dt === 'backup-link' || dn.endsWith('-INTERNET');
  }

  function normalizeReportTagValue(value) {
    const DF = window.GFN_DEVICE_FORMAT || {};
    if (typeof DF.normalizeReportTag === 'function') {
      return DF.normalizeReportTag(value);
    }
    return String(value || '').trim().toLowerCase();
  }

  function reportTagMatches(row, tag) {
    return normalizeReportTagValue(row?.report_tag || row?.reportTag) === String(tag || '').trim().toLowerCase();
  }

  /**
   * @param {object[]} reportRows - rows from GET /api/reporting/internet-power-outage
   * @returns {Map<string, number>} store key (AR####) -> credited minutes in store-hours
   */
  function buildInternetTaggedMinutesByStore(reportRows, tag, fromMs, toMs, sched, scheduledMinutesInRange) {
    const byStore = new Map();
    const schedFn = typeof scheduledMinutesInRange === 'function' ? scheduledMinutesInRange : () => 0;
    const rangeEnd = Number.isFinite(toMs) ? toMs : Date.now();
    const rangeStart = Number.isFinite(fromMs) ? fromMs : 0;
    const wantedTag = String(tag || '').trim().toLowerCase();

    (reportRows || []).forEach((row) => {
      if (!row || !isInternetIssueRow(row)) return;
      if (row.report_tag !== undefined && !reportTagMatches(row, wantedTag)) return;

      const storeKey = storeKeyFromReportRow(row);
      if (!storeKey) return;

      const startMs = parseIsoMs(row.offline_started_at || row.offlineStartedAt);
      if (startMs == null) return;
      let endMs = parseIsoMs(row.offline_ended_at || row.offlineEndedAt);
      if (endMs == null || endMs < startMs) {
        endMs = rangeEnd;
      }

      const clipStart = Math.max(rangeStart, startMs);
      const clipEnd = Math.min(rangeEnd, endMs);
      if (clipEnd <= clipStart) return;

      if (!byStore.has(storeKey)) byStore.set(storeKey, []);
      byStore.get(storeKey).push([clipStart, clipEnd]);
    });

    const minutesOut = new Map();
    byStore.forEach((intervals, storeKey) => {
      const merged = mergeIntervals(intervals);
      let sum = 0;
      merged.forEach(([a, b]) => {
        sum += schedFn(a, b, sched);
      });
      if (sum > 0) minutesOut.set(storeKey, sum);
    });
    return minutesOut;
  }

  function buildPowerOutageMinutesByStore(reportRows, fromMs, toMs, sched, scheduledMinutesInRange) {
    return buildInternetTaggedMinutesByStore(
      reportRows,
      POWER_OUTAGE_TAG,
      fromMs,
      toMs,
      sched,
      scheduledMinutesInRange
    );
  }

  function buildPlannedMinutesByStore(reportRows, fromMs, toMs, sched, scheduledMinutesInRange) {
    return buildInternetTaggedMinutesByStore(
      reportRows,
      PLANNED_TAG,
      fromMs,
      toMs,
      sched,
      scheduledMinutesInRange
    );
  }

  function lookupStoreKey(storeLabel, extractStoreCode) {
    const extract = extractStoreCode || function (v) {
      const m = String(v || '').trim().match(/^(ar\d+)/i);
      return m ? m[1].toUpperCase() : '';
    };
    const raw = String(storeLabel || '').trim();
    const code = extract(raw);
    if (code) return code;
    return raw.toUpperCase();
  }

  function taggedMinutesForStore(storeLabel, minutesByStore, extractStoreCode) {
    if (!minutesByStore || minutesByStore.size === 0) return 0;
    const tried = new Set();
    const tryKey = (k) => {
      const key = String(k || '').trim();
      if (!key || tried.has(key)) return 0;
      tried.add(key);
      const v = minutesByStore.get(key);
      return v != null && v > 0 ? Math.floor(v) : 0;
    };
    const code = lookupStoreKey(storeLabel, extractStoreCode);
    let m = tryKey(code);
    if (m) return m;
    const raw = String(storeLabel || '').trim();
    m = tryKey(raw.toUpperCase());
    if (m) return m;
    const PS = window.GFN_PARSERS || {};
    if (typeof PS.normalizeOntLookupKey === 'function') {
      m = tryKey(PS.normalizeOntLookupKey(raw));
      if (m) return m;
    }
    if (typeof PS.compactOntLookupKey === 'function') {
      m = tryKey(PS.compactOntLookupKey(raw));
      if (m) return m;
    }
    return 0;
  }

  function powerOutageMinutesForStore(storeLabel, powerOutageByStore, extractStoreCode) {
    return taggedMinutesForStore(storeLabel, powerOutageByStore, extractStoreCode);
  }

  /**
   * Mutates rows: sets internetDownEffective, internetPowerOutageMinutes,
   * internetPlannedReportMinutes, recomputes internetUptimePct.
   */
  function applyInternetReportAdjustmentsToOfflineRows(rows, powerOutageByStore, plannedByStore, fromMs, toMs, sched, helpers) {
    const list = Array.isArray(rows) ? rows : [];
    const S = typeof helpers.scheduledMinutesInRange === 'function'
      ? helpers.scheduledMinutesInRange(fromMs, toMs, sched)
      : 0;
    const extract = helpers.extractStoreCode;

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row) continue;

      const raw = row.internetDownScheduled;
      const rawM = raw != null && Number.isFinite(raw) ? Math.max(0, raw) : 0;
      const poM = taggedMinutesForStore(row.store, powerOutageByStore, extract);
      const plannedM = taggedMinutesForStore(row.store, plannedByStore, extract);
      const reportM = Math.max(0, poM);
      const creditM = Math.min(rawM, reportM);
      const effM = Math.max(0, rawM - creditM);

      row.internetPowerOutageReportMinutes = reportM > 0 ? reportM : 0;
      row.internetPowerOutageMinutes = creditM > 0 ? creditM : 0;
      row.internetPlannedReportMinutes = plannedM > 0 ? plannedM : 0;
      row.internetDownEffective = effM;

      if (S <= 0) {
        row.internetUptimePct = null;
      } else {
        row.internetUptimePct = (Math.max(0, S - effM) / S) * 100;
      }
    }
  }

  function applyPowerOutageAdjustmentToOfflineRows(rows, powerOutageByStore, fromMs, toMs, sched, helpers) {
    applyInternetReportAdjustmentsToOfflineRows(
      rows,
      powerOutageByStore,
      null,
      fromMs,
      toMs,
      sched,
      helpers
    );
  }

  window.GFN_OFFLINE_POWER_OUTAGE = {
    POWER_OUTAGE_TAG,
    PLANNED_TAG,
    mergeIntervals,
    buildInternetTaggedMinutesByStore,
    buildPowerOutageMinutesByStore,
    buildPlannedMinutesByStore,
    applyInternetReportAdjustmentsToOfflineRows,
    applyPowerOutageAdjustmentToOfflineRows,
    taggedMinutesForStore,
    powerOutageMinutesForStore,
    lookupStoreKey
  };
})();
