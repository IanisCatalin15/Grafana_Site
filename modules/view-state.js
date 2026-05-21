/**
 * modules/view-state.js
 *
 * Single source of truth for dashboard navigation: page, device, offline view.
 * Survives runGfnPanel re-execution; bumps viewVersion on each navigation so
 * async renders from a previous view can bail out before touching the DOM.
 *
 * Loaded BEFORE script.js and shell.js. Exposed as window.GFN_VIEW_STATE.
 */
(function () {
  'use strict';

  const _C = window.GFN_CONSTANTS || {};
  const STORAGE_KEY_PAGE = _C.STORAGE_KEY_DASHBOARD_PAGE || 'grafana_custom_panel_dashboard_page';
  const STORAGE_KEY_DEVICE = _C.STORAGE_KEY_DEVICE || 'grafana_custom_panel_device_type';
  const STORAGE_KEY_OFFLINE = _C.STORAGE_KEY_OFFLINE_VIEW || 'grafana_custom_panel_offline_view';

  const VALID_PAGES = ['live', 'reporting', 'router-timeline'];

  function normalizeDevice(raw) {
    let device = raw ? String(raw) : 'routers';
    if (device === 'cash-register-1' || device === 'cash-register-2' || device === 'cash-register-3') {
      device = 'cash-registers';
    } else if (device === 'inside-music' || device === 'outside-music') {
      device = 'music';
    } else if (device === 'switches-primary' || device === 'switches-secondary') {
      device = 'switches';
    }
    return device;
  }

  function normalizePage(raw) {
    const page = raw ? String(raw) : 'live';
    return VALID_PAGES.includes(page) ? page : 'live';
  }

  function readPersistedState() {
    let page = 'live';
    let device = 'routers';
    let offline = false;
    try {
      page = normalizePage(localStorage.getItem(STORAGE_KEY_PAGE));
      device = normalizeDevice(localStorage.getItem(STORAGE_KEY_DEVICE));
      offline = localStorage.getItem(STORAGE_KEY_OFFLINE) === 'true';
    } catch (_e) { /* ignore */ }
    return { page, device, offline };
  }

  function persistState(state) {
    try {
      localStorage.setItem(STORAGE_KEY_PAGE, state.page);
      localStorage.setItem(STORAGE_KEY_DEVICE, state.device);
      localStorage.setItem(STORAGE_KEY_OFFLINE, state.offline ? 'true' : 'false');
    } catch (_e) { /* ignore */ }
  }

  function statesEqual(a, b) {
    return a.page === b.page && a.device === b.device && Boolean(a.offline) === Boolean(b.offline);
  }

  const initial = readPersistedState();
  let state = { ...initial };
  let viewVersion = 0;
  const subscribers = [];

  function notify() {
    const snapshot = getState();
    subscribers.forEach((fn) => {
      try { fn(snapshot, viewVersion); } catch (_e) { /* ignore */ }
    });
  }

  function getState() {
    return { page: state.page, device: state.device, offline: state.offline };
  }

  function getVersion() {
    return viewVersion;
  }

  function isVersion(version) {
    return version === viewVersion;
  }

  /**
   * @param {Partial<{page:string,device:string,offline:boolean}>} patch
   * @param {{ bumpVersion?: boolean, persist?: boolean, silent?: boolean }} [opts]
   * @returns {boolean} true if state changed
   */
  function setState(patch, opts) {
    const options = opts || {};
    const bumpVersion = options.bumpVersion !== false;
    const persist = options.persist !== false;
    const silent = options.silent === true;

    const next = { ...state };
    if (patch.page !== undefined) next.page = normalizePage(patch.page);
    if (patch.device !== undefined) next.device = normalizeDevice(patch.device);
    if (patch.offline !== undefined) next.offline = Boolean(patch.offline);

    // Reporting / Router Timeline pages never keep offline mode or a live-only device context.
    if (next.page === 'reporting' || next.page === 'router-timeline') {
      next.offline = false;
    }

    const changed = !statesEqual(state, next);
    if (!changed) return false;

    state = next;
    if (persist) persistState(state);
    if (bumpVersion) viewVersion += 1;
    if (!silent) notify();
    return true;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    return function unsubscribe() {
      const idx = subscribers.indexOf(fn);
      if (idx >= 0) subscribers.splice(idx, 1);
    };
  }

  window.GFN_VIEW_STATE = {
    getState,
    getVersion,
    isVersion,
    setState,
    subscribe,
    normalizeDevice,
    normalizePage,
    STORAGE_KEY_PAGE,
    STORAGE_KEY_DEVICE,
    STORAGE_KEY_OFFLINE
  };
})();
