/**
 * router-timeline.js
 *
 * Router status timeline page. Adapted from a Grafana-panel-internal script
 * that consumed a Grafana-injected `data.series` array.
 *
 *   - Prometheus data        ->  /prom/query_range  (nginx proxy to prometheus:9090)
 *   - Reports storage        ->  /incidents-api/router-timeline/reports (Postgres)
 *   - Reporter identity      ->  localStorage-backed name
 *
 * The visualization, segment building, divider math, modals, search, CSV
 * exports and auto-resolve logic are intentionally kept close to the
 * original — they were already well battle-tested.
 *
 * Exposed API:
 *   window.GFN_ROUTER_TIMELINE.init(htmlNode)     // first load
 *   window.GFN_ROUTER_TIMELINE.refresh(htmlNode)  // soft data refresh (no UI wipe)
 *   window.GFN_ROUTER_TIMELINE.isMounted()        // already initialized on this page
 *   window.GFN_ROUTER_TIMELINE.teardown()         // close modals, cancel timers
 */
(function () {
    'use strict';

    // =====================================================================
    // CONFIGURATION
    // =====================================================================

    const PROM_BASE = '/prom';
    const STORAGE_KEY_REPORTER = 'grafana_custom_panel_reporter_name';
    const STORAGE_KEY_REPORTER_LOGIN = 'grafana_custom_panel_reporter_login';

    const REQUEST_TIMEOUT_MS = 20000;
    const SYNC_MIN_INTERVAL_MS = 15000;

    const PROM_QUERIES = [
        // Raw router_status4 values: 0=down, 1=backup, 2=up. Do NOT use `<= 1` —
        // that boolean filter drops most stores and mis-maps status on refresh.
        { refId: 'A', expr: 'max by (store) (router_status4)' },
        { refId: 'B', expr: 'max by (store) (router_status4_projects)' }
    ];

    let promFetchInFlight = null;
    let promFetchKey = '';
    let initInFlight = null;

    const moduleState = {
        reportsCache: [],
        isSyncing: false,
        lastSyncTime: 0,
        syncInFlight: null,
        autoSolveTimeoutId: null,
        reportsSyncIntervalId: null,
        modalFocusTimeoutId: null,
        initSeq: 0,
        refreshSeq: 0,
        boundHtmlNode: null,
        currentData: null,
        reportsFingerprint: '',
        visibleTimeRange: null,
        reportsOnLongDown: [],
        reportsOnDownCount: 0,
        downLocationCount: 0
    };

    let historyTimeSeriesData = [];
    let toastRoot = null;
    let grafanaDisplayName = 'Operator';
    let grafanaUserLogin = 'operator';
    let editingReportId = null;
    let incidentSearchQuery = '';
    let draftTimelineStartMs = null;
    let draftTimelineEndMs = null;

    // =====================================================================
    // UTILITIES
    // =====================================================================

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str == null ? '' : str);
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/'/g, '&#39;');
    }

    function formatTimestamp(ts) {
        const date = new Date(ts);
        return date.toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
        });
    }

    function formatDateTime(date) {
        return date.toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    }

    function timeAgo(date) {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        const days = Math.floor(seconds / 86400);
        if (days === 1) return 'yesterday';
        if (days < 7) return `${days}d ago`;
        return formatDateTime(date);
    }

    function formatDuration(durationMs) {
        const totalSeconds = Math.round(durationMs / 1000);
        const totalMinutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (totalMinutes === 0) return `${seconds}s`;
        if (totalMinutes < 60) return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    function isTimestampInInterval(ts, startMs, endMs) {
        return Number.isFinite(ts) && Number.isFinite(startMs) && Number.isFinite(endMs)
            && ts >= startMs && ts < endMs;
    }

    function intervalsOverlap(startA, endA, startB, endB) {
        return Number.isFinite(startA) && Number.isFinite(endA)
            && Number.isFinite(startB) && Number.isFinite(endB)
            && startA < endB && endA > startB;
    }

    function parseBool(value) {
        if (value === true || value === 1) return true;
        if (value === false || value === 0) return false;
        if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (v === 'true' || v === 'yes' || v === '1') return true;
            if (v === 'false' || v === 'no' || v === '0') return false;
        }
        return false;
    }

    function csvEscape(value, delimiter) {
        if (value === null || value === undefined) return '';
        let str = String(value);
        if (/^[=+\-@\t\r\n]/.test(str)) str = `'${str}`;
        const mustQuote = str.includes(delimiter) || str.includes('"') || str.includes('\n');
        return mustQuote ? `"${str.replace(/"/g, '""')}"` : str;
    }

    function downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    function normalizeStoreName(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const compact = raw.replace(/\s+/g, ' ').trim();
        const noArPrefix = compact.replace(/^AR[\s\-_:]*/i, '');
        if (/[a-zA-Z]/.test(noArPrefix)) return noArPrefix.toLowerCase();
        const digits = noArPrefix.replace(/\D+/g, '');
        if (!digits) return noArPrefix.toLowerCase();
        const normalized = digits.replace(/^0+/, '');
        return normalized || '0';
    }

    function getLocationNumber(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const compact = raw.replace(/\s+/g, ' ').trim();
        const noArPrefix = compact.replace(/^AR[\s\-_:]*/i, '');
        if (/[a-zA-Z]/.test(noArPrefix)) return noArPrefix.toUpperCase();
        const digits = noArPrefix.replace(/\D+/g, '');
        if (!digits) return noArPrefix.toUpperCase();
        const normalized = digits.replace(/^0+/, '');
        return normalized || '0';
    }

    function requestTimeoutMs(fromMs, toMs) {
        const spanMs = Math.max(0, Number(toMs || 0) - Number(fromMs || 0));
        const days = spanMs / (24 * 60 * 60 * 1000);
        return Math.min(120000, Math.max(REQUEST_TIMEOUT_MS, Math.round(20000 + days * 8000)));
    }

    function fetchWithTimeout(url, options, timeoutMs) {
        timeoutMs = timeoutMs || REQUEST_TIMEOUT_MS;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const opts = Object.assign({}, options || {}, {
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'include'
        });
        return fetch(url, opts).finally(() => clearTimeout(timer));
    }

    function showToast(message, type) {
        type = type || 'info';
        const container = (toastRoot || document).querySelector('#timeline-toasts')
            || document.getElementById('timeline-toasts');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `timeline-toast ${type}`;
        toast.textContent = String(message || '');
        container.appendChild(toast);
        while (container.children.length > 5) container.removeChild(container.firstElementChild);
        setTimeout(() => toast.remove(), 3000);
    }

    function cleanupRuntimeTimers() {
        if (moduleState.autoSolveTimeoutId) {
            clearTimeout(moduleState.autoSolveTimeoutId);
            moduleState.autoSolveTimeoutId = null;
        }
        if (moduleState.reportsSyncIntervalId) {
            clearInterval(moduleState.reportsSyncIntervalId);
            moduleState.reportsSyncIntervalId = null;
        }
        if (moduleState.modalFocusTimeoutId) {
            clearTimeout(moduleState.modalFocusTimeoutId);
            moduleState.modalFocusTimeoutId = null;
        }
    }

    // =====================================================================
    // IDENTITY (localStorage-backed)
    // =====================================================================

    function normalizeUsername(value) {
        if (!value) return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'object') {
            return normalizeUsername(value.login || value.username || value.name || value.email || value.text || value.value || '');
        }
        return String(value).trim();
    }

    function normalizeAccessUsername(value) {
        return normalizeUsername(value).toLowerCase();
    }

    function canManageReports() {
        return true;
    }

    function canManageComment(comment) {
        if (canManageReports()) return true;
        const myLogin = normalizeAccessUsername(grafanaUserLogin);
        const myDisplay = normalizeUsername(grafanaDisplayName);
        if (comment && typeof comment === 'object') {
            const commentLogin = normalizeAccessUsername(comment.userLogin || comment.login || comment.username || '');
            if (commentLogin && myLogin) return commentLogin === myLogin;
            return normalizeUsername(comment.user || comment.author || comment.by || '') === myDisplay;
        }
        return normalizeUsername(comment) === myDisplay;
    }

    function canEditReportDescription(report) {
        if (!report || typeof report !== 'object') return false;
        const myLogin = normalizeAccessUsername(grafanaUserLogin);
        const reportLogin = normalizeAccessUsername(report.userLogin || report.login || report.username || '');
        if (myLogin && reportLogin) return myLogin === reportLogin;
        const myDisplay = normalizeAccessUsername(grafanaDisplayName);
        const reportDisplay = normalizeAccessUsername(report.user || report.reporter || report.author || '');
        return !!myDisplay && !!reportDisplay && myDisplay === reportDisplay;
    }

    function canModifyReport(report) {
        // Anyone can modify in localStorage-only mode (single browser).
        return true;
    }

    function getReporterDisplayName() {
        const display = normalizeUsername(grafanaDisplayName);
        if (display && display.toLowerCase() !== 'unknown user') return display;
        const stored = normalizeUsername(localStorage.getItem(STORAGE_KEY_REPORTER));
        if (stored) return stored;
        return 'Operator';
    }

    function resolveIdentity() {
        const storedName = normalizeUsername(localStorage.getItem(STORAGE_KEY_REPORTER));
        const storedLogin = normalizeUsername(localStorage.getItem(STORAGE_KEY_REPORTER_LOGIN));
        return {
            login: storedLogin || (storedName ? storedName.toLowerCase().replace(/\s+/g, '-') : 'operator'),
            displayName: storedName || 'Operator'
        };
    }

    // =====================================================================
    // PROMETHEUS DATA
    // =====================================================================

    function resolvePanelRange() {
        if (typeof window.gfnResolvePanelRange === 'function') {
            return window.gfnResolvePanelRange();
        }
        const now = Date.now();
        return { fromMs: now - 6 * 3600 * 1000, toMs: now, rangeStr: '21600s', isLive: true };
    }

    function pickStep(rangeSec) {
        // Match Grafana's "auto" step granularity (~range / panel-width-px).
        const auto = Math.max(30, Math.round(rangeSec / 2500));
        const days = rangeSec / 86400;
        // Brief backup/down events (~2 min) vanish at ~4 min steps unless the
        // Prometheus query grid happens to align with the scrape that saw
        // status=1 — that is why Store 75 backup looked random on hard refresh.
        if (days <= 7) return Math.min(auto, 60);
        if (days <= 30) return Math.min(auto, 120);
        return Math.min(auto, 300);
    }

    async function promQueryRange(expr, fromMs, toMs, stepSec) {
        const url = `${PROM_BASE}/query_range`
            + `?query=${encodeURIComponent(expr)}`
            + `&start=${(fromMs / 1000).toFixed(3)}`
            + `&end=${(toMs / 1000).toFixed(3)}`
            + `&step=${stepSec}s`;
        let res;
        try {
            res = await fetchWithTimeout(
                url,
                { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'include' },
                requestTimeoutMs(fromMs, toMs)
            );
        } catch (err) {
            console.warn('[RouterTimeline] Prom fetch failed:', err);
            return [];
        }
        if (!res.ok) {
            console.warn('[RouterTimeline] Prom HTTP', res.status, expr.slice(0, 60));
            return [];
        }
        let json;
        try {
            json = await res.json();
        } catch (err) {
            console.warn('[RouterTimeline] Prom JSON parse failed', err);
            return [];
        }
        if (!json || json.status !== 'success' || !json.data || !Array.isArray(json.data.result)) {
            return [];
        }
        return json.data.result;
    }

    function buildSeriesFromMatrix(refId, result) {
        const rawValues = Array.isArray(result.values) ? result.values : [];
        const times = new Array(rawValues.length);
        const vals = new Array(rawValues.length);
        for (let i = 0; i < rawValues.length; i++) {
            const tup = rawValues[i];
            times[i] = Number(tup[0]) * 1000;
            vals[i] = Number(tup[1]);
        }
        const labels = result.metric || {};
        const metricName = labels.__name__ || refId;
        return {
            refId,
            name: metricName,
            fields: [
                {
                    name: 'Time', type: 'time',
                    values: { length: times.length, get(i) { return times[i]; } }
                },
                {
                    name: metricName, type: 'number', labels,
                    values: { length: vals.length, get(i) { return vals[i]; } }
                }
            ]
        };
    }

    function rawRangeFromResolved(range) {
        // Build a minimal `request.range.raw` so getTimeRangeLabel can emit
        // a "Last 6h" label when the URL uses live tokens.
        const params = new URLSearchParams(window.location.search);
        const from = params.get('from');
        const to = params.get('to');
        if (from && to) return { from, to };
        return { from: new Date(range.fromMs).toISOString(), to: new Date(range.toMs).toISOString() };
    }

    async function fetchPanelData() {
        const range = resolvePanelRange();
        const stepSec = pickStep((range.toMs - range.fromMs) / 1000);
        const fetchKey = `${range.fromMs}|${range.toMs}|${stepSec}`;
        if (promFetchInFlight && promFetchKey === fetchKey) return promFetchInFlight;
        promFetchKey = fetchKey;
        promFetchInFlight = (async () => {
            const all = await Promise.all(
                PROM_QUERIES.map((q) => promQueryRange(q.expr, range.fromMs, range.toMs, stepSec))
            );
            const series = [];
            for (let i = 0; i < all.length; i++) {
                const refId = PROM_QUERIES[i].refId;
                for (const result of all[i]) series.push(buildSeriesFromMatrix(refId, result));
            }
            if (!series.length) {
                console.warn('[RouterTimeline] Prometheus returned no router timeline series');
            }
            const fromDate = new Date(range.fromMs);
            const toDate = new Date(range.toMs);
            return {
                series,
                request: {
                    range: {
                        from: fromDate, to: toDate,
                        raw: rawRangeFromResolved(range)
                    }
                }
            };
        })();
        try {
            return await promFetchInFlight;
        } finally {
            if (promFetchKey === fetchKey) {
                promFetchInFlight = null;
                promFetchKey = '';
            }
        }
    }

    function reportStatusLabel(report) {
        if (!report || !report.resolved) return 'Active';
        return report.resolvedAuto ? 'Auto Solved' : 'Solved';
    }

    function resolveApiBase() {
        const api = window.GFN_API_BASE;
        if (api && typeof api.resolveApiBase === 'function') return api.resolveApiBase();
        const configured =
            (typeof window !== 'undefined' && window.__CRM_TICKET_API_BASE__) ||
            (typeof window !== 'undefined' && window.CRM_TICKET_API_BASE) ||
            '';
        return String(configured || '/incidents-api').replace(/\/+$/, '');
    }

    async function apiJson(method, path, body) {
        const url = `${resolveApiBase()}${path}`;
        const opts = {
            method,
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            credentials: 'include'
        };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetchWithTimeout(url, opts);
        if (!res.ok) {
            let detail = '';
            try { detail = await res.text(); } catch (_e) { /* ignore */ }
            throw new Error(detail || `HTTP ${res.status}`);
        }
        if (res.status === 204) return null;
        return res.json();
    }

    function upsertReportInCache(report) {
        if (!report) return;
        const idx = moduleState.reportsCache.findIndex((r) => r.id === report.id);
        if (idx === -1) moduleState.reportsCache.unshift(report);
        else moduleState.reportsCache[idx] = report;
        moduleState.reportsCache.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
    }

    function removeReportFromCache(reportId) {
        moduleState.reportsCache = moduleState.reportsCache.filter((r) => r.id !== reportId);
    }

    // =====================================================================
    // REPORTS API (Postgres via gfn_api)
    // =====================================================================

    function normalizeComments(value) {
        if (!Array.isArray(value)) return [];
        const out = [];
        for (let i = 0; i < value.length; i++) {
            const c = value[i];
            let id = '', user = 'Unknown User', userLogin = '', text = '', ts = '';
            if (typeof c === 'string') { text = c; ts = new Date().toISOString(); }
            else if (c && typeof c === 'object') {
                id = String(c.id || c.commentId || c._id || '').trim();
                user = normalizeUsername(c.user || c.author || c.author_name || c.by || c.login || c.username || c.name || c.reporter || c.email) || 'Unknown User';
                userLogin = normalizeUsername(c.userLogin || c.author_login || c.login || c.username || c.user_name || '');
                text = String(c.text || c.comment || c.message || c.body || '');
                ts = String(c.timestamp || c.time || c.createdAt || c.created_at || c.created || '');
            } else continue;
            text = String(text || '').trim();
            if (!text) continue;
            if (text.length > 2000) text = text.slice(0, 2000);
            let dt = ts ? new Date(ts) : null;
            if (!dt || isNaN(dt.getTime())) dt = new Date();
            if (!id) id = String(dt.getTime()) + '-' + String(i) + '-' + String(Math.random()).slice(2, 8);
            out.push({
                id: String(id),
                user: normalizeUsername(user) || 'Unknown User',
                userLogin: normalizeUsername(userLogin),
                text,
                timestamp: dt.toISOString()
            });
            if (out.length >= 200) break;
        }
        out.sort((a, b) => (Date.parse(b && b.timestamp || '') || 0) - (Date.parse(a && a.timestamp || '') || 0));
        return out;
    }

    function countTotalComments(comments) {
        return normalizeComments(comments).length;
    }

    function getPanelTimeRange(data) {
        const fromRaw = data && data.request && data.request.range && data.request.range.from;
        const toRaw = data && data.request && data.request.range && data.request.range.to;
        const from = fromRaw ? (typeof fromRaw.valueOf === 'function' ? fromRaw.valueOf() : new Date(fromRaw).getTime()) : null;
        const to = toRaw ? (typeof toRaw.valueOf === 'function' ? toRaw.valueOf() : new Date(toRaw).getTime()) : null;
        return {
            from: Number.isFinite(from) ? from : null,
            to: Number.isFinite(to) ? to : null
        };
    }

    function normalizeReportRecord(r) {
        const idNum = (r && r.id !== undefined && r.id !== null) ? parseInt(r.id, 10) : NaN;
        const updates = r && (r.updates || r.comments || r.comment || r.notes);
        return {
            id: Number.isFinite(idNum) ? idNum : Date.now(),
            store: String((r && (r.store || r.store_code)) || '').trim(),
            deviceType: String((r && (r.deviceType || r.device || r.category)) || '').trim(),
            description: String((r && r.description) || '').trim(),
            user: String((r && (r.user || r.reporter || r.reporter_name)) || '').trim() || 'Unknown User',
            userLogin: String((r && (r.userLogin || r.reporterLogin || r.reporter_login || r.login || r.username)) || '').trim(),
            timestamp: String((r && (r.timestamp || r.reported_at)) || new Date().toISOString()),
            timelineStart: String((r && (r.timelineStart || r.timeline_start || r.windowStart || r.segmentStart || r.startDate)) || '').trim(),
            timelineEnd: String((r && (r.timelineEnd || r.timeline_end || r.windowEnd || r.segmentEnd || r.endDate)) || '').trim(),
            resolved: parseBool(r && (r.resolved !== undefined ? r.resolved : (r.done !== undefined ? r.done : r.isResolved))),
            resolvedAuto: parseBool(r && (r.resolvedAuto !== undefined ? r.resolvedAuto : r.resolved_auto)),
            comments: normalizeComments(updates)
        };
    }

    async function fetchReports() {
        try {
            const data = await apiJson('GET', '/router-timeline/reports');
            const rows = Array.isArray(data && data.reports) ? data.reports : [];
            return rows.map(normalizeReportRecord).filter((r) => r.store && r.deviceType && r.description);
        } catch (err) {
            console.warn('[RouterTimeline] Reports API unavailable (rebuild gfn_api + run SQL migration):', err);
            return [];
        }
    }

    async function syncReports(force) {
        if (moduleState.isSyncing && moduleState.syncInFlight) {
            try { await moduleState.syncInFlight; } catch (e) { /* ignore */ }
            return moduleState.reportsCache;
        }
        if (!force && moduleState.reportsCache.length > 0 && Date.now() - moduleState.lastSyncTime < SYNC_MIN_INTERVAL_MS) {
            return moduleState.reportsCache;
        }

        moduleState.isSyncing = true;
        moduleState.syncInFlight = (async () => {
            const reports = await fetchReports();
            moduleState.reportsCache = Array.isArray(reports) ? reports : [];
            moduleState.lastSyncTime = Date.now();
            return moduleState.reportsCache;
        })();

        try {
            await moduleState.syncInFlight;
        } catch (e) {
            console.error('[RouterTimeline] Sync failed:', e);
        } finally {
            moduleState.isSyncing = false;
            moduleState.syncInFlight = null;
        }

        return moduleState.reportsCache;
    }

    async function addReport(store, deviceType, description, userDisplayName, userLogin, resolved, timestampMs, timelineStartMs, timelineEndMs) {
        const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
        const payload = {
            storeCode: store.trim(),
            category: deviceType,
            description: description.trim(),
            reporterName: normalizeUsername(userDisplayName) || 'Unknown User',
            reporterLogin: normalizeUsername(userLogin || ''),
            reportedAtMs: ts,
            resolved: !!resolved
        };
        if (Number.isFinite(timelineStartMs)) payload.timelineStartMs = timelineStartMs;
        if (Number.isFinite(timelineEndMs)) payload.timelineEndMs = timelineEndMs;
        const row = await apiJson('POST', '/router-timeline/reports', payload);
        const report = normalizeReportRecord(row);
        upsertReportInCache(report);
        return report;
    }

    async function updateReport(reportId, updates) {
        const current = moduleState.reportsCache.find((r) => r.id === reportId);
        const ts = Number.isFinite(updates && updates.timestampMs)
            ? updates.timestampMs
            : (current ? Date.parse(current.timestamp) : Date.now());
        const payload = {
            storeCode: String(updates.store || (current && current.store) || '').trim(),
            category: String(updates.deviceType || (current && current.deviceType) || '').trim(),
            description: String(updates.description || (current && current.description) || '').trim(),
            reportedAtMs: ts,
            resolved: !!(updates && updates.resolved)
        };
        if (updates && Object.prototype.hasOwnProperty.call(updates, 'timelineStartMs')) {
            payload.timelineStartMs = Number.isFinite(updates.timelineStartMs) ? updates.timelineStartMs : null;
        }
        if (updates && Object.prototype.hasOwnProperty.call(updates, 'timelineEndMs')) {
            payload.timelineEndMs = Number.isFinite(updates.timelineEndMs) ? updates.timelineEndMs : null;
        }
        const row = await apiJson('PATCH', `/router-timeline/reports/${reportId}`, payload);
        const report = normalizeReportRecord(row);
        upsertReportInCache(report);
        return report;
    }

    async function deleteReport(reportId) {
        await apiJson('DELETE', `/router-timeline/reports/${reportId}`);
        removeReportFromCache(reportId);
        return { id: reportId };
    }

    async function updateReportResolved(reportId, resolved, resolvedAuto) {
        const row = await apiJson('PATCH', `/router-timeline/reports/${reportId}/resolved`, {
            resolved: !!resolved,
            resolvedAuto: !!resolvedAuto
        });
        const report = normalizeReportRecord(row);
        upsertReportInCache(report);
        return report;
    }

    async function addReportComment(reportId, userDisplayName, userLogin, text) {
        const msg = String(text || '').trim();
        if (!msg) throw new Error('Empty comment');
        const row = await apiJson('POST', `/router-timeline/reports/${reportId}/updates`, {
            authorName: normalizeUsername(userDisplayName) || 'Unknown User',
            authorLogin: normalizeUsername(userLogin || ''),
            body: msg
        });
        const report = normalizeReportRecord(row);
        upsertReportInCache(report);
        return report;
    }

    async function updateReportComment(reportId, commentId, userDisplayName, userLogin, text) {
        const msg = String(text || '').trim();
        if (!msg) throw new Error('Empty comment');
        const row = await apiJson('PATCH', `/router-timeline/reports/${reportId}/updates/${commentId}`, {
            authorName: normalizeUsername(userDisplayName) || 'Unknown User',
            authorLogin: normalizeUsername(userLogin || ''),
            body: msg
        });
        const report = normalizeReportRecord(row);
        upsertReportInCache(report);
        return report;
    }

    async function deleteReportComment(reportId, commentId) {
        const row = await apiJson('DELETE', `/router-timeline/reports/${reportId}/updates/${commentId}`);
        const report = normalizeReportRecord(row);
        upsertReportInCache(report);
        return report;
    }

    function computeReportsFingerprint(reports) {
        if (!Array.isArray(reports) || !reports.length) return '';
        return reports.map((r) => [
            r.id,
            r.timestamp,
            r.resolved ? '1' : '0',
            r.resolvedAuto ? '1' : '0',
            r.description,
            r.deviceType || r.device || '',
            countTotalComments(r.comments)
        ].join(':')).join('|');
    }

    function applyPanelData(data) {
        historyTimeSeriesData = [];
        const parsedSeries = [];
        if (data && data.series) {
            data.series.forEach((series) => {
                const parsed = parseHistoricalSeries(series);
                if (parsed) parsedSeries.push(parsed);
            });
        }
        historyTimeSeriesData = mergeRouterTimelineSeriesByStore(parsedSeries);
    }

    function refreshReportsIfChanged(htmlNode) {
        const fp = computeReportsFingerprint(moduleState.reportsCache);
        if (fp === moduleState.reportsFingerprint) return false;
        moduleState.reportsFingerprint = fp;
        renderIncidentReportsList(htmlNode, moduleState.currentData);
        return true;
    }

    function ensureReportsSyncInterval(htmlNode) {
        if (moduleState.reportsSyncIntervalId) return;
        moduleState.reportsSyncIntervalId = setInterval(async () => {
            if (document.visibilityState !== 'visible') return;
            const node = moduleState.boundHtmlNode || htmlNode;
            if (!node) return;
            try {
                await syncReports(false);
                refreshReportsIfChanged(node);
            } catch (err) {
                console.warn('[RouterTimeline] Reports sync failed:', err);
            }
        }, 30000);
    }

    // =====================================================================
    // TIMELINE DATA
    // =====================================================================

    function parseHistoricalSeries(series) {
        if (!series || !series.fields || series.fields.length < 2) return null;
        const timeField = series.fields.find((f) => f.type === 'time' || (f.name || '').toLowerCase() === 'time')
            || series.fields[0];
        const valueField = series.fields.find((f) => (f.type === 'number' && f !== timeField) || (f.name || '').toLowerCase().includes('value'))
            || series.fields.find((f) => f !== timeField)
            || series.fields[1];
        if (!timeField || !valueField || !timeField.values || !valueField.values) return null;
        const labelStore = valueField.labels && (valueField.labels.store || valueField.labels.location || valueField.labels.instance);
        const deviceName = String(labelStore || valueField.name || 'Unknown').trim();
        const dataPoints = [];
        for (let i = 0; i < timeField.values.length; i++) {
            const timestamp = timeField.values.get(i);
            const rawValue = valueField.values.get(i);
            if (timestamp === null || rawValue === null) continue;
            const value = Number(rawValue);
            if (!Number.isFinite(value)) continue;
            let status = 'up';
            if (value === 0) status = 'down';
            else if (value === 1) status = 'backup';
            dataPoints.push({ time: timestamp, value, status });
        }
        if (dataPoints.length === 0) return null;
        return { name: deviceName, storeKey: normalizeStoreName(deviceName), dataPoints };
    }

    function mergeRouterTimelineSeriesByStore(parsedList) {
        const list = (Array.isArray(parsedList) ? parsedList : []).filter(Boolean);
        if (list.length < 2) return list;
        const groups = new Map();
        list.forEach((parsed) => {
            const key = normalizeStoreName(parsed.storeKey || parsed.name);
            if (!key) {
                if (!groups.has('__orphan__')) groups.set('__orphan__', []);
                groups.get('__orphan__').push(parsed);
                return;
            }
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(parsed);
        });

        function pickPreferredDeviceName(parts) {
            let best = '';
            parts.forEach((p) => {
                const s = String((p && p.name) || '').trim();
                if (!s) return;
                if (!best) { best = s; return; }
                if (/AR\d+/i.test(s) && !/AR\d+/i.test(best)) { best = s; return; }
                if (/AR\d+/i.test(s) && /AR\d+/i.test(best) && s.length > best.length) best = s;
            });
            return best || (parts[0] && parts[0].name) || '';
        }

        const out = [];
        groups.forEach((parts, key) => {
            if (key === '__orphan__') { parts.forEach((p) => out.push(p)); return; }
            if (parts.length === 1) { out.push(parts[0]); return; }
            const allPoints = [];
            parts.forEach((p) => {
                if (p.dataPoints && p.dataPoints.length) {
                    for (let i = 0; i < p.dataPoints.length; i++) allPoints.push(p.dataPoints[i]);
                }
            });
            allPoints.sort((a, b) => a.time - b.time);
            const byTime = new Map();
            for (let i = 0; i < allPoints.length; i++) {
                const p = allPoints[i];
                const t = p.time;
                if (!byTime.has(t)) { byTime.set(t, p); continue; }
                const prev = byTime.get(t);
                const pv = Number(prev.value);
                const cv = Number(p.value);
                if (!Number.isFinite(pv)) byTime.set(t, p);
                else if (Number.isFinite(cv) && cv < pv) byTime.set(t, p);
            }
            const mergedPoints = Array.from(byTime.keys()).sort((a, b) => a - b).map((t) => byTime.get(t));
            out.push({ name: pickPreferredDeviceName(parts), storeKey: key, dataPoints: mergedPoints });
        });

        out.sort((a, b) => {
            const ka = String(a.storeKey || '');
            const kb = String(b.storeKey || '');
            const na = parseInt(ka, 10);
            const nb = parseInt(kb, 10);
            if (String(na) === ka && String(nb) === kb && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
            return ka.localeCompare(kb, undefined, { numeric: true });
        });

        return out;
    }

    function incidentSegments(segments) {
        return (segments || []).filter((s) => s.status === 'down' || s.status === 'backup');
    }

    function deviceHasVisibleActivity(device, maxTime, reportsByStore, rangeMin, rangeMax) {
        const points = device && device.dataPoints;
        if (!points || !points.length) return false;
        const segments = buildSegments(points.slice().sort((a, b) => a.time - b.time), maxTime);
        if (incidentSegments(segments).length > 0) return true;
        const key = normalizeStoreName(device.storeKey);
        const reps = reportsByStore.get(key) || [];
        return reps.some((r) => {
            const ts = Date.parse(r.timestamp);
            return Number.isFinite(ts) && ts >= rangeMin && ts <= rangeMax;
        });
    }

    function buildSegments(dataPoints, maxTime) {
        if (!dataPoints || dataPoints.length === 0) return [];
        const segments = [];
        const MAX_ALLOWED_GAP = 20 * 60 * 1000;
        let expectedInterval = 2 * 60 * 1000;
        const lastTime = dataPoints[dataPoints.length - 1].time;
        const rangeCap = Number.isFinite(maxTime) ? maxTime : lastTime;
        const deltas = [];
        for (let i = 1; i < dataPoints.length; i++) {
            const delta = dataPoints[i].time - dataPoints[i - 1].time;
            if (delta > 0 && delta <= MAX_ALLOWED_GAP) deltas.push(delta);
        }
        if (deltas.length) {
            deltas.sort((a, b) => a - b);
            expectedInterval = deltas[Math.floor(deltas.length / 2)];
        }
        if (!Number.isFinite(expectedInterval) || expectedInterval <= 0) expectedInterval = 2 * 60 * 1000;
        const contiguousGap = expectedInterval * 1.5;
        const capTime = Math.min(rangeCap, lastTime + expectedInterval);
        let current = null;
        for (let i = 0; i < dataPoints.length; i++) {
            const point = dataPoints[i];
            const next = dataPoints[i + 1];
            const gap = next ? (next.time - point.time) : 0;
            const withinGap = next && gap <= MAX_ALLOWED_GAP;
            const contiguous = next && gap <= contiguousGap;
            const rawEnd = withinGap
                ? (contiguous ? next.time : (point.time + expectedInterval))
                : (point.time + expectedInterval);
            const endTime = Math.min(rawEnd, capTime);
            if (!current) {
                current = { status: point.status, startTime: point.time, endTime, startValue: point.value, endValue: point.value };
                continue;
            }
            if (point.status === current.status && point.time - current.endTime <= contiguousGap) {
                current.endTime = endTime;
                current.endValue = point.value;
            } else {
                if (current.endTime < current.startTime) current.endTime = current.startTime;
                segments.push(current);
                current = { status: point.status, startTime: point.time, endTime, startValue: point.value, endValue: point.value };
            }
        }
        if (current) {
            if (current.endTime < current.startTime) current.endTime = current.startTime;
            segments.push(current);
        }
        return segments;
    }

    function getTimeRangeLabel(rangeFrom, rangeTo, rawRange) {
        if (rawRange && rawRange.from && rawRange.to) {
            const rawFrom = String(rawRange.from).toLowerCase();
            const rawTo = String(rawRange.to).toLowerCase();
            if (rawFrom.startsWith('now-') && rawTo === 'now') {
                return `Last ${rawFrom.replace('now-', '')}`;
            }
        }
        if (Number.isFinite(rangeFrom) && Number.isFinite(rangeTo)) {
            return `${formatTimestamp(rangeFrom)} - ${formatTimestamp(rangeTo)}`;
        }
        return 'Custom range';
    }

    function getTimelineDividerMode(timeRangeMs) {
        const dayMs = 24 * 60 * 60 * 1000;
        if (!Number.isFinite(timeRangeMs) || timeRangeMs <= 0) return null;
        const days = timeRangeMs / dayMs;
        if (days < 0.75) return null;
        if (days <= 9)   return { kind: 'day',    stepUnit: 'day',   step: 1 };
        if (days <= 17)  return { kind: 'day',    stepUnit: 'day',   step: 2 };
        if (days <= 75)  return { kind: 'period', stepUnit: 'day',   step: 7 };
        if (days <= 135) return { kind: 'period', stepUnit: 'month', step: 1 };
        if (days <= 270) return { kind: 'period', stepUnit: 'month', step: 2 };
        if (days <= 540) return { kind: 'period', stepUnit: 'month', step: 3 };
        return                 { kind: 'period', stepUnit: 'month', step: 6 };
    }

    function formatTimelineDividerLabel(mode, startMs, endMs) {
        const start = new Date(startMs);
        const end = new Date(Math.max(startMs, endMs - 1));
        if (mode.stepUnit === 'day') {
            if (mode.step <= 2) return start.toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
            const startDay = start.getDate();
            const endDay = end.getDate();
            const startMonth = start.toLocaleDateString('en-US', { month: 'long' });
            const endMonth = end.toLocaleDateString('en-US', { month: 'long' });
            if (startMonth === endMonth) return `${startDay}-${endDay} ${startMonth}`;
            return `${startDay} ${startMonth} - ${endDay} ${endMonth}`;
        }
        if (mode.stepUnit === 'month') {
            if (mode.step === 1) return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            const startLabel = start.toLocaleDateString('en-US', { month: 'short' });
            const endLabel = end.toLocaleDateString('en-US', { month: 'short' });
            const startYear = start.getFullYear();
            const endYear = end.getFullYear();
            if (startYear === endYear) return `${startLabel} - ${endLabel} ${endYear}`;
            return `${startLabel} ${startYear} - ${endLabel} ${endYear}`;
        }
        return '';
    }

    function buildTimelineDividers(minTime, maxTime, includeLabels) {
        const timeRange = maxTime - minTime;
        const mode = getTimelineDividerMode(timeRange);
        if (!mode) return { linesHtml: '', labelsHtml: '' };
        const boundaries = [];
        const cursor = new Date(minTime);
        cursor.setHours(0, 0, 0, 0);
        if (mode.stepUnit === 'day') {
            if (mode.step === 7) {
                const day = cursor.getDay();
                const toNextMonday = day === 0 ? 1 : (8 - day);
                cursor.setDate(cursor.getDate() + toNextMonday);
            } else {
                cursor.setDate(cursor.getDate() + mode.step);
            }
            const stepMs = mode.step * 24 * 60 * 60 * 1000;
            let t = cursor.getTime();
            while (t < maxTime) {
                if (t > minTime) boundaries.push(t);
                t += stepMs;
            }
        } else {
            cursor.setDate(1);
            cursor.setMonth(cursor.getMonth() + mode.step);
            while (cursor.getTime() < maxTime) {
                const t = cursor.getTime();
                if (t > minTime) boundaries.push(t);
                cursor.setMonth(cursor.getMonth() + mode.step);
            }
        }
        const cssMode = mode.kind === 'day' ? 'day' : 'period';
        let linesHtml = '';
        boundaries.forEach((boundaryMs) => {
            const left = ((boundaryMs - minTime) / timeRange) * 100;
            linesHtml += `<span class="timeline-divider timeline-divider-${cssMode}" style="left:${left}%;" aria-hidden="true"></span>`;
        });
        if (!includeLabels) return { linesHtml, labelsHtml: '' };
        const bucketEnds = boundaries.concat([maxTime]);
        let bucketStart = minTime;
        let labelsHtml = '';
        bucketEnds.forEach((bucketEnd) => {
            const center = ((bucketStart + bucketEnd) / 2 - minTime) / timeRange * 100;
            const label = formatTimelineDividerLabel(mode, bucketStart, bucketEnd);
            labelsHtml += `<span class="timeline-divider-label timeline-divider-label-${cssMode}" style="left:${center}%;" aria-hidden="true">${escapeHtml(label)}</span>`;
            bucketStart = bucketEnd;
        });
        return { linesHtml, labelsHtml };
    }

    function renderTimeline(htmlNode, data) {
        const wrapper = htmlNode.getElementById('timeline-wrapper');
        if (!wrapper) return;
        if (!historyTimeSeriesData.length) {
            wrapper.innerHTML = '<div class="timeline-loading">No incidents in the selected time range.</div>';
            return;
        }

        const rangeFromRaw = data && data.request && data.request.range && data.request.range.from;
        const rangeToRaw = data && data.request && data.request.range && data.request.range.to;
        const rangeFrom = rangeFromRaw ? (typeof rangeFromRaw.valueOf === 'function' ? rangeFromRaw.valueOf() : new Date(rangeFromRaw).getTime()) : null;
        const rangeTo = rangeToRaw ? (typeof rangeToRaw.valueOf === 'function' ? rangeToRaw.valueOf() : new Date(rangeToRaw).getTime()) : null;

        let minTime = Number.isFinite(rangeFrom) ? rangeFrom : Infinity;
        let maxTime = Number.isFinite(rangeTo) ? rangeTo : -Infinity;

        historyTimeSeriesData.forEach((device) => {
            if (!device.dataPoints || device.dataPoints.length === 0) return;
            const first = device.dataPoints[0].time;
            const last = device.dataPoints[device.dataPoints.length - 1].time;
            if (!Number.isFinite(rangeFrom)) minTime = Math.min(minTime, first);
            if (!Number.isFinite(rangeTo)) maxTime = Math.max(maxTime, last);
        });

        if (!Number.isFinite(minTime) || !Number.isFinite(maxTime) || minTime >= maxTime) {
            minTime = Date.now() - 6 * 60 * 60 * 1000;
            maxTime = Date.now();
        }

        const timeRange = maxTime - minTime;
        const rangeEl = htmlNode.getElementById('timeline-range');
        if (rangeEl) {
            rangeEl.textContent = getTimeRangeLabel(minTime, maxTime, data && data.request && data.request.range && data.request.range.raw);
        }

        moduleState.visibleTimeRange = { minTime, maxTime };

        const reports = moduleState.reportsCache.slice();
        const reportsInRange = reports.filter((r) => {
            const ts = Date.parse(r.timestamp);
            return Number.isFinite(ts) && ts >= minTime && ts <= maxTime;
        });

        let downLocationCount = 0;
        const downRangesByStore = new Map();
        const MIN_DOWN_DURATION_MS = 15 * 60 * 1000;

        historyTimeSeriesData.forEach((device) => {
            const storeKey = normalizeStoreName(device.storeKey);
            const points = device.dataPoints.slice().sort((a, b) => a.time - b.time);
            const segments = buildSegments(points, maxTime);
            segments.forEach((segment) => {
                if (!segment || segment.status !== 'down') return;
                const segmentDuration = segment.endTime - segment.startTime;
                if (!Number.isFinite(segmentDuration) || segmentDuration < MIN_DOWN_DURATION_MS) return;
                downLocationCount += 1;
                if (!downRangesByStore.has(storeKey)) downRangesByStore.set(storeKey, []);
                downRangesByStore.get(storeKey).push(segment);
            });
        });

        const reportsOnDownKeys = new Set();
        const reportsOnDown = [];
        reportsInRange.forEach((r) => {
            const ts = Date.parse(r.timestamp);
            if (!Number.isFinite(ts)) return;
            const key = normalizeStoreName(r.store);
            const ranges = downRangesByStore.get(key);
            if (!ranges || ranges.length === 0) return;
            const isWithinDown = ranges.some((segment) => {
                if (isTimestampInInterval(ts, segment.startTime, segment.endTime)) {
                    reportsOnDownKeys.add(key + '|' + segment.startTime + '|' + segment.endTime);
                    return true;
                }
                return false;
            });
            if (isWithinDown) reportsOnDown.push(r);
        });
        const reportsOnDownCount = reportsOnDownKeys.size;
        moduleState.reportsOnLongDown = reportsOnDown;
        moduleState.reportsOnDownCount = reportsOnDownCount;
        moduleState.downLocationCount = downLocationCount;

        const reportsLabelBtn = htmlNode.getElementById('timeline-reports-btn');
        if (reportsLabelBtn) reportsLabelBtn.textContent = `Reports ${reportsOnDownCount} / ${downLocationCount} Down`;

        const reportsByStore = new Map();
        reportsInRange.forEach((r) => {
            const key = normalizeStoreName(r.store);
            if (!key) return;
            if (!reportsByStore.has(key)) reportsByStore.set(key, []);
            reportsByStore.get(key).push(r);
        });

        const allReportsByStore = new Map();
        reports.forEach((r) => {
            const key = normalizeStoreName(r.store);
            if (!key) return;
            if (!allReportsByStore.has(key)) allReportsByStore.set(key, []);
            allReportsByStore.get(key).push(r);
        });

        const AUTO_SOLVE_DELAY_MS = 15 * 60 * 1000;
        const now = Date.now();
        const reportsToAutoSolve = new Map();

        historyTimeSeriesData.forEach((device) => {
            const key = normalizeStoreName(device.storeKey);
            const points = device.dataPoints.slice().sort((a, b) => a.time - b.time);
            const segments = buildSegments(points, maxTime);
            if (!segments.length) return;
            const downSegments = segments.filter((s) => s.status === 'down' && Number.isFinite(s.startTime) && Number.isFinite(s.endTime));
            const storeReports = allReportsByStore.get(key) || [];
            storeReports.forEach((report) => {
                if (!report || report.resolved) return;
                const ts = Date.parse(report.timestamp);
                if (!Number.isFinite(ts)) return;
                const reportStart = Date.parse(report.timelineStart || '');
                const reportEnd = Date.parse(report.timelineEnd || '');
                const hasTimelineWindow = Number.isFinite(reportStart) && Number.isFinite(reportEnd) && reportEnd >= reportStart;
                let anchorEnd = NaN;
                if (hasTimelineWindow) {
                    const related = downSegments.filter((segment) => intervalsOverlap(segment.startTime, segment.endTime, reportStart, reportEnd));
                    anchorEnd = related.length
                        ? related.reduce((maxEnd, segment) => Math.max(maxEnd, segment.endTime), 0)
                        : reportEnd;
                } else {
                    const related = downSegments.filter((segment) => isTimestampInInterval(ts, segment.startTime, segment.endTime));
                    anchorEnd = related.length
                        ? related.reduce((maxEnd, segment) => Math.max(maxEnd, segment.endTime), 0)
                        : ts;
                }
                if (!Number.isFinite(anchorEnd) || anchorEnd <= 0) return;
                let expanded = true;
                while (expanded) {
                    expanded = false;
                    const recoverAt = anchorEnd + AUTO_SOLVE_DELAY_MS;
                    downSegments.forEach((segment) => {
                        if (segment.startTime < recoverAt && segment.endTime > anchorEnd) {
                            anchorEnd = segment.endTime;
                            expanded = true;
                        }
                    });
                }
                if (now < anchorEnd + AUTO_SOLVE_DELAY_MS) return;
                reportsToAutoSolve.set(report.id, report);
            });
        });

        if (moduleState.autoSolveTimeoutId) {
            clearTimeout(moduleState.autoSolveTimeoutId);
            moduleState.autoSolveTimeoutId = null;
        }
        if (reportsToAutoSolve.size > 0) {
            moduleState.autoSolveTimeoutId = setTimeout(async () => {
                let changed = false;
                let autoSolvedCount = 0;
                for (const report of reportsToAutoSolve.values()) {
                    if (!report || report.resolved) continue;
                    try {
                        const updated = await updateReportResolved(report.id, true, true);
                        if (updated) { changed = true; autoSolvedCount += 1; }
                    } catch (err) {
                        console.error('[RouterTimeline] Auto-resolve report failed:', err);
                    }
                }
                if (changed) {
                    await syncReports(true);
                    refreshAllViews(htmlNode, moduleState.currentData || data);
                    showToast(`Auto-solved ${autoSolvedCount} report${autoSolvedCount === 1 ? '' : 's'} after 15m recovery`, 'success');
                }
                moduleState.autoSolveTimeoutId = null;
            }, 0);
        }

        const timelineDividers = buildTimelineDividers(minTime, maxTime, true);

        let html = '<div class="timeline-content">';
        html += '<div class="timeline-row timeline-row-head">';
        html += '<div class="timeline-label timeline-label-head">';
        html += '<span class="timeline-cell">STORE</span>';
        html += '<span class="timeline-cell">DOWN</span>';
        html += '<span class="timeline-cell">BACKUP</span>';
        html += '<span class="timeline-cell">REPORT</span>';
        html += '</div>';
        html += `<div class="timeline-bar timeline-bar-head" aria-hidden="true">${timelineDividers.linesHtml}${timelineDividers.labelsHtml}</div>`;
        html += '</div>';

        const visibleDevices = historyTimeSeriesData.filter((device) =>
            deviceHasVisibleActivity(device, maxTime, reportsByStore, minTime, maxTime)
        );

        if (!visibleDevices.length) {
            wrapper.innerHTML = '<div class="timeline-loading">No incidents in the selected time range.</div>';
            return;
        }

        visibleDevices.forEach((device) => {
            const points = device.dataPoints.slice().sort((a, b) => a.time - b.time);
            const segments = buildSegments(points, maxTime);
            const deviceReports = reportsByStore.get(normalizeStoreName(device.storeKey)) || [];
            const statusCounts = { down: 0, backup: 0 };
            const statusDetails = { down: [], backup: [] };

            segments.forEach((segment) => {
                if (!statusCounts.hasOwnProperty(segment.status)) return;
                statusCounts[segment.status] += 1;
                const duration = segment.endTime - segment.startTime;
                statusDetails[segment.status].push(
                    `${formatTimestamp(segment.startTime)} - ${formatTimestamp(segment.endTime)} (Duration: ${formatDuration(duration)})`
                );
            });

            const downTitle = statusCounts.down > 0
                ? `Down ${statusCounts.down} times:\n${statusDetails.down.join('\n')}`
                : 'Down 0 times';
            const backupTitle = statusCounts.backup > 0
                ? `Backup ${statusCounts.backup} times:\n${statusDetails.backup.join('\n')}`
                : 'Backup 0 times';

            const downCell = statusCounts.down > 0
                ? `<span class="counter-badge down timeline-cell" data-badge-status="down" data-badge-title="${escapeHtml(downTitle)}">${statusCounts.down}</span>`
                : '<span class="timeline-cell timeline-cell-empty" aria-hidden="true"></span>';

            const backupCell = statusCounts.backup > 0
                ? `<span class="counter-badge backup timeline-cell" data-badge-status="backup" data-badge-title="${escapeHtml(backupTitle)}">${statusCounts.backup}</span>`
                : '<span class="timeline-cell timeline-cell-empty" aria-hidden="true"></span>';

            const countersHtml = downCell + backupCell;

            const reportCount = deviceReports.length;
            const badge = reportCount > 0
                ? `<button type="button" class="report-badge" data-store="${escapeAttr(device.storeKey)}" aria-label="Open ${reportCount} reports">${reportCount}</button>`
                : '<span class="timeline-cell timeline-cell-empty" aria-hidden="true"></span>';

            html += '<div class="timeline-row">';
            html += `<div class="timeline-label"><span class="device-name timeline-cell">${escapeHtml(getLocationNumber(device.name || device.storeKey || ''))}</span>${countersHtml}<span class="timeline-cell">${badge}</span></div>`;
            html += `<div class="timeline-bar" data-store="${escapeAttr(device.storeKey)}">`;
            html += timelineDividers.linesHtml;

            incidentSegments(segments).forEach((segment) => {
                    const startPercent = ((segment.startTime - minTime) / timeRange) * 100;
                    const endPercent = ((segment.endTime - minTime) / timeRange) * 100;
                    const widthPercent = Math.max(endPercent - startPercent, 0.4);
                    html += `<div class="timeline-segment ${segment.status}"`
                        + ` style="left:${startPercent}%;width:${widthPercent}%;"`
                        + ` data-start-time="${segment.startTime}"`
                        + ` data-end-time="${segment.endTime}"`
                        + ` data-status="${segment.status}"`
                        + ` data-device-name="${escapeAttr(device.name)}"`
                        + ` data-store="${escapeAttr(device.storeKey)}"`
                        + `></div>`;
                });

            deviceReports.forEach((report) => {
                const ts = Date.parse(report.timestamp);
                if (!Number.isFinite(ts)) return;
                const pos = ((ts - minTime) / timeRange) * 100;
                const label = `${report.store} - ${report.description}`;
                const statusClass = report.resolved ? 'resolved' : 'active';
                html += `<button class="report-marker ${statusClass}" type="button"`
                    + ` data-report-id="${report.id}"`
                    + ` data-store="${escapeAttr(device.storeKey)}"`
                    + ` style="left:${Math.min(Math.max(pos, 0), 100)}%;"`
                    + ` title="${escapeAttr(label)}"`
                    + ` aria-label="Report marker"></button>`;
            });

            html += '</div>';
            html += '</div>';
        });

        html += '</div>';
        wrapper.innerHTML = html;

        const tooltip = htmlNode.getElementById('timeline-tooltip');
        const segments = wrapper.querySelectorAll('.timeline-segment');
        const markers = wrapper.querySelectorAll('.report-marker');
        const badges = wrapper.querySelectorAll('.report-badge');
        const countBadges = wrapper.querySelectorAll('.counter-badge[data-badge-title]');

        function showTooltip(content, clientX, clientY) {
            if (!tooltip) return;
            tooltip.innerHTML = content;
            tooltip.classList.add('show');
            tooltip.setAttribute('aria-hidden', 'false');
            const wrapperRect = wrapper.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            let left = clientX - wrapperRect.left + 12;
            let top = clientY - wrapperRect.top - tooltipRect.height - 10;
            if (left + tooltipRect.width > wrapperRect.width) left = clientX - wrapperRect.left - tooltipRect.width - 10;
            if (top < 0) top = clientY - wrapperRect.top + 12;
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
        }
        function hideTooltip() {
            if (!tooltip) return;
            tooltip.classList.remove('show');
            tooltip.setAttribute('aria-hidden', 'true');
        }

        segments.forEach((segment) => {
            segment.addEventListener('mousemove', (e) => {
                const startTime = parseInt(segment.getAttribute('data-start-time'), 10);
                const endTime = parseInt(segment.getAttribute('data-end-time'), 10);
                const status = segment.getAttribute('data-status');
                const deviceName = segment.getAttribute('data-device-name');
                const storeKey = segment.getAttribute('data-store');
                const deviceReports = reportsByStore.get(normalizeStoreName(storeKey)) || [];
                const segmentReports = deviceReports.filter((r) => {
                    const ts = Date.parse(r.timestamp);
                    return isTimestampInInterval(ts, startTime, endTime);
                });
                const statusLabel = status === 'down' ? 'Down' : (status === 'backup' ? 'Backup' : 'Up');
                const reportHtml = segmentReports.length
                    ? segmentReports.slice(0, 3).map((r) =>
                        `<div class="tooltip-muted">${escapeHtml(formatTimestamp(Date.parse(r.timestamp)))} - ${escapeHtml(r.description)}</div>`
                    ).join('')
                    : '<div class="tooltip-muted">No reports in this window</div>';
                const reportNote = segmentReports.length > 3
                    ? `<div class="tooltip-muted">+${segmentReports.length - 3} more</div>`
                    : '';
                const totalDuration = endTime - startTime;
                const content = `
                    <div class="tooltip-title">${escapeHtml(deviceName)}</div>
                    <div class="tooltip-muted">${escapeHtml(formatTimestamp(startTime))} - ${escapeHtml(formatTimestamp(endTime))}</div>
                    <div>Status: <strong>${statusLabel}</strong></div>
                    <div>Duration: ${escapeHtml(formatDuration(totalDuration))}</div>
                    <div class="tooltip-divider"></div>
                    <div><strong>Reports</strong></div>
                    ${reportHtml}
                    ${reportNote}
                `;
                showTooltip(content, e.clientX, e.clientY);
            });
            segment.addEventListener('mouseleave', hideTooltip);
            segment.addEventListener('click', (e) => {
                const startTime = parseInt(segment.getAttribute('data-start-time'), 10);
                const endTime = parseInt(segment.getAttribute('data-end-time'), 10);
                const status = segment.getAttribute('data-status');
                const storeKey = segment.getAttribute('data-store');
                if (status !== 'down' && status !== 'backup') {
                    showToast('Only downtime or backup segments can be reported or edited', 'warning');
                    return;
                }
                const rect = segment.getBoundingClientRect();
                const percentInSegment = (e.clientX - rect.left) / rect.width;
                const timeAtCursor = startTime + ((endTime - startTime) * percentInSegment);
                const deviceReports = reportsByStore.get(normalizeStoreName(storeKey)) || [];
                const segmentReports = deviceReports.filter((r) => {
                    const ts = Date.parse(r.timestamp);
                    return isTimestampInInterval(ts, startTime, endTime);
                });
                const existingReport = segmentReports.slice().sort((a, b) =>
                    (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)
                )[0] || null;
                openReportModal(storeKey, timeAtCursor, existingReport, { startTime, endTime });
            });
        });

        markers.forEach((marker) => {
            marker.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(marker.getAttribute('data-report-id'), 10);
                const report = reports.find((r) => r.id === id);
                if (report) openReportView(report);
            });
        });

        badges.forEach((badge) => {
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const storeKey = badge.getAttribute('data-store');
                const storeReports = reportsByStore.get(normalizeStoreName(storeKey)) || [];
                if (!storeReports.length) { showToast('No reports for this store', 'warning'); return; }
                if (storeReports.length > 1) { openReportList(storeReports, data); return; }
                const latest = storeReports.slice().sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))[0];
                if (latest) openReportView(latest);
            });
        });

        countBadges.forEach((cbadge) => {
            cbadge.addEventListener('mousemove', (e) => {
                const badgeTitle = cbadge.getAttribute('data-badge-title') || '';
                const badgeStatus = cbadge.getAttribute('data-badge-status') || '';
                const lines = badgeTitle.split('\n');
                const header = lines[0].replace(/:$/, '');
                const details = lines.slice(1);
                const statusColor = badgeStatus === 'down' ? '#fca5a5' : '#fde68a';
                const icon = badgeStatus === 'down' ? '▼' : '⚡';
                const detailHtml = details.length
                    ? '<div class="tooltip-divider"></div>' + details.map((l) =>
                        `<div class="tooltip-muted">${escapeHtml(l)}</div>`
                    ).join('')
                    : '';
                const content = `<div class="tooltip-title" style="color:${statusColor}">${icon} ${escapeHtml(header)}</div>${detailHtml}`;
                showTooltip(content, e.clientX, e.clientY);
            });
            cbadge.addEventListener('mouseleave', hideTooltip);
        });
    }

    // =====================================================================
    // MODALS
    // =====================================================================

    function openReportModal(storeKey, timestampMs, report, timelineWindow) {
        const modal = toastRoot.getElementById('report-modal');
        const storeInput = toastRoot.getElementById('report-store');
        const deviceInput = toastRoot.getElementById('report-device');
        const descInput = toastRoot.getElementById('report-desc');
        const resolvedInput = toastRoot.getElementById('report-resolved');
        const timeInput = toastRoot.getElementById('report-timestamp');
        const timeDisplay = toastRoot.getElementById('report-time-display');
        const updateNoteRow = toastRoot.getElementById('report-update-note-row');
        const updateNoteInput = toastRoot.getElementById('report-update-note');
        const title = toastRoot.getElementById('report-modal-title');
        const submitBtn = toastRoot.getElementById('report-submit');

        if (!modal || !storeInput || !deviceInput || !descInput || !timeInput || !updateNoteInput) return;

        if (report) {
            editingReportId = report.id;
            storeInput.value = String(report.store || storeKey || '').toUpperCase();
            deviceInput.value = String(report.deviceType || report.device || 'Network').trim();
            descInput.value = String(report.description || '').trim();
            storeInput.readOnly = true;
            deviceInput.disabled = false;
            descInput.readOnly = false;
            resolvedInput.checked = !!report.resolved;
            resolvedInput.disabled = false;
            timeInput.disabled = false;
            const existingStart = Date.parse(report.timelineStart || '');
            const existingEnd = Date.parse(report.timelineEnd || '');
            draftTimelineStartMs = Number.isFinite(existingStart) ? existingStart : null;
            draftTimelineEndMs = Number.isFinite(existingEnd) ? existingEnd : null;
            const ts = Date.parse(report.timestamp) || timestampMs || Date.now();
            timeInput.value = String(ts);
            if (title) title.textContent = 'Edit Report';
            if (submitBtn) submitBtn.textContent = 'Update Report';
            if (updateNoteRow) updateNoteRow.style.display = 'block';
            if (updateNoteInput) updateNoteInput.value = '';
        } else {
            editingReportId = null;
            storeInput.value = (storeKey || '').toUpperCase();
            deviceInput.value = 'Network';
            deviceInput.disabled = false;
            descInput.value = '';
            descInput.readOnly = false;
            resolvedInput.checked = false;
            resolvedInput.disabled = false;
            const hasWindow = timelineWindow && Number.isFinite(timelineWindow.startTime) && Number.isFinite(timelineWindow.endTime);
            draftTimelineStartMs = hasWindow ? timelineWindow.startTime : null;
            draftTimelineEndMs = hasWindow ? timelineWindow.endTime : null;
            timeInput.value = String(timestampMs || Date.now());
            timeInput.disabled = false;
            storeInput.readOnly = true;
            if (title) title.textContent = 'New Report';
            if (submitBtn) submitBtn.textContent = 'Save Report';
            if (updateNoteRow) updateNoteRow.style.display = 'none';
            if (updateNoteInput) updateNoteInput.value = '';
        }
        if (timeDisplay) timeDisplay.textContent = formatDateTime(new Date(parseInt(timeInput.value, 10)));

        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        if (moduleState.modalFocusTimeoutId) {
            clearTimeout(moduleState.modalFocusTimeoutId);
            moduleState.modalFocusTimeoutId = null;
        }
        moduleState.modalFocusTimeoutId = setTimeout(() => {
            if (descInput && typeof descInput.focus === 'function') descInput.focus();
            moduleState.modalFocusTimeoutId = null;
        }, 50);
    }

    function closeReportModal() {
        const modal = toastRoot.getElementById('report-modal');
        const form = toastRoot.getElementById('report-form');
        if (!modal) return;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        editingReportId = null;
        draftTimelineStartMs = null;
        draftTimelineEndMs = null;
        if (form) form.reset();
    }

    function openConfirmModal(message) {
        return new Promise((resolve) => {
            const modal = toastRoot.getElementById('confirm-modal');
            const msgEl = toastRoot.getElementById('confirm-modal-message');
            const okBtn = toastRoot.getElementById('confirm-ok');
            const cancelBtn = toastRoot.getElementById('confirm-cancel');
            if (!modal) { resolve(false); return; }
            if (msgEl) msgEl.textContent = message || 'This action cannot be undone.';
            modal.classList.add('show');
            modal.setAttribute('aria-hidden', 'false');
            setTimeout(() => { if (okBtn) okBtn.focus(); }, 50);
            function closeModal(result) {
                modal.classList.remove('show');
                modal.setAttribute('aria-hidden', 'true');
                if (okBtn) okBtn.onclick = null;
                if (cancelBtn) cancelBtn.onclick = null;
                resolve(result);
            }
            if (okBtn) okBtn.onclick = () => closeModal(true);
            if (cancelBtn) cancelBtn.onclick = () => closeModal(false);
        });
    }

    function openEditUpdateModal(initialText) {
        return new Promise((resolve) => {
            const modal = toastRoot.getElementById('edit-update-modal');
            const textarea = toastRoot.getElementById('edit-update-text');
            const doneBtn = toastRoot.getElementById('edit-update-done');
            const cancelBtn = toastRoot.getElementById('edit-update-cancel');
            const closeBtn = toastRoot.getElementById('edit-update-close');
            if (!modal || !textarea) { resolve(null); return; }
            textarea.value = initialText;
            modal.classList.add('show');
            modal.setAttribute('aria-hidden', 'false');
            setTimeout(() => textarea.focus(), 50);
            function closeModal(result) {
                modal.classList.remove('show');
                modal.setAttribute('aria-hidden', 'true');
                if (doneBtn) doneBtn.onclick = null;
                if (cancelBtn) cancelBtn.onclick = null;
                if (closeBtn) closeBtn.onclick = null;
                resolve(result);
            }
            if (doneBtn) doneBtn.onclick = () => closeModal(textarea.value);
            if (cancelBtn) cancelBtn.onclick = () => closeModal(null);
            if (closeBtn) closeBtn.onclick = () => closeModal(null);
        });
    }

    function openReportView(report) {
        const modal = toastRoot.getElementById('report-view-modal');
        const view = toastRoot.getElementById('report-view');
        const list = toastRoot.getElementById('report-list');
        const title = toastRoot.getElementById('report-view-title');
        if (!modal || !view || !report) return;
        const resolvedLabel = reportStatusLabel(report);
        const reportComments = normalizeComments(report.comments);
        const updatesCount = reportComments.length;
        const commentBoxes = reportComments.length
            ? reportComments.map((c) => {
                const when = timeAgo(new Date(c.timestamp));
                const canManageUpdate = canManageComment(c);
                const actions = canManageUpdate
                    ? '<div class="update-item-actions">'
                        + `<button type="button" class="update-action-btn" data-update-action="edit" data-update-id="${escapeAttr(String(c.id))}">Edit</button>`
                        + `<button type="button" class="update-action-btn danger" data-update-action="delete" data-update-id="${escapeAttr(String(c.id))}">Delete</button>`
                    + '</div>'
                    : '';
                return '<div class="update-item">'
                    + '<div class="update-item-header">'
                    + `<span class="update-item-author">${escapeHtml(c.user || 'Unknown')}</span>`
                    + `<span class="update-item-time">${escapeHtml(when)}</span>`
                    + '</div>'
                    + `<div class="update-item-text">${escapeHtml(c.text)}</div>`
                    + actions
                    + '</div>';
            }).join('')
            : '<div class="comment-box empty">No updates yet</div>';

        if (title) title.textContent = 'Report Details';
        if (list) list.classList.remove('show');
        view.style.display = 'grid';

        view.innerHTML = `
            <div class="report-view-item">
                <span>Store</span>
                <strong>${escapeHtml(String(report.store || '').toUpperCase())}</strong>
            </div>
            <div class="report-view-item">
                <span>Category</span>
                <strong>${escapeHtml(report.deviceType || report.device || '')}</strong>
            </div>
            <div class="report-view-item">
                <span>Status</span>
                <strong>${escapeHtml(resolvedLabel)}</strong>
            </div>
            <div class="report-view-item full">
                <span>Reported By At</span>
                <strong>${escapeHtml(report.user || report.reporter || 'Unknown User')} at ${escapeHtml(formatDateTime(new Date(report.timestamp)))}</strong>
            </div>
            <div class="report-view-item full">
                <span>Description</span>
                <strong>${escapeHtml(report.description)}</strong>
            </div>
            ${updatesCount > 0 ? `
            <div class="report-view-item full" style="margin-top:8px;">
                <span>Updates ( ${updatesCount} )</span>
                <div class="comment-box-container">${commentBoxes}</div>
            </div>` : ''}
            <div class="report-view-actions">
                <button type="button" class="btn ghost compact" id="report-add-update-btn">Updates</button>
                <button type="button" class="btn ghost compact danger" id="report-delete-btn">Delete Report</button>
            </div>
        `;

        const addUpdateBtn = toastRoot.getElementById('report-add-update-btn');
        if (addUpdateBtn) {
            addUpdateBtn.onclick = async () => {
                const nextText = await openEditUpdateModal('');
                if (nextText === null) return;
                const message = String(nextText).trim();
                if (!message) { showToast('Update cannot be empty', 'warning'); return; }
                try {
                    const updatedReport = await addReportComment(report.id, getReporterDisplayName(), grafanaUserLogin, message);
                    if (!updatedReport) { showToast('Report not found', 'warning'); return; }
                    showToast('Update added', 'success');
                    refreshAllViews(toastRoot, moduleState.currentData);
                    openReportView(updatedReport);
                } catch (err) {
                    console.error('Add update failed:', err);
                    showToast('Failed to add update', 'error');
                }
            };
        }

        const deleteBtn = toastRoot.getElementById('report-delete-btn');
        if (deleteBtn) {
            deleteBtn.onclick = async () => {
                const ok = await openConfirmModal('Delete this report? This action cannot be undone.');
                if (!ok) return;
                deleteBtn.disabled = true;
                try {
                    const deleted = await deleteReport(report.id);
                    if (!deleted) showToast('Report not found', 'warning');
                    else {
                        showToast('Report deleted', 'success');
                        closeReportView();
                        refreshAllViews(toastRoot, moduleState.currentData);
                    }
                } catch (err) {
                    console.error('Delete report failed:', err);
                    showToast('Failed to delete report', 'error');
                } finally {
                    deleteBtn.disabled = false;
                }
            };
        }

        const updateActionButtons = view.querySelectorAll('[data-update-action]');
        updateActionButtons.forEach((button) => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = button.getAttribute('data-update-action');
                const updateId = button.getAttribute('data-update-id');
                const existing = reportComments.find((c) => String(c.id) === String(updateId));
                if (!existing) { showToast('Update not found', 'warning'); return; }
                try {
                    if (action === 'edit') {
                        const nextText = await openEditUpdateModal(String(existing.text || ''));
                        if (nextText === null) return;
                        const message = String(nextText).trim();
                        if (!message) { showToast('Update cannot be empty', 'warning'); return; }
                        const updatedReport = await updateReportComment(report.id, updateId, getReporterDisplayName(), grafanaUserLogin, message);
                        if (!updatedReport) { showToast('Update not found', 'warning'); return; }
                        showToast('Update edited', 'success');
                        openReportView(updatedReport);
                        refreshAllViews(toastRoot, moduleState.currentData);
                        return;
                    }
                    if (action === 'delete') {
                        const ok = await openConfirmModal('Do you want to delete this update? This action cannot be undone.');
                        if (!ok) return;
                        const updatedReport = await deleteReportComment(report.id, updateId);
                        if (!updatedReport) { showToast('Update not found', 'warning'); return; }
                        showToast('Update deleted', 'success');
                        openReportView(updatedReport);
                        refreshAllViews(toastRoot, moduleState.currentData);
                        return;
                    }
                } catch (err) {
                    console.error('Update action failed:', err);
                    showToast('Action failed', 'error');
                }
            });
        });

        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
    }

    function openReportList(storeReports, panelData) {
        const modal = toastRoot.getElementById('report-view-modal');
        const view = toastRoot.getElementById('report-view');
        const list = toastRoot.getElementById('report-list');
        const title = toastRoot.getElementById('report-view-title');
        if (!modal || !view || !list || !storeReports || storeReports.length === 0) return;

        const sorted = storeReports.slice().sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
        const storeName = String(sorted[0].store || '').toUpperCase();

        if (title) title.textContent = `${storeName} Reports (${sorted.length})`;
        view.style.display = 'none';
        list.classList.add('show');

        list.innerHTML = sorted.map((report) => {
            const statusClass = report.resolved ? 'resolved' : 'active';
            const statusLabel = reportStatusLabel(report);
            const timeLabel = formatTimestamp(Date.parse(report.timestamp));
            const category = report.deviceType || report.device || '';
            const reporter = report.user || report.reporter || 'Unknown User';
            const desc = report.description || '';
            return `
                <button class="report-list-item" type="button" data-report-id="${report.id}">
                    <div class="report-list-meta">${escapeHtml(timeLabel)}</div>
                    <div class="report-list-main">
                        <div class="report-list-title">${escapeHtml(category)} - ${escapeHtml(reporter)}</div>
                        <div class="report-list-desc">${escapeHtml(desc)}</div>
                    </div>
                    <div>
                        <button type="button" class="report-comment-btn" data-list-action="update" data-report-id="${report.id}">Updates</button>
                        <div class="report-status-chip ${statusClass}" style="margin-top:6px;">${escapeHtml(statusLabel)}</div>
                    </div>
                </button>
            `;
        }).join('');

        const items = list.querySelectorAll('.report-list-item');
        items.forEach((item) => {
            item.addEventListener('click', () => {
                const id = parseInt(item.getAttribute('data-report-id'), 10);
                const report = sorted.find((r) => r.id === id);
                if (report) openReportView(report);
            });
        });

        const updateButtons = list.querySelectorAll('[data-list-action="update"]');
        updateButtons.forEach((button) => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = parseInt(button.getAttribute('data-report-id'), 10);
                if (!Number.isFinite(id)) return;
                const report = sorted.find((r) => r.id === id);
                if (!report) { showToast('Report not found', 'warning'); return; }
                const nextText = await openEditUpdateModal('');
                if (nextText === null) return;
                const message = String(nextText).trim();
                if (!message) { showToast('Update cannot be empty', 'warning'); return; }
                try {
                    const updatedReport = await addReportComment(report.id, getReporterDisplayName(), grafanaUserLogin, message);
                    if (!updatedReport) { showToast('Report not found', 'warning'); return; }
                    showToast('Update added', 'success');
                    refreshAllViews(toastRoot, panelData || moduleState.currentData);
                    openReportView(updatedReport);
                } catch (err) {
                    console.error('Add update failed:', err);
                    showToast('Failed to add update', 'error');
                }
            });
        });

        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
    }

    function closeReportView() {
        const modal = toastRoot.getElementById('report-view-modal');
        if (!modal) return;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
    }

    function getTopReporters(reports, timeRange) {
        const counts = {};
        const minTime = timeRange && Number.isFinite(timeRange.minTime) ? timeRange.minTime : -Infinity;
        const maxTime = timeRange && Number.isFinite(timeRange.maxTime) ? timeRange.maxTime : Infinity;
        (reports || []).forEach((r) => {
            const ts = Date.parse(r.timestamp);
            if (!Number.isFinite(ts) || ts < minTime || ts > maxTime) return;
            const user = normalizeUsername(r.user || r.reporter || 'Unknown User') || 'Unknown User';
            counts[user] = (counts[user] || 0) + 1;
        });
        return Object.keys(counts).map((user) => ({ user, count: counts[user] }))
            .sort((a, b) => b.count - a.count || a.user.localeCompare(b.user));
    }

    function buildTopUsersHtml(topUsers) {
        if (!topUsers || !topUsers.length) {
            return '<div style="padding:8px;color:var(--text-muted);">No reports available.</div>';
        }
        const total = topUsers.reduce((sum, item) => sum + item.count, 0);
        let html = `<div style="font-size:0.95rem;margin-bottom:10px;color:var(--text-muted);">Total reports: ${total}</div>`;
        html += '<ol style="margin:0;padding-left:18px;">';
        topUsers.forEach((item) => {
            html += `<li style="margin-bottom:6px;">${escapeHtml(item.user)}: <strong>${item.count}</strong> reports</li>`;
        });
        html += '</ol>';
        return html;
    }

    function openTopUsersModal(htmlNode) {
        const modal = htmlNode.getElementById('top-users-modal');
        const list = htmlNode.getElementById('top-users-content');
        if (!modal || !list) return;
        const reportsToCount = moduleState.reportsOnLongDown || [];
        const topUsers = getTopReporters(reportsToCount, moduleState.visibleTimeRange);
        list.innerHTML = buildTopUsersHtml(topUsers);
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
    }

    function closeTopUsersModal(htmlNode) {
        const modal = htmlNode.getElementById('top-users-modal');
        if (!modal) return;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
    }

    function exportTopUsersCSV() {
        const reportsToCount = moduleState.reportsOnLongDown || [];
        const topUsers = getTopReporters(reportsToCount, moduleState.visibleTimeRange);
        const reportsOnDownCount = Number.isFinite(moduleState.reportsOnDownCount) ? moduleState.reportsOnDownCount : 0;
        const downLocationCount = Number.isFinite(moduleState.downLocationCount) ? moduleState.downLocationCount : 0;
        if (!topUsers || !topUsers.length) { showToast('No top reporters to export', 'warning'); return; }
        const d = ':';
        const headers = ['User', 'Reports'];
        const metaRows = [
            [csvEscape('Reports', d), csvEscape(reportsOnDownCount, d)].join(d),
            [csvEscape('Down', d), csvEscape(downLocationCount, d)].join(d),
            ''
        ];
        const rows = topUsers.map((item) => [csvEscape(item.user, d), csvEscape(item.count, d)].join(d));
        const csv = '\uFEFF' + metaRows.join('\n') + headers.map((h) => csvEscape(h, d)).join(d) + '\n' + rows.join('\n');
        downloadFile(csv, 'top_reporters_' + new Date().toISOString().split('T')[0] + '.csv', 'text/csv;charset=utf-8;');
        showToast('Top reporters CSV exported', 'success');
    }

    function refreshAllViews(htmlNode, data) {
        renderTimeline(htmlNode, data || moduleState.currentData);
        moduleState.reportsFingerprint = computeReportsFingerprint(moduleState.reportsCache);
        renderIncidentReportsList(htmlNode, data || moduleState.currentData);
    }

    function exportReportsCSV() {
        const reports = (moduleState.reportsCache || []).slice().sort((a, b) =>
            (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)
        );
        const d = ',';
        const headers = ['Timestamp', 'Store', 'Category', 'Description', 'User', 'Status', 'Start Date', 'End Date', 'Duration', 'Comments'];
        const rows = reports.map((r) => {
            const startTs = Date.parse(r.timelineStart || '');
            const endTs = Date.parse(r.timelineEnd || '');
            const hasWindow = Number.isFinite(startTs) && Number.isFinite(endTs);
            const startLabel = hasWindow ? formatDateTime(new Date(startTs)) : '';
            const endLabel = hasWindow ? formatDateTime(new Date(endTs)) : '';
            const durationLabel = hasWindow ? formatDuration(Math.max(endTs - startTs, 0)) : '';
            return [
                csvEscape(formatDateTime(new Date(r.timestamp)), d),
                csvEscape(r.store, d),
                csvEscape(r.deviceType || r.device || '', d),
                csvEscape(r.description, d),
                csvEscape(r.user || r.reporter || 'Unknown User', d),
                csvEscape(reportStatusLabel(r), d),
                csvEscape(startLabel, d),
                csvEscape(endLabel, d),
                csvEscape(durationLabel, d),
                csvEscape(countTotalComments(r.comments), d)
            ].join(d);
        });
        const csv = '\uFEFF' + headers.map((h) => csvEscape(h, d)).join(d) + '\n' + rows.join('\n');
        downloadFile(csv, 'incident_reports_' + new Date().toISOString().split('T')[0] + '.csv', 'text/csv;charset=utf-8;');
    }

    function exportTimelineCSV(data) {
        let rangeFrom = null;
        let rangeTo = null;
        const fromRaw = data && data.request && data.request.range && data.request.range.from;
        const toRaw = data && data.request && data.request.range && data.request.range.to;
        if (fromRaw) rangeFrom = (typeof fromRaw.valueOf === 'function') ? fromRaw.valueOf() : new Date(fromRaw).getTime();
        if (toRaw) rangeTo = (typeof toRaw.valueOf === 'function') ? toRaw.valueOf() : new Date(toRaw).getTime();

        const rows = [];
        historyTimeSeriesData.forEach((device) => {
            const points = (device.dataPoints || []).slice().sort((a, b) => a.time - b.time);
            if (!points.length) return;
            const maxTime = Number.isFinite(rangeTo) ? rangeTo : points[points.length - 1].time;
            const segments = buildSegments(points, maxTime);
            incidentSegments(segments).forEach((segment) => {
                const start = segment.startTime;
                const end = segment.endTime;
                if (Number.isFinite(rangeFrom) && end < rangeFrom) return;
                if (Number.isFinite(rangeTo) && start > rangeTo) return;
                const statusLabel = segment.status === 'down' ? 'Down' : 'Backup';
                rows.push([
                    csvEscape(device.name, ','),
                    csvEscape(statusLabel, ','),
                    csvEscape(formatDateTime(new Date(start)), ','),
                    csvEscape(formatDateTime(new Date(end)), ','),
                    csvEscape(formatDuration(Math.max(end - start, 0)), ',')
                ].join(','));
            });
        });

        const headers = ['Store', 'Status', 'Start', 'End', 'Duration'];
        const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
        downloadFile(csv, 'timeline_status_' + new Date().toISOString().split('T')[0] + '.csv', 'text/csv;charset=utf-8;');
    }

    function renderIncidentReportsList(htmlNode, data) {
        const list = htmlNode.getElementById('incident-reports-list');
        const summary = htmlNode.getElementById('incident-summary');
        if (!list) return;
        // Incident Reports is the user's persistent log of every report they
        // ever filed — it must NOT be scoped by the date picker. The timeline
        // bars / markers above still scope by range (they reflect Prometheus
        // data), but the list below stays stable so users don't lose track
        // of resolved reports when they switch ranges. The search box is
        // the only filter that applies here. See also: data param kept for
        // signature compatibility with refreshAllViews.
        void data;
        const scoped = (moduleState.reportsCache || []).slice().sort((a, b) =>
            (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)
        );
        const filtered = scoped.filter((report) => {
            if (!incidentSearchQuery) return true;
            const hay = [
                report.store,
                report.deviceType || report.device || '',
                report.description,
                report.user || report.reporter || '',
                report.resolved ? 'solved' : 'active'
            ].join(' ').toLowerCase();
            return hay.includes(incidentSearchQuery);
        });
        if (summary) summary.textContent = `${filtered.length} / ${scoped.length} reports`;
        if (!filtered.length) {
            list.innerHTML = '<div class="incident-empty">No incident reports found</div>';
            return;
        }
        list.innerHTML = filtered.map((report) => {
            const statusClass = report.resolved ? 'resolved' : 'active';
            const statusLabel = reportStatusLabel(report);
            const updatesCount = countTotalComments(report.comments);
            const updatesLabel = updatesCount > 0 ? `Updates (${updatesCount})` : 'Updates';
            return `
                <div class="incident-card ${statusClass}" data-id="${report.id}">
                    <div class="incident-head">
                        <div class="incident-meta">
                            <span class="incident-store">${escapeHtml(getLocationNumber(report.store || ''))}</span>
                            <span class="incident-category">${escapeHtml(report.deviceType || report.device || '')}</span>
                            <span class="incident-status ${statusClass}">${statusLabel}</span>
                        </div>
                        <div class="incident-time">${escapeHtml(timeAgo(new Date(report.timestamp)))}</div>
                    </div>
                    <div class="incident-main">
                        <div class="incident-desc">${escapeHtml(report.description || '')}</div>
                        <div class="incident-actions">
                            <button type="button" class="incident-action danger" data-action="delete" data-id="${report.id}">Delete</button>
                            <button type="button" class="incident-action incident-comments-badge" data-action="updated" data-id="${report.id}">${updatesLabel}</button>
                        </div>
                    </div>
                    <div class="incident-user">${escapeHtml(report.user || report.reporter || 'Unknown User')} · ${escapeHtml(formatDateTime(new Date(report.timestamp)))}</div>
                </div>
            `;
        }).join('');

        const actionButtons = list.querySelectorAll('[data-action]');
        actionButtons.forEach((button) => {
            button.addEventListener('click', async (e) => {
                if (e) { e.stopPropagation(); if (typeof e.preventDefault === 'function') e.preventDefault(); }
                const action = button.getAttribute('data-action');
                const id = parseInt(button.getAttribute('data-id'), 10);
                if (!Number.isFinite(id)) return;
                const currentReport = (moduleState.reportsCache || []).find((r) => r.id === id);
                if (!currentReport) { showToast('Report not found', 'warning'); return; }
                try {
                    if (action === 'delete') {
                        const ok = await openConfirmModal('Do you want to delete this report? This action cannot be undone.');
                        if (!ok) return;
                        await deleteReport(id);
                        showToast('Report deleted', 'success');
                        refreshAllViews(htmlNode, data);
                        return;
                    }
                    if (action === 'updated') {
                        const commentsCount = countTotalComments(currentReport.comments);
                        if (commentsCount === 0) {
                            const nextText = await openEditUpdateModal('');
                            if (nextText === null) return;
                            const message = String(nextText).trim();
                            if (!message) { showToast('Update cannot be empty', 'warning'); return; }
                            const updatedReport = await addReportComment(currentReport.id, getReporterDisplayName(), grafanaUserLogin, message);
                            if (!updatedReport) { showToast('Report not found', 'warning'); return; }
                            showToast('Update added', 'success');
                            refreshAllViews(htmlNode, data);
                            openReportView(updatedReport);
                            return;
                        }
                        openReportView(currentReport);
                        return;
                    }
                } catch (err) {
                    console.error('[RouterTimeline] Incident action failed:', err);
                    showToast('Action failed', 'error');
                }
            });
        });
    }

    // =====================================================================
    // INITIALIZATION
    // =====================================================================

    function bindStaticHandlers(htmlNode, data) {
        // Only bind once per htmlNode. Reuses DOM elements (the section is
        // static; re-init just refreshes data and re-renders).
        if (htmlNode.__rtHandlersBound) {
            // Refresh closure-captured `data` ref on each init so handlers
            // that fall back to it pick up the new range.
            return;
        }
        htmlNode.__rtHandlersBound = true;

        const modal = htmlNode.getElementById('report-modal');
        const modalClose = htmlNode.getElementById('report-modal-close');
        const modalCancel = htmlNode.getElementById('report-cancel');
        const form = htmlNode.getElementById('report-form');
        const submitBtn = htmlNode.getElementById('report-submit');

        if (modalClose) modalClose.onclick = closeReportModal;
        if (modalCancel) modalCancel.onclick = closeReportModal;

        const storeInput = htmlNode.getElementById('report-store');
        if (storeInput) storeInput.oninput = function () { this.value = this.value.toUpperCase(); };

        if (modal) modal.onclick = (e) => { if (e.target === modal) closeReportModal(); };

        const viewModal = htmlNode.getElementById('report-view-modal');
        const viewClose = htmlNode.getElementById('report-view-close');
        if (viewClose) viewClose.onclick = closeReportView;
        if (viewModal) viewModal.onclick = (e) => { if (e.target === viewModal) closeReportView(); };

        const exportTimelineBtn = htmlNode.getElementById('menu-export-csv');
        const exportReportsBtn = htmlNode.getElementById('menu-export-reports-csv');
        const topUsersBtn = htmlNode.getElementById('timeline-reports-btn');
        const topUsersModal = htmlNode.getElementById('top-users-modal');
        const topUsersClose = htmlNode.getElementById('top-users-close');
        const topUsersCancel = htmlNode.getElementById('top-users-cancel');
        const topUsersExport = htmlNode.getElementById('top-users-export');

        if (exportTimelineBtn) exportTimelineBtn.onclick = () => {
            exportTimelineCSV(moduleState.currentData);
            showToast('Timeline CSV exported', 'success');
        };
        if (exportReportsBtn) exportReportsBtn.onclick = () => {
            exportReportsCSV();
            showToast('Reports CSV exported', 'success');
        };
        if (topUsersBtn) topUsersBtn.onclick = () => openTopUsersModal(htmlNode);
        if (topUsersClose) topUsersClose.onclick = () => closeTopUsersModal(htmlNode);
        if (topUsersCancel) topUsersCancel.onclick = () => closeTopUsersModal(htmlNode);
        if (topUsersExport) topUsersExport.onclick = () => exportTopUsersCSV();
        if (topUsersModal) topUsersModal.onclick = (e) => { if (e.target === topUsersModal) closeTopUsersModal(htmlNode); };

        const incidentSearch = htmlNode.getElementById('incident-search');
        if (incidentSearch) {
            incidentSearch.oninput = function () {
                incidentSearchQuery = String(this.value || '').trim().toLowerCase();
                renderIncidentReportsList(htmlNode, moduleState.currentData);
            };
        }

        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const store = htmlNode.getElementById('report-store').value.trim();
                const device = htmlNode.getElementById('report-device').value.trim();
                const descField = htmlNode.getElementById('report-desc');
                const desc = descField ? String(descField.value || '').trim() : '';
                const resolved = htmlNode.getElementById('report-resolved').checked;
                const tsValue = parseInt(htmlNode.getElementById('report-timestamp').value, 10);
                const updateNoteTextarea = htmlNode.getElementById('report-update-note');
                const updateNote = updateNoteTextarea ? String(updateNoteTextarea.value || '').trim() : '';

                if (!store || !device || (!desc && !editingReportId)) {
                    showToast('Please fill all fields', 'warning');
                    return;
                }
                if (!editingReportId && desc.length < 5) {
                    showToast('Description must have at least 5 characters', 'warning');
                    return;
                }

                submitBtn.disabled = true;
                submitBtn.textContent = 'Saving...';

                try {
                    if (editingReportId) {
                        const updated = await updateReport(editingReportId, {
                            store, deviceType: device, description: desc,
                            resolved, timestampMs: tsValue,
                            timelineStartMs: draftTimelineStartMs, timelineEndMs: draftTimelineEndMs
                        });
                        if (!updated) showToast('Report not found', 'warning');
                        else {
                            if (updateNote) {
                                await addReportComment(editingReportId, getReporterDisplayName(), grafanaUserLogin, updateNote);
                            }
                            showToast('Report updated', 'success');
                        }
                    } else {
                        await addReport(store, device, desc, getReporterDisplayName(), grafanaUserLogin,
                            resolved, tsValue, draftTimelineStartMs, draftTimelineEndMs);
                        showToast('Report added', 'success');
                    }
                    closeReportModal();
                    refreshAllViews(htmlNode, moduleState.currentData);
                } catch (err) {
                    console.error('Save report failed:', err);
                    showToast('Failed to save report', 'error');
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = editingReportId ? 'Update Report' : 'Save Report';
                }
            };
        }
    }

    async function initTimeline(data, htmlNode, loadToken) {
        toastRoot = htmlNode;
        moduleState.currentData = data;
        moduleState.boundHtmlNode = htmlNode;

        applyPanelData(data);

        const identity = resolveIdentity();
        grafanaDisplayName = normalizeUsername(identity.displayName) || 'Operator';
        grafanaUserLogin = normalizeUsername(identity.login) || 'operator';

        bindStaticHandlers(htmlNode, data);

        if (loadToken !== moduleState.initSeq) return;

        try {
            refreshAllViews(htmlNode, data);
        } catch (err) {
            console.error('[RouterTimeline] render failed:', err);
            const w = htmlNode.getElementById('timeline-wrapper');
            if (w) w.innerHTML = '<div class="timeline-loading">Could not render timeline. Check console.</div>';
        }

        if (loadToken !== moduleState.initSeq) return;

        syncReports(true).then(() => {
            if (loadToken !== moduleState.initSeq) return;
            refreshAllViews(htmlNode, data);
        }).catch((err) => {
            console.warn('[RouterTimeline] Could not sync reports:', err);
            moduleState.reportsCache = [];
        });

        ensureReportsSyncInterval(htmlNode);
    }

    async function refresh(htmlNode) {
        const target = htmlNode || moduleState.boundHtmlNode;
        if (!target) return;
        if (!target.__rtHandlersBound) {
            return init(target);
        }

        const token = ++moduleState.refreshSeq;
        moduleState.boundHtmlNode = target;
        toastRoot = target;

        try {
            const data = await fetchPanelData();
            if (token !== moduleState.refreshSeq) return;

            applyPanelData(data);
            moduleState.currentData = data;
            refreshAllViews(target, data);

            try {
                await syncReports(false);
            } catch (err) {
                console.warn('[RouterTimeline] Could not sync reports:', err);
            }
            if (token !== moduleState.refreshSeq) return;
            refreshReportsIfChanged(target);
        } catch (err) {
            if (token !== moduleState.refreshSeq) return;
            console.warn('[RouterTimeline] refresh failed (keeping last good data):', err);
            if (moduleState.currentData && historyTimeSeriesData.length) {
                refreshAllViews(target, moduleState.currentData);
            }
        }
    }

    function isMounted() {
        return !!(moduleState.boundHtmlNode && moduleState.boundHtmlNode.__rtHandlersBound);
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    async function init(htmlNode) {
        const target = htmlNode || document;
        if (isMounted() && moduleState.boundHtmlNode === target) {
            return refresh(target);
        }
        if (initInFlight) {
            return initInFlight;
        }

        const loadToken = ++moduleState.initSeq;
        moduleState.refreshSeq++;
        cleanupRuntimeTimers();

        const wrapper = target.getElementById('timeline-wrapper');
        if (wrapper) {
            wrapper.innerHTML = '<div class="timeline-loading">Loading timeline…</div>';
        }

        const flight = (async () => {
            try {
                const data = await fetchPanelData();
                if (loadToken !== moduleState.initSeq) return;
                await initTimeline(data, target, loadToken);
            } catch (err) {
                if (loadToken !== moduleState.initSeq) return;
                console.warn('[RouterTimeline] init failed:', err);
                if (wrapper) {
                    wrapper.innerHTML = '<div class="timeline-loading">Could not load timeline data (Prometheus /prom). Check console.</div>';
                }
            }
        })();
        initInFlight = flight;

        try {
            return await flight;
        } finally {
            if (initInFlight === flight) initInFlight = null;
        }
    }

    function teardown() {
        const node = moduleState.boundHtmlNode;
        cleanupRuntimeTimers();
        if (node) node.__rtHandlersBound = false;
        moduleState.boundHtmlNode = null;
        moduleState.currentData = null;
        moduleState.reportsFingerprint = '';
        moduleState.initSeq++;
        moduleState.refreshSeq++;
        // Close any modals that might be open across navigation.
        const modalIds = ['report-modal', 'report-view-modal', 'top-users-modal', 'edit-update-modal', 'confirm-modal'];
        modalIds.forEach((id) => {
            const el = document.getElementById(id);
            if (el && el.classList.contains('show')) {
                el.classList.remove('show');
                el.setAttribute('aria-hidden', 'true');
            }
        });
    }

    function tryBootFromDom() {
        try {
            if (document.documentElement.getAttribute('data-gfn-page') !== 'router-timeline') return;
            const wrapper = document.getElementById('timeline-wrapper');
            if (!wrapper || isMounted()) return;
            const loadingEl = wrapper.querySelector('.timeline-loading');
            if (!loadingEl) return;
            init(document);
        } catch (err) {
            console.warn('[RouterTimeline] boot fallback failed:', err);
        }
    }

    window.GFN_ROUTER_TIMELINE = { init, refresh, isMounted, teardown };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryBootFromDom, { once: true });
    } else {
        tryBootFromDom();
    }
})();
