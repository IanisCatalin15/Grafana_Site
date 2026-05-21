/**
 * modules/device-format.js
 *
 * Pure helpers for device naming, labels, store-code parsing, incident
 * duration formatting. No DOM access, no closure dependencies.
 *
 * Hot paths (formatDeviceLabel, formatUnreportedTimelineCompact) use a
 * small LRU cache; we keep the cache module-local so cache reuse survives
 * across runGfnPanel ticks.
 *
 * Exposes `window.GFN_DEVICE_FORMAT` with all helpers; runGfnPanel rebinds
 * each entry to a local `const` at the top of the closure.
 */
(function () {
  'use strict';

  const _U = (typeof window !== 'undefined' && window.GFN_UTILS) || {};
  const formatTime = _U.formatTime || function (m) { return String(m); };
  const DTF_COMPACT = _U.DTF_COMPACT;
  const ISO_DT_CACHE_MAX = _U.ISO_DT_CACHE_MAX || 1024;

  // ---- Store / device key normalizers ----------------------------------------
  function normalizeDeviceKey(deviceName) {
    return String(deviceName || '').trim().toUpperCase();
  }

  function extractStoreCode(deviceName) {
    const match = String(deviceName || '').trim().match(/^(ar\d+)/i);
    return match ? match[1].toUpperCase() : '';
  }

  function normalizeStoreCodeInput(storeDigitsOrCode) {
    const raw = String(storeDigitsOrCode || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return `AR${digits.padStart(4, '0')}`;
  }

  function toEpochMs(value) {
    if (!value) return null;
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.getTime();
  }

  function minutesSince(isoDateTime) {
    if (!isoDateTime) return null;
    const start = new Date(isoDateTime);
    if (Number.isNaN(start.getTime())) return null;
    const minutes = Math.floor((Date.now() - start.getTime()) / (1000 * 60));
    return Math.max(0, minutes);
  }

  // ---- Device-type canonicalization ------------------------------------------
  const DEVICE_CATEGORY_LABELS = {
    'price-checkers': 'Price Checker',
    'cash-register-1': 'Cash Register K1',
    'cash-register-2': 'Cash Register K2',
    'cash-register-3': 'Cash Register K3',
    'cash-register': 'Cash Register',
    'music': 'Music',
    'inside-music': 'Music M1',
    'outside-music': 'Music M2',
    'primary-link': 'Primary Link',
    'backup-link': 'Backup Link',
    'admin-pc': 'Admin PC',
    'switches-primary': 'Primary Switch',
    'switches-secondary': 'Secondary Switch',
    'routers': 'Router'
  };

  const DEVICE_TYPE_ALIASES = {
    'pricechecker': 'price-checkers',
    'pricecheckers': 'price-checkers',
    'cashregister': 'cash-register',
    'cashregister1': 'cash-register-1',
    'cashregister2': 'cash-register-2',
    'cashregister3': 'cash-register-3',
    'cashregisterk1': 'cash-register-1',
    'cashregisterk2': 'cash-register-2',
    'cashregisterk3': 'cash-register-3',
    'insidemusic': 'inside-music',
    'outsidemusic': 'outside-music',
    'switchprimary': 'switches-primary',
    'switchessecondary': 'switches-secondary',
    'switchsecondary': 'switches-secondary',
    'switchesprimary': 'switches-primary',
    'primarylink': 'primary-link',
    'backuplink': 'backup-link',
    'router': 'routers'
  };

  function normalizeDeviceTypeKey(deviceType) {
    const raw = String(deviceType || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (DEVICE_CATEGORY_LABELS[lower]) return lower;
    const compact = lower.replace(/[^a-z0-9]+/g, '');
    return DEVICE_TYPE_ALIASES[compact] || lower;
  }

  function formatDeviceCategory(deviceType) {
    const key = normalizeDeviceTypeKey(deviceType);
    return DEVICE_CATEGORY_LABELS[key] || (key || 'Device');
  }

  // ---- Device-label cache + regex matchers -----------------------------------
  const DEVICE_LABEL_CACHE = new Map();
  const DEVICE_LABEL_CACHE_MAX = 512;
  const RE_PRICE_P_STRICT = /-P(\d+)$/i;
  const RE_PRICE_PC_STRICT = /-PC(\d+)$/i;
  const RE_PRICE_HOST_STRICT = /-p(\d+)(?:\.|$)/i;
  const RE_PRICE_PC_LOOSE = /(?:^|[^a-z0-9])PC(\d+)(?:[^a-z0-9]|$)/i;
  const RE_PRICE_P_LOOSE = /(?:^|[^a-z0-9])P(\d+)(?:[^a-z0-9]|$)/i;
  const RE_MUSIC_STRICT = /-M([12])(?:[.\-_]|$)/i;
  const RE_MUSIC_LOOSE = /(?:^|[^a-z0-9])M([12])(?:[^a-z0-9]|$)/i;
  const RE_CASH_TYPE_NUM = /^cash-register-(\d+)$/i;
  const RE_CASH_CASA = /Casa[_\-\s]?(\d+)/i;
  const RE_CASH_CR = /(?:^|[^a-z0-9])CR(\d+)(?:[^a-z0-9]|$)/i;

  function formatDeviceLabel(deviceName, deviceType, sourceAlert) {
    const name = String(deviceName || '').trim();
    const dt = normalizeDeviceTypeKey(deviceType);
    const cacheKey = name + '|' + dt + '|' + (sourceAlert || '');
    const cached = DEVICE_LABEL_CACHE.get(cacheKey);
    if (cached !== undefined) return cached;
    const category = DEVICE_CATEGORY_LABELS[dt] || (dt || 'Device');
    let out;
    if (!name) {
      out = category;
    } else if (dt === 'price-checkers') {
      const m =
        name.match(RE_PRICE_P_STRICT) ||
        name.match(RE_PRICE_PC_STRICT) ||
        name.match(RE_PRICE_HOST_STRICT) ||
        name.match(RE_PRICE_PC_LOOSE) ||
        name.match(RE_PRICE_P_LOOSE);
      out = m ? `Price Checker P${m[1]}` : 'Price Checker';
    } else if (dt === 'inside-music') {
      out = 'Music M1';
    } else if (dt === 'outside-music') {
      out = 'Music M2';
    } else if (dt === 'music') {
      const m = name.match(RE_MUSIC_STRICT) || name.match(RE_MUSIC_LOOSE);
      out = m ? `Music M${m[1]}` : 'Music';
    } else if (dt === 'cash-register' || RE_CASH_TYPE_NUM.test(dt)) {
      const casa = name.match(RE_CASH_CASA);
      if (casa) out = `Cash Register ${casa[1]}`;
      else {
        const cr = name.match(RE_CASH_CR);
        if (cr) out = `Cash Register ${cr[1]}`;
        else {
          const tm = dt.match(RE_CASH_TYPE_NUM);
          out = tm ? `Cash Register ${tm[1]}` : 'Cash Register';
        }
      }
    } else if (dt === 'primary-link') {
      if (/\b-INTERNET$/i.test(name)) out = 'Internet Down';
      else out = 'Primary Down';
    } else if (dt === 'backup-link') {
      out = 'Backup Down';
    } else {
      const storeCode = extractStoreCode(name);
      const suffix = name.includes('-') ? name.split('-').pop() : name;
      const suffixUpper = suffix.toUpperCase();
      if (storeCode && suffixUpper === storeCode) {
        out = category;
      } else {
        const categoryLastToken = category.split(' ').pop();
        if (categoryLastToken && suffixUpper === String(categoryLastToken).toUpperCase()) {
          out = category;
        } else {
          out = `${category} - ${suffix}`;
        }
      }
    }
    if (DEVICE_LABEL_CACHE.size >= DEVICE_LABEL_CACHE_MAX) {
      const firstKey = DEVICE_LABEL_CACHE.keys().next().value;
      DEVICE_LABEL_CACHE.delete(firstKey);
    }
    DEVICE_LABEL_CACHE.set(cacheKey, out);
    return out;
  }

  function formatDeviceToastLabel(deviceName) {
    const raw = String(deviceName || '').trim();
    if (!raw) return raw;
    const noFqdn = raw.split('.')[0];
    return noFqdn.toUpperCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getIncidentDeviceToken(deviceType) {
    const map = {
      'inside-music': 'M1',
      'outside-music': 'M2',
      'cash-register-1': 'K1',
      'cash-register-2': 'K2',
      'cash-register-3': 'K3',
      'price-checkers': 'P',
      'primary-link': 'PRIMARY',
      'backup-link': 'BACKUP'
    };
    return map[deviceType] || 'DEVICE';
  }

  function buildIncidentDeviceName(device, deviceType) {
    const rawName = String((device && device.name) || '').trim();
    const storeCode = extractStoreCode(rawName);
    if (!storeCode) return rawName;
    if (deviceType === 'price-checkers' && /-P\d+$/i.test(rawName)) {
      return rawName;
    }
    return `${storeCode}-${getIncidentDeviceToken(deviceType)}`;
  }

  function normalizeIncidentKey(deviceName, deviceType) {
    return `${String(deviceType || '').trim().toLowerCase()}::${normalizeDeviceKey(deviceName)}`;
  }

  function formatIncidentStatus(status) {
    if (status === 'open') return 'Active';
    if (status === 'closed') return 'Online';
    return status || '-';
  }

  function formatIncidentDuration(row) {
    const hasDuration = row && row.duration_minutes !== null && row.duration_minutes !== undefined;
    if (hasDuration) {
      const minutes = Number(row.duration_minutes);
      if (minutes <= 0 && row && row.incident_status === 'open') return '<1m';
      return formatTime(minutes);
    }
    if (row && row.incident_status === 'open' && row.offline_started_at) {
      const liveMinutes = minutesSince(row.offline_started_at);
      if (liveMinutes !== null) {
        if (liveMinutes <= 0) return '<1m';
        return formatTime(liveMinutes);
      }
    }
    return '-';
  }

  function formatTimeToReport(row) {
    if (row && row.time_to_report_minutes !== null && row.time_to_report_minutes !== undefined) {
      return formatTime(Number(row.time_to_report_minutes));
    }
    if (row && row.incident_offline_started_at && row.created_at) {
      const start = new Date(row.incident_offline_started_at);
      const reported = new Date(row.created_at);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(reported.getTime())) {
        const minutes = Math.max(0, Math.floor((reported.getTime() - start.getTime()) / (1000 * 60)));
        return formatTime(minutes);
      }
    }
    return 'N/A';
  }

  function formatReportToResolve(row) {
    if (row && row.report_to_resolve_minutes !== null && row.report_to_resolve_minutes !== undefined) {
      return formatTime(Number(row.report_to_resolve_minutes));
    }
    return 'N/A';
  }

  // ---- Live unreported duration helpers -------------------------------------
  function unreportedLiveDurationDisplay(row) {
    if (row && row.incident_status === 'open') {
      const start = toEpochMs(row.offline_started_at);
      if (start == null) return '—';
      const mins = Math.max(0, Math.floor((Date.now() - start) / 60000));
      return formatTime(mins);
    }
    const d = row && row.duration_minutes;
    if (d != null && d !== '') return formatTime(Number(d));
    return '—';
  }

  // unreportedLiveDurationCompact mirrors unreportedLiveDurationDisplay today.
  // Kept as a separate symbol because the panel may eventually want a shorter
  // form for narrow viewports (e.g. mobile breakpoint < 480px).
  function unreportedLiveDurationCompact(row) {
    return unreportedLiveDurationDisplay(row);
  }

  const ISO_DT_COMPACT_CACHE = new Map();
  function formatUnreportedTimelineCompact(value) {
    if (!value) return '—';
    const cached = ISO_DT_COMPACT_CACHE.get(value);
    if (cached !== undefined) return cached;
    const dt = new Date(value);
    let out;
    if (Number.isNaN(dt.getTime())) {
      out = '—';
    } else if (DTF_COMPACT) {
      out = DTF_COMPACT.format(dt);
    } else {
      out = dt.toLocaleString('en-GB', {
        day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    }
    if (ISO_DT_COMPACT_CACHE.size >= ISO_DT_CACHE_MAX) {
      const firstKey = ISO_DT_COMPACT_CACHE.keys().next().value;
      ISO_DT_COMPACT_CACHE.delete(firstKey);
    }
    ISO_DT_COMPACT_CACHE.set(value, out);
    return out;
  }

  // ---- Owner / report-tag normalizers ---------------------------------------
  function isUnknownOwner(value) {
    return !String(value || '').trim();
  }

  function normalizeOwnerUsername(value, fallback = '') {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const at = raw.indexOf('@');
    const user = at > 0 ? raw.slice(0, at).trim() : raw;
    return user || fallback;
  }

  function capitalizeOwnerLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return raw;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  function ownerDisplayName(value, fallback = '-') {
    const normalized = normalizeOwnerUsername(value, '');
    if (!normalized) return fallback;
    try {
      const bootUser = (typeof window !== 'undefined' && window.grafanaBootData && window.grafanaBootData.user) || {};
      const currentName = String((bootUser && bootUser.name) || '').trim();
      const currentLogin = normalizeOwnerUsername((bootUser && bootUser.login) || '', '').toLowerCase();
      const currentEmail = normalizeOwnerUsername((bootUser && bootUser.email) || '', '').toLowerCase();
      const normalizedLower = normalized.toLowerCase();
      if (
        currentName &&
        (normalizedLower === currentLogin || normalizedLower === currentEmail)
      ) {
        return currentName;
      }
    } catch (_error) {
      // Ignore; fallback to normalized owner id.
    }
    return capitalizeOwnerLabel(normalized || fallback);
  }

  function normalizeReportTag(value) {
    return String(value || '').trim().toLowerCase();
  }

  function reportTagLabel(value, fallback = '') {
    const tag = normalizeReportTag(value);
    if (!tag) return fallback;
    return tag.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }

  function isInternetIssueType(deviceType, deviceName = '') {
    const dt = String(deviceType || '').trim().toLowerCase();
    const dn = String(deviceName || '').trim().toUpperCase();
    return dt === 'primary-link' || dt === 'backup-link' || dn.endsWith('-INTERNET');
  }

  // INTERNET_REPORT_TAGS / DEVICE_REPORT_TAGS imported from GFN_CONSTANTS so
  // both modules share the canonical lists.
  function allowedTagsForDevice(deviceType, deviceName = '') {
    const C = (typeof window !== 'undefined' && window.GFN_CONSTANTS) || {};
    return isInternetIssueType(deviceType, deviceName)
      ? (C.INTERNET_REPORT_TAGS || [])
      : (C.DEVICE_REPORT_TAGS || []);
  }

  // ---- Misc pure helpers -----------------------------------------------------
  function csvEscape(value, delimiter = ',') {
    if (value === null || value === undefined) return '';
    const str = String(value);
    const mustQuote = str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r');
    if (!mustQuote) return str;
    return `"${str.replace(/"/g, '""')}"`;
  }

  function naturalSortStores(a, b) {
    const extractNum = (str) => {
      const match = String(str || '').match(/(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };
    const numA = extractNum(a && a.store);
    const numB = extractNum(b && b.store);
    if (numA && numB) return numA - numB;
    return String((a && a.store) || '').localeCompare(String((b && b.store) || ''));
  }

  window.GFN_DEVICE_FORMAT = {
    normalizeDeviceKey,
    extractStoreCode,
    normalizeStoreCodeInput,
    toEpochMs,
    minutesSince,
    normalizeDeviceTypeKey,
    formatDeviceCategory,
    formatDeviceLabel,
    formatDeviceToastLabel,
    getIncidentDeviceToken,
    buildIncidentDeviceName,
    normalizeIncidentKey,
    formatIncidentStatus,
    formatIncidentDuration,
    formatTimeToReport,
    formatReportToResolve,
    unreportedLiveDurationDisplay,
    unreportedLiveDurationCompact,
    formatUnreportedTimelineCompact,
    isUnknownOwner,
    normalizeOwnerUsername,
    capitalizeOwnerLabel,
    ownerDisplayName,
    normalizeReportTag,
    reportTagLabel,
    isInternetIssueType,
    allowedTagsForDevice,
    csvEscape,
    naturalSortStores
  };
})();
