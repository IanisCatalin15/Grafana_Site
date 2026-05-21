/**
 * shell.js — sidebar + topbar overlay for the verbatim Grafana panel.
 * Routes sidebar clicks through GFN_VIEW_STATE (atomic navigation) instead of
 * synthetic click cascades on legacy panel controls.
 */
(function () {
  'use strict';

  const STORAGE_COLLAPSED = 'aurora_shell_sidebar_collapsed';

  const ROUTES = {
    live: { title: 'Live', icon: 'fa-signal', page: 'live', device: 'routers', offline: false },
    'offline-time': { title: 'Offline Time Report', icon: 'fa-clock', page: 'live', device: 'routers', offline: true },
    incidents: { title: 'Incidents', icon: 'fa-triangle-exclamation', page: 'live', device: 'unreported', offline: false },
    'router-timeline': { title: 'Router Timeline', icon: 'fa-timeline', page: 'router-timeline', device: null, offline: false },
    reporting: { title: 'Incident & Reporting', icon: 'fa-chart-line', page: 'reporting', device: null, offline: false },
    switches: { title: 'Switches', icon: 'fa-network-wired', page: 'live', device: 'switches', offline: false },
    'admin-pc': { title: "Admin's PC", icon: 'fa-desktop', page: 'live', device: 'admin-pc', offline: false },
    'cash-registers': { title: 'Cash Registers', icon: 'fa-cash-register', page: 'live', device: 'cash-registers', offline: false },
    music: { title: 'Music', icon: 'fa-music', page: 'live', device: 'music', offline: false },
    'price-checkers': { title: 'Price Checkers', icon: 'fa-barcode', page: 'live', device: 'price-checkers', offline: false }
  };

  const NAV = [
    { group: 'Dashboard', items: ['live', 'offline-time', 'incidents', 'router-timeline', 'reporting'] },
    { group: 'Devices', items: ['switches', 'admin-pc', 'cash-registers', 'music', 'price-checkers'] }
  ];

  let shellReady = false;
  let suppressSync = false;

  function $(id) {
    return document.getElementById(id);
  }

  function viewStateApi() {
    return window.GFN_VIEW_STATE || null;
  }

  function readViewState() {
    const VS = viewStateApi();
    if (VS && VS.getState) return VS.getState();
    return { page: 'live', device: 'routers', offline: false };
  }

  function labelDown(raw) {
    if (raw == null) return false;
    const s = String(raw).trim().toLowerCase();
    return s === 'down' || s === 'offline' || /\bdown\b/.test(s);
  }

  function seriesValue(series) {
    const f = series && series.fields && series.fields[1];
    if (!f || !f.values || f.values.length < 1) return null;
    return f.values.get(f.values.length - 1);
  }

  function seriesLabels(series) {
    const f = series && series.fields && series.fields[1];
    return (f && f.labels) || {};
  }

  /**
   * Compute Internet Status + Offline Devices counts from Prometheus snapshot.
   */
  function computeCountsFromData(data) {
    const counts = {
      primary: 0,
      backup: 0,
      switches: 0,
      cash: 0,
      music: 0,
      price: 0
    };
    if (!data || !Array.isArray(data.series)) return counts;

    const routerSeen = new Set();

    for (const series of data.series) {
      const refId = series.refId;
      const labels = seriesLabels(series);
      const val = seriesValue(series);
      const num = val == null || !Number.isFinite(Number(val)) ? null : Number(val);

      if (refId === 'A' || refId === 'M') {
        const store = labels.store || labels.location || series.name || '';
        const key = String(store);
        if (routerSeen.has(key)) continue;
        routerSeen.add(key);
        if (labelDown(labels.ONT_Primary)) counts.primary += 1;
        if (labelDown(labels.ONT_Backup)) counts.backup += 1;
      } else if (refId === 'B' || refId === 'C') {
        if (num === 0) counts.switches += 1;
      } else if (refId === 'E' || refId === 'F' || refId === 'G') {
        if (num === 0) counts.cash += 1;
      } else if (refId === 'H' || refId === 'I') {
        if (num === 0) counts.music += 1;
      } else if (refId === 'K') {
        if (num === 0) counts.price += 1;
      }
    }

    return counts;
  }

  function setCountEl(id, n) {
    const el = $(id);
    if (!el) return;
    el.textContent = String(n);
    el.classList.remove('is-ok', 'is-warn', 'is-danger');
    if (n === 0) el.classList.add('is-ok');
    else if (n <= 3) el.classList.add('is-warn');
    else el.classList.add('is-danger');
  }

  function gfnShellUpdateCounts(data) {
    const c = computeCountsFromData(data);
    setCountEl('int-primary-offline', c.primary);
    setCountEl('int-backup-offline', c.backup);
    setCountEl('int-switch-offline', c.switches);
    setCountEl('int-cash-offline', c.cash);
    setCountEl('int-music-offline', c.music);
    setCountEl('int-price-offline', c.price);

    const band = $('shell-overview-band');
    if (band) {
      const vs = readViewState();
      const show = vs.page === 'live' && vs.device === 'routers' && !vs.offline;
      band.style.display = show ? '' : 'none';
    }
  }

  window.gfnShellUpdateCounts = gfnShellUpdateCounts;

  function buildSidebar() {
    const aside = $('app-sidebar');
    if (!aside || aside.dataset.built === '1') return;

    let html = `
      <div class="app-sidebar__brand">
        <div class="app-sidebar__logo" aria-hidden="true"></div>
        <div class="app-sidebar__brand-text">
          <div class="app-sidebar__title">Aurora</div>
        </div>
      </div>
      <nav class="app-sidebar__nav" aria-label="Main navigation">`;

    NAV.forEach(function (section, idx) {
      if (idx > 0) {
        html += '<hr class="app-sidebar__divider" />';
      }
      for (const routeId of section.items) {
        const r = ROUTES[routeId];
        if (!r) continue;
        html += `<button type="button" class="app-sidebar__item" data-route="${routeId}" title="${r.title}">
          <i class="fa-solid fa-fw ${r.icon}" aria-hidden="true"></i>
          <span>${r.title}</span>
        </button>`;
      }
    });
    html += '</nav>';
    html += `
      <div class="app-sidebar__footer">
        <button type="button" class="app-sidebar__collapse" id="app-sidebar-collapse" aria-label="Collapse sidebar" title="Collapse sidebar">
          <i class="fa-solid fa-fw fa-angles-right" aria-hidden="true"></i>
          <span class="app-sidebar__collapse-label">Collapse</span>
        </button>
      </div>`;
    aside.innerHTML = html;
    aside.dataset.built = '1';

    aside.addEventListener('click', function (ev) {
      if (ev.target.closest('#app-sidebar-collapse')) {
        toggleCollapsed();
        ev.stopPropagation();
        return;
      }
      const btn = ev.target.closest('[data-route]');
      if (!btn) return;
      navigate(btn.dataset.route);
      closeMobileSidebar();
    });

    applyCollapsedState();
  }

  function isCollapsed() {
    return localStorage.getItem(STORAGE_COLLAPSED) === '1';
  }

  function applyCollapsedState() {
    const shell = $('app-shell');
    if (!shell) return;
    const collapsed = isCollapsed();
    shell.classList.toggle('is-sidebar-collapsed', collapsed);

    const btn = $('app-sidebar-collapse');
    if (btn) {
      const icon = btn.querySelector('i');
      const label = btn.querySelector('.app-sidebar__collapse-label');
      if (icon) {
        icon.classList.remove('fa-angles-left', 'fa-angles-right');
        icon.classList.add(collapsed ? 'fa-angles-left' : 'fa-angles-right');
      }
      if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
      btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    }
  }

  function toggleCollapsed() {
    const next = !isCollapsed();
    localStorage.setItem(STORAGE_COLLAPSED, next ? '1' : '0');
    applyCollapsedState();
  }

  function buildTopbar() {
    const topbar = $('app-topbar');
    if (!topbar || topbar.dataset.built === '1') return;

    topbar.innerHTML = `
      <button type="button" class="app-topbar__menu" id="app-topbar-menu" aria-label="Open menu">
        <i class="fa-solid fa-bars" aria-hidden="true"></i>
      </button>
      <h1 class="app-topbar__title" id="app-topbar-title">Live</h1>
      <div class="app-topbar__actions" id="app-topbar-actions">
        <div id="app-topbar-time-slot"></div>
        <button type="button" class="app-topbar__auto" id="app-topbar-auto"
          title="Click to refresh now (auto-refreshes every 30s)"
          aria-label="Refresh now (auto-refreshes every 30 seconds)"
          aria-live="polite">
          <i class="fa-solid fa-rotate" aria-hidden="true"></i>
          <span class="app-topbar__auto-label">Auto</span>
        </button>
      </div>`;
    topbar.dataset.built = '1';

    const timeSlot = $('app-topbar-time-slot');
    const liveBtn = $('time-range-button');
    const repBtn = $('reporting-time-range-button');
    if (timeSlot && liveBtn) timeSlot.appendChild(liveBtn);
    if (timeSlot && repBtn) {
      repBtn.style.display = 'none';
      timeSlot.appendChild(repBtn);
    }

    $('app-topbar-menu')?.addEventListener('click', toggleMobileSidebar);
    $('app-sidebar-backdrop')?.addEventListener('click', closeMobileSidebar);

    // Manual refresh: window.gfnPanelRefresh forces a Prometheus snapshot
    // fetch + full runGfnPanel render (see panel-bootstrap.js). On the Live
    // Incidents view we also kick the CRM-side trigger so DB-backed
    // Reported/Solved tables update immediately too.
    const autoBtn = $('app-topbar-auto');
    if (autoBtn) {
      autoBtn.addEventListener('click', async () => {
        if (autoBtn.getAttribute('aria-busy') === 'true') return;
        const labelEl = autoBtn.querySelector('.app-topbar__auto-label');
        const originalLabel = labelEl ? labelEl.textContent : 'Auto';
        autoBtn.setAttribute('aria-busy', 'true');
        if (labelEl) labelEl.textContent = 'Refreshing…';
        try {
          if (typeof window.gfnPanelRefresh === 'function') {
            await window.gfnPanelRefresh();
          }
        } catch (_e) {
          /* ignore — UI state restored below */
        }
        try {
          const liveTrig = window.__GFN_LIVE_TRIG__;
          if (typeof liveTrig === 'function') liveTrig();
        } catch (_e) { /* ignore */ }
        // Keep the busy state visible briefly so the click feels responsive.
        setTimeout(() => {
          autoBtn.setAttribute('aria-busy', 'false');
          if (labelEl) labelEl.textContent = originalLabel || 'Auto';
        }, 500);
      });
    }
  }

  /** Sync legacy panel controls without synthetic events (no click/change cascade). */
  function syncPanelControlsQuiet(state) {
    const sel = $('device-type-selector');
    if (sel && state.device && sel.value !== state.device) {
      sel.value = state.device;
    }
    const liveBtn = $('page-switch-live');
    const repBtn = $('page-switch-reporting');
    if (liveBtn) {
      const on = state.page === 'live';
      liveBtn.classList.toggle('active', on);
      liveBtn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (repBtn) {
      const on = state.page === 'reporting';
      repBtn.classList.toggle('active', on);
      repBtn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    const offlineBtn = $('offline-time-button');
    if (offlineBtn) {
      offlineBtn.classList.toggle('active', Boolean(state.offline));
    }
  }

  function navigate(routeId) {
    const route = ROUTES[routeId];
    const VS = viewStateApi();
    if (!route || !VS) return;

    const patch = { page: route.page, offline: Boolean(route.offline) };
    if (route.page === 'live' && route.device) {
      patch.device = route.device;
    }

    suppressSync = true;
    try {
      VS.setState(patch);
      const state = VS.getState();
      syncPanelControlsQuiet(state);

      const title = $('app-topbar-title');
      if (title) title.textContent = route.title;

      document.querySelectorAll('.app-sidebar__item').forEach(function (el) {
        el.classList.toggle('is-active', el.dataset.route === routeId);
      });

      syncTimeRangeButtons();

      if (typeof window.gfnPanelApplyView === 'function') {
        window.gfnPanelApplyView(document);
      }
    } finally {
      setTimeout(function () {
        suppressSync = false;
        syncSidebarFromPanel();
      }, 80);
    }
  }

  function syncTimeRangeButtons() {
    const vs = readViewState();
    const liveBtn = $('time-range-button');
    const repBtn = $('reporting-time-range-button');
    const showLive = vs.page === 'live' && (vs.offline || vs.device === 'unreported');
    const showRep = vs.page === 'reporting' || vs.page === 'router-timeline';
    if (liveBtn) {
      if (showLive) liveBtn.style.setProperty('display', 'inline-flex', 'important');
      else liveBtn.style.setProperty('display', 'none', 'important');
    }
    if (repBtn) {
      if (showRep) repBtn.style.setProperty('display', 'inline-flex', 'important');
      else repBtn.style.setProperty('display', 'none', 'important');
    }
  }

  function detectActiveRoute() {
    const vs = readViewState();
    if (vs.page === 'reporting') return 'reporting';
    if (vs.page === 'router-timeline') return 'router-timeline';
    if (vs.offline && vs.device === 'routers') return 'offline-time';
    if (vs.device === 'unreported') return 'incidents';
    if (vs.device === 'routers') return 'live';
    if (ROUTES[vs.device]) return vs.device;
    return 'live';
  }

  function syncSidebarFromPanel() {
    if (suppressSync) return;
    const routeId = detectActiveRoute();
    const route = ROUTES[routeId];
    if (!route) return;

    document.querySelectorAll('.app-sidebar__item').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.route === routeId);
    });

    const title = $('app-topbar-title');
    if (title) title.textContent = route.title;

    syncTimeRangeButtons();

    const band = $('shell-overview-band');
    if (band) {
      const show = routeId === 'live';
      band.style.display = show ? '' : 'none';
    }
  }

  function toggleMobileSidebar() {
    $('app-shell')?.classList.toggle('is-sidebar-open');
    $('app-sidebar-backdrop')?.classList.toggle('is-visible');
  }

  function closeMobileSidebar() {
    $('app-shell')?.classList.remove('is-sidebar-open');
    $('app-sidebar-backdrop')?.classList.remove('is-visible');
  }

  function observePanel() {
    const root = $('panelRoot');
    if (!root) return;

    const obs = new MutationObserver(function () {
      syncSidebarFromPanel();
    });

    obs.observe(root, {
      attributes: true,
      subtree: true,
      attributeFilter: ['class', 'aria-selected', 'hidden', 'style']
    });

    const VS = viewStateApi();
    if (VS && VS.subscribe) {
      VS.subscribe(function () {
        if (!suppressSync) syncSidebarFromPanel();
      });
    }

    const sel = $('device-type-selector');
    if (sel) sel.addEventListener('change', syncSidebarFromPanel);

    const keys = VS
      ? [VS.STORAGE_KEY_PAGE, VS.STORAGE_KEY_DEVICE, VS.STORAGE_KEY_OFFLINE]
      : [];
    window.addEventListener('storage', function (ev) {
      if (keys.indexOf(ev.key) >= 0) syncSidebarFromPanel();
    });
  }

  function initShell() {
    if (shellReady) return;
    if (!$('app-shell') || !$('panelRoot')) return;

    buildSidebar();
    buildTopbar();
    observePanel();
    syncSidebarFromPanel();
    shellReady = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShell, { once: true });
  } else {
    initShell();
  }
})();
