/**
 * prom-adapter.js
 * Replaces Grafana's `data.series` injection.
 *
 * Calls Prometheus directly through nginx `/prom/*` (which proxies to
 * `http://prometheus:9090/api/v1/`) and assembles the exact `data.series`
 * shape the in-Grafana panel script consumes via genericParser /
 * getOfflineMetricData / getPcOver15DetailData.
 *
 * Queries are transcribed from Grafana/query.md (refIds A..Z, incl. W).
 * For each Prometheus vector entry we build:
 *
 *   {
 *     refId,
 *     fields: [
 *       { name: 'Time',  type: 'time',   values: { length: 1, get(i){ return now; } } },
 *       { name: <metric>, type: 'number',
 *         labels: <prom labels>,
 *         values: { length: 1, get(i){ return Number(value); } } }
 *     ]
 *   }
 *
 * which matches what genericParser reads at
 * Grafana_Incidents-main/script.js line ~3784 (series.fields[1].labels and
 * series.fields[1].values.get(series.fields[1].values.length - 1)).
 *
 * Exposes:
 *   window.gfnFetchPanelSnapshot() -> Promise<{ series, request, timeRange }>
 *   window.gfnResolvePanelRange()  -> { fromMs, toMs, rangeStr, isLive }
 */
(function () {
  'use strict';

  const PROM_BASE = '/prom';

  // Same refId map as the Grafana panel (DEVICE_PARSERS / OFFLINE_METRICS in script.js).
  // Each entry is { refId, expr, kind, isRange?: boolean }.
  // - kind 'live'    -> instant snapshot (current router/device state)
  // - kind 'offline' -> downtime aggregate over [$__range]
  // - the `$__range` placeholder is replaced at fetch time with `<seconds>s`.
  const QUERIES = [
    // Live device state (instant)
    { refId: 'A', kind: 'live', expr: 'router_status4' },
    { refId: 'M', kind: 'live', expr: 'router_status4_projects' },
    { refId: 'B', kind: 'live', expr: 'device_ping_status_switches{device_type=~"Switch_Principal"}' },
    { refId: 'C', kind: 'live', expr: 'device_ping_status_switches{device_type=~"Switch_Secundar"}' },
    { refId: 'D', kind: 'live', expr: 'device_ping_status_v3_t{device_type=~"NUC"}' },
    { refId: 'E', kind: 'live', expr: 'device_ping_status_v3_t{device_type=~"Casa_1"}' },
    { refId: 'F', kind: 'live', expr: 'device_ping_status_v3_t{device_type=~"Casa_2"}' },
    { refId: 'G', kind: 'live', expr: 'device_ping_status_v3_t{device_type=~"Casa_3"}' },
    { refId: 'H', kind: 'live', expr: 'device_ping_status_v3_t{device_type=~"M1"} == 0' },
    { refId: 'I', kind: 'live', expr: 'device_ping_status_v3_t{device_type=~"M2"} == 0' },
    { refId: 'J', kind: 'live', expr: 'device_ping_status_v3_t{device_type=~"Printer"}' },
    { refId: 'K', kind: 'live', expr: 'device_ping_status_pc_test{device_type=~"PriceChecker"} == 0' },

    // Offline-minute aggregates (depend on $__range; see query.md L..U + X/Y/Z)
    { refId: 'L', kind: 'offline', expr:
      'sum by (store) (\n' +
      '  count_over_time(router_status4{Provider="Down"}[$__range]) * 15\n' +
      ') / 30'
    },
    { refId: 'N', kind: 'offline', expr:
      'sum by (store) (\n' +
      '  count_over_time(router_status4{Provider="Backup"}[$__range]) * 15\n' +
      ') / 30 or vector(0)'
    },
    { refId: 'O', kind: 'offline', expr:
      'sum by (store) (\n' +
      '  (count_over_time(device_ping_status_v3_t{device_type="Casa_1"}[$__range])\n' +
      '   - sum_over_time(device_ping_status_v3_t{device_type="Casa_1"}[$__range])) * 5 / 10\n' +
      ') or vector(0)'
    },
    { refId: 'P', kind: 'offline', expr:
      'sum by (store) (\n' +
      '  (count_over_time(device_ping_status_v3_t{device_type="Casa_2"}[$__range])\n' +
      '   - sum_over_time(device_ping_status_v3_t{device_type="Casa_2"}[$__range])) * 5 / 10\n' +
      ') or vector(0)'
    },
    { refId: 'Q', kind: 'offline', expr:
      'sum by (store) (\n' +
      '  (count_over_time(device_ping_status_v3_t{device_type="Casa_3"}[$__range])\n' +
      '   - sum_over_time(device_ping_status_v3_t{device_type="Casa_3"}[$__range])) * 5 / 10\n' +
      ') or vector(0)'
    },
    { refId: 'R', kind: 'offline', expr:
      'sum by (store) (\n' +
      '  (count_over_time(device_ping_status_v3_t{device_type="NUC"}[$__range])\n' +
      '   - sum_over_time(device_ping_status_v3_t{device_type="NUC"}[$__range])) * 5 / 10\n' +
      ') or vector(0)'
    },
    { refId: 'S', kind: 'offline', expr:
      'sum by (store) (\n' +
      '  (count_over_time(device_ping_status_v3_t{device_type="M1"}[$__range])\n' +
      '   - sum_over_time(device_ping_status_v3_t{device_type="M1"}[$__range])) * 5 / 10\n' +
      ') or vector(0)'
    },
    { refId: 'T', kind: 'offline', expr:
      'sum by (store) (\n' +
      '  (count_over_time(device_ping_status_v3_t{device_type="M2"}[$__range])\n' +
      '   - sum_over_time(device_ping_status_v3_t{device_type="M2"}[$__range])) * 5 / 10\n' +
      ') or vector(0)'
    },
    { refId: 'U', kind: 'offline', expr:
      'sum by (store) (\n' +
      '  (count_over_time(device_ping_status_pc_test{device_type!="Printer"}[$__range])\n' +
      '   - sum_over_time(device_ping_status_pc_test[$__range])) / 2\n' +
      ') or vector(0)'
    },
    // Per-hostname price checkers down ≥15m in [$__range] (Grafana refId W; store-level
    // aggregate is refId V in query.md). Keeps store + hostname for getPcOver15DetailData.
    { refId: 'W', kind: 'offline', expr:
      '(\n' +
      '  min_over_time(\n' +
      '    avg_over_time(device_ping_status_pc_test{device_type=~"PriceChecker"}[15m])[$__range:1m]\n' +
      '  ) == 0\n' +
      ')'
    },
    { refId: 'X', kind: 'offline', expr:
      'sum_over_time(\n' +
      '  (\n' +
      '    max by (store) (\n' +
      '      {__name__=~"router_status4(_projects)?", ONT_Primary=~"(?i)^down$"} * 0 + 1\n' +
      '    )\n' +
      '    * on (store) group_left()\n' +
      '    (\n' +
      '      (\n' +
      '        hour(\n' +
      '          timestamp(max by (store)({__name__=~"router_status4(_projects)?"})) + 7200\n' +
      '        ) >= bool 7\n' +
      '      )\n' +
      '      *\n' +
      '      (\n' +
      '        hour(\n' +
      '          timestamp(max by (store)({__name__=~"router_status4(_projects)?"})) + 7200\n' +
      '        ) < bool 21\n' +
      '      )\n' +
      '    )\n' +
      '  )[$__range:1m]\n' +
      ')'
    },
    { refId: 'Y', kind: 'offline', expr:
      'sum_over_time(\n' +
      '  (\n' +
      '    max by (store) (\n' +
      '      {__name__=~"router_status4(_projects)?", ONT_Backup=~"(?i)^down$"} * 0 + 1\n' +
      '    )\n' +
      '    * on (store) group_left()\n' +
      '    (\n' +
      '      (\n' +
      '        hour(\n' +
      '          timestamp(max by (store)({__name__=~"router_status4(_projects)?"})) + 7200\n' +
      '        ) >= bool 7\n' +
      '      )\n' +
      '      *\n' +
      '      (\n' +
      '        hour(\n' +
      '          timestamp(max by (store)({__name__=~"router_status4(_projects)?"})) + 7200\n' +
      '        ) < bool 21\n' +
      '      )\n' +
      '    )\n' +
      '  )[$__range:1m]\n' +
      ')'
    },
    { refId: 'Z', kind: 'offline', expr:
      'sum_over_time(\n' +
      '  (\n' +
      '    max by (store) (store:network_blackout_by_store > bool 0)\n' +
      '    * on (store) group_left()\n' +
      '    (\n' +
      '      (\n' +
      '        hour(\n' +
      '          timestamp(max by (store)({__name__=~"router_status4(_projects)?"})) + 7200\n' +
      '        ) >= bool 7\n' +
      '      )\n' +
      '      *\n' +
      '      (\n' +
      '        hour(\n' +
      '          timestamp(max by (store)({__name__=~"router_status4(_projects)?"})) + 7200\n' +
      '        ) < bool 21\n' +
      '      )\n' +
      '    )\n' +
      '  )[$__range:1m]\n' +
      ')'
    }
  ];

  /**
   * Resolve the panel's active time range from URL params.
   * Same logic as `getCurrentAppliedRange` in the original panel script (~L8257).
   *
   * Returns:
   *   { fromMs:Number, toMs:Number, rangeStr:String, isLive:Boolean }
   *
   * rangeStr is suitable for `[X]` Prometheus duration syntax (e.g. `21600s`).
   */
  function resolvePanelRange() {
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('from');
    const toParam = params.get('to');

    const now = Date.now();

    // Known live tokens (matches TIME_RANGE_LABELS in the panel).
    const LIVE_TOKENS = {
      'now-3h': 3 * 3600 * 1000,
      'now-6h': 6 * 3600 * 1000,
      'now-12h': 12 * 3600 * 1000,
      'now-24h': 24 * 3600 * 1000,
      'now-2d': 2 * 86400 * 1000,
      'now-7d': 7 * 86400 * 1000
    };

    if (fromParam && toParam) {
      if (LIVE_TOKENS[fromParam] && toParam === 'now') {
        const fromMs = now - LIVE_TOKENS[fromParam];
        return rangeOut(fromMs, now, true);
      }
      const fromNum = Number(fromParam);
      const toNum = Number(toParam);
      if (!Number.isNaN(fromNum) && !Number.isNaN(toNum) && fromNum > 0 && toNum > fromNum) {
        return rangeOut(fromNum, toNum, false);
      }
    }

    // Default: Last 6 hours (matches the panel's fallback at line ~8382).
    return rangeOut(now - 6 * 3600 * 1000, now, true);
  }

  function rangeOut(fromMs, toMs, isLive) {
    const seconds = Math.max(1, Math.round((toMs - fromMs) / 1000));
    return { fromMs, toMs, rangeStr: `${seconds}s`, isLive };
  }

  /**
   * Prometheus scrapes are paused outside 07:10–21:00 Europe/Bucharest.
   * After the cutoff, instant queries at `now` return empty vectors and the
   * Live page collapses to "No devices found". Pin the instant query to the
   * most recent 21:00 cutoff instead — Prometheus's TSDB still has the
   * samples, so the panel shows the device state exactly as it was when
   * scraping stopped.
   *
   * Returns null during the day (use `now`), otherwise the cutoff epoch ms.
   */
  function getNightCutoffMs(nowMs) {
    const C = (typeof window !== 'undefined' && window.GFN_CONSTANTS) || null;
    const startMin = (C && typeof C.MONITORING_START_MINUTES === 'number')
      ? C.MONITORING_START_MINUTES
      : 7 * 60 + 10;
    const endMin = (C && typeof C.MONITORING_END_MINUTES === 'number')
      ? C.MONITORING_END_MINUTES
      : 21 * 60;
    const now = new Date(nowMs);
    const minutes = now.getHours() * 60 + now.getMinutes();
    const inDay = minutes >= startMin && minutes < endMin;
    if (inDay) return null;
    const cutoff = new Date(now);
    if (minutes >= endMin) {
      cutoff.setHours(21, 0, 0, 0);
    } else {
      cutoff.setDate(cutoff.getDate() - 1);
      cutoff.setHours(21, 0, 0, 0);
    }
    return cutoff.getTime();
  }

  /**
   * Issue a Prometheus instant query at `time = toMs`.
   * Returns the raw `data.result` array on success, [] on failure.
   */
  async function promQuery(expr, atMs) {
    const url = `${PROM_BASE}/query?query=${encodeURIComponent(expr)}&time=${(atMs / 1000).toFixed(3)}`;
    let response;
    try {
      response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    } catch (err) {
      console.warn('[prom-adapter] fetch failed for', expr.slice(0, 80), err);
      return [];
    }
    if (!response.ok) {
      console.warn('[prom-adapter] HTTP', response.status, 'for', expr.slice(0, 80));
      return [];
    }
    let json;
    try {
      json = await response.json();
    } catch (err) {
      console.warn('[prom-adapter] JSON parse failed', err);
      return [];
    }
    if (!json || json.status !== 'success' || !json.data || !Array.isArray(json.data.result)) {
      return [];
    }
    return json.data.result;
  }

  /**
   * Wrap a Prometheus vector entry into the Grafana `series` shape.
   */
  function buildSeries(refId, metricName, labels, valueNumber, atMs) {
    return {
      refId,
      name: metricName,
      fields: [
        {
          name: 'Time',
          type: 'time',
          values: { length: 1, get: function (_i) { return atMs; } }
        },
        {
          name: metricName,
          type: 'number',
          labels: labels || {},
          values: { length: 1, get: function (_i) { return valueNumber; } }
        }
      ]
    };
  }

  /**
   * For one query, run it against Prometheus and turn each result into a
   * `series` object. One Prometheus result row = one series.
   *
   * `atMs` lets the caller pin the evaluation time (e.g. 21:00 cutoff
   * during night freeze so live metrics resolve to the pre-pause snapshot
   * even though `now > cutoff + 5min` is outside Prometheus's lookback).
   */
  async function fetchOneRefId(query, range, atMs) {
    const expr = (query.expr || '').replace(/\$__range/g, range.rangeStr);
    const queryAtMs = Number.isFinite(atMs) ? atMs : range.toMs;
    const results = await promQuery(expr, queryAtMs);
    const seriesList = [];
    for (const row of results) {
      const labels = row.metric || {};
      const metricName = labels.__name__ || query.refId;
      const valStr = Array.isArray(row.value) ? row.value[1] : null;
      const num = valStr == null ? 0 : Number(valStr);
      if (!Number.isFinite(num)) continue;
      // Drop scalar-fallback rows from PromQL `... or vector(0)`. They come
      // back with no `store` label and were previously surfaced as bogus
      // single-letter rows (P, Q, R, ...) in the offline table.
      if (query.kind === 'offline' && !labels.store) continue;
      seriesList.push(buildSeries(query.refId, metricName, labels, num, queryAtMs));
    }
    return seriesList;
  }

  /**
   * The Grafana `data` object exposed to the panel.
   * Includes `request.range.{from,to}` with `valueOf()` returning numeric ms
   * because the panel script reads it that way (see getPanelTimeRangeMs at
   * script.js:3854 and getCurrentAppliedRange at script.js:8257).
   */
  async function gfnFetchPanelSnapshot() {
    const range = resolvePanelRange();
    // Live (instant) metrics pin to 21:00 during night freeze so Prometheus
    // returns the last scraped state. Offline aggregates keep the panel's
    // configured range (yesterday/this week/etc.) intact.
    const cutoffMs = getNightCutoffMs(Date.now());
    const liveAtMs = cutoffMs != null ? cutoffMs : range.toMs;

    const all = await Promise.all(
      QUERIES.map(function (q) {
        const atMs = q.kind === 'live' ? liveAtMs : range.toMs;
        return fetchOneRefId(q, range, atMs);
      })
    );

    const series = [];
    for (const arr of all) {
      for (const s of arr) series.push(s);
    }

    const fromDate = new Date(range.fromMs);
    const toDate = new Date(range.toMs);

    return {
      series,
      request: { range: { from: fromDate, to: toDate, raw: { from: fromDate, to: toDate } } },
      timeRange: { from: fromDate, to: toDate, raw: { from: fromDate, to: toDate } }
    };
  }

  window.gfnFetchPanelSnapshot = gfnFetchPanelSnapshot;
  window.gfnResolvePanelRange = resolvePanelRange;
})();
