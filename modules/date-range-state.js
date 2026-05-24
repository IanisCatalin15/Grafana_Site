/**
 * modules/date-range-state.js
 *
 * Page-scoped date selector (?from=&to=) logic. Pure functions take an explicit
 * view state object so they work across runGfnPanel re-executions.
 *
 * Loaded after constants.js, before script.js.
 */
(function () {
  'use strict';

  const _C = window.GFN_CONSTANTS || {};
  const STORAGE_KEY_SAVED_DATE_FILTER =
    _C.STORAGE_KEY_SAVED_DATE_FILTER || 'grafana_custom_panel_saved_date_filter';
  const DEFAULT_LIVE_DATE_FROM = _C.DEFAULT_LIVE_DATE_FROM || 'now-12h';
  const DEFAULT_LIVE_DATE_TO = _C.DEFAULT_LIVE_DATE_TO || 'now';
  const LIVE_UNREPORTED_DEVICE_TYPE = _C.LIVE_UNREPORTED_DEVICE_TYPE || 'unreported';

  /**
   * @param {{ page: string, device: string, offline: boolean }} viewState
   */
  function isDateAwareView(viewState) {
    if (!viewState) return false;
    if (viewState.page === 'reporting') return true;
    if (viewState.page === 'router-timeline') return true;
    if (viewState.page === 'live') {
      if (viewState.offline) return true;
      if (viewState.device === LIVE_UNREPORTED_DEVICE_TYPE) return true;
    }
    return false;
  }

  function urlDateRangeInfo() {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    const to = params.get('to');
    if (!from || !to) return { kind: 'none', from: null, to: null };
    if (to === 'now' && /^now-\d+[hd]$/.test(from)) {
      return { kind: 'live', from, to };
    }
    return { kind: 'historical', from, to };
  }

  function readSavedDateFilter() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SAVED_DATE_FILTER);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.from && parsed.to) {
        return { from: String(parsed.from), to: String(parsed.to) };
      }
    } catch (_e) { /* ignore */ }
    return null;
  }

  function writeSavedDateFilter(value) {
    try {
      if (value && value.from && value.to) {
        localStorage.setItem(
          STORAGE_KEY_SAVED_DATE_FILTER,
          JSON.stringify({ from: String(value.from), to: String(value.to) })
        );
      } else {
        localStorage.removeItem(STORAGE_KEY_SAVED_DATE_FILTER);
      }
    } catch (_e) { /* ignore */ }
  }

  /**
   * Reconcile URL ?from=&to= with view. Returns true if location was rewritten
   * (caller should stop — full reload in flight).
   *
   * @param {{ page: string, device: string, offline: boolean }} viewState
   */
  function syncDateFilterUrlForView(viewState) {
    const info = urlDateRangeInfo();
    const dateAware = isDateAwareView(viewState);
    const params = new URLSearchParams(window.location.search);

    if (dateAware) {
      const saved = readSavedDateFilter();
      if (saved && (info.from !== saved.from || info.to !== saved.to)) {
        params.set('from', saved.from);
        params.set('to', saved.to);
        window.location.search = params.toString();
        return true;
      }
      return false;
    }

    if (info.kind === 'historical') {
      writeSavedDateFilter({ from: info.from, to: info.to });
      params.set('from', DEFAULT_LIVE_DATE_FROM);
      params.set('to', DEFAULT_LIVE_DATE_TO);
      window.location.search = params.toString();
      return true;
    }
    return false;
  }

  window.GFN_DATE_RANGE = {
    isDateAwareView,
    urlDateRangeInfo,
    readSavedDateFilter,
    writeSavedDateFilter,
    syncDateFilterUrlForView,
    DEFAULT_LIVE_DATE_FROM,
    DEFAULT_LIVE_DATE_TO
  };
})();
