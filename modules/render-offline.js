/**
 * modules/render-offline.js
 *
 * Offline Time Report table renderer + sorting handler. Pulled out of the
 * monolithic script.js — this view is fully isolated from the live UI.
 *
 * Utility helpers (formatTime, escapeHtml, lookupOntForOfflineStore, …) are
 * read from the existing GFN_* globals so we don't need to thread every
 * single helper through `deps`.
 *
 * Public API:
 *   window.GFN_RENDER_OFFLINE.buildOfflineStoreData(offlineReportData, dataMap)
 *   window.GFN_RENDER_OFFLINE.renderOfflineTable(htmlNode, opts)
 *   window.GFN_RENDER_OFFLINE.setupOfflineTableHeaderSorting(htmlNode, opts)
 */
(function () {
  'use strict';

  function helpers() {
    const _U  = window.GFN_UTILS    || {};
    const _DF = window.GFN_DEVICE_FORMAT || {};
    const _PS = window.GFN_PARSERS  || {};
    return {
      escapeHtml: _U.escapeHtml || String,
      escapeAttr: _U.escapeAttr || String,
      formatTime: _U.formatTime || ((m) => `${m}m`),
      naturalSortStores: _DF.naturalSortStores || ((a, b) => String(a.store).localeCompare(String(b.store))),
      OFFLINE_UPTIME_SCHEDULE: _PS.OFFLINE_UPTIME_SCHEDULE,
      getPanelTimeRangeMs: _PS.getPanelTimeRangeMs,
      scheduledMinutesInRange: _PS.scheduledMinutesInRange,
      formatUptimePercent: _PS.formatUptimePercent || ((v) => v == null ? '—' : `${v.toFixed(1)}%`),
      uptimePercentCellClass: _PS.uptimePercentCellClass || (() => 'time-cell'),
      lookupOntForOfflineStore: _PS.lookupOntForOfflineStore || (() => null),
      extractStoreCode: _DF.extractStoreCode || (() => ''),
      applyInternetUptimeToOfflineRows: _PS.applyInternetUptimeToOfflineRows || (() => {}),
      applyPowerOutageAdjustmentToOfflineRows: (window.GFN_OFFLINE_POWER_OUTAGE || {}).applyPowerOutageAdjustmentToOfflineRows || (() => {}),
      applyInternetReportAdjustmentsToOfflineRows: (window.GFN_OFFLINE_POWER_OUTAGE || {}).applyInternetReportAdjustmentsToOfflineRows || (() => {}),
      buildRouterOntByStore: _PS.buildRouterOntByStore || (() => ({})),
      offlinePrimaryUptimeTooltip: _U.offlinePrimaryUptimeTooltip || (() => ''),
      offlinePrimaryUptimeTooltipTotal: _U.offlinePrimaryUptimeTooltipTotal || (() => ''),
      offlineBackupUptimeTooltip: _U.offlineBackupUptimeTooltip || (() => ''),
      offlineBackupUptimeTooltipTotal: _U.offlineBackupUptimeTooltipTotal || (() => ''),
      offlineInternetUptimeTooltip: _U.offlineInternetUptimeTooltip || (() => ''),
      offlineInternetUptimeTooltipTotal: _U.offlineInternetUptimeTooltipTotal || (() => '')
    };
  }

  function getCellClass(value) {
    if (value > 60) return 'highlight-critical';
    if (value > 15) return 'highlight-warning';
    return 'time-cell';
  }

  function buildOfflineStoreData(offlineReportData, dataMap) {
    const PS = window.GFN_PARSERS || {};
    const resolveCanonical = PS.resolveCanonicalOfflineStoreLabel || null;
    const storeDataMap = {};
    const legacyNumericKeys = new Set([
      'bothDown', 'backup', 'cr1', 'cr2', 'cr3', 'nuc', 'm1', 'm2', 'pc'
    ]);
    const emptyRow = (store) => ({
      store,
      bothDown: 0, backup: 0,
      cr1: 0, cr2: 0, cr3: 0,
      nuc: 0, m1: 0, m2: 0, pc: 0,
      primaryDownScheduled: null,
      backupDownScheduled: null,
      internetDownScheduled: null
    });
    const applyMetric = (row, mt, value) => {
      if (mt === 'primaryDownScheduled' || mt === 'backupDownScheduled' || mt === 'internetDownScheduled') {
        row[mt] = value;
      } else if (legacyNumericKeys.has(mt)) {
        row[mt] = Math.max(row[mt] || 0, value || 0);
      }
    };

    (offlineReportData || []).forEach((item) => {
      const rawStore = item && item.store;
      if (!rawStore) return;
      let storeKey = String(rawStore);
      if (resolveCanonical && dataMap) {
        const canonical = resolveCanonical(rawStore, dataMap);
        if (!canonical) return;
        storeKey = canonical;
      }
      if (!storeDataMap[storeKey]) {
        storeDataMap[storeKey] = emptyRow(storeKey);
      }
      const mt = item.metricType;
      if (!mt) return;
      applyMetric(storeDataMap[storeKey], mt, item.timeOffline);
    });

    let storeArray = Object.values(storeDataMap);
    const excludedStores = ['per-store', 'total', 'sum', '', 'unknown', 'value', 'ar0000'];
    storeArray = storeArray.filter((item) => !excludedStores.includes(String(item.store || '').toLowerCase()));
    return storeArray;
  }

  function totalMinutesForRow(row) {
    return (row.bothDown || 0) + (row.backup || 0) + (row.cr1 || 0)
      + (row.cr2 || 0) + (row.cr3 || 0) + (row.nuc || 0)
      + (row.m1 || 0) + (row.m2 || 0) + (row.pc || 0);
  }

  function compareByColumn(a, b, key, direction) {
    const dir = direction === 'asc' ? 1 : -1;
    if (key === 'store') return dir * a.store.localeCompare(b.store);
    if (key === 'total') {
      const diff = totalMinutesForRow(a) - totalMinutesForRow(b);
      return diff !== 0 ? dir * diff : a.store.localeCompare(b.store);
    }
    if (key === 'primaryUptimePct' || key === 'backupUptimePct' || key === 'internetUptimePct') {
      const va = a[key];
      const vb = b[key];
      const na = va != null && Number.isFinite(Number(va)) ? Number(va) : null;
      const nb = vb != null && Number.isFinite(Number(vb)) ? Number(vb) : null;
      if (na == null && nb == null) return a.store.localeCompare(b.store);
      if (na == null) return 1;
      if (nb == null) return -1;
      if (na !== nb) return dir * (na - nb);
      return a.store.localeCompare(b.store);
    }
    const valA = Number(a[key] || 0);
    const valB = Number(b[key] || 0);
    return valA !== valB ? dir * (valA - valB) : a.store.localeCompare(b.store);
  }

  function renderOfflineTable(htmlNode, opts) {
    const h = helpers();
    const tbody = htmlNode.getElementById('offline-time-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Time range display
    const timeRangeDisplay = htmlNode.getElementById('time-range-display');
    if (timeRangeDisplay) {
      const urlParams = new URLSearchParams(window.location.search);
      const from = urlParams.get('from');
      let timeRangeText = 'Last 12 hours';
      if (from) {
        if (from.startsWith('now-')) {
          const timeValue = from.replace('now-', '');
          if (timeValue.includes('h')) timeRangeText = `Last ${timeValue.replace('h', ' hours')}`;
          else if (timeValue.includes('d')) timeRangeText = `Last ${timeValue.replace('d', ' days')}`;
          else timeRangeText = `Last ${timeValue}`;
        } else if (!isNaN(Number(from))) {
          timeRangeText = 'Custom Range';
        }
      }
      timeRangeDisplay.textContent = timeRangeText;
    }

    const offlineReportData = opts && opts.offlineReportData;
    const searchQuery = (opts && opts.searchQuery) || '';
    const sortColumn = opts && opts.sortColumn;
    const sortDirection = (opts && opts.sortDirection) || 'desc';
    const sortMode = (opts && opts.sortMode) || 'consecutive';
    const latestGrafanaData = opts && opts.latestGrafanaData;
    const dataMap = (opts && opts.dataMap) || {};
    const effectiveRangeBoundsFn = opts && opts.getEffectiveRangeBounds;
    const powerOutageByStore = (opts && opts.powerOutageByStore) || null;
    const plannedByStore = (opts && opts.plannedByStore) || null;

    let storeArray = buildOfflineStoreData(offlineReportData, opts && opts.dataMap);
    const panelBounds = (h.getPanelTimeRangeMs && h.getPanelTimeRangeMs(latestGrafanaData))
      || (effectiveRangeBoundsFn ? effectiveRangeBoundsFn() : { fromMs: 0, toMs: 0 });
    const ontByStoreOffline = h.buildRouterOntByStore(dataMap);
    h.applyInternetUptimeToOfflineRows(storeArray, panelBounds.fromMs, panelBounds.toMs, ontByStoreOffline);
    if (
      (powerOutageByStore && powerOutageByStore.size > 0) ||
      (plannedByStore && plannedByStore.size > 0)
    ) {
      const applyAdjustments = h.applyInternetReportAdjustmentsToOfflineRows || h.applyPowerOutageAdjustmentToOfflineRows;
      applyAdjustments(storeArray, powerOutageByStore, plannedByStore, panelBounds.fromMs, panelBounds.toMs, h.OFFLINE_UPTIME_SCHEDULE, {
        scheduledMinutesInRange: h.scheduledMinutesInRange,
        extractStoreCode: h.extractStoreCode,
        lookupOntForOfflineStore: h.lookupOntForOfflineStore,
        ontByStore: ontByStoreOffline
      });
    }

    if (searchQuery) {
      const query = String(searchQuery).toLowerCase();
      storeArray = storeArray.filter((item) => item.store.toLowerCase().includes(query));
    }

    if (sortColumn) {
      storeArray.sort((a, b) => compareByColumn(a, b, sortColumn, sortDirection));
    } else if (sortMode === 'consecutive') {
      storeArray.sort(h.naturalSortStores);
    } else {
      storeArray.sort((a, b) => compareByColumn(a, b, 'total', 'desc'));
    }

    const headers = htmlNode.querySelectorAll('.offline-time-table thead th.sortable[data-sort-key]');
    headers.forEach((th) => {
      th.classList.remove('is-active', 'sort-asc', 'sort-desc');
      const key = th.getAttribute('data-sort-key');
      if (key === sortColumn) {
        th.classList.add('is-active', sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    if (storeArray.length === 0) {
      tbody.innerHTML = '<tr><td colspan="13" class="empty-msg">No offline data reported within this time range.</td></tr>';
      return;
    }

    const totals = {
      bothDown: 0, backup: 0,
      cr1: 0, cr2: 0, cr3: 0,
      nuc: 0, m1: 0, m2: 0, pc: 0,
      primaryUptimePct: null,
      backupUptimePct: null,
      internetUptimePct: null
    };
    storeArray.forEach((item) => {
      totals.bothDown += item.bothDown || 0;
      totals.backup   += item.backup   || 0;
      totals.cr1 += item.cr1 || 0;
      totals.cr2 += item.cr2 || 0;
      totals.cr3 += item.cr3 || 0;
      totals.nuc += item.nuc || 0;
      totals.m1  += item.m1  || 0;
      totals.m2  += item.m2  || 0;
      totals.pc  += item.pc  || 0;
    });

    const Srow = h.scheduledMinutesInRange
      ? h.scheduledMinutesInRange(panelBounds.fromMs, panelBounds.toMs, h.OFFLINE_UPTIME_SCHEDULE)
      : 0;
    let sumPd = 0, sumBd = 0, sumId = 0, sumIdRaw = 0, sumPo = 0, sumPl = 0;
    let nPrim = 0, nBak = 0, nInt = 0;
    storeArray.forEach((item) => {
      const ont = h.lookupOntForOfflineStore(item.store, ontByStoreOffline);
      if (!ont || ont.primary !== 'none') {
        nPrim++;
        sumPd += item.primaryDownScheduled != null && Number.isFinite(item.primaryDownScheduled)
          ? Math.max(0, item.primaryDownScheduled)
          : 0;
      }
      if (!ont || ont.backup !== 'none') {
        nBak++;
        sumBd += item.backupDownScheduled != null && Number.isFinite(item.backupDownScheduled)
          ? Math.max(0, item.backupDownScheduled)
          : 0;
      }
      nInt++;
      const idRaw = item.internetDownScheduled != null && Number.isFinite(item.internetDownScheduled)
        ? Math.max(0, item.internetDownScheduled)
        : 0;
      sumIdRaw += idRaw;
      const idEff = item.internetDownEffective != null && Number.isFinite(item.internetDownEffective)
        ? Math.max(0, item.internetDownEffective)
        : idRaw;
      sumId += idEff;
      sumPo += item.internetPowerOutageReportMinutes != null && Number.isFinite(item.internetPowerOutageReportMinutes)
        ? Math.max(0, item.internetPowerOutageReportMinutes)
        : 0;
      sumPl += item.internetPlannedReportMinutes != null && Number.isFinite(item.internetPlannedReportMinutes)
        ? Math.max(0, item.internetPlannedReportMinutes)
        : 0;
    });
    if (Srow > 0 && nPrim > 0) totals.primaryUptimePct  = ((nPrim * Srow - sumPd) / (nPrim * Srow)) * 100;
    if (Srow > 0 && nBak  > 0) totals.backupUptimePct   = ((nBak  * Srow - sumBd) / (nBak  * Srow)) * 100;
    if (Srow > 0 && nInt  > 0) totals.internetUptimePct = ((nInt  * Srow - sumId) / (nInt  * Srow)) * 100;

    let html = `
      <tr class="total-row">
        <td class="store-name-cell total-label">TOTAL (${storeArray.length} stores)</td>
        <td class="${getCellClass(totals.bothDown)}">${h.formatTime(totals.bothDown)}</td>
        <td class="${getCellClass(totals.backup)}">${h.formatTime(totals.backup)}</td>
        <td class="${getCellClass(totals.cr1)}">${h.formatTime(totals.cr1)}</td>
        <td class="${getCellClass(totals.cr2)}">${h.formatTime(totals.cr2)}</td>
        <td class="${getCellClass(totals.cr3)}">${h.formatTime(totals.cr3)}</td>
        <td class="${getCellClass(totals.nuc)}">${h.formatTime(totals.nuc)}</td>
        <td class="${getCellClass(totals.m1)}">${h.formatTime(totals.m1)}</td>
        <td class="${getCellClass(totals.m2)}">${h.formatTime(totals.m2)}</td>
        <td class="${getCellClass(totals.pc)}">${h.formatTime(totals.pc)}</td>
        <td class="${h.uptimePercentCellClass(totals.primaryUptimePct)}" title="${h.escapeAttr(h.offlinePrimaryUptimeTooltipTotal(nPrim, sumPd, Srow))}">${h.formatUptimePercent(totals.primaryUptimePct)}</td>
        <td class="${h.uptimePercentCellClass(totals.backupUptimePct)}" title="${h.escapeAttr(h.offlineBackupUptimeTooltipTotal(nBak, sumBd, Srow))}">${h.formatUptimePercent(totals.backupUptimePct)}</td>
        <td class="${h.uptimePercentCellClass(totals.internetUptimePct)}" title="${h.escapeAttr(h.offlineInternetUptimeTooltipTotal(storeArray.length, sumIdRaw, Srow, sumPo, sumPl))}">${h.formatUptimePercent(totals.internetUptimePct)}</td>
      </tr>
    `;

    storeArray.forEach((item) => {
      const ont = h.lookupOntForOfflineStore(item.store, ontByStoreOffline);
      html += `
        <tr>
          <td class="store-name-cell">${h.escapeHtml(item.store)}</td>
          <td class="${getCellClass(item.bothDown)}">${h.formatTime(item.bothDown)}</td>
          <td class="${getCellClass(item.backup)}">${h.formatTime(item.backup)}</td>
          <td class="${getCellClass(item.cr1)}">${h.formatTime(item.cr1)}</td>
          <td class="${getCellClass(item.cr2)}">${h.formatTime(item.cr2)}</td>
          <td class="${getCellClass(item.cr3)}">${h.formatTime(item.cr3)}</td>
          <td class="${getCellClass(item.nuc)}">${h.formatTime(item.nuc)}</td>
          <td class="${getCellClass(item.m1)}">${h.formatTime(item.m1)}</td>
          <td class="${getCellClass(item.m2)}">${h.formatTime(item.m2)}</td>
          <td class="${getCellClass(item.pc)}">${h.formatTime(item.pc)}</td>
          <td class="${h.uptimePercentCellClass(item.primaryUptimePct)}" title="${h.escapeAttr(h.offlinePrimaryUptimeTooltip(item, Srow, ont))}">${h.formatUptimePercent(item.primaryUptimePct)}</td>
          <td class="${h.uptimePercentCellClass(item.backupUptimePct)}" title="${h.escapeAttr(h.offlineBackupUptimeTooltip(item, Srow, ont))}">${h.formatUptimePercent(item.backupUptimePct)}</td>
          <td class="${h.uptimePercentCellClass(item.internetUptimePct)}" title="${h.escapeAttr(h.offlineInternetUptimeTooltip(item, Srow))}">${h.formatUptimePercent(item.internetUptimePct)}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  function setupOfflineTableHeaderSorting(htmlNode, opts) {
    const thead = htmlNode.querySelector('.offline-time-table thead');
    if (!thead) return;
    thead.onclick = function (e) {
      const th = e.target.closest('th.sortable[data-sort-key]');
      if (!th) return;
      const key = th.getAttribute('data-sort-key');
      if (!key) return;
      const cur = (opts && opts.getSort && opts.getSort()) || { column: null, direction: 'desc' };
      let nextDir;
      if (cur.column === key) {
        nextDir = cur.direction === 'desc' ? 'asc' : 'desc';
      } else {
        nextDir = 'desc';
      }
      if (opts && opts.onSortChange) {
        opts.onSortChange(key, nextDir);
      }
    };
  }

  window.GFN_RENDER_OFFLINE = {
    buildOfflineStoreData,
    renderOfflineTable,
    setupOfflineTableHeaderSorting,
    getCellClass,
    totalMinutesForRow
  };
})();
