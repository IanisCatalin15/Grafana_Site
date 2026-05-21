/**
 * panel-bootstrap.js
 *
 * Replaces Grafana's panel runtime: invokes window.runGfnPanel(data, htmlNode)
 * on first load, on a 15s ticker, and on visibility change. data is built by
 * prom-adapter.js by querying Prometheus through nginx /prom/ proxy.
 *
 * The original panel script in Grafana_Incidents-main/script.js stores
 * cross-tick state on window.__GFN_PANEL_RUNTIME__ (script.js:257) precisely
 * so it can be re-executed every panel data refresh -- so re-calling
 * runGfnPanel here is the supported usage pattern.
 *
 * Configurable via window.GFN_PROM_TICK_MS before this script loads.
 */
(function () {
  'use strict';

  const TICK_MS = (typeof window.GFN_PROM_TICK_MS === 'number' && window.GFN_PROM_TICK_MS > 0)
    ? window.GFN_PROM_TICK_MS
    : 30000;

  let htmlNode = null;
  let timerId = null;
  let inFlight = false;
  let pendingAfter = false;
  let lastSnapshotFingerprint = null;
  let lastRangeKey = null;

  function logError(prefix, err) {
    try { console.warn('[panel-bootstrap]', prefix, err); } catch (_) { /* ignore */ }
  }

  /**
   * Cheap fingerprint of a Prometheus snapshot. We hash the `refId + labels
   * + last value` of every series so two identical-looking snapshots produce
   * the same string. If the fingerprint matches the previous tick (and the
   * URL time range hasn't changed), we skip runGfnPanel entirely — that's
   * the call that wipes & rebuilds the device cards, which is the cause of
   * the flicker the user was seeing every refresh.
   */
  function snapshotFingerprint(data) {
    if (!data || !Array.isArray(data.series)) return '';
    const parts = [];
    for (const s of data.series) {
      const f = s.fields && s.fields[1];
      if (!f) continue;
      const labels = f.labels ? JSON.stringify(f.labels) : '';
      let val = '';
      if (f.values && typeof f.values.get === 'function' && f.values.length) {
        try { val = String(f.values.get(f.values.length - 1)); } catch (_) { val = ''; }
      }
      parts.push(s.refId + '|' + labels + '|' + val);
    }
    return parts.join(';');
  }

  function currentRangeKey() {
    try {
      const u = new URLSearchParams(window.location.search);
      return (u.get('from') || '') + '~' + (u.get('to') || '');
    } catch (_) {
      return '';
    }
  }

  async function tick(opts) {
    const forceRender = !!(opts && opts.force);
    if (!htmlNode || typeof window.runGfnPanel !== 'function') return;
    if (inFlight) { pendingAfter = true; return; }
    inFlight = true;
    try {
      const data = await window.gfnFetchPanelSnapshot();
      if (typeof window.gfnShellUpdateCounts === 'function') {
        try {
          window.gfnShellUpdateCounts(data);
        } catch (countErr) {
          logError('shell counts', countErr);
        }
      }

      const fp = snapshotFingerprint(data);
      const rk = currentRangeKey();
      const sameAsBefore = !forceRender
        && fp === lastSnapshotFingerprint
        && rk === lastRangeKey
        && lastSnapshotFingerprint != null;

      if (!sameAsBefore) {
        try {
          window.runGfnPanel(data, htmlNode);
        } catch (renderErr) {
          logError('panel render threw', renderErr);
        }
        lastSnapshotFingerprint = fp;
        lastRangeKey = rk;
      }
    } catch (fetchErr) {
      logError('snapshot fetch failed', fetchErr);
    } finally {
      inFlight = false;
      if (pendingAfter) {
        pendingAfter = false;
        // Schedule next tick in a microtask so we don't recurse synchronously.
        Promise.resolve().then(tick);
      }
    }
  }

  function startLoop() {
    if (timerId != null) return;
    timerId = setInterval(tick, TICK_MS);
  }

  function stopLoop() {
    if (timerId != null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function boot() {
    // The original Grafana HTML Graphics panel passes a Document-like node
    // here -- the script uses htmlNode.getElementById(...) ~218 times, which
    // only works on Document. Using `document` itself is safe because the
    // panel HTML is the only thing in <body> and its IDs are unique.
    if (!document.getElementById('panelRoot')) {
      logError('boot', new Error('#panelRoot not found in DOM'));
      return;
    }
    htmlNode = document;
    // First paint forces a full render (no previous fingerprint to compare),
    // then the ticker takes over. visibilitychange refreshes immediately.
    tick({ force: true });
    startLoop();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      // Coming back to tab: refresh immediately, restart loop in case it was throttled.
      stopLoop();
      tick();
      startLoop();
    }
  });

  // Expose a manual refresh hook (used by external code, e.g. when the URL
  // time-range changes and we want an immediate redraw before the next 30s
  // tick lands). Always forces a render — bypasses the no-change skip.
  window.gfnPanelRefresh = function () { return tick({ force: true }); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
