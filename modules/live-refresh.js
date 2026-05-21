/**
 * modules/live-refresh.js
 *
 * Cross-iframe SSE leader election + kiosk health guard. Pulled out of the
 * monolithic script.js since this is entirely self-contained except for a
 * handful of view-state lookups (which we now read from window.GFN_VIEW_STATE).
 *
 * Public API:
 *   window.GFN_LIVE_REFRESH.installRefreshTrigger(fn)
 *     → register the per-IIFE refresh handler. The handler is stored on
 *       window so visibility/SSE listeners always invoke the LATEST one,
 *       even after Grafana re-executes runGfnPanel.
 *
 *   window.GFN_LIVE_REFRESH.startLiveAutoRefresh(opts)
 *     → opts = { crmApiBase }. Idempotent — safe to call on every tick.
 *
 *   window.GFN_LIVE_REFRESH.startKioskHealthGuard(opts)
 *     → opts = { panelRuntime }. Idempotent.
 */
(function () {
  'use strict';

  const _C = window.GFN_CONSTANTS || {};
  const LIVE_UNREPORTED_DEVICE_TYPE = _C.LIVE_UNREPORTED_DEVICE_TYPE || 'unreported';

  function isLiveIncidentsView() {
    const VS = window.GFN_VIEW_STATE;
    if (!VS || !VS.getState) return false;
    const s = VS.getState();
    if (s.page !== 'live') return false;
    if (s.device !== LIVE_UNREPORTED_DEVICE_TYPE) return false;
    if (s.offline) return false;
    return true;
  }

  function installRefreshTrigger(fn) {
    window.__GFN_LIVE_TRIG__ = typeof fn === 'function' ? fn : null;
  }

  function fireLocalRefresh() {
    const fn = window.__GFN_LIVE_TRIG__;
    if (typeof fn === 'function') fn();
  }

  function startLiveAutoRefresh(opts) {
    if (typeof window === 'undefined') return;
    const crmApiBase = (opts && opts.crmApiBase) || '';

    const SSE_BUS_NAME = 'gfn-sse-bus';
    const HEARTBEAT_MS = 3000;
    const LEADER_TIMEOUT_MS = 8000;
    const ELECTION_WAIT_MS = 400;
    const hasBC = typeof BroadcastChannel !== 'undefined';
    const hasES = typeof EventSource !== 'undefined';

    // Singleton state on `window`: survives IIFE re-execution.
    if (!window.__GFN_SSE_STATE__) {
      window.__GFN_SSE_STATE__ = {
        clientId: Math.random().toString(36).slice(2) + '-' + Date.now(),
        channel: hasBC ? new BroadcastChannel(SSE_BUS_NAME) : null,
        es: null,
        isLeader: false,
        lastLeaderSeenAt: 0,
        heartbeatTimer: null,
        electionTimer: null,
        unloadHooked: false,
        visHooked: false,
        kickstarted: false
      };
    }
    const state = window.__GFN_SSE_STATE__;

    function broadcast(msg) {
      if (state.channel) {
        try { state.channel.postMessage(msg); } catch (_) { /* ignore */ }
      }
    }

    function closeOurEventSource() {
      if (state.es) {
        try { state.es.close(); } catch (_) { /* ignore */ }
      }
      state.es = null;
    }

    function becomeFollower() {
      if (state.heartbeatTimer) {
        clearInterval(state.heartbeatTimer);
        state.heartbeatTimer = null;
      }
      closeOurEventSource();
      state.isLeader = false;
    }

    function becomeLeader() {
      if (!hasES) return;
      if (state.es && state.es.readyState !== 2) {
        state.isLeader = true;
        return;
      }
      try {
        state.es = new EventSource(`${crmApiBase}/events/stream`);
      } catch (_) {
        state.es = null;
        state.isLeader = false;
        return;
      }
      state.isLeader = true;
      state.es.onmessage = () => {
        fireLocalRefresh();
        broadcast({ kind: 'event', from: state.clientId });
      };
      state.es.onerror = () => { /* EventSource auto-reconnects */ };

      if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
      broadcast({ kind: 'heartbeat', from: state.clientId, ts: Date.now() });
      state.heartbeatTimer = setInterval(() => {
        broadcast({ kind: 'heartbeat', from: state.clientId, ts: Date.now() });
      }, HEARTBEAT_MS);
    }

    function runElection() {
      if (!hasBC) {
        becomeLeader();
        return;
      }
      broadcast({ kind: 'who-is-leader', from: state.clientId });
      if (state.electionTimer) clearTimeout(state.electionTimer);
      state.electionTimer = setTimeout(() => {
        const now = Date.now();
        const leaderAlive = (now - state.lastLeaderSeenAt) < LEADER_TIMEOUT_MS;
        if (!leaderAlive) becomeLeader();
      }, ELECTION_WAIT_MS);
    }

    if (state.channel && !state.channel.__GFN_HOOKED__) {
      state.channel.__GFN_HOOKED__ = true;
      state.channel.onmessage = (ev) => {
        const msg = ev && ev.data;
        if (!msg || msg.from === state.clientId) return;
        if (msg.kind === 'heartbeat') {
          state.lastLeaderSeenAt = msg.ts || Date.now();
          if (state.isLeader && msg.from > state.clientId) {
            becomeFollower();
          }
          return;
        }
        if (msg.kind === 'event') {
          state.lastLeaderSeenAt = Date.now();
          fireLocalRefresh();
          return;
        }
        if (msg.kind === 'who-is-leader') {
          if (state.isLeader) {
            broadcast({ kind: 'heartbeat', from: state.clientId, ts: Date.now() });
          }
          return;
        }
        if (msg.kind === 'leader-stepping-down') {
          state.lastLeaderSeenAt = 0;
          runElection();
        }
      };
    }

    if (!state.watchdogTimer) {
      state.watchdogTimer = setInterval(() => {
        if (state.isLeader) return;
        const now = Date.now();
        if ((now - state.lastLeaderSeenAt) > LEADER_TIMEOUT_MS) {
          runElection();
        }
      }, HEARTBEAT_MS);
    }

    if (!state.unloadHooked && typeof window.addEventListener === 'function') {
      state.unloadHooked = true;
      const onUnload = () => {
        if (state.isLeader) {
          broadcast({ kind: 'leader-stepping-down', from: state.clientId });
        }
        if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
        closeOurEventSource();
      };
      window.addEventListener('pagehide', onUnload);
      window.addEventListener('beforeunload', onUnload);
    }

    if (!state.visHooked && typeof document !== 'undefined') {
      state.visHooked = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        fireLocalRefresh();
      });
    }

    if (!state.es && !state.electionTimer) {
      runElection();
    }

    if (!state.kickstarted && typeof setTimeout === 'function') {
      state.kickstarted = true;
      setTimeout(fireLocalRefresh, 0);
    }
  }

  function startKioskHealthGuard(opts) {
    if (typeof window === 'undefined' || typeof setInterval !== 'function') return;
    const panelRuntime = opts && opts.panelRuntime;
    if (!panelRuntime) return;

    const CHECK_MS = 60 * 1000;
    const FORCE_RELOAD_MS = 90 * 60 * 1000;
    const HEAP_RATIO_LIMIT = 0.72;
    if (!panelRuntime.kioskHealth) {
      panelRuntime.kioskHealth = { lastReloadAt: Date.now(), timer: null };
    }
    const state = panelRuntime.kioskHealth;
    if (state.timer) return;
    state.timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const VS = window.GFN_VIEW_STATE;
      if (VS && VS.getState) {
        const s = VS.getState();
        if (s.page !== 'live') return;
        if (s.offline) return;
      }
      const now = Date.now();
      let shouldReload = (now - state.lastReloadAt) >= FORCE_RELOAD_MS;
      if (!shouldReload && typeof performance !== 'undefined' && performance && performance.memory) {
        const used = Number(performance.memory.usedJSHeapSize || 0);
        const limit = Number(performance.memory.jsHeapSizeLimit || 0);
        if (used > 0 && limit > 0 && (used / limit) >= HEAP_RATIO_LIMIT) {
          shouldReload = true;
        }
      }
      if (!shouldReload) return;
      state.lastReloadAt = now;
      try { window.location.reload(); } catch (_err) { /* ignore */ }
    }, CHECK_MS);
  }

  window.GFN_LIVE_REFRESH = {
    installRefreshTrigger,
    startLiveAutoRefresh,
    startKioskHealthGuard,
    isLiveIncidentsView
  };
})();
