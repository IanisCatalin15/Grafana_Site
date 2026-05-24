            /**
             * Grafana HTML Graphics Panel - Device Monitoring Dashboard
             * Enhanced version with search, export, notifications, and auto-refresh
             * @version 2.1.15
             *
             * Standalone port: this used to be a `(function(){...})()` IIFE
             * implicitly receiving `data` and `htmlNode` from Grafana's panel
             * scope. We now expose it as `window.runGfnPanel(data, htmlNode)`
             * so panel-bootstrap.js can call it on every tick, with `data`
             * built by prom-adapter.js.
             *
             * Refactor in progress: pure utility helpers have been extracted
             * to /modules/utils.js, which is loaded BEFORE this file and
             * exposes them via `window.GFN_UTILS`. The closure below re-binds
             * each helper to a local `const` so the (very large) body keeps
             * working without churn while we split it up incrementally.
             */
            window.runGfnPanel = function(data, htmlNode) {
                'use strict';

                // ---- Helpers extracted to /modules/utils.js (window.GFN_UTILS) ----
                const _U = window.GFN_UTILS || {};
                const escapeHtml = _U.escapeHtml;
                const escapeAttr = _U.escapeAttr;
                const formatTime = _U.formatTime;
                const formatHoursMinutesOnly = _U.formatHoursMinutesOnly;
                const offlineInternetUptimeTooltip = _U.offlineInternetUptimeTooltip;
                const offlineInternetUptimeTooltipTotal = _U.offlineInternetUptimeTooltipTotal;
                const offlinePrimaryUptimeTooltip = _U.offlinePrimaryUptimeTooltip;
                const offlinePrimaryUptimeTooltipTotal = _U.offlinePrimaryUptimeTooltipTotal;
                const offlineBackupUptimeTooltip = _U.offlineBackupUptimeTooltip;
                const offlineBackupUptimeTooltipTotal = _U.offlineBackupUptimeTooltipTotal;
                const formatDateTime = _U.formatDateTime;
                const DTF_COMPACT = _U.DTF_COMPACT;
                const formatStoreCodeFromInput = _U.formatStoreCodeFromInput;
                const isManualReportedRow = _U.isManualReportedRow;
                const formatIsoDateTime = _U.formatIsoDateTime;
                // extractStoreCode is also redeclared further down (~line 4254)
                // for the ticket-links section; the second declaration wins,
                // so we leave it in place for now.

                // ============================================================================
                // 1. MODULE REBINDS — pull extracted helpers/constants into locals so the
                //    (very large) body below keeps referring to them by their original names.
                //    See `Grafana_site/public/modules/*.js`:
                //      constants.js      -> window.GFN_CONSTANTS
                //      api-base.js       -> window.GFN_API_BASE
                //      device-format.js  -> window.GFN_DEVICE_FORMAT
                //      parsers.js        -> window.GFN_PARSERS
                //      ticket-links.js   -> window.GFN_TICKET_LINKS
                //      incident-dedup.js -> window.GFN_INCIDENT_DEDUP
                // ============================================================================

                // ---- constants -----------------------------------------------------------
                const _C = window.GFN_CONSTANTS || {};
                const STORAGE_KEY_DEVICE = _C.STORAGE_KEY_DEVICE;
                const STORAGE_KEY_SORT = _C.STORAGE_KEY_SORT;
                const STORAGE_KEY_OFFLINE_VIEW = _C.STORAGE_KEY_OFFLINE_VIEW;
                const STORAGE_KEY_OFFLINE_SORT = _C.STORAGE_KEY_OFFLINE_SORT;
                const STORAGE_KEY_OFFLINE_SORT_COLUMN = _C.STORAGE_KEY_OFFLINE_SORT_COLUMN;
                const STORAGE_KEY_OFFLINE_SORT_DIRECTION = _C.STORAGE_KEY_OFFLINE_SORT_DIRECTION;
                const STORAGE_KEY_DEVICE_STATUS_SNAPSHOT = _C.STORAGE_KEY_DEVICE_STATUS_SNAPSHOT;
                const STORAGE_KEY_DASHBOARD_PAGE = _C.STORAGE_KEY_DASHBOARD_PAGE;
                const STORAGE_KEY_PRIMARY_DOWN_SINCE = _C.STORAGE_KEY_PRIMARY_DOWN_SINCE;
                const STORAGE_KEY_NIGHT_FREEZE_STATE = _C.STORAGE_KEY_NIGHT_FREEZE_STATE;
                const STORAGE_KEY_LIVE_UNREPORTED_DURATION_SORT = _C.STORAGE_KEY_LIVE_UNREPORTED_DURATION_SORT;
                const STORAGE_KEY_SAVED_DATE_FILTER = _C.STORAGE_KEY_SAVED_DATE_FILTER;
                const DEFAULT_LIVE_DATE_FROM = _C.DEFAULT_LIVE_DATE_FROM;
                const DEFAULT_LIVE_DATE_TO = _C.DEFAULT_LIVE_DATE_TO;
                const PRIMARY_DOWN_GRACE_MINUTES = _C.PRIMARY_DOWN_GRACE_MINUTES;
                const MONITORING_START_MINUTES = _C.MONITORING_START_MINUTES;
                const MONITORING_END_MINUTES = _C.MONITORING_END_MINUTES;
                const TIME_RANGE_LABELS = _C.TIME_RANGE_LABELS;
                const DEVICE_PARSERS = _C.DEVICE_PARSERS;
                const INTERNET_REPORT_TAGS = _C.INTERNET_REPORT_TAGS;
                const DEVICE_REPORT_TAGS = _C.DEVICE_REPORT_TAGS;
                const LIVE_INCIDENT_TAG_FILTER_IDS = _C.LIVE_INCIDENT_TAG_FILTER_IDS;
                const REPORTABLE_DEVICE_TYPES = _C.REPORTABLE_DEVICE_TYPES;
                const LIVE_UNREPORTED_DEVICE_TYPE = _C.LIVE_UNREPORTED_DEVICE_TYPE;
                const PRIORITY_ORDER = _C.PRIORITY_ORDER;
                const PANEL_RUNTIME_KEY = _C.PANEL_RUNTIME_KEY;
                const UNREPORTED_LIVE_PAGE_SIZE = _C.UNREPORTED_LIVE_PAGE_SIZE;
                const UNREPORTED_REPORTING_PAGE_SIZE = _C.UNREPORTED_REPORTING_PAGE_SIZE;
                const REPORTED_TABLE_PAGE_SIZE = _C.REPORTED_TABLE_PAGE_SIZE;
                const LIVE_REPORTED_SOLVED_PAGE_SIZE = _C.LIVE_REPORTED_SOLVED_PAGE_SIZE;
                const LIVE_RENDER_MAX_PER_SECTION = _C.LIVE_RENDER_MAX_PER_SECTION;
                const LOAD_MORE_MIN_TOTAL = _C.LOAD_MORE_MIN_TOTAL;

                // ---- api-base ------------------------------------------------------------
                const _AB = window.GFN_API_BASE || {};
                const normalizeApiBase = _AB.normalizeApiBase;
                const resolveApiBase = _AB.resolveApiBase;

                // ---- device-format -------------------------------------------------------
                const _DF = window.GFN_DEVICE_FORMAT || {};
                const normalizeDeviceKey = _DF.normalizeDeviceKey;
                const extractStoreCode = _DF.extractStoreCode;
                const normalizeStoreCodeInput = _DF.normalizeStoreCodeInput;
                const toEpochMs = _DF.toEpochMs;
                const minutesSince = _DF.minutesSince;
                const normalizeDeviceTypeKey = _DF.normalizeDeviceTypeKey;
                const formatDeviceCategory = _DF.formatDeviceCategory;
                const formatDeviceLabel = _DF.formatDeviceLabel;
                const formatDeviceToastLabel = _DF.formatDeviceToastLabel;
                const getIncidentDeviceToken = _DF.getIncidentDeviceToken;
                const buildIncidentDeviceName = _DF.buildIncidentDeviceName;
                const normalizeIncidentKey = _DF.normalizeIncidentKey;
                const formatIncidentStatus = _DF.formatIncidentStatus;
                const formatIncidentDuration = _DF.formatIncidentDuration;
                const formatTimeToReport = _DF.formatTimeToReport;
                const formatReportToResolve = _DF.formatReportToResolve;
                const unreportedLiveDurationDisplay = _DF.unreportedLiveDurationDisplay;
                const unreportedLiveDurationCompact = _DF.unreportedLiveDurationCompact;
                const formatUnreportedTimelineCompact = _DF.formatUnreportedTimelineCompact;
                const isUnknownOwner = _DF.isUnknownOwner;
                const normalizeOwnerUsername = _DF.normalizeOwnerUsername;
                const capitalizeOwnerLabel = _DF.capitalizeOwnerLabel;
                const ownerDisplayName = _DF.ownerDisplayName;
                const normalizeReportTag = _DF.normalizeReportTag;
                const reportTagLabel = _DF.reportTagLabel;
                const isInternetIssueType = _DF.isInternetIssueType;
                const internetReportTagAllowsNoTicket = _DF.internetReportTagAllowsNoTicket;
                const isTagOnlyReportedIncident = _DF.isTagOnlyReportedIncident;
                const allowedTagsForDevice = _DF.allowedTagsForDevice;
                const csvEscape = _DF.csvEscape;
                const naturalSortStores = _DF.naturalSortStores;

                // ---- parsers (panel data + ONT + uptime) --------------------------------
                const _PS = window.GFN_PARSERS || {};
                const OFFLINE_UPTIME_SCHEDULE = _PS.OFFLINE_UPTIME_SCHEDULE;
                const OFFLINE_METRICS = _PS.OFFLINE_METRICS;
                const PC_OVER15_DETAILS_REFID = _PS.PC_OVER15_DETAILS_REFID;
                const genericParser = _PS.genericParser;
                const getOfflineMetricData = _PS.getOfflineMetricData;
                const getPcOver15DetailData = _PS.getPcOver15DetailData;
                const getPanelTimeRangeMs = _PS.getPanelTimeRangeMs;
                const scheduledMinutesInRange = _PS.scheduledMinutesInRange;
                const formatUptimePercent = _PS.formatUptimePercent;
                const uptimePercentCellClass = _PS.uptimePercentCellClass;
                const normalizeOntLookupKey = _PS.normalizeOntLookupKey;
                const compactOntLookupKey = _PS.compactOntLookupKey;
                const lookupOntForOfflineStore = _PS.lookupOntForOfflineStore;
                const applyInternetUptimeToOfflineRows = _PS.applyInternetUptimeToOfflineRows;
                const _OPO = window.GFN_OFFLINE_POWER_OUTAGE || {};
                const buildPowerOutageMinutesByStore = _OPO.buildPowerOutageMinutesByStore || (() => new Map());
                const buildPlannedMinutesByStore = _OPO.buildPlannedMinutesByStore || (() => new Map());
                const applyPowerOutageAdjustmentToOfflineRows = _OPO.applyPowerOutageAdjustmentToOfflineRows || (() => {});
                const applyInternetReportAdjustmentsToOfflineRows = _OPO.applyInternetReportAdjustmentsToOfflineRows || applyPowerOutageAdjustmentToOfflineRows;
                // dataMap-bound wrappers: declared as arrows so `dataMap` is resolved at
                // call time (after the closure body initializes the `const dataMap` below).
                const buildRouterOntByStore = () => _PS.buildRouterOntByStore(dataMap);
                const combineRouterStatuses = () => _PS.combineRouterStatuses(dataMap);
                const knownStoreCodesSet = () => _PS.knownStoreCodesSet(dataMap);

                // ---- ticket-links --------------------------------------------------------
                const _TL = window.GFN_TICKET_LINKS || {};
                // Closure-bound wrappers: forward `currentDeviceType` and `deviceTicketLinks`
                // by reading them at call time (let-declared further below).
                const effectiveTicketGridDeviceType = (deviceName, gridDeviceType) =>
                    _TL.effectiveTicketGridDeviceType(deviceName, gridDeviceType, currentDeviceType);
                const ticketLookupCandidateNames = _TL.ticketLookupCandidateNames;
                const deviceTicketLinkLookupKeys = (deviceName, gridDeviceType) =>
                    _TL.deviceTicketLinkLookupKeys(deviceName, gridDeviceType, currentDeviceType);
                const getDeviceTicketLink = (deviceName, gridDeviceType) =>
                    _TL.getDeviceTicketLink(deviceName, gridDeviceType, currentDeviceType, deviceTicketLinks);
                const hasDeviceTicketLink = (deviceName, gridDeviceType) =>
                    _TL.hasDeviceTicketLink(deviceName, gridDeviceType, currentDeviceType, deviceTicketLinks);
                const extractCrmTaskIdFromTicketUrl = _TL.extractCrmTaskIdFromTicketUrl;
                const normalizeLiveCrmTicketSearchQuery = _TL.normalizeLiveCrmTicketSearchQuery;
                const sanitizeLiveCrmTicketFieldValue = _TL.sanitizeLiveCrmTicketFieldValue;
                const unreportedLiveTicketMetaBlockHtml = _TL.unreportedLiveTicketMetaBlockHtml;

                // ---- incident-dedup ------------------------------------------------------
                const _ID = window.GFN_INCIDENT_DEDUP || {};
                const WAN_DEPENDENT_RECOVERY_GRACE_MS = _ID.WAN_DEPENDENT_RECOVERY_GRACE_MS;
                const PRIMARY_DOWN_BACKUP_UP_ALERT = _ID.PRIMARY_DOWN_BACKUP_UP_ALERT;
                const STORE_WAN_BLACKOUT_ALERT = _ID.STORE_WAN_BLACKOUT_ALERT;
                const CASCADE_DEPENDENT_TYPES = _ID.CASCADE_DEPENDENT_TYPES;
                const UNREPORTED_DEVICE_GROUP_TYPES = _ID.UNREPORTED_DEVICE_GROUP_TYPES;
                const UNREPORTED_DEVICE_GROUP_IDS = _ID.UNREPORTED_DEVICE_GROUP_IDS;
                const DEVICE_TYPE_TO_GROUP_ID = _ID.DEVICE_TYPE_TO_GROUP_ID;
                const LIVE_GROUPED_DEVICE_TYPES = _ID.LIVE_GROUPED_DEVICE_TYPES;
                const LIVE_UNREPORTED_DEDUP_OFFLINE_START_ALIGN_MS = _ID.LIVE_UNREPORTED_DEDUP_OFFLINE_START_ALIGN_MS;
                const incidentRowDeviceType = _ID.incidentRowDeviceType;
                const deviceGroupIdForType = _ID.deviceGroupIdForType;
                const countRowsForDeviceGroup = _ID.countRowsForDeviceGroup;
                const filterCascadeIncidents = _ID.filterCascadeIncidents;
                const liveDedupStoreCode = _ID.liveDedupStoreCode;
                const liveIncidentDedupKeySet = _ID.liveIncidentDedupKeySet;
                const liveDedupKeySetsOverlap = _ID.liveDedupKeySetsOverlap;
                const liveReportedSolvedRowResolvedEndMs = _ID.liveReportedSolvedRowResolvedEndMs;
                const liveReportedSolvedSupersedesUnreportedOpen = _ID.liveReportedSolvedSupersedesUnreportedOpen;
                // Closure-bound: caches live further down; the arrow defers the lookup.
                const livePreparedReportedSolvedSupersessions = () =>
                    _ID.livePreparedReportedSolvedSupersessions(liveReportedRowsCache, liveSolvedRowsCache);
                const liveUnreportedSupersedesReportedOrSolved = (unreportedRow, prepared) =>
                    _ID.liveUnreportedSupersedesReportedOrSolved(unreportedRow, prepared, getDeviceTicketLink);

                const _LIF = window.GFN_LIVE_INCIDENT_FILTERS || {};

                const _DR = window.GFN_DATE_RANGE || {};
                const viewStateApi = () => window.GFN_VIEW_STATE || null;

                // ============================================================================
                // 2. SETUP AND PERSISTENT STATE
                // ============================================================================

                const CRM_API_BASE = resolveApiBase();
                // Keep browser-originated incident writes opt-in so Alertmanager can be the single source.
                const ENABLE_BROWSER_INCIDENT_EVENTS =
                    (typeof window !== 'undefined' && window.__ENABLE_BROWSER_INCIDENT_EVENTS__ === true) ||
                    (typeof window !== 'undefined' && window.ENABLE_BROWSER_INCIDENT_EVENTS === true);

                // Restore saved state
                const savedDevice = localStorage.getItem(STORAGE_KEY_DEVICE);
                const savedSort = localStorage.getItem(STORAGE_KEY_SORT);
                const savedOfflineView = localStorage.getItem(STORAGE_KEY_OFFLINE_VIEW) === 'true';
                const savedOfflineSort = localStorage.getItem(STORAGE_KEY_OFFLINE_SORT);
                const savedOfflineSortColumn = localStorage.getItem(STORAGE_KEY_OFFLINE_SORT_COLUMN);
                const savedOfflineSortDirection = localStorage.getItem(STORAGE_KEY_OFFLINE_SORT_DIRECTION);
                const savedStatusSnapshot = localStorage.getItem(STORAGE_KEY_DEVICE_STATUS_SNAPSHOT);
                const savedPrimaryDownSince = localStorage.getItem(STORAGE_KEY_PRIMARY_DOWN_SINCE);
                const savedNightFreezeState = localStorage.getItem(STORAGE_KEY_NIGHT_FREEZE_STATE);

                const _bootView = viewStateApi()?.getState
                    ? viewStateApi().getState()
                    : {
                        page: 'live',
                        device: savedDevice ? savedDevice : 'routers',
                        offline: savedOfflineView
                    };

                // Initialize variables (navigation from GFN_VIEW_STATE singleton)
                let currentDeviceType = _bootView.device;
                let currentSortMode = savedSort ? savedSort : 'alphabetic';
                let isOfflineViewActive = _bootView.offline;
                let currentFilterMode = 'all';
                /** Live Incidents: all | still_offline (open) | back_online_unreported (closed, no ticket yet in CRM sense) */
                let liveUnreportedStatusFilter = 'all';
                /** Group ids (primary, price, …) user unchecked; unchecked = hidden from list */
                let liveUnreportedHiddenDeviceGroups = new Set();
                /** Report tag ids (CRM) user unchecked; hidden from Reported/Solved lists (same pattern as device groups). */
                let liveUnreportedHiddenReportTags = new Set();
                /** When false, tag filter narrows Reported/Solved (rows without report_tag are hidden). */
                let liveUnreportedTagAllMode = true;
                /** Avoid re-entrant change handlers when syncing checkboxes programmatically (prevents hangs / OOM in some browsers). */
                let liveUnreportedDeviceFilterSuppressChange = false;
                let liveUnreportedTagFilterSuppressChange = false;
                let currentDashboardPage = _bootView.page;
                let offlineSortMode = savedOfflineSort ? savedOfflineSort : 'highest';
                let searchQuery = '';
                /** Live toolbar: filter Reported/Solved by CRM task id (digits or full task URL). */
                let liveCrmTicketSearchValue = '';

                // Offline table: sort by column (header click)
                let offlineSortColumn = savedOfflineSortColumn ? savedOfflineSortColumn : '';
                let offlineSortDirection = savedOfflineSortDirection === 'asc' ? 'asc' : 'desc';
                let deviceTicketLinks = {};
                let currentTicketActor = '';
                let lastDeviceStatusSnapshot = {};
                let primaryDownSinceByStore = {};
                let nightFreezeState = {};
                try {
                    lastDeviceStatusSnapshot = savedStatusSnapshot ? JSON.parse(savedStatusSnapshot) : {};
                } catch (_error) {
                    lastDeviceStatusSnapshot = {};
                }
                try {
                    primaryDownSinceByStore = savedPrimaryDownSince ? JSON.parse(savedPrimaryDownSince) : {};
                } catch (_error) {
                    primaryDownSinceByStore = {};
                }
                try {
                    nightFreezeState = savedNightFreezeState ? JSON.parse(savedNightFreezeState) : {};
                } catch (_error) {
                    nightFreezeState = {};
                }

                let liveUnreportedRowsCache = [];
                let liveReportedRowsCache = [];
                let liveSolvedRowsCache = [];
                let liveIncidentSyncInFlight = false;
                let unreportedLiveFetchToken = 0;
                let liveUnreportedRawAccum = [];
                let liveUnreportedSessionId = 0;
                /** Last server totals for Live Unreported meta bar (survives grid re-render without refetch). */
                let liveUnreportedLastMeta = { total: null, sqlLoaded: 0, hasMore: false };

                /** Per-list column filters on Live Incidents (Unreported / Reported / Solved). */
                let liveIncidentSectionFilters = _LIF.getOrLoadAllSectionFilters
                    ? _LIF.getOrLoadAllSectionFilters()
                    : {
                        unreported: _LIF.createSectionState ? _LIF.createSectionState() : {},
                        reported: _LIF.createSectionState ? _LIF.createSectionState() : {},
                        solved: _LIF.createSectionState ? _LIF.createSectionState() : {}
                    };

                function persistLiveIncidentSectionFilters() {
                    if (_LIF.persistAllSectionFilters) {
                        _LIF.persistAllSectionFilters(liveIncidentSectionFilters);
                    }
                }
                let liveIncidentSectionFiltersBoundRoot = null;
                let liveIncidentSectionFiltersPanelRoot = null;
                let liveIncidentSectionFiltersHandler = null;
                let liveIncidentTicketFilterTimer = null;
                /** While typing in Ticket filter: restore focus after debounced re-render. */
                let liveIncidentTicketFilterFocus = null;

                function clearLiveIncidentTicketFilterTypingState() {
                    if (liveIncidentTicketFilterTimer) {
                        clearTimeout(liveIncidentTicketFilterTimer);
                        liveIncidentTicketFilterTimer = null;
                    }
                    liveIncidentTicketFilterFocus = null;
                }

                function restoreLiveIncidentTicketFilterFocus(root) {
                    const snap = liveIncidentTicketFilterFocus;
                    if (!snap || !root) return;
                    const input = root.querySelector(`.live-inc-ticket-input[data-section="${snap.sectionId}"]`);
                    if (!input) return;
                    const wrap = input.closest('.incident-col-ticket-wrap');
                    const btn = wrap && wrap.querySelector('.live-inc-ticket-btn');
                    if (btn) btn.classList.add('is-hidden');
                    input.hidden = false;
                    if (wrap) wrap.classList.add('is-active');
                    input.focus({ preventScroll: true });
                    const len = String(input.value || '').length;
                    const start = Number.isFinite(snap.selectionStart) ? snap.selectionStart : len;
                    const end = Number.isFinite(snap.selectionEnd) ? snap.selectionEnd : len;
                    try {
                        input.setSelectionRange(start, end);
                    } catch (_e) {
                        /* ignore */
                    }
                }

                function scheduleLiveIncidentTicketFilterRerender(root, sectionId, input) {
                    if (input) {
                        liveIncidentTicketFilterFocus = {
                            sectionId,
                            selectionStart: input.selectionStart,
                            selectionEnd: input.selectionEnd
                        };
                    }
                    if (liveIncidentTicketFilterTimer) clearTimeout(liveIncidentTicketFilterTimer);
                    liveIncidentTicketFilterTimer = setTimeout(() => {
                        liveIncidentTicketFilterTimer = null;
                        rerenderLiveIncidentCardsFromSectionFilter(root);
                        restoreLiveIncidentTicketFilterFocus(root);
                    }, 400);
                }

                /** Per store: previous full-WAN blackout flag (edge detect). */
                let prevIsStoreFullWanBlackoutByCode = {};
                /** Per store: epoch ms until which peripheral offline is excluded from Offline Devices summary (post-recovery). */
                let wanRecoveryOfflineCountGraceUntilByCode = {};
                /** Per store: previous WAN blackout state for incident masking. */
                let prevIsStoreFullWanBlackoutForIncidentsByCode = {};
                /** Per store: epoch ms until which dependent device incidents stay masked after WAN recovery. */
                let wanIncidentRecoveryGraceUntilByCode = {};

                // Data containers — initialized empty here; populated by the parser pass below.
                const dataMap = {
                    'routers': [],
                    'project-routers': [],
                    'switches-primary': [],
                    'switches-secondary': [],
                    'admin-pc': [],
                    'cash-register-1': [],
                    'cash-register-2': [],
                    'cash-register-3': [],
                    'inside-music': [],
                    'outside-music': [],
                    'printer': [],
                    'price-checkers': []
                };

                let offlineReportData = [];
                /** Per store (AR####): minutes credited to power-outage / planned Internet Down reports in range. */
                let offlinePowerOutageByStore = new Map();
                let offlinePlannedByStore = new Map();
                let offlineInternetReportRangeKey = '';
                let offlineInternetReportFetchToken = 0;
                let pcOver15DetailsByStore = {};
                let latestGrafanaData = null;

                const panelRuntime =
                    typeof window !== 'undefined'
                        ? (window[PANEL_RUNTIME_KEY] = window[PANEL_RUNTIME_KEY] || {
                              toastRootNode: null,
                              listenersInitialized: false,
                              listenersRootNode: null,
                              pcTagDocBound: false,
                              niiTagDocBound: false,
                              kioskHealth: null
                          })
                        : {
                              toastRootNode: null,
                              listenersInitialized: false,
                              listenersRootNode: null,
                              pcTagDocBound: false,
                              niiTagDocBound: false,
                              kioskHealth: null
                          };
                let toastRootNode = panelRuntime.toastRootNode;
                let listenersInitialized = panelRuntime.listenersInitialized;
                let listenersRootNode = panelRuntime.listenersRootNode;
                let deleteReportConfirmModalEl = null;

                // ============================================================================
                // 2. UTILITIES
                // ============================================================================

                // ---- Section 2 utilities moved to modules/utils.js ----
                // (escapeHtml, escapeAttr, formatTime, formatHoursMinutesOnly,
                //  offlineInternetUptimeTooltip(+Total), offlinePrimaryUptimeTooltip(+Total),
                //  offlineBackupUptimeTooltip(+Total), formatDateTime, DTF_COMPACT,
                //  extractStoreCode, formatStoreCodeFromInput, isManualReportedRow,
                //  formatIsoDateTime, ISO_DT_CACHE)
                // The local `const`s at the top of runGfnPanel rebind them so callers
                // below keep working unchanged.

                /** Reported/Solved Live: CRM resolve tag in the Tag column. The
                 *  "Non Internet" marker used to live here as a second chip,
                 *  but in Excel-list mode it now has its own Type column —
                 *  stacking two chips here was doubling the row height. */
                function reportedLiveCardHeaderChipsHtml(reportTagRaw, _row) {
                    const tagNorm = normalizeReportTag(reportTagRaw);
                    if (!tagNorm) return '';
                    const chip = `<span class="unreported-live-source-badge unreported-live-source-badge--tag">${escapeHtml(reportTagLabel(reportTagRaw))}</span>`;
                    return `<div class="unreported-live-top-right" role="group" aria-label="Report tag">${chip}</div>`;
                }

                // ---- Section 2/3 helpers moved to modules/device-format.js +
                //      modules/incident-dedup.js.
                //   device-format: unreportedLiveDuration*, formatUnreportedTimelineCompact,
                //     DEVICE_CATEGORY_LABELS, DEVICE_TYPE_ALIASES, normalizeDeviceTypeKey,
                //     formatDeviceCategory, formatDeviceLabel, formatDeviceToastLabel,
                //     getIncidentDeviceToken, buildIncidentDeviceName, normalizeIncidentKey,
                //     formatIncidentStatus, minutesSince, formatIncidentDuration,
                //     formatTimeToReport, formatReportToResolve, toEpochMs.
                //   incident-dedup: WAN_DEPENDENT_RECOVERY_GRACE_MS,
                //     PRIMARY_DOWN_BACKUP_UP_ALERT, STORE_WAN_BLACKOUT_ALERT,
                //     CASCADE_DEPENDENT_TYPES, filterCascadeIncidents,
                //     UNREPORTED_DEVICE_GROUP_TYPES, UNREPORTED_DEVICE_GROUP_IDS,
                //     DEVICE_TYPE_TO_GROUP_ID, LIVE_GROUPED_DEVICE_TYPES,
                //     incidentRowDeviceType, deviceGroupIdForType, countRowsForDeviceGroup.
                // The rebind block at the top of runGfnPanel re-binds them under their
                // original names so call sites below stay unchanged.

                function writeFilterChecklistCountOnLabel(checkboxEl, count) {
                    if (!checkboxEl) return;
                    const label = checkboxEl.closest('label');
                    if (!label) return;
                    let sp = label.querySelector('.filter-checklist-count');
                    if (!sp) {
                        sp = label.ownerDocument.createElement('span');
                        sp.className = 'filter-checklist-count';
                        sp.setAttribute('aria-hidden', 'true');
                        label.appendChild(sp);
                    }
                    sp.textContent = ` (${Number(count) || 0})`;
                }

                function updateDeviceGroupChecklistCounts(wrap, checkboxClass, allCheckboxSelector, rows) {
                    if (!wrap) return;
                    const list = Array.isArray(rows) ? rows : [];
                    const allCb = allCheckboxSelector ? wrap.querySelector(allCheckboxSelector) : null;
                    if (allCb) writeFilterChecklistCountOnLabel(allCb, list.length);
                    UNREPORTED_DEVICE_GROUP_IDS.forEach((groupId) => {
                        const cb = wrap.querySelector(`.${checkboxClass}[data-group="${groupId}"]`);
                        if (!cb) return;
                        writeFilterChecklistCountOnLabel(cb, countRowsForDeviceGroup(list, groupId));
                    });
                }

                function refreshReportingDeviceFilterCounts(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    if (!rv) return;
                    const uw = panel.querySelector('#reporting-unreported-filters');
                    const ubase = rv._unreportedRowsBase;
                    if (uw && Array.isArray(ubase)) {
                        const thresholded = ubase
                            .filter((r) => unreportedPassesMinDowntimeThreshold(r))
                            .filter((r) => !unreportedRowStaleOpenWhilePriceCheckerLiveUp(r));
                        updateDeviceGroupChecklistCounts(uw, 'unreported-dev-cb', '#unreported-dev-all', thresholded);
                    }
                    const rw = panel.querySelector('#reporting-reported-filters');
                    const rbase = rv._reportedRowsBase;
                    if (rw && Array.isArray(rbase)) {
                        updateDeviceGroupChecklistCounts(rw, 'reported-dev-cb', '#reported-dev-all', rbase);
                    }
                }

                /**
                 * Rows for Live → Devices checklist counts only (numbers in parentheses).
                 * Matches Non Reported grid rules: same as `filteredLiveUnreportedList` with
                 * device-group filter omitted (tags affect only Reported/Solved, not these counts).
                 */
                function liveRowsForLiveUnreportedDeviceFilterCounts() {
                    return filteredLiveUnreportedList(liveUnreportedRowsCache || [], { omitDeviceGroup: true });
                }

                function refreshLiveUnreportedDeviceFilterCounts(htmlNode) {
                    const wrap = htmlNode.getElementById('live-unreported-device-checklist-wrap');
                    if (!wrap) return;
                    updateDeviceGroupChecklistCounts(
                        wrap,
                        'live-unreported-dev-cb',
                        '#live-unreported-dev-all',
                        liveRowsForLiveUnreportedDeviceFilterCounts()
                    );
                }

                /**
                 * Close <details> when clicking outside (same behavior as Live Incidents device filter).
                 * Optional onOpenCb runs when the panel opens (e.g. refresh device counts).
                 */
                function bindDetailsOutsidePointerClose(detailsEl, htmlNode, onOpenCb) {
                    if (!detailsEl || detailsEl._detailsOutsidePointerCloseBound) return;
                    detailsEl._detailsOutsidePointerCloseBound = true;
                    const doc = (htmlNode && htmlNode.ownerDocument) || document;
                    detailsEl.addEventListener('toggle', () => {
                        if (detailsEl._detailsOutsideDocClose) {
                            doc.removeEventListener('click', detailsEl._detailsOutsideDocClose, false);
                            detailsEl._detailsOutsideDocClose = null;
                        }
                        if (detailsEl.open && typeof onOpenCb === 'function') {
                            onOpenCb();
                        }
                        if (!detailsEl.open) return;
                        const closeIfOutside = (ev) => {
                            if (!detailsEl.open) {
                                doc.removeEventListener('click', closeIfOutside, false);
                                detailsEl._detailsOutsideDocClose = null;
                                return;
                            }
                            let inside = false;
                            try {
                                const t = ev.target;
                                if (t && typeof detailsEl.contains === 'function' && detailsEl.contains(t)) {
                                    inside = true;
                                } else if (typeof ev.composedPath === 'function') {
                                    inside = ev.composedPath().includes(detailsEl);
                                }
                            } catch (_err) {
                                inside = Boolean(ev.target && detailsEl.contains(ev.target));
                            }
                            if (inside) return;
                            detailsEl.open = false;
                        };
                        detailsEl._detailsOutsideDocClose = closeIfOutside;
                        doc.addEventListener('click', closeIfOutside, false);
                    });
                }

                function bindReportingFilterDetailsOutsideClose(htmlNode) {
                    const rv = htmlNode.getElementById('incident-reporting-view');
                    if (!rv || rv._reportingDetailsOutsideCloseSuiteBound) return;
                    rv._reportingDetailsOutsideCloseSuiteBound = true;
                    const deviceIds = ['unreported-device-filter-details', 'reported-device-filter-details'];
                    deviceIds.forEach((id) => {
                        const el = rv.querySelector(`#${id}`);
                        if (!el) return;
                        bindDetailsOutsidePointerClose(el, htmlNode, () => refreshReportingDeviceFilterCounts(htmlNode));
                    });
                    ['reported-owner-filter-details', 'reported-tag-filter-details', 'ow-owner-filter-details'].forEach((id) => {
                        const el = rv.querySelector(`#${id}`);
                        if (!el) return;
                        bindDetailsOutsidePointerClose(el, htmlNode, null);
                    });
                }

                function liveUnreportedGroupIdForRow(row) {
                    // Null = device_type not in UNREPORTED_DEVICE_GROUP_TYPES. When the device
                    // checklist is narrowed, null-gid rows are excluded (see filteredLive*List).
                    return deviceGroupIdForType(incidentRowDeviceType(row));
                }

                /** Canonical AR####-P# for matching incident hostnames to panel series (FQDN / P / PC). */
                function priceCheckerCanonicalSlotFromDeviceName(raw) {
                    const head = String(raw || '').trim().split('.')[0] || '';
                    const m = head.match(/^(AR\d+)-(P|PC)(\d+)$/i);
                    if (!m) return '';
                    return `${m[1].toUpperCase()}-P${Number(m[3])}`;
                }

                /**
                 * Price checker status from the live Prometheus snapshot in `dataMap`.
                 * Panel query K is often `... == 0`: Grafana only returns **down** series, so UP devices
                 * are absent from `dataMap` — treat "slot not in down list" as UP when we have any K data.
                 * @returns {'active'|'inactive'|'warning'|null} null = cannot infer (no PC series loaded).
                 */
                function livePriceCheckerPingStatusForIncidentDevice(row) {
                    if (incidentRowDeviceType(row) !== 'price-checkers') return null;
                    const list = dataMap['price-checkers'];
                    if (!Array.isArray(list) || !list.length) return null;
                    const name = String(row?.device_name || '').trim();
                    if (!name) return null;
                    const byNorm = Object.create(null);
                    const slotDown = Object.create(null);
                    for (let i = 0; i < list.length; i++) {
                        const d = list[i];
                        if (!d || !d.name) continue;
                        const raw = String(d.name).trim();
                        const dot = raw.indexOf('.');
                        const host = dot > 0 ? raw.slice(0, dot).trim() : raw;
                        const kHost = normalizeDeviceKey(host);
                        const kFull = normalizeDeviceKey(raw);
                        const st = d.status || 'unknown';
                        if (kHost) byNorm[kHost] = st;
                        if (kFull) byNorm[kFull] = st;
                        const slot =
                            priceCheckerCanonicalSlotFromDeviceName(raw) ||
                            priceCheckerCanonicalSlotFromDeviceName(host);
                        if (slot && st === 'inactive') slotDown[slot] = true;
                    }
                    const cands = ticketLookupCandidateNames(name, 'price-checkers');
                    for (let j = 0; j < cands.length; j++) {
                        const st = byNorm[normalizeDeviceKey(cands[j])];
                        if (st) return st;
                    }
                    const wantSlot = priceCheckerCanonicalSlotFromDeviceName(name);
                    if (wantSlot) {
                        if (slotDown[wantSlot]) return 'inactive';
                        const st = byNorm[normalizeDeviceKey(wantSlot)];
                        if (st) return st;
                        return 'active';
                    }
                    return null;
                }

                /** Open DB row but panel metrics show this price checker is not down (UP or absent from down-only query). */
                function unreportedRowStaleOpenWhilePriceCheckerLiveUp(row) {
                    if (String(row?.incident_status || '').toLowerCase() !== 'open') return false;
                    const ping = livePriceCheckerPingStatusForIncidentDevice(row);
                    return ping != null && ping !== 'inactive';
                }

                const LIVE_UNREPORTED_STATUS_CYCLE = ['all', 'still_offline', 'back_online_unreported'];
                const LIVE_UNREPORTED_DURATION_CYCLE = ['duration_desc', 'duration_asc'];
                const LIVE_UNREPORTED_MIN_DOWNTIME_MINUTES_DEFAULT = 15;
                const LIVE_UNREPORTED_MIN_DOWNTIME_MINUTES_PRICE_CHECKER = 120;
                const savedLiveUnreportedDurationSort = localStorage.getItem(STORAGE_KEY_LIVE_UNREPORTED_DURATION_SORT);
                let liveUnreportedDurationSort = LIVE_UNREPORTED_DURATION_CYCLE.includes(savedLiveUnreportedDurationSort)
                    ? savedLiveUnreportedDurationSort
                    : 'duration_desc';

                function liveUnreportedStatusCycleValueLabel(filter) {
                    if (filter === 'still_offline') return 'Offline';
                    if (filter === 'back_online_unreported') return 'Online but Unreported';
                    return 'All';
                }

                function updateLiveUnreportedStatusCycleButton(htmlNode) {
                    const btn = htmlNode.getElementById('live-unreported-status-cycle');
                    const valEl = htmlNode.getElementById('live-unreported-status-cycle-value');
                    const v = liveUnreportedStatusFilter || 'all';
                    const line = liveUnreportedStatusCycleValueLabel(v);
                    if (valEl) valEl.textContent = line;
                    if (btn) {
                        btn.setAttribute('data-status', v);
                        const full = `Status — ${line}`;
                        btn.title = full;
                        btn.setAttribute('aria-label', `${full}. Click to cycle status filter.`);
                    }
                }

                function liveUnreportedDurationCycleValueLabel(mode) {
                    if (mode === 'duration_asc') return 'Lowest';
                    if (mode === 'duration_desc') return 'Highest';
                    return 'Highest';
                }

                function updateLiveUnreportedDurationCycleButton(htmlNode) {
                    const btn = htmlNode.getElementById('live-unreported-duration-cycle');
                    const valEl = htmlNode.getElementById('live-unreported-duration-cycle-value');
                    const v = liveUnreportedDurationSort || 'default';
                    const line = liveUnreportedDurationCycleValueLabel(v);
                    if (valEl) valEl.textContent = line;
                    if (btn) {
                        btn.setAttribute('data-duration-sort', v);
                        const full = `Duration — ${line}`;
                        btn.title = full;
                        btn.setAttribute('aria-label', `${full}. Click to cycle duration sort.`);
                    }
                }

                /**
                 * Delegate clicks on the panel root (same document as the iframe / panel — not top-level `document`).
                 * When Grafana swaps the panel DOM node, remove the old listener and attach on the new root so we
                 * never rely on a detached element or on `document` (clicks in an iframe do not bubble to the parent page).
                 */
                let liveToolbarCyclesAttachedRoot = null;
                let liveToolbarCyclesHandler = null;
                function liveToolbarCyclesOnClick(ev) {
                    const root = listenersRootNode;
                    if (!root || !root.isConnected) return;
                    const statusBtn = ev.target.closest('#live-unreported-status-cycle');
                    const durationBtn = ev.target.closest('#live-unreported-duration-cycle');
                    if (statusBtn && root.contains(statusBtn)) {
                        ev.preventDefault();
                        const seq = LIVE_UNREPORTED_STATUS_CYCLE;
                        const i = seq.indexOf(liveUnreportedStatusFilter);
                        liveUnreportedStatusFilter = seq[(i >= 0 ? i + 1 : 0) % seq.length];
                        updateLiveUnreportedStatusCycleButton(root);
                        if (currentDashboardPage === 'live' && currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE) {
                            renderUnreportedLiveCards(root, liveUnreportedRowsCache, liveReportedRowsCache, liveSolvedRowsCache);
                        }
                        return;
                    }
                    if (durationBtn && root.contains(durationBtn)) {
                        ev.preventDefault();
                        const seq = LIVE_UNREPORTED_DURATION_CYCLE;
                        const i = seq.indexOf(liveUnreportedDurationSort);
                        liveUnreportedDurationSort = seq[(i >= 0 ? i + 1 : 0) % seq.length];
                        localStorage.setItem(STORAGE_KEY_LIVE_UNREPORTED_DURATION_SORT, liveUnreportedDurationSort);
                        updateLiveUnreportedDurationCycleButton(root);
                        if (currentDashboardPage === 'live' && currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE) {
                            renderUnreportedLiveCards(root, liveUnreportedRowsCache, liveReportedRowsCache, liveSolvedRowsCache);
                        }
                    }
                }
                function ensureLiveUnreportedToolbarCyclesDelegation(htmlNode) {
                    if (!htmlNode) return;
                    if (liveToolbarCyclesAttachedRoot === htmlNode && liveToolbarCyclesHandler) return;
                    if (liveToolbarCyclesAttachedRoot && liveToolbarCyclesHandler) {
                        liveToolbarCyclesAttachedRoot.removeEventListener('click', liveToolbarCyclesHandler);
                    }
                    liveToolbarCyclesHandler = liveToolbarCyclesOnClick;
                    liveToolbarCyclesAttachedRoot = htmlNode;
                    htmlNode.addEventListener('click', liveToolbarCyclesHandler);
                }

                // ---- Incidents page: per-section collapse state ----------------------
                // Persists which of Unreported / Reported / Solved the user has
                // collapsed. Same DOM gets re-rendered every Live refresh, so we
                // read this on each render to set the initial class, and use a
                // click-delegation handler (attached once) to flip it.

                const STORAGE_KEY_INCIDENT_COLLAPSED = 'grafana_custom_panel_incident_collapsed_sections';

                function readCollapsedIncidentSections() {
                    try {
                        const raw = localStorage.getItem(STORAGE_KEY_INCIDENT_COLLAPSED);
                        if (!raw) return new Set();
                        const parsed = JSON.parse(raw);
                        if (!Array.isArray(parsed)) return new Set();
                        return new Set(parsed.filter((s) => typeof s === 'string'));
                    } catch (_e) {
                        return new Set();
                    }
                }

                function writeCollapsedIncidentSections(set) {
                    try {
                        localStorage.setItem(
                            STORAGE_KEY_INCIDENT_COLLAPSED,
                            JSON.stringify([...set])
                        );
                    } catch (_e) { /* ignore */ }
                }

                let incidentSectionToggleAttachedRoot = null;
                let incidentSectionToggleHandler = null;
                function incidentSectionToggleOnClick(ev) {
                    const title = ev.target.closest('.grouped-device-title');
                    if (!title) return;
                    const section = title.closest('.grouped-device-section[data-incident-section]');
                    if (!section) return;
                    // Only react when the title is a direct child of the section
                    // (avoid catching nested grouped titles in any future markup).
                    if (title.parentElement !== section) return;

                    ev.preventDefault();
                    const sectionId = section.dataset.incidentSection;
                    const willCollapse = !section.classList.contains('is-collapsed');
                    section.classList.toggle('is-collapsed', willCollapse);
                    title.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');
                    const set = readCollapsedIncidentSections();
                    if (willCollapse) set.add(sectionId);
                    else set.delete(sectionId);
                    writeCollapsedIncidentSections(set);
                }

                function ensureIncidentSectionTogglesDelegation(htmlNode) {
                    if (!htmlNode) return;
                    if (incidentSectionToggleAttachedRoot === htmlNode && incidentSectionToggleHandler) return;
                    if (incidentSectionToggleAttachedRoot && incidentSectionToggleHandler) {
                        incidentSectionToggleAttachedRoot.removeEventListener('click', incidentSectionToggleHandler);
                    }
                    incidentSectionToggleHandler = incidentSectionToggleOnClick;
                    incidentSectionToggleAttachedRoot = htmlNode;
                    htmlNode.addEventListener('click', incidentSectionToggleHandler);
                }

                function liveIncidentStoreSortKey(row) {
                    const code = extractStoreCode(row?.store_code || row?.device_name || '');
                    const m = /^AR(\d+)$/i.exec(code);
                    return m ? Number(m[1]) : 0;
                }

                function liveIncidentUnreportedStartMs(row) {
                    return toEpochMs(row?.offline_started_at) || 0;
                }

                function liveIncidentUnreportedEndMs(row) {
                    if (String(row?.incident_status || '').toLowerCase() === 'open') return Number.MAX_SAFE_INTEGER;
                    return toEpochMs(row?.offline_ended_at) || 0;
                }

                function liveIncidentReportedStartMs(row) {
                    const isManual = isManualReportedRow(row);
                    const iso = row?.incident_offline_started_at || (isManual ? (row?.created_at || '') : '');
                    return toEpochMs(iso) || 0;
                }

                function liveIncidentReportedEndMs(row) {
                    if (row?.__heldFromSolved) return Number.MAX_SAFE_INTEGER;
                    const rtr = row?.report_to_resolve_minutes != null ? Number(row.report_to_resolve_minutes) : null;
                    const reportMs = toEpochMs(row?.created_at);
                    if (rtr != null && Number.isFinite(rtr) && rtr >= 0 && reportMs != null) {
                        return reportMs + (rtr * 60000);
                    }
                    if (String(row?.incident_status || '').toLowerCase() !== 'closed') return Number.MAX_SAFE_INTEGER;
                    return toEpochMs(row?.offline_ended_at) || 0;
                }

                function liveIncidentReportedDurationMinutes(row) {
                    const start = liveIncidentReportedStartMs(row);
                    if (!start) return 0;
                    const end = liveIncidentReportedEndMs(row);
                    if (end >= Number.MAX_SAFE_INTEGER) {
                        return Math.max(0, Math.floor((Date.now() - start) / 60000));
                    }
                    return Math.max(0, Math.floor((end - start) / 60000));
                }

                function liveIncidentReportedSolvedAtMs(row) {
                    const end = liveIncidentReportedEndMs(row);
                    return end >= Number.MAX_SAFE_INTEGER ? 0 : end;
                }

                function liveIncidentFilterDeps() {
                    return {
                        groupIdForRow: liveUnreportedGroupIdForRow,
                        ownerKey: (r) => normalizeOwnerUsername(r?.owner_name || r?._ticket_owner || '', '-'),
                        ownerLabel: (k) => ownerDisplayName(k, '-'),
                        tagKey: (r) => rowReportTagId(r) || '',
                        tagLabel: (k) => (k ? reportTagLabel(k, k) : '—'),
                        isManualRow: (r) => isManualReportedRow(r),
                        ticketIdFromRow: (r) => {
                            const fromUrl = extractCrmTaskIdFromTicketUrl(String(r?.ticket_url || r?._ticket_url || '').trim());
                            if (fromUrl) return fromUrl;
                            const raw = r?.crm_task_id != null ? String(r.crm_task_id) : '';
                            return raw.replace(/\D/g, '');
                        },
                        storeSortKey: liveIncidentStoreSortKey,
                        startSortKey: (r, kind) => (
                            kind === 'unreported' ? liveIncidentUnreportedStartMs(r) : liveIncidentReportedStartMs(r)
                        ),
                        endSortKey: (r, kind) => (
                            kind === 'unreported' ? liveIncidentUnreportedEndMs(r) : liveIncidentReportedEndMs(r)
                        ),
                        durationSortKey: (r, kind) => (
                            kind === 'unreported'
                                ? unreportedEffectiveDurationMinutes(r)
                                : liveIncidentReportedDurationMinutes(r)
                        ),
                        reportedSortKey: (r) => toEpochMs(r?.created_at) || 0,
                        solvedSortKey: (r) => liveIncidentReportedSolvedAtMs(r)
                    };
                }

                function rerenderLiveIncidentCardsFromSectionFilter(_htmlNode) {
                    const renderRoot = liveIncidentSectionFiltersPanelRoot
                        || (_htmlNode && _htmlNode.id === 'stores-grid'
                            ? (_htmlNode.ownerDocument || document)
                            : _htmlNode);
                    if (!renderRoot) return;
                    const grid = renderRoot.id === 'stores-grid'
                        ? renderRoot
                        : renderRoot.getElementById('stores-grid');
                    if (grid) delete grid.dataset.fingerprint;
                    renderUnreportedLiveCards(
                        renderRoot,
                        liveUnreportedRowsCache,
                        liveReportedRowsCache,
                        liveSolvedRowsCache
                    );
                }

                function liveIncidentSectionFilterOnBlur(ev) {
                    const root = liveIncidentSectionFiltersBoundRoot;
                    if (!root) return;
                    const target = ev.target;
                    if (!target || !target.classList || !target.classList.contains('live-inc-ticket-input')) return;
                    if (!root.contains(target)) return;
                    clearLiveIncidentTicketFilterTypingState();
                    rerenderLiveIncidentCardsFromSectionFilter(root);
                }

                function liveIncidentSectionFilterOnClick(ev) {
                    const root = liveIncidentSectionFiltersBoundRoot;
                    if (!root) return;
                    const checklist = ev.target.closest('.analytics-filter-checklist');
                    if (checklist && root.contains(checklist)) {
                        ev.stopPropagation();
                    }
                    const sortBtn = ev.target.closest('.live-inc-sort-btn');
                    if (sortBtn && root.contains(sortBtn)) {
                        ev.preventDefault();
                        const sectionId = sortBtn.getAttribute('data-section');
                        const sortKey = sortBtn.getAttribute('data-sort-key');
                        if (!sectionId || !sortKey || !liveIncidentSectionFilters[sectionId]) return;
                        const state = liveIncidentSectionFilters[sectionId];
                        const cur = state[`${sortKey}Order`] || '';
                        const next = _LIF.cycleSort ? _LIF.cycleSort(cur) : '';
                        state[`${sortKey}Order`] = next;
                        persistLiveIncidentSectionFilters();
                        clearLiveIncidentTicketFilterTypingState();
                        const sym = sortBtn.querySelector('.analytics-th-sort-symbol');
                        if (sym && _LIF.sortSymbol) sym.textContent = _LIF.sortSymbol(next);
                        rerenderLiveIncidentCardsFromSectionFilter(root);
                        return;
                    }
                    const typeBtn = ev.target.closest('.live-inc-type-btn');
                    if (typeBtn && root.contains(typeBtn)) {
                        ev.preventDefault();
                        const sectionId = typeBtn.getAttribute('data-section');
                        if (!sectionId || !liveIncidentSectionFilters[sectionId]) return;
                        const state = liveIncidentSectionFilters[sectionId];
                        const next = _LIF.cycleTypeFilter ? _LIF.cycleTypeFilter(state.typeFilter) : 'all';
                        state.typeFilter = next;
                        persistLiveIncidentSectionFilters();
                        clearLiveIncidentTicketFilterTypingState();
                        const sym = typeBtn.querySelector('.analytics-th-sort-symbol');
                        if (sym && _LIF.typeFilterSymbol) sym.textContent = _LIF.typeFilterSymbol(next);
                        rerenderLiveIncidentCardsFromSectionFilter(root);
                        return;
                    }
                    const ticketBtn = ev.target.closest('.live-inc-ticket-btn');
                    if (ticketBtn && root.contains(ticketBtn)) {
                        ev.preventDefault();
                        const sectionId = ticketBtn.getAttribute('data-section');
                        const wrap = ticketBtn.closest('.incident-col-ticket-wrap');
                        const input = wrap && wrap.querySelector('.live-inc-ticket-input');
                        if (!input) return;
                        ticketBtn.classList.add('is-hidden');
                        input.hidden = false;
                        wrap.classList.add('is-active');
                        input.focus();
                        return;
                    }
                }

                function liveIncidentSectionFilterOnChange(ev) {
                    const root = liveIncidentSectionFiltersBoundRoot;
                    if (!root) return;
                    const target = ev.target;
                    if (!target || !target.getAttribute) return;
                    const sectionId = target.getAttribute('data-section');
                    if (!sectionId || !liveIncidentSectionFilters[sectionId]) return;
                    if (
                        target.classList.contains('live-inc-dev-all') ||
                        target.classList.contains('live-inc-dev-cb') ||
                        target.classList.contains('live-inc-owner-all') ||
                        target.classList.contains('live-inc-owner-cb') ||
                        target.classList.contains('live-inc-tag-all') ||
                        target.classList.contains('live-inc-tag-cb')
                    ) {
                        liveIncidentSectionFilters[sectionId] = _LIF.updateStateFromCheckboxChange(
                            sectionId,
                            liveIncidentSectionFilters[sectionId],
                            target
                        );
                        persistLiveIncidentSectionFilters();
                        clearLiveIncidentTicketFilterTypingState();
                        rerenderLiveIncidentCardsFromSectionFilter(root);
                        return;
                    }
                    if (target.classList.contains('live-inc-ticket-input')) {
                        const digits = String(target.value || '').replace(/\D/g, '');
                        if (target.value !== digits) target.value = digits;
                        liveIncidentSectionFilters[sectionId].ticketQuery = digits;
                        persistLiveIncidentSectionFilters();
                        scheduleLiveIncidentTicketFilterRerender(root, sectionId, target);
                    }
                }

                function ensureLiveIncidentSectionFiltersDelegation(htmlNode) {
                    if (!htmlNode || !_LIF.buildSectionHeader) return;
                    const panelRoot = htmlNode.ownerDocument || document;
                    if (
                        liveIncidentSectionFiltersBoundRoot === htmlNode
                        && liveIncidentSectionFiltersPanelRoot === panelRoot
                        && liveIncidentSectionFiltersHandler
                    ) {
                        return;
                    }
                    if (liveIncidentSectionFiltersBoundRoot && liveIncidentSectionFiltersHandler) {
                        liveIncidentSectionFiltersBoundRoot.removeEventListener('click', liveIncidentSectionFiltersHandler);
                        liveIncidentSectionFiltersBoundRoot.removeEventListener('change', liveIncidentSectionFilterOnChange);
                        liveIncidentSectionFiltersBoundRoot.removeEventListener('input', liveIncidentSectionFilterOnChange);
                        liveIncidentSectionFiltersBoundRoot.removeEventListener('blur', liveIncidentSectionFilterOnBlur, true);
                    }
                    liveIncidentSectionFiltersHandler = liveIncidentSectionFilterOnClick;
                    liveIncidentSectionFiltersBoundRoot = htmlNode;
                    liveIncidentSectionFiltersPanelRoot = panelRoot;
                    htmlNode.addEventListener('click', liveIncidentSectionFiltersHandler);
                    htmlNode.addEventListener('change', liveIncidentSectionFilterOnChange);
                    htmlNode.addEventListener('input', liveIncidentSectionFilterOnChange);
                    htmlNode.addEventListener('blur', liveIncidentSectionFilterOnBlur, true);
                }

                function liveUnreportedApplyHiddenToDeviceCheckboxes(wrap, present) {
                    if (!wrap) return;
                    const allCb = wrap.querySelector('#live-unreported-dev-all');
                    const groupCbs = [...wrap.querySelectorAll('.live-unreported-dev-cb[data-group]')].filter((cb) => {
                        const gid = cb.getAttribute('data-group');
                        if (!gid || gid === 'all') return false;
                        const label = cb.closest('label');
                        return label && label.style.display !== 'none';
                    });
                    const allShown = present.size > 0 && [...present].every((gid) => !liveUnreportedHiddenDeviceGroups.has(gid));
                    if (allCb && present.size > 0) {
                        if (allShown) {
                            allCb.checked = true;
                            groupCbs.forEach((c) => {
                                c.checked = false;
                            });
                        } else {
                            allCb.checked = false;
                            groupCbs.forEach((c) => {
                                const gid = c.getAttribute('data-group');
                                c.checked = !liveUnreportedHiddenDeviceGroups.has(gid);
                            });
                        }
                        allCb.indeterminate = false;
                    }
                }

                function liveUnreportedUpdateDeviceFilterSummary(htmlNode) {
                    const wrap = htmlNode.getElementById('live-unreported-device-checklist-wrap');
                    const details = htmlNode.getElementById('live-unreported-device-filter-details');
                    const summary = htmlNode.getElementById('live-unreported-device-filter-summary');
                    if (!wrap || !details || !summary) return;
                    ensureFilterSummaryIcon(summary);
                    const present = visibleDeviceGroupIdsFromRows(liveCombinedRowsMatchingToolbarExceptDeviceGroup());
                    if (present.size === 0) {
                        details.title = 'Devices — no categories in range';
                        details.classList.remove('is-filtered-partial');
                        return;
                    }
                    const allCb = wrap.querySelector('#live-unreported-dev-all');
                    const groupCbs = [...wrap.querySelectorAll('.live-unreported-dev-cb[data-group]')].filter((c) => {
                        const gid = c.getAttribute('data-group');
                        if (!gid || gid === 'all') return false;
                        const label = c.closest('label');
                        return label && label.style.display !== 'none';
                    });
                    const n = groupCbs.filter((c) => c.checked).length;
                    const total = groupCbs.length;
                    const allMode = allCb && allCb.checked && n === 0;
                    if (allMode) {
                        details.title = 'Devices — all categories';
                        details.classList.remove('is-filtered-partial');
                    } else if (n === 0) {
                        details.title = 'Devices — none selected (no rows)';
                        details.classList.add('is-filtered-partial');
                    } else {
                        details.title = `Devices — ${n} of ${total} categories`;
                        details.classList.add('is-filtered-partial');
                    }
                }

                function syncLiveUnreportedDeviceFilterUI(htmlNode) {
                    const wrap = htmlNode.getElementById('live-unreported-device-checklist-wrap');
                    const details = htmlNode.getElementById('live-unreported-device-filter-details');
                    const emptyEl = htmlNode.getElementById('live-unreported-device-filter-empty');
                    const hgroup = htmlNode.querySelector('.live-unreported-device-hgroup');
                    const toolbar = htmlNode.getElementById('live-unreported-toolbar');
                    if (!wrap || !toolbar || toolbar.hidden) return;
                    const rows = liveCombinedRowsMatchingToolbarExceptDeviceGroup();
                    const present = visibleDeviceGroupIdsFromRows(rows);
                    for (const gid of [...liveUnreportedHiddenDeviceGroups]) {
                        if (!present.has(gid)) liveUnreportedHiddenDeviceGroups.delete(gid);
                    }
                    if (present.size === 0) {
                        if (hgroup) hgroup.hidden = true;
                        if (emptyEl) emptyEl.hidden = false;
                        liveUnreportedUpdateDeviceFilterSummary(htmlNode);
                        refreshLiveUnreportedDeviceFilterCounts(htmlNode);
                        syncLiveUnreportedTagFilterUI(htmlNode);
                        return;
                    }
                    if (hgroup) hgroup.hidden = false;
                    if (emptyEl) emptyEl.hidden = true;
                    syncDeviceFilterVisibility(wrap, 'live-unreported-dev-cb', 'live-unreported-dev-all', present);
                    liveUnreportedApplyHiddenToDeviceCheckboxes(wrap, present);
                    liveUnreportedUpdateDeviceFilterSummary(htmlNode);
                    refreshLiveUnreportedDeviceFilterCounts(htmlNode);
                    syncLiveUnreportedTagFilterUI(htmlNode);
                }

                function bindLiveUnreportedDeviceFilterDetailsOutsideClose(htmlNode) {
                    const detailsEl = htmlNode.querySelector('#live-unreported-device-filter-details');
                    if (!detailsEl) return;
                    bindDetailsOutsidePointerClose(detailsEl, htmlNode, () => refreshLiveUnreportedDeviceFilterCounts(htmlNode));
                }

                function setupLiveUnreportedDeviceFilters(htmlNode) {
                    const wrap = htmlNode.getElementById('live-unreported-device-checklist-wrap');
                    if (!wrap || wrap._liveUnreportedDeviceFiltersBound) return;
                    wrap._liveUnreportedDeviceFiltersBound = true;
                    const allCb = wrap.querySelector('#live-unreported-dev-all');
                    const getGroupCbs = () =>
                        [...wrap.querySelectorAll('.live-unreported-dev-cb[data-group]')].filter((c) => c.getAttribute('data-group') !== 'all');
                    const visibleGroupCbs = () =>
                        getGroupCbs().filter((cb) => {
                            const label = cb.closest('label');
                            return label && label.style.display !== 'none';
                        });
                    const onChange = () => {
                        liveUnreportedUpdateDeviceFilterSummary(htmlNode);
                        renderUnreportedLiveCards(htmlNode, liveUnreportedRowsCache, liveReportedRowsCache, liveSolvedRowsCache);
                    };
                    if (allCb) {
                        allCb.addEventListener('change', () => {
                            if (liveUnreportedDeviceFilterSuppressChange) return;
                            if (allCb.checked) {
                                liveUnreportedDeviceFilterSuppressChange = true;
                                try {
                                    getGroupCbs().forEach((c) => {
                                        c.checked = false;
                                    });
                                    liveUnreportedHiddenDeviceGroups.clear();
                                } finally {
                                    liveUnreportedDeviceFilterSuppressChange = false;
                                }
                            } else {
                                const vg = visibleGroupCbs();
                                const n = vg.filter((c) => c.checked).length;
                                if (n === 0) {
                                    liveUnreportedDeviceFilterSuppressChange = true;
                                    try {
                                        allCb.checked = true;
                                        liveUnreportedHiddenDeviceGroups.clear();
                                    } finally {
                                        liveUnreportedDeviceFilterSuppressChange = false;
                                    }
                                }
                            }
                            allCb.indeterminate = false;
                            onChange();
                        });
                    }
                    getGroupCbs().forEach((cb) => {
                        cb.addEventListener('change', () => {
                            if (liveUnreportedDeviceFilterSuppressChange) return;
                            const vg = visibleGroupCbs();
                            const n = vg.filter((c) => c.checked).length;
                            liveUnreportedDeviceFilterSuppressChange = true;
                            try {
                                if (n === vg.length && vg.length > 0) {
                                    if (allCb) allCb.checked = true;
                                    vg.forEach((c) => {
                                        c.checked = false;
                                    });
                                    liveUnreportedHiddenDeviceGroups.clear();
                                } else if (n === 0) {
                                    if (allCb) allCb.checked = true;
                                    vg.forEach((c) => {
                                        c.checked = false;
                                    });
                                    liveUnreportedHiddenDeviceGroups.clear();
                                } else {
                                    if (allCb) allCb.checked = false;
                                    liveUnreportedHiddenDeviceGroups.clear();
                                    vg.forEach((c) => {
                                        const gid = c.getAttribute('data-group');
                                        if (!c.checked) liveUnreportedHiddenDeviceGroups.add(gid);
                                    });
                                }
                                if (allCb) allCb.indeterminate = false;
                            } finally {
                                liveUnreportedDeviceFilterSuppressChange = false;
                            }
                            onChange();
                        });
                    });
                    liveUnreportedUpdateDeviceFilterSummary(htmlNode);
                    bindLiveUnreportedDeviceFilterDetailsOutsideClose(htmlNode);
                }

                /** CRM / reporting row tag (API may use report_tag or reportTag). */
                function rowReportTagId(row) {
                    if (!row) return '';
                    const raw =
                        row.report_tag !== undefined && row.report_tag !== null && String(row.report_tag).trim() !== ''
                            ? row.report_tag
                            : row.reportTag;
                    return normalizeReportTag(raw);
                }

                function visibleLiveIncidentTagIdsFromRows(rows) {
                    const want = new Set(LIVE_INCIDENT_TAG_FILTER_IDS);
                    const out = new Set();
                    (Array.isArray(rows) ? rows : []).forEach((row) => {
                        const t = rowReportTagId(row);
                        if (t && want.has(t)) out.add(t);
                    });
                    return out;
                }

                function countRowsForLiveIncidentTag(rows, tagId) {
                    if (!Array.isArray(rows) || !tagId) return 0;
                    let n = 0;
                    for (let i = 0; i < rows.length; i++) {
                        if (rowReportTagId(rows[i]) === tagId) n++;
                    }
                    return n;
                }

                /** Unreported + Reported + Solved (min-downtime on unreported only) for tag checklist counts / visibility. */
                function liveReportedSolvedRowsForTagUi() {
                    const u = (liveUnreportedRowsCache || []).filter((r) => unreportedPassesMinDowntimeThreshold(r));
                    return u.concat(liveReportedRowsCache || []).concat(liveSolvedRowsCache || []);
                }

                /** Rows that carry a CRM tag from the Live toolbar checklist (Reported + Solved only). */
                function liveRowsMatchingToolbarTags(rows) {
                    const list = Array.isArray(rows) ? rows : [];
                    return list.filter((r) => LIVE_INCIDENT_TAG_FILTER_IDS.includes(rowReportTagId(r)));
                }

                function setLiveIncidentTagFilterNoneUi(wrap, showNone) {
                    if (!wrap) return;
                    const noneEl = wrap.querySelector('.live-tag-filter-none-msg');
                    if (noneEl) {
                        noneEl.hidden = !showNone;
                        noneEl.style.display = showNone ? 'block' : 'none';
                    }
                    wrap.querySelectorAll(':scope > label.unreported-cb-label').forEach((lab) => {
                        const isAll = lab.querySelector('#live-unreported-tag-all');
                        if (showNone && !isAll) {
                            lab.style.display = 'none';
                        } else if (!showNone && !isAll) {
                            lab.style.display = '';
                        }
                    });
                }

                function syncLiveIncidentTagFilterVisibility(wrap, presentTagIds) {
                    if (!wrap) return;
                    const allCb = wrap.querySelector('#live-unreported-tag-all');
                    const groupCbs = [...wrap.querySelectorAll('.live-unreported-tag-cb')];
                    const visibleCbs = [];
                    groupCbs.forEach((cb) => {
                        const tid = cb.getAttribute('data-tag') || '';
                        if (tid === 'all') return;
                        const label = cb.closest('label');
                        const isVisible = presentTagIds.has(tid);
                        if (label) label.style.display = isVisible ? '' : 'none';
                        if (!isVisible) cb.checked = false;
                        if (isVisible) visibleCbs.push(cb);
                    });
                    if (allCb) {
                        if (!visibleCbs.some((c) => c.checked)) {
                            allCb.checked = true;
                        } else {
                            allCb.checked = false;
                        }
                        allCb.indeterminate = false;
                    }
                }

                function liveUnreportedApplyHiddenToTagCheckboxes(wrap, present) {
                    if (!wrap) return;
                    const allCb = wrap.querySelector('#live-unreported-tag-all');
                    const groupCbs = [...wrap.querySelectorAll('.live-unreported-tag-cb[data-tag]')].filter((cb) => {
                        const tid = cb.getAttribute('data-tag');
                        if (!tid || tid === 'all') return false;
                        const label = cb.closest('label');
                        return label && label.style.display !== 'none';
                    });
                    if (!allCb) return;
                    liveUnreportedTagFilterSuppressChange = true;
                    try {
                        if (!present || present.size === 0) {
                            allCb.checked = !!liveUnreportedTagAllMode;
                            allCb.indeterminate = false;
                            return;
                        }
                        if (liveUnreportedTagAllMode) {
                            liveUnreportedHiddenReportTags.clear();
                            allCb.checked = true;
                            groupCbs.forEach((c) => {
                                c.checked = false;
                            });
                        } else {
                            allCb.checked = false;
                            groupCbs.forEach((c) => {
                                const tid = c.getAttribute('data-tag');
                                c.checked = !!(tid && !liveUnreportedHiddenReportTags.has(tid));
                            });
                        }
                        allCb.indeterminate = false;
                    } finally {
                        liveUnreportedTagFilterSuppressChange = false;
                    }
                }

                function refreshLiveUnreportedTagFilterCounts(htmlNode) {
                    const wrap = htmlNode.getElementById('live-unreported-tag-checklist-wrap');
                    if (!wrap) return;
                    const rs = liveReportedSolvedRowsForTagUi();
                    const tagged = liveRowsMatchingToolbarTags(rs);
                    const allCb = wrap.querySelector('#live-unreported-tag-all');
                    if (allCb) writeFilterChecklistCountOnLabel(allCb, tagged.length);
                    LIVE_INCIDENT_TAG_FILTER_IDS.forEach((tagId) => {
                        const cb = wrap.querySelector(`.live-unreported-tag-cb[data-tag="${tagId}"]`);
                        if (!cb) return;
                        writeFilterChecklistCountOnLabel(cb, countRowsForLiveIncidentTag(rs, tagId));
                    });
                    const noneEl = wrap.querySelector('.live-tag-filter-none-msg');
                    if (noneEl) noneEl.textContent = tagged.length === 0 ? 'None (0)' : 'None';
                }

                function liveUnreportedUpdateTagFilterSummary(htmlNode) {
                    const wrap = htmlNode.getElementById('live-unreported-tag-checklist-wrap');
                    const details = htmlNode.getElementById('live-unreported-tag-filter-details');
                    const summary = htmlNode.getElementById('live-unreported-tag-filter-summary');
                    if (!wrap || !details || !summary) return;
                    ensureFilterSummaryIcon(summary);
                    const rs = liveReportedSolvedRowsForTagUi();
                    const tagged = liveRowsMatchingToolbarTags(rs);
                    const present = visibleLiveIncidentTagIdsFromRows(rs);
                    if (tagged.length === 0 || present.size === 0) {
                        details.title = 'Tags — None';
                        details.classList.remove('is-filtered-partial');
                        return;
                    }
                    const allCb = wrap.querySelector('#live-unreported-tag-all');
                    const groupCbs = [...wrap.querySelectorAll('.live-unreported-tag-cb[data-tag]')].filter((c) => {
                        const tid = c.getAttribute('data-tag');
                        if (!tid || tid === 'all') return false;
                        const label = c.closest('label');
                        return label && label.style.display !== 'none';
                    });
                    const n = groupCbs.filter((c) => c.checked).length;
                    const total = groupCbs.length;
                    const allMode = allCb && allCb.checked && n === 0;
                    if (allMode) {
                        details.title = 'Tags — all';
                        details.classList.remove('is-filtered-partial');
                    } else if (n === 0) {
                        details.title = 'Tags — none selected (no rows)';
                        details.classList.add('is-filtered-partial');
                    } else {
                        details.title = `Tags — ${n} of ${total}`;
                        details.classList.add('is-filtered-partial');
                    }
                }

                function syncLiveUnreportedTagFilterUI(htmlNode) {
                    const wrap = htmlNode.getElementById('live-unreported-tag-checklist-wrap');
                    const toolbar = htmlNode.getElementById('live-unreported-toolbar');
                    if (!wrap || !toolbar || toolbar.hidden) return;
                    const rs = liveReportedSolvedRowsForTagUi();
                    const tagged = liveRowsMatchingToolbarTags(rs);
                    const present = visibleLiveIncidentTagIdsFromRows(rs);
                    for (const tid of [...liveUnreportedHiddenReportTags]) {
                        if (!LIVE_INCIDENT_TAG_FILTER_IDS.includes(tid)) liveUnreportedHiddenReportTags.delete(tid);
                    }
                    if (tagged.length === 0 || present.size === 0) {
                        setLiveIncidentTagFilterNoneUi(wrap, true);
                        syncLiveIncidentTagFilterVisibility(wrap, present);
                        liveUnreportedApplyHiddenToTagCheckboxes(wrap, present);
                        liveUnreportedUpdateTagFilterSummary(htmlNode);
                        refreshLiveUnreportedTagFilterCounts(htmlNode);
                        return;
                    }
                    setLiveIncidentTagFilterNoneUi(wrap, false);
                    syncLiveIncidentTagFilterVisibility(wrap, present);
                    liveUnreportedApplyHiddenToTagCheckboxes(wrap, present);
                    liveUnreportedUpdateTagFilterSummary(htmlNode);
                    refreshLiveUnreportedTagFilterCounts(htmlNode);
                }

                function bindLiveUnreportedTagFilterDetailsOutsideClose(htmlNode) {
                    const detailsEl = htmlNode.querySelector('#live-unreported-tag-filter-details');
                    if (!detailsEl) return;
                    bindDetailsOutsidePointerClose(detailsEl, htmlNode, () => refreshLiveUnreportedTagFilterCounts(htmlNode));
                }

                function setupLiveUnreportedTagFilters(htmlNode) {
                    const wrap = htmlNode.getElementById('live-unreported-tag-checklist-wrap');
                    if (!wrap || wrap._liveUnreportedTagFiltersBound) return;
                    wrap._liveUnreportedTagFiltersBound = true;
                    const allCb = wrap.querySelector('#live-unreported-tag-all');
                    const getTagCbs = () =>
                        [...wrap.querySelectorAll('.live-unreported-tag-cb[data-tag]')].filter((c) => c.getAttribute('data-tag') !== 'all');
                    const visibleTagCbs = () =>
                        getTagCbs().filter((cb) => {
                            const label = cb.closest('label');
                            return label && label.style.display !== 'none';
                        });
                    const onChange = () => {
                        liveUnreportedUpdateTagFilterSummary(htmlNode);
                        renderUnreportedLiveCards(htmlNode, liveUnreportedRowsCache, liveReportedRowsCache, liveSolvedRowsCache);
                    };
                    if (allCb) {
                        allCb.addEventListener('change', () => {
                            if (liveUnreportedTagFilterSuppressChange) return;
                            if (allCb.checked) {
                                liveUnreportedTagFilterSuppressChange = true;
                                try {
                                    getTagCbs().forEach((c) => {
                                        c.checked = false;
                                    });
                                    liveUnreportedHiddenReportTags.clear();
                                    liveUnreportedTagAllMode = true;
                                } finally {
                                    liveUnreportedTagFilterSuppressChange = false;
                                }
                            } else {
                                const vg = visibleTagCbs();
                                const n = vg.filter((c) => c.checked).length;
                                if (n === 0) {
                                    liveUnreportedTagFilterSuppressChange = true;
                                    try {
                                        allCb.checked = true;
                                        liveUnreportedHiddenReportTags.clear();
                                        liveUnreportedTagAllMode = true;
                                    } finally {
                                        liveUnreportedTagFilterSuppressChange = false;
                                    }
                                }
                            }
                            allCb.indeterminate = false;
                            onChange();
                        });
                    }
                    getTagCbs().forEach((cb) => {
                        cb.addEventListener('change', () => {
                            if (liveUnreportedTagFilterSuppressChange) return;
                            const vg = visibleTagCbs();
                            const n = vg.filter((c) => c.checked).length;
                            liveUnreportedTagFilterSuppressChange = true;
                            try {
                                if (n === vg.length && vg.length > 1) {
                                    if (allCb) allCb.checked = true;
                                    vg.forEach((c) => {
                                        c.checked = false;
                                    });
                                    liveUnreportedHiddenReportTags.clear();
                                    liveUnreportedTagAllMode = true;
                                } else if (n === vg.length && vg.length === 1) {
                                    if (allCb) allCb.checked = false;
                                    liveUnreportedHiddenReportTags.clear();
                                    const onlyTid = vg[0].getAttribute('data-tag');
                                    LIVE_INCIDENT_TAG_FILTER_IDS.forEach((id) => {
                                        if (id !== onlyTid) liveUnreportedHiddenReportTags.add(id);
                                    });
                                    liveUnreportedTagAllMode = false;
                                } else if (n === 0) {
                                    if (allCb) allCb.checked = true;
                                    vg.forEach((c) => {
                                        c.checked = false;
                                    });
                                    liveUnreportedHiddenReportTags.clear();
                                    liveUnreportedTagAllMode = true;
                                } else {
                                    if (allCb) allCb.checked = false;
                                    liveUnreportedHiddenReportTags.clear();
                                    vg.forEach((c) => {
                                        const tid = c.getAttribute('data-tag');
                                        if (tid && !c.checked) liveUnreportedHiddenReportTags.add(tid);
                                    });
                                    liveUnreportedTagAllMode = false;
                                }
                                if (allCb) allCb.indeterminate = false;
                            } finally {
                                liveUnreportedTagFilterSuppressChange = false;
                            }
                            onChange();
                        });
                    });
                    liveUnreportedUpdateTagFilterSummary(htmlNode);
                    bindLiveUnreportedTagFilterDetailsOutsideClose(htmlNode);
                }

                function setupLiveCrmTicketSearch(htmlNode) {
                    const input = htmlNode.getElementById('live-crm-ticket-search-input');
                    if (!input || input._liveCrmTicketSearchBound) return;
                    input._liveCrmTicketSearchBound = true;
                    const apply = () => {
                        const next = sanitizeLiveCrmTicketFieldValue(input.value);
                        if (next !== input.value) input.value = next;
                        liveCrmTicketSearchValue = input.value;
                        if (currentDashboardPage === 'live' && currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE) {
                            renderUnreportedLiveCards(htmlNode, liveUnreportedRowsCache, liveReportedRowsCache, liveSolvedRowsCache);
                        }
                    };
                    input.addEventListener('input', apply);
                    input.addEventListener('keydown', (ev) => {
                        if (ev.key !== 'Escape') return;
                        input.value = '';
                        liveCrmTicketSearchValue = '';
                        apply();
                    });
                }

                function visibleDeviceGroupIdsFromRows(rows) {
                    const out = new Set();
                    const list = Array.isArray(rows) ? rows : [];
                    list.forEach((row) => {
                        if (!row) return;
                        const gid = deviceGroupIdForType(incidentRowDeviceType(row));
                        if (gid) out.add(gid);
                    });
                    return out;
                }

                function syncDeviceFilterVisibility(wrap, checkboxClass, allId, visibleGroupIds) {
                    if (!wrap) return;
                    const allCb = wrap.querySelector(`#${allId}`);
                    const groupCbs = [...wrap.querySelectorAll(`.${checkboxClass}`)];
                    const visibleCbs = [];
                    groupCbs.forEach((cb) => {
                        const gid = cb.getAttribute('data-group') || '';
                        if (gid === 'all') return;
                        const label = cb.closest('label');
                        const isVisible = visibleGroupIds.has(gid);
                        if (label) label.style.display = isVisible ? '' : 'none';
                        if (!isVisible) cb.checked = false;
                        if (isVisible) visibleCbs.push(cb);
                    });
                    if (allCb) {
                        if (!visibleCbs.some((c) => c.checked)) {
                            allCb.checked = true;
                        } else {
                            allCb.checked = false;
                        }
                        allCb.indeterminate = false;
                    }
                }

                function unreportedAllDeviceTypesSet() {
                    const s = new Set();
                    UNREPORTED_DEVICE_GROUP_IDS.forEach((id) => {
                        (UNREPORTED_DEVICE_GROUP_TYPES[id] || []).forEach((t) => s.add(t));
                    });
                    return s;
                }

                function unreportedStoreNumberKey(storeCode) {
                    const digits = String(storeCode || '').replace(/\D/g, '');
                    if (digits) return parseInt(digits, 10);
                    return 0;
                }

                function unreportedEffectiveDurationMinutes(row) {
                    const hasDur = row?.duration_minutes !== null && row?.duration_minutes !== undefined;
                    if (hasDur) return Math.max(0, Number(row.duration_minutes) || 0);
                    if (row?.incident_status === 'open' && row?.offline_started_at) {
                        const live = minutesSince(row.offline_started_at);
                        return live !== null ? live : 0;
                    }
                    return 0;
                }

                function unreportedMinDowntimeThresholdMinutes(row) {
                    const normalizedType = normalizeDeviceTypeKey(incidentRowDeviceType(row));
                    return normalizedType === 'price-checkers'
                        ? LIVE_UNREPORTED_MIN_DOWNTIME_MINUTES_PRICE_CHECKER
                        : LIVE_UNREPORTED_MIN_DOWNTIME_MINUTES_DEFAULT;
                }

                function unreportedPassesMinDowntimeThreshold(row) {
                    return unreportedEffectiveDurationMinutes(row) >= unreportedMinDowntimeThresholdMinutes(row);
                }

                function unreportedPanelRoot(root) {
                    return root && root.querySelector ? root : (typeof document !== 'undefined' ? document : null);
                }

                function unreportedGetAllowedDeviceTypes(root) {
                    const panel = unreportedPanelRoot(root);
                    const wrap = panel ? panel.querySelector('#reporting-unreported-filters') : null;
                    const types = new Set();
                    if (!wrap) return types;
                    const allCb = wrap.querySelector('#unreported-dev-all');
                    const groupCbs = UNREPORTED_DEVICE_GROUP_IDS.map((id) => wrap.querySelector(`.unreported-dev-cb[data-group="${id}"]`)).filter(Boolean);
                    const anyGroupChecked = groupCbs.some((c) => c.checked);
                    /* All = full set only when All is on and no per-category boxes are checked */
                    if (allCb && allCb.checked && !anyGroupChecked) {
                        return unreportedAllDeviceTypesSet();
                    }
                    UNREPORTED_DEVICE_GROUP_IDS.forEach((id) => {
                        const cb = wrap.querySelector(`.unreported-dev-cb[data-group="${id}"]`);
                        if (cb && cb.checked) {
                            (UNREPORTED_DEVICE_GROUP_TYPES[id] || []).forEach((t) => types.add(t));
                        }
                    });
                    return types;
                }

                function unreportedFilterByDevice(rows, allowedTypes) {
                    if (!allowedTypes || allowedTypes.size === 0) return [];
                    // Rows can carry raw Prometheus labels (e.g. "PriceChecker"); the
                    // allowedTypes set holds canonical IDs (e.g. "price-checkers"), so
                    // normalize before comparison or matches silently miss.
                    return rows.filter((r) => {
                        const raw = String(r && r.device_type || '');
                        if (allowedTypes.has(raw)) return true;
                        const norm = normalizeDeviceTypeKey(raw);
                        return norm ? allowedTypes.has(norm) : false;
                    });
                }

                function unreportedFilterByStatus(rows, status) {
                    if (status === 'active') return rows.filter((r) => r.incident_status === 'open');
                    if (status === 'solved') return rows.filter((r) => r.incident_status === 'closed');
                    return rows.slice();
                }

                function unreportedSortRows(rows, state) {
                    const out = rows.slice();
                    const cmps = [];
                    if (state.storeOrder === 'asc' || state.storeOrder === 'desc') {
                        const dir = state.storeOrder;
                        cmps.push((a, b) => {
                            const na = unreportedStoreNumberKey(a.store_code);
                            const nb = unreportedStoreNumberKey(b.store_code);
                            if (na !== nb) return dir === 'asc' ? na - nb : nb - na;
                            const sa = String(a.store_code || '').toUpperCase();
                            const sb = String(b.store_code || '').toUpperCase();
                            const c = sa.localeCompare(sb);
                            return dir === 'asc' ? c : -c;
                        });
                    }
                    if (state.offStartOrder === 'asc' || state.offStartOrder === 'desc') {
                        const dir = state.offStartOrder;
                        cmps.push((a, b) => {
                            const va = toEpochMs(a.offline_started_at) ?? 0;
                            const vb = toEpochMs(b.offline_started_at) ?? 0;
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.offEndOrder === 'asc' || state.offEndOrder === 'desc') {
                        const dir = state.offEndOrder;
                        const nullSent = dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
                        cmps.push((a, b) => {
                            const va = toEpochMs(a.offline_ended_at) ?? nullSent;
                            const vb = toEpochMs(b.offline_ended_at) ?? nullSent;
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.durationOrder === 'asc' || state.durationOrder === 'desc') {
                        const dir = state.durationOrder;
                        cmps.push((a, b) => {
                            const da = unreportedEffectiveDurationMinutes(a);
                            const db = unreportedEffectiveDurationMinutes(b);
                            return dir === 'asc' ? da - db : db - da;
                        });
                    }
                    if (!cmps.length) return out;
                    out.sort((a, b) => {
                        for (let i = 0; i < cmps.length; i++) {
                            const d = cmps[i](a, b);
                            if (d !== 0) return d;
                        }
                        return 0;
                    });
                    return out;
                }

                function unreportedReadFilterState(root) {
                    const panel = unreportedPanelRoot(root);
                    const wrap = panel ? panel.querySelector('#reporting-unreported-filters') : null;
                    const val = (id) => (wrap && wrap.querySelector(`#${id}`) ? wrap.querySelector(`#${id}`).value : '');
                    return {
                        storeOrder: val('unreported-filter-store-order') || '',
                        status: val('unreported-filter-status') || 'all',
                        offStartOrder: val('unreported-filter-offstart-order') || '',
                        offEndOrder: val('unreported-filter-offend-order') || '',
                        durationOrder: val('unreported-filter-duration-order') || ''
                    };
                }

                function unreportedApplyFiltersAndSort(baseRows, root) {
                    const state = unreportedReadFilterState(root);
                    const allowed = unreportedGetAllowedDeviceTypes(root);
                    let rows = (Array.isArray(baseRows) ? baseRows : []).filter((r) => unreportedPassesMinDowntimeThreshold(r));
                    rows = rows.filter((r) => !unreportedRowStaleOpenWhilePriceCheckerLiveUp(r));
                    rows = unreportedFilterByDevice(rows, allowed);
                    rows = unreportedFilterByStatus(rows, state.status);
                    return unreportedSortRows(rows, state);
                }

                function renderUnreportedIncidentsTable(htmlNode, rows) {
                    const tbody = htmlNode.getElementById('reporting-unreported-body');

                    renderSimpleTableRows(tbody, rows, [
                        (r) => escapeHtml(r.store_code || '-'),
                        (r) => escapeHtml(formatDeviceLabel(r.device_name, r.device_type, r.source_alert)),
                        (r) => escapeHtml(formatIncidentStatus(r.incident_status)),
                        (r) => escapeHtml(formatIsoDateTime(r.offline_started_at)),
                        (r) => escapeHtml(formatIsoDateTime(r.offline_ended_at)),
                        (r) => escapeHtml(formatIncidentDuration(r))
                    ]);
                }

                function refreshUnreportedIncidentsFromFilters(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    const base = rv && rv._unreportedRowsBase;
                    if (!base) return;
                    const wrap = panel ? panel.querySelector('#reporting-unreported-filters') : null;
                    const visibleGroups = visibleDeviceGroupIdsFromRows(base);
                    syncDeviceFilterVisibility(wrap, 'unreported-dev-cb', 'unreported-dev-all', visibleGroups);
                    const rows = unreportedApplyFiltersAndSort(base, htmlNode);
                    renderUnreportedIncidentsTable(htmlNode, rows);
                    refreshReportingDeviceFilterCounts(htmlNode);
                }

                function unreportedUpdateDeviceFilterSummary(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const wrap = panel ? panel.querySelector('#reporting-unreported-filters') : null;
                    const details = panel ? panel.querySelector('#unreported-device-filter-details') : null;
                    const summary = panel ? panel.querySelector('#unreported-device-filter-summary') : null;
                    if (!wrap || !details || !summary) return;
                    const allCb = wrap.querySelector('#unreported-dev-all');
                    const groupCbs = UNREPORTED_DEVICE_GROUP_IDS.map((id) => wrap.querySelector(`.unreported-dev-cb[data-group="${id}"]`)).filter(Boolean);
                    const n = groupCbs.filter((c) => c.checked).length;
                    const total = groupCbs.length;
                    ensureFilterSummaryIcon(summary);
                    const allMode = allCb && allCb.checked && n === 0;
                    if (allMode) {
                        details.title = 'Devices — all categories';
                        details.classList.remove('is-filtered-partial');
                    } else if (n === 0) {
                        details.title = 'Devices — none selected (no rows)';
                        details.classList.add('is-filtered-partial');
                    } else {
                        details.title = `Devices — ${n} of ${total} categories`;
                        details.classList.add('is-filtered-partial');
                    }
                }

                function reportingCycleSortThreeState(current) {
                    if (!current) return 'asc';
                    if (current === 'asc') return 'desc';
                    return '';
                }

                function reportingSortSymbol(state) {
                    if (state === 'asc') return '\u2191';
                    if (state === 'desc') return '\u2193';
                    return '-';
                }

                function reportingCycleStatusThreeState(current) {
                    if (current === 'all' || !current) return 'active';
                    if (current === 'active') return 'solved';
                    return 'all';
                }

                function reportingStatusSymbol(state) {
                    if (state === 'active') return 'Active';
                    if (state === 'solved') return 'Online';
                    return '-';
                }

                function reportingCycleReportedIssueKind(current) {
                    if (current === 'all' || !current) return 'internet';
                    if (current === 'internet') return 'non_internet';
                    return 'all';
                }

                function reportingReportedIssueKindSymbol(state) {
                    if (state === 'internet') return 'Internet';
                    if (state === 'non_internet') return 'Non Internet';
                    return '-';
                }

                function reportedFilterByIssueKind(rows, kind) {
                    if (kind === 'internet') return rows.filter((r) => !isManualReportedRow(r));
                    if (kind === 'non_internet') return rows.filter((r) => isManualReportedRow(r));
                    return rows.slice();
                }

                function dispatchRefreshForReportingFilterRow(filterRowEl, htmlNode) {
                    if (!filterRowEl || !htmlNode) return;
                    const id = filterRowEl.id;
                    if (id === 'reporting-unreported-filters') {
                        refreshUnreportedIncidentsFromFilters(htmlNode);
                        unreportedUpdateDeviceFilterSummary(htmlNode);
                    } else if (id === 'reporting-reported-filters') {
                        refreshReportedTicketsFromFilters(htmlNode);
                        reportedUpdateDeviceFilterSummary(htmlNode);
                        reportedUpdateOwnerFilterSummary(htmlNode);
                    } else if (id === 'reporting-top-stores-filters') {
                        refreshTopStoresFromFilters(htmlNode);
                    } else if (id === 'reporting-top-device-categories-filters') {
                        refreshTopDeviceCategoriesFromFilters(htmlNode);
                    } else if (id === 'reporting-owner-workload-filters') {
                        refreshOwnerWorkloadFromFilters(htmlNode);
                    }
                }

                function syncAllReportingSortButtons(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    if (!rv) return;
                    rv.querySelectorAll('.analytics-th-sort-btn[data-sort-input]').forEach((btn) => {
                        const id = btn.getAttribute('data-sort-input');
                        if (!id) return;
                        const input = rv.querySelector(`#${id}`);
                        if (!input) return;
                        const sym = btn.querySelector('.analytics-th-sort-symbol');
                        if (sym) sym.textContent = reportingSortSymbol(input.value);
                    });
                    rv.querySelectorAll('.analytics-th-sort-btn[data-status-input]').forEach((btn) => {
                        const id = btn.getAttribute('data-status-input');
                        if (!id) return;
                        const input = rv.querySelector(`#${id}`);
                        const v = (input && input.value) || 'all';
                        const sym = btn.querySelector('.analytics-th-sort-symbol');
                        if (sym) {
                            sym.textContent =
                                id === 'reported-filter-issue-kind'
                                    ? reportingReportedIssueKindSymbol(v)
                                    : reportingStatusSymbol(v);
                        }
                    });
                }

                function setupReportingSortButtonsDelegation(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    if (!rv || rv._reportingSortBtnsBound) return;
                    rv._reportingSortBtnsBound = true;
                    rv.addEventListener('click', (e) => {
                        const sortBtn = e.target.closest('.analytics-th-sort-btn[data-sort-input]');
                        const statusBtn = e.target.closest('.analytics-th-sort-btn[data-status-input]');
                        if (!sortBtn && !statusBtn) return;
                        const btn = sortBtn || statusBtn;
                        if (!rv.contains(btn)) return;
                        e.preventDefault();
                        const filterRow = btn.closest('tr[id^="reporting-"], [role="row"][id^="reporting-"]');
                        if (sortBtn) {
                            const id = sortBtn.getAttribute('data-sort-input');
                            const input = id ? rv.querySelector(`#${id}`) : null;
                            if (!input) return;
                            const next = reportingCycleSortThreeState(input.value);
                            input.value = next;
                            const sym = sortBtn.querySelector('.analytics-th-sort-symbol');
                            if (sym) sym.textContent = reportingSortSymbol(next);
                            dispatchRefreshForReportingFilterRow(filterRow, htmlNode);
                            return;
                        }
                        if (statusBtn) {
                            const id = statusBtn.getAttribute('data-status-input');
                            const input = id ? rv.querySelector(`#${id}`) : null;
                            const cur = (input && input.value) || 'all';
                            const next =
                                id === 'reported-filter-issue-kind'
                                    ? reportingCycleReportedIssueKind(cur)
                                    : reportingCycleStatusThreeState(cur);
                            if (input) input.value = next;
                            const sym = statusBtn.querySelector('.analytics-th-sort-symbol');
                            if (sym) {
                                sym.textContent =
                                    id === 'reported-filter-issue-kind'
                                        ? reportingReportedIssueKindSymbol(next)
                                        : reportingStatusSymbol(next);
                            }
                            dispatchRefreshForReportingFilterRow(filterRow, htmlNode);
                        }
                    });
                }

                function setupUnreportedIncidentFilters(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    const wrap = panel ? panel.querySelector('#reporting-unreported-filters') : null;
                    if (!rv || !wrap || rv._unreportedFiltersBound) return;
                    rv._unreportedFiltersBound = true;

                    const onChange = () => {
                        refreshUnreportedIncidentsFromFilters(htmlNode);
                        unreportedUpdateDeviceFilterSummary(htmlNode);
                    };

                    const allCb = wrap.querySelector('#unreported-dev-all');
                    const groupCbs = UNREPORTED_DEVICE_GROUP_IDS.map((id) => wrap.querySelector(`.unreported-dev-cb[data-group="${id}"]`)).filter(Boolean);

                    if (allCb) {
                        allCb.addEventListener('change', () => {
                            if (allCb.checked) {
                                groupCbs.forEach((c) => { c.checked = false; });
                            }
                            allCb.indeterminate = false;
                            onChange();
                        });
                    }
                    groupCbs.forEach((cb) => {
                        cb.addEventListener('change', () => {
                            const n = groupCbs.filter((c) => c.checked).length;
                            if (n === groupCbs.length) {
                                allCb.checked = true;
                                groupCbs.forEach((c) => { c.checked = false; });
                            } else {
                                /* Any category pick exits All-only mode: clear All fully (no indeterminate) */
                                allCb.checked = false;
                            }
                            allCb.indeterminate = false;
                            onChange();
                        });
                    });

                    unreportedUpdateDeviceFilterSummary(htmlNode);
                }

                function reportedRowPassesDeviceFilter(row, allowedTypes) {
                    if (!allowedTypes || allowedTypes.size === 0) return false;
                    const dt = String(row && row.device_type || '');
                    if (!dt) return allowedTypes.has('primary-link');
                    if (allowedTypes.has(dt)) return true;
                    // Prometheus may emit raw camelCase labels ("PriceChecker"); the
                    // allowedTypes set carries canonical kebab-case IDs ("price-checkers").
                    const norm = normalizeDeviceTypeKey(dt);
                    return norm ? allowedTypes.has(norm) : false;
                }

                function reportedGetAllowedDeviceTypes(filterTr) {
                    const types = new Set();
                    if (!filterTr) return types;
                    const allCb = filterTr.querySelector('#reported-dev-all');
                    const groupCbs = UNREPORTED_DEVICE_GROUP_IDS.map((id) => filterTr.querySelector(`.reported-dev-cb[data-group="${id}"]`)).filter(Boolean);
                    if (!allCb && !groupCbs.length) return unreportedAllDeviceTypesSet();
                    const anyGroupChecked = groupCbs.some((c) => c.checked);
                    if (allCb && allCb.checked && !anyGroupChecked) {
                        return unreportedAllDeviceTypesSet();
                    }
                    UNREPORTED_DEVICE_GROUP_IDS.forEach((id) => {
                        const cb = filterTr.querySelector(`.reported-dev-cb[data-group="${id}"]`);
                        if (cb && cb.checked) {
                            (UNREPORTED_DEVICE_GROUP_TYPES[id] || []).forEach((t) => types.add(t));
                        }
                    });
                    return types;
                }

                function reportedSortKeyStoreDevice(r) {
                    const store = r.store_code || '';
                    const device = formatDeviceLabel(r.device_name, r.device_type, r.source_alert);
                    return `${store} / ${device}`.toUpperCase();
                }

                // ---- Owner / report-tag normalizers moved to modules/device-format.js ----
                //   isUnknownOwner, normalizeOwnerUsername, capitalizeOwnerLabel,
                //   ownerDisplayName, normalizeReportTag, reportTagLabel,
                //   isInternetIssueType, allowedTagsForDevice.

                function reportingOwnerKeyReported(r) {
                    return normalizeOwnerUsername(r.owner_name, '-');
                }

                function reportingTagKeyReported(r) {
                    return rowReportTagId(r) || '';
                }

                function reportingOwnerKeyWorkload(r) {
                    return normalizeOwnerUsername(r.owner_name, 'Unassigned');
                }

                function populateReportedOwnerChecklist(htmlNode, rows) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const body = panel && panel.querySelector('#reported-owner-filter-checklist-body');
                    if (!body) return;
                    const list = Array.isArray(rows) ? rows : [];
                    const keys = [...new Set(list.map(reportingOwnerKeyReported))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                    const parts = [
                        `<label class="unreported-cb-label"><input type="checkbox" id="reported-owner-all" checked /> All <span class="filter-checklist-count" aria-hidden="true">(${list.length})</span></label>`
                    ];
                    keys.forEach((k) => {
                        const enc = encodeURIComponent(k);
                        const n = list.filter((r) => reportingOwnerKeyReported(r) === k).length;
                        parts.push(
                            `<label class="unreported-cb-label"><input type="checkbox" class="reported-owner-user-cb" data-owner="${enc}" /> ${escapeHtml(ownerDisplayName(k, '-'))} <span class="filter-checklist-count" aria-hidden="true">(${n})</span></label>`
                        );
                    });
                    body.innerHTML = parts.join('');
                }

                function populateReportedTagChecklist(htmlNode, rows) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const body = panel && panel.querySelector('#reported-tag-filter-checklist-body');
                    if (!body) return;
                    const list = Array.isArray(rows) ? rows : [];
                    const keys = [...new Set(list.map(reportingTagKeyReported))].sort((a, b) => {
                        if (a === '' && b !== '') return 1;
                        if (b === '' && a !== '') return -1;
                        return a.localeCompare(b, undefined, { sensitivity: 'base' });
                    });
                    const parts = [
                        `<label class="unreported-cb-label"><input type="checkbox" id="reported-tag-all" checked /> All <span class="filter-checklist-count" aria-hidden="true">(${list.length})</span></label>`
                    ];
                    keys.forEach((k) => {
                        const enc = encodeURIComponent(k);
                        const n = list.filter((r) => reportingTagKeyReported(r) === k).length;
                        const labelText = k ? reportTagLabel(k, k) : '—';
                        parts.push(
                            `<label class="unreported-cb-label"><input type="checkbox" class="reported-tag-cb" data-tag="${enc}" /> ${escapeHtml(labelText)} <span class="filter-checklist-count" aria-hidden="true">(${n})</span></label>`
                        );
                    });
                    body.innerHTML = parts.join('');
                }

                function populateOwnerWorkloadOwnerChecklist(htmlNode, rows) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const body = panel && panel.querySelector('#ow-owner-filter-checklist-body');
                    if (!body) return;
                    const list = Array.isArray(rows) ? rows : [];
                    const keys = [...new Set(list.map(reportingOwnerKeyWorkload))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                    const parts = [
                        `<label class="unreported-cb-label"><input type="checkbox" id="ow-owner-all" checked /> All <span class="filter-checklist-count" aria-hidden="true">(${list.length})</span></label>`
                    ];
                    keys.forEach((k) => {
                        const enc = encodeURIComponent(k);
                        const n = list.filter((r) => reportingOwnerKeyWorkload(r) === k).length;
                        parts.push(
                            `<label class="unreported-cb-label"><input type="checkbox" class="ow-owner-user-cb" data-owner="${enc}" /> ${escapeHtml(ownerDisplayName(k, 'Unassigned'))} <span class="filter-checklist-count" aria-hidden="true">(${n})</span></label>`
                        );
                    });
                    body.innerHTML = parts.join('');
                }

                function reportedGetSelectedOwnerKeys(filterTr) {
                    if (!filterTr) return null;
                    const allCb = filterTr.querySelector('#reported-owner-all');
                    const userCbs = [...filterTr.querySelectorAll('.reported-owner-user-cb')];
                    if (!userCbs.length) return null;
                    const anyUserChecked = userCbs.some((c) => c.checked);
                    if (allCb && allCb.checked && !anyUserChecked) return null;
                    const set = new Set();
                    userCbs.forEach((c) => {
                        if (!c.checked) return;
                        try {
                            set.add(decodeURIComponent(c.getAttribute('data-owner') || ''));
                        } catch (err) {
                            set.add(String(c.getAttribute('data-owner') || ''));
                        }
                    });
                    return set;
                }

                function reportedGetSelectedTagKeys(filterTr) {
                    if (!filterTr) return null;
                    const allCb = filterTr.querySelector('#reported-tag-all');
                    const tagCbs = [...filterTr.querySelectorAll('.reported-tag-cb')];
                    if (!tagCbs.length) return null;
                    const anyTagChecked = tagCbs.some((c) => c.checked);
                    if (allCb && allCb.checked && !anyTagChecked) return null;
                    const set = new Set();
                    tagCbs.forEach((c) => {
                        if (!c.checked) return;
                        try {
                            set.add(decodeURIComponent(c.getAttribute('data-tag') || ''));
                        } catch (err) {
                            set.add(String(c.getAttribute('data-tag') || ''));
                        }
                    });
                    return set;
                }

                function ownerWorkloadGetSelectedOwnerKeys(wrap) {
                    if (!wrap) return null;
                    const allCb = wrap.querySelector('#ow-owner-all');
                    const userCbs = [...wrap.querySelectorAll('.ow-owner-user-cb')];
                    if (!userCbs.length) return null;
                    const anyUserChecked = userCbs.some((c) => c.checked);
                    if (allCb && allCb.checked && !anyUserChecked) return null;
                    const set = new Set();
                    userCbs.forEach((c) => {
                        if (!c.checked) return;
                        try {
                            set.add(decodeURIComponent(c.getAttribute('data-owner') || ''));
                        } catch (err) {
                            set.add(String(c.getAttribute('data-owner') || ''));
                        }
                    });
                    return set;
                }

                function reportedReadFilterState(root) {
                    const panel = unreportedPanelRoot(root);
                    const wrap = panel ? panel.querySelector('#reporting-reported-filters') : null;
                    const val = (id) => (wrap && wrap.querySelector(`#${id}`) ? wrap.querySelector(`#${id}`).value : '');
                    return {
                        storeOrder: val('reported-filter-store-order') || '',
                        createdOrder: val('reported-filter-created-order') || '',
                        ttrOrder: val('reported-filter-ttr-order') || '',
                        rtrOrder: val('reported-filter-rtr-order') || ''
                    };
                }

                function reportedSortRows(rows, state) {
                    const out = rows.slice();
                    const cmps = [];
                    const nullNum = Number.POSITIVE_INFINITY;
                    if (state.storeOrder === 'asc' || state.storeOrder === 'desc') {
                        const dir = state.storeOrder;
                        cmps.push((a, b) => {
                            const na = unreportedStoreNumberKey(a.store_code);
                            const nb = unreportedStoreNumberKey(b.store_code);
                            if (na !== nb) return dir === 'asc' ? na - nb : nb - na;
                            const ca = reportedSortKeyStoreDevice(a);
                            const cb = reportedSortKeyStoreDevice(b);
                            const c = ca.localeCompare(cb);
                            return dir === 'asc' ? c : -c;
                        });
                    }
                    if (state.createdOrder === 'asc' || state.createdOrder === 'desc') {
                        const dir = state.createdOrder;
                        cmps.push((a, b) => {
                            const va = toEpochMs(a.created_at) ?? 0;
                            const vb = toEpochMs(b.created_at) ?? 0;
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.ttrOrder === 'asc' || state.ttrOrder === 'desc') {
                        const dir = state.ttrOrder;
                        cmps.push((a, b) => {
                            const va = a.time_to_report_minutes != null && a.time_to_report_minutes !== '' ? Number(a.time_to_report_minutes) : nullNum;
                            const vb = b.time_to_report_minutes != null && b.time_to_report_minutes !== '' ? Number(b.time_to_report_minutes) : nullNum;
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.rtrOrder === 'asc' || state.rtrOrder === 'desc') {
                        const dir = state.rtrOrder;
                        cmps.push((a, b) => {
                            const va = a.report_to_resolve_minutes != null && a.report_to_resolve_minutes !== '' ? Number(a.report_to_resolve_minutes) : nullNum;
                            const vb = b.report_to_resolve_minutes != null && b.report_to_resolve_minutes !== '' ? Number(b.report_to_resolve_minutes) : nullNum;
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (!cmps.length) return out;
                    out.sort((a, b) => {
                        for (let i = 0; i < cmps.length; i++) {
                            const d = cmps[i](a, b);
                            if (d !== 0) return d;
                        }
                        return 0;
                    });
                    return out;
                }

                function reportedApplyFiltersAndSort(baseRows, root) {
                    const panel = unreportedPanelRoot(root);
                    const filterTr = panel ? panel.querySelector('#reporting-reported-filters') : null;
                    let rows = Array.isArray(baseRows) ? baseRows.slice() : [];
                    if (filterTr) {
                        const allowed = reportedGetAllowedDeviceTypes(filterTr);
                        rows = rows.filter((r) => reportedRowPassesDeviceFilter(r, allowed));
                        const ownerSel = reportedGetSelectedOwnerKeys(filterTr);
                        if (ownerSel !== null) {
                            if (ownerSel.size === 0) rows = [];
                            else rows = rows.filter((r) => ownerSel.has(reportingOwnerKeyReported(r)));
                        }
                        const tagSel = reportedGetSelectedTagKeys(filterTr);
                        if (tagSel !== null) {
                            if (tagSel.size === 0) rows = [];
                            else rows = rows.filter((r) => tagSel.has(reportingTagKeyReported(r)));
                        }
                        const issueKindEl = filterTr.querySelector('#reported-filter-issue-kind');
                        const issueKind = (issueKindEl && issueKindEl.value) || 'all';
                        rows = reportedFilterByIssueKind(rows, issueKind);
                    }
                    return reportedSortRows(rows, reportedReadFilterState(root));
                }

                function renderReportedTicketsTable(htmlNode, rows) {
                    renderSimpleTableRows(htmlNode.getElementById('reporting-reported-body'), rows, [
                        (r) => {
                            const store = r.store_code || '-';
                            const device = formatDeviceLabel(r.device_name, r.device_type, r.source_alert);
                            return escapeHtml(`${store} / ${device}`);
                        },
                        (r) => escapeHtml(ownerDisplayName(r.owner_name, '-')),
                        (r) => {
                            const tagRaw = normalizeReportTag(r.report_tag);
                            return tagRaw
                                ? `<span class="reported-tag-text">${escapeHtml(reportTagLabel(r.report_tag))}</span>`
                                : '—';
                        },
                        (r) =>
                            escapeHtml(isManualReportedRow(r) ? 'Non Internet' : 'Internet'),
                        (r) => {
                            if (r.ticket_url) {
                                return `<a href="${escapeHtml(r.ticket_url)}" target="_blank" rel="noopener noreferrer">Open Ticket</a>`;
                            }
                            return '-';
                        },
                        (r) => escapeHtml(formatIsoDateTime(r.created_at)),
                        (r) => escapeHtml(formatTimeToReport(r)),
                        (r) => {
                            const reportToResolve = escapeHtml(formatReportToResolve(r));
                            if (!isManualReportedRow(r)) return reportToResolve;
                            return `<span class="reported-rtr-cell"><span class="reported-rtr-value">${reportToResolve}</span><span class="reported-source-tag">Non Internet</span></span>`;
                        }
                    ]);
                }

                function refreshReportedTicketsFromFilters(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    const base = rv && rv._reportedRowsBase;
                    if (!base) return;
                    const wrap = panel ? panel.querySelector('#reporting-reported-filters') : null;
                    const visibleGroups = visibleDeviceGroupIdsFromRows(base);
                    syncDeviceFilterVisibility(wrap, 'reported-dev-cb', 'reported-dev-all', visibleGroups);
                    const rows = reportedApplyFiltersAndSort(base, htmlNode);
                    renderReportedTicketsTable(htmlNode, rows);
                    reportedUpdateOwnerFilterSummary(htmlNode);
                    reportedUpdateTagFilterSummary(htmlNode);
                    refreshReportingDeviceFilterCounts(htmlNode);
                }

                function reportedUpdateOwnerFilterSummary(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const wrap = panel ? panel.querySelector('#reporting-reported-filters') : null;
                    const details = panel ? panel.querySelector('#reported-owner-filter-details') : null;
                    const summary = panel ? panel.querySelector('#reported-owner-filter-summary') : null;
                    if (!wrap || !details || !summary) return;
                    const allCb = wrap.querySelector('#reported-owner-all');
                    const userCbs = [...wrap.querySelectorAll('.reported-owner-user-cb')];
                    const n = userCbs.filter((c) => c.checked).length;
                    ensureFilterSummaryIcon(summary);
                    const allMode = allCb && allCb.checked && n === 0;
                    if (allMode) {
                        details.title = 'Owner — all users in list';
                        details.classList.remove('is-filtered-partial');
                    } else if (n === 0) {
                        details.title = 'Owner — none selected (no rows)';
                        details.classList.add('is-filtered-partial');
                    } else {
                        details.title = `Owner — ${n} user(s) selected`;
                        details.classList.add('is-filtered-partial');
                    }
                }

                function reportedUpdateTagFilterSummary(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const wrap = panel ? panel.querySelector('#reporting-reported-filters') : null;
                    const details = panel ? panel.querySelector('#reported-tag-filter-details') : null;
                    const summary = panel ? panel.querySelector('#reported-tag-filter-summary') : null;
                    if (!wrap || !details || !summary) return;
                    const allCb = wrap.querySelector('#reported-tag-all');
                    const tagCbs = [...wrap.querySelectorAll('.reported-tag-cb')];
                    const n = tagCbs.filter((c) => c.checked).length;
                    ensureFilterSummaryIcon(summary);
                    const allMode = allCb && allCb.checked && n === 0;
                    if (allMode) {
                        details.title = 'Tag — all tags in list';
                        details.classList.remove('is-filtered-partial');
                    } else if (n === 0) {
                        details.title = 'Tag — none selected (no rows)';
                        details.classList.add('is-filtered-partial');
                    } else {
                        details.title = `Tag — ${n} tag(s) selected`;
                        details.classList.add('is-filtered-partial');
                    }
                }

                function reportedUpdateDeviceFilterSummary(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const wrap = panel ? panel.querySelector('#reporting-reported-filters') : null;
                    const details = panel ? panel.querySelector('#reported-device-filter-details') : null;
                    const summary = panel ? panel.querySelector('#reported-device-filter-summary') : null;
                    if (!wrap || !details || !summary) return;
                    const allCb = wrap.querySelector('#reported-dev-all');
                    const groupCbs = UNREPORTED_DEVICE_GROUP_IDS.map((id) => wrap.querySelector(`.reported-dev-cb[data-group="${id}"]`)).filter(Boolean);
                    const n = groupCbs.filter((c) => c.checked).length;
                    const total = groupCbs.length;
                    ensureFilterSummaryIcon(summary);
                    const allMode = allCb && allCb.checked && n === 0;
                    if (allMode) {
                        details.title = 'Devices — all categories';
                        details.classList.remove('is-filtered-partial');
                    } else if (n === 0) {
                        details.title = 'Devices — none selected (no rows)';
                        details.classList.add('is-filtered-partial');
                    } else {
                        details.title = `Devices — ${n} of ${total} categories`;
                        details.classList.add('is-filtered-partial');
                    }
                }

                function setupReportedTicketsFilters(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    const wrap = panel ? panel.querySelector('#reporting-reported-filters') : null;
                    if (!rv || !wrap || rv._reportedFiltersBound) return;
                    rv._reportedFiltersBound = true;

                    const onChange = () => {
                        refreshReportedTicketsFromFilters(htmlNode);
                        reportedUpdateDeviceFilterSummary(htmlNode);
                    };

                    if (!wrap._reportedOwnerFilterDelegation) {
                        wrap._reportedOwnerFilterDelegation = true;
                        wrap.addEventListener('change', (e) => {
                            const t = e.target;
                            if (t.id !== 'reported-owner-all' && !t.classList.contains('reported-owner-user-cb')) return;
                            const allCb = wrap.querySelector('#reported-owner-all');
                            const userCbs = [...wrap.querySelectorAll('.reported-owner-user-cb')];
                            if (t.id === 'reported-owner-all') {
                                if (allCb && allCb.checked) userCbs.forEach((c) => { c.checked = false; });
                                if (allCb) allCb.indeterminate = false;
                            } else {
                                const n = userCbs.filter((c) => c.checked).length;
                                if (allCb && userCbs.length > 0 && n === userCbs.length) {
                                    allCb.checked = true;
                                    userCbs.forEach((c) => { c.checked = false; });
                                } else if (allCb) {
                                    allCb.checked = false;
                                }
                                if (allCb) allCb.indeterminate = false;
                            }
                            onChange();
                        });
                    }

                    if (!wrap._reportedTagFilterDelegation) {
                        wrap._reportedTagFilterDelegation = true;
                        wrap.addEventListener('change', (e) => {
                            const t = e.target;
                            if (t.id !== 'reported-tag-all' && !t.classList.contains('reported-tag-cb')) return;
                            const allCb = wrap.querySelector('#reported-tag-all');
                            const tagCbs = [...wrap.querySelectorAll('.reported-tag-cb')];
                            if (t.id === 'reported-tag-all') {
                                if (allCb && allCb.checked) tagCbs.forEach((c) => { c.checked = false; });
                                if (allCb) allCb.indeterminate = false;
                            } else {
                                const n = tagCbs.filter((c) => c.checked).length;
                                if (allCb && tagCbs.length > 0 && n === tagCbs.length) {
                                    allCb.checked = true;
                                    tagCbs.forEach((c) => { c.checked = false; });
                                } else if (allCb) {
                                    allCb.checked = false;
                                }
                                if (allCb) allCb.indeterminate = false;
                            }
                            onChange();
                        });
                    }

                    const allCb = wrap.querySelector('#reported-dev-all');
                    const groupCbs = UNREPORTED_DEVICE_GROUP_IDS.map((id) => wrap.querySelector(`.reported-dev-cb[data-group="${id}"]`)).filter(Boolean);

                    if (allCb) {
                        allCb.addEventListener('change', () => {
                            if (allCb.checked) {
                                groupCbs.forEach((c) => { c.checked = false; });
                            }
                            allCb.indeterminate = false;
                            onChange();
                        });
                    }
                    groupCbs.forEach((cb) => {
                        cb.addEventListener('change', () => {
                            const n = groupCbs.filter((c) => c.checked).length;
                            if (allCb && n === groupCbs.length) {
                                allCb.checked = true;
                                groupCbs.forEach((c) => { c.checked = false; });
                            } else if (allCb) {
                                allCb.checked = false;
                            }
                            if (allCb) allCb.indeterminate = false;
                            onChange();
                        });
                    });

                    reportedUpdateDeviceFilterSummary(htmlNode);
                }

                function topStoresReadFilterState(root) {
                    const panel = unreportedPanelRoot(root);
                    const wrap = panel ? panel.querySelector('#reporting-top-stores-filters') : null;
                    const val = (id) => (wrap && wrap.querySelector(`#${id}`) ? wrap.querySelector(`#${id}`).value : '');
                    return {
                        storeOrder: val('ts-filter-store-order') || '',
                        incidentsOrder: val('ts-filter-incidents-order') || '',
                        downtimeOrder: val('ts-filter-downtime-order') || '',
                        mttrOrder: val('ts-filter-mttr-order') || '',
                        ttrAvgOrder: val('ts-filter-ttr-avg-order') || '',
                        rtrAvgOrder: val('ts-filter-rtr-avg-order') || ''
                    };
                }

                function topStoresSortRows(rows, state) {
                    const out = rows.slice();
                    const cmps = [];
                    const nullAvg = Number.POSITIVE_INFINITY;
                    const numAvg = (r, key) => {
                        const v = r[key];
                        if (v === null || v === undefined || v === '') return nullAvg;
                        return Number(v);
                    };
                    if (state.storeOrder === 'asc' || state.storeOrder === 'desc') {
                        const dir = state.storeOrder;
                        cmps.push((a, b) => {
                            const na = unreportedStoreNumberKey(a.store_code);
                            const nb = unreportedStoreNumberKey(b.store_code);
                            if (na !== nb) return dir === 'asc' ? na - nb : nb - na;
                            const sa = String(a.store_code || '').toUpperCase();
                            const sb = String(b.store_code || '').toUpperCase();
                            const c = sa.localeCompare(sb);
                            return dir === 'asc' ? c : -c;
                        });
                    }
                    if (state.incidentsOrder === 'asc' || state.incidentsOrder === 'desc') {
                        const dir = state.incidentsOrder;
                        cmps.push((a, b) => {
                            const va = Number(a.incidents ?? 0);
                            const vb = Number(b.incidents ?? 0);
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.downtimeOrder === 'asc' || state.downtimeOrder === 'desc') {
                        const dir = state.downtimeOrder;
                        cmps.push((a, b) => {
                            const va = Number(a.downtime_minutes ?? 0);
                            const vb = Number(b.downtime_minutes ?? 0);
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.mttrOrder === 'asc' || state.mttrOrder === 'desc') {
                        const dir = state.mttrOrder;
                        cmps.push((a, b) => {
                            const va = Number(a.mttr_minutes ?? 0);
                            const vb = Number(b.mttr_minutes ?? 0);
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.ttrAvgOrder === 'asc' || state.ttrAvgOrder === 'desc') {
                        const dir = state.ttrAvgOrder;
                        cmps.push((a, b) => {
                            const va = numAvg(a, 'time_to_report_avg_minutes');
                            const vb = numAvg(b, 'time_to_report_avg_minutes');
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.rtrAvgOrder === 'asc' || state.rtrAvgOrder === 'desc') {
                        const dir = state.rtrAvgOrder;
                        cmps.push((a, b) => {
                            const va = numAvg(a, 'report_to_resolve_avg_minutes');
                            const vb = numAvg(b, 'report_to_resolve_avg_minutes');
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (!cmps.length) return out;
                    out.sort((a, b) => {
                        for (let i = 0; i < cmps.length; i++) {
                            const d = cmps[i](a, b);
                            if (d !== 0) return d;
                        }
                        return 0;
                    });
                    return out;
                }

                function refreshTopStoresFromFilters(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    const base = rv && rv._topStoresRowsBase;
                    if (!base) return;
                    // Overlay per-store counts from the KPI source so the
                    // store totals close back to the INCIDENTS KPI value.
                    // Stores whose recomputed count is 0 hold only sub-
                    // threshold / hidden-by-UI rows and are dropped here.
                    const recomputedCounts = rebuildTopStoreCountsFromKpiSource(rv);
                    let overlaid;
                    if (recomputedCounts) {
                        overlaid = [];
                        for (let i = 0; i < base.length; i++) {
                            const row = base[i];
                            const store = String((row && row.store_code) || '').trim().toUpperCase();
                            const n = store ? (recomputedCounts[store] || 0) : 0;
                            if (n <= 0) continue;
                            overlaid.push({ ...row, incidents: n });
                        }
                    } else {
                        overlaid = base.slice();
                    }
                    const rows = topStoresSortRows(overlaid, topStoresReadFilterState(htmlNode));
                    renderSimpleTableRows(htmlNode.getElementById('reporting-top-stores-body'), rows, [
                        (r) => escapeHtml(r.store_code || '-'),
                        (r) => escapeHtml(String(r.incidents ?? 0)),
                        (r) => escapeHtml(formatTime(Number(r.downtime_minutes || 0))),
                        (r) => escapeHtml(formatTime(Number(r.mttr_minutes || 0))),
                        (r) => (r.time_to_report_avg_minutes === null || r.time_to_report_avg_minutes === undefined)
                            ? 'N/A'
                            : escapeHtml(formatTime(Math.round(Number(r.time_to_report_avg_minutes)))),
                        (r) => (r.report_to_resolve_avg_minutes === null || r.report_to_resolve_avg_minutes === undefined)
                            ? 'N/A'
                            : escapeHtml(formatTime(Math.round(Number(r.report_to_resolve_avg_minutes))))
                    ]);
                }

                const TOP_DEVICE_CATEGORY_ORDER = [
                    'Primary',
                    'Backup',
                    'Price Checkers',
                    'Music',
                    'Cash Registers',
                    'Switches'
                ];

                function topDeviceCategoriesReadFilterState(root) {
                    const panel = unreportedPanelRoot(root);
                    const wrap = panel ? panel.querySelector('#reporting-top-device-categories-filters') : null;
                    const val = (id) => (wrap && wrap.querySelector(`#${id}`) ? wrap.querySelector(`#${id}`).value : '');
                    return {
                        categoryOrder: val('tdc-filter-category-order') || '',
                        incidentsOrder: val('tdc-filter-incidents-order') || '',
                        downtimeOrder: val('tdc-filter-downtime-order') || '',
                        mttrOrder: val('tdc-filter-mttr-order') || '',
                        ttrAvgOrder: val('tdc-filter-ttr-avg-order') || '',
                        rtrAvgOrder: val('tdc-filter-rtr-avg-order') || ''
                    };
                }

                function topDeviceCategoriesSortRows(rows, state) {
                    const out = rows.slice();
                    const cmps = [];
                    const nullAvg = Number.POSITIVE_INFINITY;
                    const numAvg = (r, key) => {
                        const v = r[key];
                        if (v === null || v === undefined || v === '') return nullAvg;
                        return Number(v);
                    };
                    const catIdx = (r) => {
                        const i = TOP_DEVICE_CATEGORY_ORDER.indexOf(String(r.device_category || ''));
                        return i === -1 ? TOP_DEVICE_CATEGORY_ORDER.length : i;
                    };
                    if (state.categoryOrder === 'asc' || state.categoryOrder === 'desc') {
                        const dir = state.categoryOrder;
                        cmps.push((a, b) => {
                            const ia = catIdx(a);
                            const ib = catIdx(b);
                            if (ia !== ib) return dir === 'asc' ? ia - ib : ib - ia;
                            return String(a.device_category || '').localeCompare(String(b.device_category || ''));
                        });
                    }
                    if (state.incidentsOrder === 'asc' || state.incidentsOrder === 'desc') {
                        const dir = state.incidentsOrder;
                        cmps.push((a, b) => {
                            const va = Number(a.incidents ?? 0);
                            const vb = Number(b.incidents ?? 0);
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.downtimeOrder === 'asc' || state.downtimeOrder === 'desc') {
                        const dir = state.downtimeOrder;
                        cmps.push((a, b) => {
                            const va = Number(a.downtime_minutes ?? 0);
                            const vb = Number(b.downtime_minutes ?? 0);
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.mttrOrder === 'asc' || state.mttrOrder === 'desc') {
                        const dir = state.mttrOrder;
                        cmps.push((a, b) => {
                            const va = Number(a.mttr_minutes ?? 0);
                            const vb = Number(b.mttr_minutes ?? 0);
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.ttrAvgOrder === 'asc' || state.ttrAvgOrder === 'desc') {
                        const dir = state.ttrAvgOrder;
                        cmps.push((a, b) => {
                            const va = numAvg(a, 'time_to_report_avg_minutes');
                            const vb = numAvg(b, 'time_to_report_avg_minutes');
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (state.rtrAvgOrder === 'asc' || state.rtrAvgOrder === 'desc') {
                        const dir = state.rtrAvgOrder;
                        cmps.push((a, b) => {
                            const va = numAvg(a, 'report_to_resolve_avg_minutes');
                            const vb = numAvg(b, 'report_to_resolve_avg_minutes');
                            return dir === 'asc' ? va - vb : vb - va;
                        });
                    }
                    if (!cmps.length) return out;
                    out.sort((a, b) => {
                        for (let i = 0; i < cmps.length; i++) {
                            const d = cmps[i](a, b);
                            if (d !== 0) return d;
                        }
                        return 0;
                    });
                    return out;
                }

                /**
                 * Map a row's `device_type` (raw Prometheus label or canonical
                 * ID) to the same fixed category buckets the backend uses for
                 * the Top Devices table. Mirrors the SQL `case … device_type …`
                 * in `reporting_top_device_categories`. Returns null when the
                 * row doesn't belong to a known category.
                 */
                function topDeviceCategoryForRow(row) {
                    const raw = String(row && row.device_type || '');
                    const norm = (typeof normalizeDeviceTypeKey === 'function'
                        ? normalizeDeviceTypeKey(raw)
                        : raw) || raw;
                    if (norm === 'primary-link') return 'Primary';
                    if (norm === 'backup-link') return 'Backup';
                    if (norm === 'price-checkers') return 'Price Checkers';
                    if (norm === 'music' || norm === 'inside-music' || norm === 'outside-music') return 'Music';
                    if (norm.indexOf('cash-register') === 0) return 'Cash Registers';
                    if (norm === 'switches-primary' || norm === 'switches-secondary') return 'Switches';
                    return null;
                }

                /**
                 * Source rows shared by the INCIDENTS KPI and the Top Devices
                 * / Top Stores client-side recomputes. Mirrors the visible
                 * Live page sections exactly:
                 *
                 *   - `unreported`: cascade-filtered, threshold-filtered,
                 *     stale-while-live-up filtered, AND deduped against the
                 *     reported list via `liveUnreportedSupersedesReportedOrSolved`
                 *     so the same incident can't be counted twice (once as
                 *     unreported and once as reported when an operator opens
                 *     a ticket while the device is still offline).
                 *   - `reported`: raw `/reporting/reported?status=all` rows
                 *     (open + closed ticketed incidents in the window).
                 *
                 * Totals close exactly to the visible Unreported+Reported+Solved
                 * card sections on the Live page.
                 */
                function reportingKpiAlignedRows(reportingRoot) {
                    return reportingKpiAlignedRowsFromArrays(
                        reportingRoot && reportingRoot._unreportedRowsBase,
                        reportingRoot && (reportingRoot._reportedRawAccum || reportingRoot._reportedRowsBase)
                    );
                }

                function reportingKpiAlignedRowsFromArrays(unreportedCascadeFiltered, reportedAll) {
                    const repUbase = Array.isArray(unreportedCascadeFiltered) ? unreportedCascadeFiltered : null;
                    const repR = Array.isArray(reportedAll) ? reportedAll : null;
                    if (!repUbase && !repR) return null;
                    const reported = repR ? repR.slice() : [];
                    const unreportedThresholded = repUbase
                        ? repUbase
                            .filter((r) => unreportedPassesMinDowntimeThreshold(r))
                            .filter((r) => !unreportedRowStaleOpenWhilePriceCheckerLiveUp(r))
                        : [];
                    // Live page hides Unreported rows already represented in
                    // the Reported list (same device + matching ticket / time
                    // window). Mirror that here so KPI + tables agree.
                    const prepared = _ID.livePreparedReportedSolvedSupersessions(reported, []);
                    const unreported = unreportedThresholded.filter(
                        (r) => !_ID.liveUnreportedSupersedesReportedOrSolved(r, prepared, getDeviceTicketLink)
                    );
                    return { unreported, reported };
                }

                /** Composite dedup key: prefer incident_id, fall back to device+ticket. */
                function reportingRecomputeRowDedupKey(row) {
                    if (!row) return null;
                    const id = row.incident_id != null ? row.incident_id : row.id;
                    if (id != null && String(id) !== '') return `id:${id}`;
                    const device = row.device_name ? String(row.device_name).trim().toUpperCase() : '';
                    const ticket = (row.crm_ticket_url || row.ticket_url || '').toString().trim();
                    if (!device && !ticket) return null;
                    return `mn:${device}|${ticket}`;
                }

                function rebuildTopDeviceCategoryCountsFromKpiSource(reportingRoot) {
                    const src = reportingKpiAlignedRows(reportingRoot);
                    if (!src) return null;
                    const counts = {
                        'Primary': 0,
                        'Backup': 0,
                        'Price Checkers': 0,
                        'Music': 0,
                        'Cash Registers': 0,
                        'Switches': 0
                    };
                    const seenKeys = new Set();
                    const tally = (row) => {
                        const key = reportingRecomputeRowDedupKey(row);
                        if (key !== null) {
                            if (seenKeys.has(key)) return;
                            seenKeys.add(key);
                        }
                        const cat = topDeviceCategoryForRow(row);
                        if (!cat || !(cat in counts)) return;
                        counts[cat] += 1;
                    };
                    for (const arr of [src.unreported, src.reported]) {
                        if (!Array.isArray(arr)) continue;
                        for (let i = 0; i < arr.length; i++) tally(arr[i]);
                    }
                    return counts;
                }

                function rebuildTopStoreCountsFromKpiSource(reportingRoot) {
                    const src = reportingKpiAlignedRows(reportingRoot);
                    if (!src) return null;
                    const counts = Object.create(null);
                    const seenKeys = new Set();
                    const tally = (row) => {
                        const key = reportingRecomputeRowDedupKey(row);
                        if (key !== null) {
                            if (seenKeys.has(key)) return;
                            seenKeys.add(key);
                        }
                        const store = String((row && row.store_code) || '').trim().toUpperCase();
                        if (!store) return;
                        counts[store] = (counts[store] || 0) + 1;
                    };
                    for (const arr of [src.unreported, src.reported]) {
                        if (!Array.isArray(arr)) continue;
                        for (let i = 0; i < arr.length; i++) tally(arr[i]);
                    }
                    return counts;
                }

                function refreshTopDeviceCategoriesFromFilters(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    const base = rv && rv._topDeviceCategoriesRowsBase;
                    if (!base) return;
                    // Overlay per-category counts computed from the same source
                    // as the INCIDENTS KPI so totals match: each row counted in
                    // the KPI also shows up here (no matter unreported / reported
                    // / solved). Downtime / MTTR / avg columns keep the raw API
                    // aggregates — they're per-incident sums/averages, unaffected
                    // by how we group them on the client.
                    const recomputedCounts = rebuildTopDeviceCategoryCountsFromKpiSource(rv);
                    const overlaid = recomputedCounts
                        ? base.map((row) => {
                            const cat = row && row.device_category;
                            if (!cat || !(cat in recomputedCounts)) return row;
                            return { ...row, incidents: recomputedCounts[cat] };
                        })
                        : base.slice();
                    const rows = topDeviceCategoriesSortRows(overlaid, topDeviceCategoriesReadFilterState(htmlNode));
                    renderSimpleTableRows(htmlNode.getElementById('reporting-top-device-categories-body'), rows, [
                        (r) => escapeHtml(r.device_category || '-'),
                        (r) => escapeHtml(String(r.incidents ?? 0)),
                        (r) => escapeHtml(formatTime(Number(r.downtime_minutes || 0))),
                        (r) => escapeHtml(formatTime(Number(r.mttr_minutes || 0))),
                        (r) => (r.time_to_report_avg_minutes === null || r.time_to_report_avg_minutes === undefined)
                            ? 'N/A'
                            : escapeHtml(formatTime(Math.round(Number(r.time_to_report_avg_minutes)))),
                        (r) => (r.report_to_resolve_avg_minutes === null || r.report_to_resolve_avg_minutes === undefined)
                            ? 'N/A'
                            : escapeHtml(formatTime(Math.round(Number(r.report_to_resolve_avg_minutes))))
                    ]);
                }

                function setupTopStoresFilters(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    const wrap = panel ? panel.querySelector('#reporting-top-stores-filters') : null;
                    if (!rv || !wrap || rv._topStoresFiltersBound) return;
                    rv._topStoresFiltersBound = true;
                }

                function setupTopDeviceCategoriesFilters(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    const wrap = panel ? panel.querySelector('#reporting-top-device-categories-filters') : null;
                    if (!rv || !wrap || rv._topDeviceCategoriesFiltersBound) return;
                    rv._topDeviceCategoriesFiltersBound = true;
                }

                function ownerWorkloadReadFilterState(root) {
                    const panel = unreportedPanelRoot(root);
                    const wrap = panel ? panel.querySelector('#reporting-owner-workload-filters') : null;
                    const val = (id) => (wrap && wrap.querySelector(`#${id}`) ? wrap.querySelector(`#${id}`).value : '');
                    return {
                        countOrder: val('ow-filter-count-order') || ''
                    };
                }

                function ownerWorkloadSortRows(rows, state) {
                    const out = rows.slice();
                    const cmps = [];
                    if (state.countOrder === 'asc' || state.countOrder === 'desc') {
                        const dir = state.countOrder;
                        cmps.push((a, b) => {
                            const na = Number(a.ticket_count ?? 0);
                            const nb = Number(b.ticket_count ?? 0);
                            return dir === 'asc' ? na - nb : nb - na;
                        });
                    }
                    if (!cmps.length) return out;
                    out.sort((a, b) => {
                        for (let i = 0; i < cmps.length; i++) {
                            const d = cmps[i](a, b);
                            if (d !== 0) return d;
                        }
                        return 0;
                    });
                    return out;
                }

                function refreshOwnerWorkloadFromFilters(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    const base = rv && rv._ownerWorkloadRowsBase;
                    if (!base) return;
                    const wrap = panel ? panel.querySelector('#reporting-owner-workload-filters') : null;
                    let rows = base.slice();
                    if (wrap) {
                        const ownerSel = ownerWorkloadGetSelectedOwnerKeys(wrap);
                        if (ownerSel !== null) {
                            if (ownerSel.size === 0) rows = [];
                            else rows = rows.filter((r) => ownerSel.has(reportingOwnerKeyWorkload(r)));
                        }
                    }
                    rows = ownerWorkloadSortRows(rows, ownerWorkloadReadFilterState(htmlNode));
                    renderOwnerWorkloadGrid(htmlNode.getElementById('reporting-owner-workload-body'), rows);
                    ownerWorkloadUpdateOwnerFilterSummary(htmlNode);
                }

                function ownerWorkloadUpdateOwnerFilterSummary(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const wrap = panel ? panel.querySelector('#reporting-owner-workload-filters') : null;
                    const details = panel ? panel.querySelector('#ow-owner-filter-details') : null;
                    const summary = panel ? panel.querySelector('#ow-owner-filter-summary') : null;
                    if (!wrap || !details || !summary) return;
                    const allCb = wrap.querySelector('#ow-owner-all');
                    const userCbs = [...wrap.querySelectorAll('.ow-owner-user-cb')];
                    const n = userCbs.filter((c) => c.checked).length;
                    ensureFilterSummaryIcon(summary);
                    const allMode = allCb && allCb.checked && n === 0;
                    if (allMode) {
                        details.title = 'Owner — all in list';
                        details.classList.remove('is-filtered-partial');
                    } else if (n === 0) {
                        details.title = 'Owner — none (no rows)';
                        details.classList.add('is-filtered-partial');
                    } else {
                        details.title = `Owner — ${n} selected`;
                        details.classList.add('is-filtered-partial');
                    }
                }

                function setupOwnerWorkloadFilters(htmlNode) {
                    const panel = unreportedPanelRoot(htmlNode);
                    const rv = panel ? panel.querySelector('#incident-reporting-view') : null;
                    const wrap = panel ? panel.querySelector('#reporting-owner-workload-filters') : null;
                    if (!rv || !wrap || rv._ownerWorkloadFiltersBound) return;
                    rv._ownerWorkloadFiltersBound = true;
                    const owOnChange = () => refreshOwnerWorkloadFromFilters(htmlNode);
                    if (!wrap._owOwnerFilterDelegation) {
                        wrap._owOwnerFilterDelegation = true;
                        wrap.addEventListener('change', (e) => {
                            const t = e.target;
                            if (t.id !== 'ow-owner-all' && !t.classList.contains('ow-owner-user-cb')) return;
                            const allCb = wrap.querySelector('#ow-owner-all');
                            const userCbs = [...wrap.querySelectorAll('.ow-owner-user-cb')];
                            if (t.id === 'ow-owner-all') {
                                if (allCb && allCb.checked) userCbs.forEach((c) => { c.checked = false; });
                                if (allCb) allCb.indeterminate = false;
                            } else {
                                const n = userCbs.filter((c) => c.checked).length;
                                if (allCb && userCbs.length > 0 && n === userCbs.length) {
                                    allCb.checked = true;
                                    userCbs.forEach((c) => { c.checked = false; });
                                } else if (allCb) {
                                    allCb.checked = false;
                                }
                                if (allCb) allCb.indeterminate = false;
                            }
                            owOnChange();
                        });
                    }
                }

                function ensureFilterSummaryIcon(summaryEl) {
                    if (!summaryEl) return;
                    if (summaryEl.querySelector('.filter-funnel-icon')) return;
                    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svg.setAttribute('class', 'filter-funnel-icon');
                    svg.setAttribute('viewBox', '0 0 24 24');
                    svg.setAttribute('aria-hidden', 'true');
                    svg.setAttribute('focusable', 'false');
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', 'M2 4h20l-8 10v6l-4 3v-9L2 4z');
                    svg.appendChild(path);
                    summaryEl.appendChild(svg);
                }

                function resolveTicketDeviceName(deviceName, deviceType) {
                    const raw = String(deviceName || '').trim();
                    const storeCode = extractStoreCode(raw);
                    if (!storeCode || !/^AR\d+$/i.test(raw)) return raw;

                    const pickForType = (type) => {
                        const candidates = (dataMap[type] || []).filter((item) => extractStoreCode(item.name) === storeCode);
                        if (!candidates.length) return raw;
                        const offline = candidates.filter((item) => item.status === 'inactive');
                        const pool = offline.length ? offline : candidates;
                        const sorted = pool.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
                        return sorted[0]?.name || raw;
                    };

                    if (deviceType === 'price-checkers') return pickForType('price-checkers');
                    if (deviceType === 'inside-music') return pickForType('inside-music');
                    if (deviceType === 'outside-music') return pickForType('outside-music');
                    if (deviceType === 'cash-register-1') return pickForType('cash-register-1');
                    if (deviceType === 'cash-register-2') return pickForType('cash-register-2');
                    if (deviceType === 'cash-register-3') return pickForType('cash-register-3');
                    return raw;
                }

                function buildNonInternetIssuePayload(storeRaw, deviceChoiceRaw, deviceNumberRaw, cashRegisterSlotRaw) {
                    const storeCode = formatStoreCodeFromInput(storeRaw);
                    const deviceChoice = String(deviceChoiceRaw || '').trim();
                    const deviceNumberRawText = String(deviceNumberRaw || '').trim();
                    const cashRegisterSlot = Number.parseInt(String(cashRegisterSlotRaw || ''), 10);

                    if (!storeCode) {
                        throw new Error('Store number is required');
                    }
                    if (!deviceChoice) {
                        throw new Error('Device is required');
                    }

                    if (deviceChoice === 'cash-register') {
                        if (!Number.isFinite(cashRegisterSlot) || cashRegisterSlot < 1 || cashRegisterSlot > 3) {
                            throw new Error('Cash register number must be between 1 and 3');
                        }
                        const n = Math.floor(cashRegisterSlot);
                        return {
                            storeCode,
                            deviceType: `cash-register-${n}`,
                            deviceName: `${storeCode}-CR${n}`
                        };
                    }

                    if (deviceChoice === 'price-checkers') {
                        const compact = deviceNumberRawText.toUpperCase().replace(/\s+/g, '');
                        const match = /^(?:P)?(\d+)$/.exec(compact);
                        const parsed = match ? Number.parseInt(match[1], 10) : NaN;
                        if (!Number.isFinite(parsed) || parsed < 1) {
                            throw new Error('Device number is required for price checker');
                        }
                        const n = Math.floor(parsed);
                        return {
                            storeCode,
                            deviceType: 'price-checkers',
                            // Keep DB identity aligned with existing monitored naming convention.
                            deviceName: `${storeCode}-PC${n}`
                        };
                    }

                    const map = {
                        'inside-music': { deviceType: 'inside-music', suffix: 'M1' },
                        'outside-music': { deviceType: 'outside-music', suffix: 'M2' }
                    };
                    const cfg = map[deviceChoice];
                    if (!cfg) {
                        throw new Error('Unsupported device type');
                    }

                    return {
                        storeCode,
                        deviceType: cfg.deviceType,
                        deviceName: `${storeCode}-${cfg.suffix}`
                    };
                }

                function isValidTicketUrl(link) {
                    return isValidCrmTicketUrl(link);
                }

                function isValidCrmTicketUrl(link) {
                    const raw = String(link || '').trim();
                    if (!raw) return false;
                    let parsed;
                    try {
                        parsed = new URL(raw);
                    } catch (_error) {
                        return false;
                    }
                    if (parsed.protocol !== 'https:') return false;
                    if (parsed.hostname.toLowerCase() !== 'crm.avroraro.lan') return false;
                    // Require explicit workgroup task route prefix.
                    const path = String(parsed.pathname || '');
                    if (!path.toLowerCase().startsWith('/workgroups/group/')) return false;
                    return true;
                }

                function updateNiiSaveButtonState(htmlNode) {
                    const saveBtn = htmlNode.getElementById('non-internet-issue-save');
                    if (!saveBtn) return;
                    const storeInput = htmlNode.getElementById('nii-store-input');
                    const deviceSelect = htmlNode.getElementById('nii-device-select');
                    const numberInput = htmlNode.getElementById('nii-device-number-input');
                    const cashNumberSelect = htmlNode.getElementById('nii-cash-number-select');
                    const linkInput = htmlNode.getElementById('nii-link-input');
                    const tagSelect = htmlNode.getElementById('nii-tag-select');
                    if (!storeInput || !deviceSelect || !linkInput || !tagSelect) return;

                    const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');
                    const mode = () => {
                        const v = String(deviceSelect.value || '').trim();
                        if (v === 'cash-register') return 'cash';
                        if (v === 'price-checkers') return 'price';
                        return 'none';
                    };

                    if (!detectLoggedInActor()) {
                        saveBtn.disabled = true;
                        return;
                    }

                    const storeDigits = normalizeDigits(storeInput.value);
                    const normalizedStoreCode = normalizeStoreCodeInput(storeDigits);
                    if (!normalizedStoreCode || !/^AR\d+$/.test(normalizedStoreCode)) {
                        saveBtn.disabled = true;
                        return;
                    }

                    const nm = mode();
                    if (nm === 'price' && numberInput) {
                        const priceDigits = normalizeDigits(numberInput.value).slice(0, 2);
                        if (!priceDigits) {
                            saveBtn.disabled = true;
                            return;
                        }
                    }

                    const link = String(linkInput.value || '').trim();
                    if (!isValidCrmTicketUrl(link)) {
                        saveBtn.disabled = true;
                        return;
                    }
                    if (!normalizeReportTag(tagSelect.value)) {
                        saveBtn.disabled = true;
                        return;
                    }
                    try {
                        buildNonInternetIssuePayload(
                            storeInput.value,
                            deviceSelect.value,
                            numberInput ? numberInput.value : '',
                            cashNumberSelect ? cashNumberSelect.value : ''
                        );
                    } catch (_e) {
                        saveBtn.disabled = true;
                        return;
                    }
                    saveBtn.disabled = false;
                }

                // ---- Page-scoped date-selector filter (modules/date-range-state.js) ----

                function getViewState() {
                    return {
                        page: currentDashboardPage,
                        device: currentDeviceType,
                        offline: isOfflineViewActive
                    };
                }

                function isViewVersionCurrent(version) {
                    const VS = viewStateApi();
                    return VS && typeof VS.isVersion === 'function' ? VS.isVersion(version) : true;
                }

                function syncViewStateFromController() {
                    const VS = viewStateApi();
                    if (!VS || !VS.getState) return;
                    const s = VS.getState();
                    currentDashboardPage = s.page;
                    currentDeviceType = s.device;
                    isOfflineViewActive = s.offline;
                }

                function syncViewStateToController(opts) {
                    const VS = viewStateApi();
                    if (!VS || !VS.setState) return;
                    VS.setState(
                        {
                            page: currentDashboardPage,
                            device: currentDeviceType,
                            offline: isOfflineViewActive
                        },
                        opts || { bumpVersion: false }
                    );
                }

                function isDateAwareView() {
                    return _DR.isDateAwareView
                        ? _DR.isDateAwareView(getViewState())
                        : false;
                }

                function urlDateRangeInfo() {
                    return _DR.urlDateRangeInfo ? _DR.urlDateRangeInfo() : { kind: 'none', from: null, to: null };
                }

                function readSavedDateFilter() {
                    return _DR.readSavedDateFilter ? _DR.readSavedDateFilter() : null;
                }

                function writeSavedDateFilter(value) {
                    if (_DR.writeSavedDateFilter) _DR.writeSavedDateFilter(value);
                }

                function syncDateFilterUrlForView() {
                    return _DR.syncDateFilterUrlForView
                        ? _DR.syncDateFilterUrlForView(getViewState())
                        : false;
                }

                function getEffectiveRangeDays() {
                    const urlParams = new URLSearchParams(window.location.search);
                    const from = urlParams.get('from');
                    const to = urlParams.get('to');

                    if (from && to === 'now') {
                        const match = /^now-(\d+)([hd])$/.exec(from);
                        if (match) {
                            const value = Number(match[1]);
                            const unit = match[2];
                            const days = unit === 'd' ? value : (value / 24);
                            return Math.max(1, Math.ceil(days));
                        }
                    }

                    const fromNum = Number(from);
                    const toNum = Number(to);
                    if (!Number.isNaN(fromNum) && !Number.isNaN(toNum) && toNum > fromNum) {
                        const days = (toNum - fromNum) / (1000 * 60 * 60 * 24);
                        return Math.max(1, Math.ceil(days));
                    }

                    const rangeFrom = latestGrafanaData?.request?.range?.from;
                    const rangeTo = latestGrafanaData?.request?.range?.to;
                    if (rangeFrom && rangeTo) {
                        const fromMs = typeof rangeFrom.valueOf === 'function' ? rangeFrom.valueOf() : new Date(rangeFrom).getTime();
                        const toMs = typeof rangeTo.valueOf === 'function' ? rangeTo.valueOf() : new Date(rangeTo).getTime();
                        if (!Number.isNaN(fromMs) && !Number.isNaN(toMs) && toMs > fromMs) {
                            const days = (toMs - fromMs) / (1000 * 60 * 60 * 24);
                            return Math.max(1, Math.ceil(days));
                        }
                    }
                    return 7;
                }

                function getEffectiveRangeBounds() {
                    const urlParams = new URLSearchParams(window.location.search);
                    const fromRaw = urlParams.get('from');
                    const toRaw = urlParams.get('to');
                    const nowMs = Date.now();

                    if (fromRaw && toRaw) {
                        let fromMs = null;
                        let toMs = null;

                        if (toRaw === 'now') {
                            toMs = nowMs;
                        } else {
                            const toNum = Number(toRaw);
                            if (!Number.isNaN(toNum)) toMs = toNum;
                        }

                        const fromNum = Number(fromRaw);
                        if (!Number.isNaN(fromNum)) {
                            fromMs = fromNum;
                        } else {
                            const match = /^now-(\d+)([hd])$/.exec(fromRaw);
                            if (match) {
                                const value = Number(match[1]);
                                const unit = match[2];
                                const deltaMs = unit === 'd'
                                    ? value * 24 * 60 * 60 * 1000
                                    : value * 60 * 60 * 1000;
                                fromMs = nowMs - deltaMs;
                            }
                        }

                        if (fromMs !== null && toMs !== null && toMs >= fromMs) {
                            return { fromMs, toMs };
                        }
                    }

                    const rangeFrom = latestGrafanaData?.request?.range?.from;
                    const rangeTo = latestGrafanaData?.request?.range?.to;
                    if (rangeFrom && rangeTo) {
                        const fromMs = typeof rangeFrom.valueOf === 'function' ? rangeFrom.valueOf() : new Date(rangeFrom).getTime();
                        const toMs = typeof rangeTo.valueOf === 'function' ? rangeTo.valueOf() : new Date(rangeTo).getTime();
                        if (!Number.isNaN(fromMs) && !Number.isNaN(toMs) && toMs >= fromMs) {
                            return { fromMs, toMs };
                        }
                    }

                    const fallbackDays = getEffectiveRangeDays();
                    return {
                        fromMs: nowMs - fallbackDays * 24 * 60 * 60 * 1000,
                        toMs: nowMs
                    };
                }

                function detectLoggedInActor() {
                    try {
                        const bootUser = window?.grafanaBootData?.user;
                        const candidates = [
                            window?.__TICKET_ACTOR__,
                            window?.CURRENT_USER,
                            bootUser?.login,
                            bootUser?.name,
                            bootUser?.email
                        ];
                        const actor = candidates.find((item) => typeof item === 'string' && item.trim());
                        return actor ? normalizeOwnerUsername(actor, '').toLowerCase() : '';
                    } catch (_error) {
                        return '';
                    }
                }

                async function apiRequest(path, options = {}) {
                    // CRITICAL: only attach Content-Type when there is actually a
                    // body. A GET with Content-Type: application/json is NOT a
                    // CORS simple request, so it forces a preflight OPTIONS on
                    // every fetch and doubled our request count. With this guard,
                    // GETs become simple requests and skip preflight entirely.
                    const method = (options.method || 'GET').toUpperCase();
                    const hasBody = options.body !== undefined && options.body !== null && method !== 'GET' && method !== 'HEAD';
                    const finalOptions = {
                        ...options,
                        method,
                        headers: hasBody
                            ? { 'Content-Type': 'application/json', ...(options.headers || {}) }
                            : (options.headers || undefined)
                    };
                    const response = await fetch(`${CRM_API_BASE}${path}`, finalOptions);

                    let payload = null;
                    try {
                        payload = await response.json();
                    } catch (_error) {
                        payload = null;
                    }

                    if (!response.ok) {
                        let detail = payload?.detail ?? payload?.error;
                        if (Array.isArray(detail)) {
                            detail = detail.map((d) => d?.msg || d?.message || JSON.stringify(d)).join('; ');
                        }
                        const message = (detail && String(detail)) || `Request failed (${response.status})`;
                        throw new Error(message);
                    }

                    return payload;
                }

                // csvEscape moved to modules/device-format.js (window.GFN_DEVICE_FORMAT).

                // Build conditional tooltip based on device status
                function buildConditionalTooltip(dev) {
                    const primaryStatus = dev.ontPrimaryStatus || 'unknown';
                    const backupStatus = dev.ontBackupStatus || 'unknown';
                    const activeLink = dev.ontStatus || 'unknown';
                    
                    let tooltipLines = [];
                    
                    // Device name
                    tooltipLines.push(`Location: ${dev.name}`);
                    tooltipLines.push('');
                    
                    // ONT Primary/Backup Status
                    const primaryText = dev.ontPrimaryText || (primaryStatus === 'up' ? 'UP' : primaryStatus === 'down' ? 'DOWN' : primaryStatus === 'none' ? 'NONE' : 'UNKNOWN');
                    const backupText = dev.ontBackupText || (backupStatus === 'up' ? 'UP' : backupStatus === 'down' ? 'DOWN' : backupStatus === 'none' ? 'NONE' : 'UNKNOWN');
                    if ((_PS.isInternetDownRouter || function () { return false; })(dev)) {
                        tooltipLines.push('Internet: DOWN (no usable WAN)');
                    } else {
                        tooltipLines.push(`ONT Primary: ${primaryText}`);
                        tooltipLines.push(`ONT Backup: ${backupText}`);
                    }
                    
                    // Active link (based on main value)
                    if (activeLink === 'primary') {
                        tooltipLines.push('Active Connection: PRIMARY');
                    } else if (activeLink === 'backup') {
                        tooltipLines.push('Active Connection: BACKUP');
                    } else if (activeLink === 'down') {
                        tooltipLines.push('Active Connection: DOWN');
                    } else {
                        tooltipLines.push('Active Connection: UNKNOWN');
                    }
                    
                    tooltipLines.push('');
                    
                    // Find devices for this location (case-insensitive match)
                    const locName = dev.name.toLowerCase();
                    const locStoreCode = extractStoreCode(dev.name).toLowerCase();
                    const isMatch = (d) => {
                        const dName = d.name.toLowerCase();
                        const dStoreCode = extractStoreCode(d.name).toLowerCase();
                        return dName === locName ||
                            dName.startsWith(locName + '-') ||
                            dName.startsWith(locName + '_') ||
                            dName.startsWith(locName + '.') ||
                            (locStoreCode && dStoreCode && dStoreCode === locStoreCode);
                    };

                    const isStoreLocation = /^ar\d+$/i.test(String(dev.name || '').trim());
                    const locationDevices = {
                        priceCheckers: dataMap['price-checkers'].filter(isMatch),
                        cashReg1: dataMap['cash-register-1'].filter(isMatch),
                        cashReg2: dataMap['cash-register-2'].filter(isMatch),
                        cashReg3: dataMap['cash-register-3'].filter(isMatch),
                        insideMusic: dataMap['inside-music'].filter(isMatch),
                        outsideMusic: dataMap['outside-music'].filter(isMatch),
                        switchPrimary: dataMap['switches-primary'].filter(isMatch),
                        switchSecondary: dataMap['switches-secondary'].filter(isMatch),
                        adminPc: dataMap['admin-pc'].filter(isMatch)
                    };
                    
                    if (isStoreLocation) {
                        // Intentionally omit Price Checkers / Cash Registers / Music details
                        // from the store hold-tooltip to keep Overview concise.
                    }
                    
                    // Switches Status
                    const switchPrimStatus = locationDevices.switchPrimary[0]?.status;
                    const switchSecStatus = locationDevices.switchSecondary[0]?.status;
                    
                    if (switchPrimStatus) {
                        const hasIssue = switchPrimStatus !== 'active';
                        tooltipLines.push(`Switch Primary: ${switchPrimStatus === 'active' ? 'UP' : 'DOWN'}`);
                    }
                    
                    if (switchSecStatus) {
                        const hasIssue = switchSecStatus !== 'active';
                        tooltipLines.push(`Switch Secondary: ${switchSecStatus === 'active' ? 'UP' : 'DOWN'}`);
                    }
                    
                    // Admin PC Status
                    const adminPcStatus = locationDevices.adminPc[0]?.status;
                    if (adminPcStatus) {
                        const hasIssue = adminPcStatus !== 'active';
                        tooltipLines.push(`Admin PC: ${adminPcStatus === 'active' ? 'UP' : 'DOWN'}`);
                    }
                    
                    return tooltipLines.join('\n');
                }

                // Toast notifications
                function showToast(message, type = 'info') {
                    const root = toastRootNode || document;
                    const getActiveReportModalContent = () => {
                        const nonInternetModal = root.getElementById?.('non-internet-issue-modal') || document.getElementById('non-internet-issue-modal');
                        if (nonInternetModal?.classList?.contains('show')) {
                            return nonInternetModal.querySelector('.non-internet-issue-content');
                        }
                        const ticketModal = root.getElementById?.('pc-ticket-modal') || document.getElementById('pc-ticket-modal');
                        if (ticketModal?.classList?.contains('show')) {
                            return ticketModal.querySelector('.pc-ticket-content');
                        }
                        return null;
                    };
                    const isReportModalOpen = () => {
                        const ticketModal = root.getElementById?.('pc-ticket-modal') || document.getElementById('pc-ticket-modal');
                        const nonInternetModal = root.getElementById?.('non-internet-issue-modal') || document.getElementById('non-internet-issue-modal');
                        return Boolean(
                            ticketModal?.classList?.contains('show') ||
                            nonInternetModal?.classList?.contains('show')
                        );
                    };
                    let container = null;

                    // Prefer the panel-local container if available.
                    if (root && typeof root.querySelector === 'function') {
                        container = root.querySelector('#toast-container.toast-container') || root.querySelector('.toast-container');
                    }

                    // Fallback (should be rare in Grafana HTML Graphics)
                    if (!container) {
                        container = document.getElementById('toast-container') || document.querySelector('.toast-container');
                    }

                    if (!container) {
                        container = document.createElement('div');
                        container.className = 'toast-container';
                        (toastRootNode || document.body).appendChild(container);
                    }

                    container.classList.toggle('toast-container-modal', isReportModalOpen());
                    if (container.classList.contains('toast-container-modal')) {
                        const modalContent = getActiveReportModalContent();
                        if (modalContent && typeof modalContent.getBoundingClientRect === 'function') {
                            const rect = modalContent.getBoundingClientRect();
                            const viewportH = Math.max(0, window.innerHeight || 0);
                            const preferredTop = rect.top + 102; // place it visibly lower inside modal area
                            const maxTop = Math.max(12, viewportH - 120); // keep fully visible in screen
                            const top = Math.max(12, Math.min(preferredTop, maxTop));
                            container.style.top = `${top}px`;
                        } else {
                            container.style.top = '32px';
                        }
                    } else {
                        container.style.top = '';
                    }
                    
                    const toast = document.createElement('div');
                    toast.className = `toast ${type}`;
                    
                    const icons = {
                        success: 'fa-check-circle',
                        error: 'fa-exclamation-circle',
                        warning: 'fa-exclamation-triangle',
                        info: 'fa-info-circle'
                    };
                    
                    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${escapeHtml(message)}`;
                    container.appendChild(toast);

                    // Cap visible toasts to avoid UI glitches/spam
                    const MAX_TOASTS = 8;
                    while (container.children.length > MAX_TOASTS) {
                        container.removeChild(container.firstElementChild);
                    }
                    
                    setTimeout(() => toast.remove(), 3000);
                }

                // naturalSortStores moved to modules/device-format.js.

                // Export to CSV - always sorted: TOTAL first, then stores in consecutive order
                function exportToCSV(data, filename) {
                    // Sort data in consecutive order (ar0001, ar0002, etc.)
                    const sortedData = [...data].sort(naturalSortStores);
                    
                    // Calculate totals
                    const totals = {
                        store: 'TOTAL',
                        bothDown: 0,
                        backup: 0,
                        cr1: 0,
                        cr2: 0,
                        cr3: 0,
                        nuc: 0,
                        m1: 0,
                        m2: 0,
                        pc: 0,
                        primaryUptimePct: null,
                        backupUptimePct: null,
                        internetUptimePct: null
                    };
                    sortedData.forEach((row) => {
                        totals.bothDown += row.bothDown || 0;
                        totals.backup += row.backup || 0;
                        totals.cr1 += row.cr1 || 0;
                        totals.cr2 += row.cr2 || 0;
                        totals.cr3 += row.cr3 || 0;
                        totals.nuc += row.nuc || 0;
                        totals.m1 += row.m1 || 0;
                        totals.m2 += row.m2 || 0;
                        totals.pc += row.pc || 0;
                    });
                    const bounds = getPanelTimeRangeMs(latestGrafanaData) || getEffectiveRangeBounds();
                    const ontByStoreCsv = buildRouterOntByStore();
                    applyInternetUptimeToOfflineRows(sortedData, bounds.fromMs, bounds.toMs, ontByStoreCsv);
                    if (
                        (offlinePowerOutageByStore && offlinePowerOutageByStore.size > 0) ||
                        (offlinePlannedByStore && offlinePlannedByStore.size > 0)
                    ) {
                        applyInternetReportAdjustmentsToOfflineRows(
                            sortedData,
                            offlinePowerOutageByStore,
                            offlinePlannedByStore,
                            bounds.fromMs,
                            bounds.toMs,
                            OFFLINE_UPTIME_SCHEDULE,
                            {
                                scheduledMinutesInRange,
                                extractStoreCode,
                                lookupOntForOfflineStore,
                                ontByStore: ontByStoreCsv
                            }
                        );
                    }
                    const S = scheduledMinutesInRange(bounds.fromMs, bounds.toMs, OFFLINE_UPTIME_SCHEDULE);
                    let sumPd = 0;
                    let sumBd = 0;
                    let sumId = 0;
                    let nPrim = 0;
                    let nBak = 0;
                    let nInt = 0;
                    sortedData.forEach((row) => {
                        const ont = lookupOntForOfflineStore(row.store, ontByStoreCsv);
                        if (!ont || ont.primary !== 'none') {
                            nPrim++;
                            sumPd += row.primaryDownScheduled != null && Number.isFinite(row.primaryDownScheduled)
                                ? Math.max(0, row.primaryDownScheduled)
                                : 0;
                        }
                        if (!ont || ont.backup !== 'none') {
                            nBak++;
                            sumBd += row.backupDownScheduled != null && Number.isFinite(row.backupDownScheduled)
                                ? Math.max(0, row.backupDownScheduled)
                                : 0;
                        }
                        nInt++;
                        const idEff = row.internetDownEffective != null && Number.isFinite(row.internetDownEffective)
                            ? Math.max(0, row.internetDownEffective)
                            : (row.internetDownScheduled != null && Number.isFinite(row.internetDownScheduled)
                                ? Math.max(0, row.internetDownScheduled)
                                : 0);
                        sumId += idEff;
                    });
                    if (S > 0 && nPrim > 0) {
                        totals.primaryUptimePct = ((nPrim * S - sumPd) / (nPrim * S)) * 100;
                    }
                    if (S > 0 && nBak > 0) {
                        totals.backupUptimePct = ((nBak * S - sumBd) / (nBak * S)) * 100;
                    }
                    if (S > 0 && nInt > 0) {
                        totals.internetUptimePct = ((nInt * S - sumId) / (nInt * S)) * 100;
                    }

                    const headers = [
                        'Store',
                        'No Connectivity',
                        'Backup',
                        'CR1',
                        'CR2',
                        'CR3',
                        'Admin PC',
                        'M1',
                        'M2',
                        'Price Checkers',
                        'Primary uptime %',
                        'Backup uptime %',
                        'Internet uptime %'
                    ];

                    const buildRow = (row) => [
                        row.store,
                        row.bothDown || 0,
                        row.backup || 0,
                        row.cr1 || 0,
                        row.cr2 || 0,
                        row.cr3 || 0,
                        row.nuc || 0,
                        row.m1 || 0,
                        row.m2 || 0,
                        row.pc || 0,
                        row.primaryUptimePct == null ? 'N/A' : `${Math.round(Number(row.primaryUptimePct))}%`,
                        row.backupUptimePct == null ? 'N/A' : `${Math.round(Number(row.backupUptimePct))}%`,
                        row.internetUptimePct == null ? 'N/A' : `${Math.round(Number(row.internetUptimePct))}%`
                    ];
                    
                    // TOTAL row first, then sorted store rows
                    const totalRow = buildRow(totals);
                    const storeRows = sortedData.map(buildRow);
                    
                    const delimiter = ',';
                    const csvContent = '\uFEFF' + [
                        headers.map(h => csvEscape(h, delimiter)),
                        totalRow.map(v => csvEscape(v, delimiter)),
                        ...storeRows.map(r => r.map(v => csvEscape(v, delimiter)))
                    ].map(row => row.join(delimiter)).join('\n');
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    const objectUrl = URL.createObjectURL(blob);
                    link.href = objectUrl;
                    link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
                    
                    showToast(`Exported ${sortedData.length} stores successfully!`, 'success');
                }

                // ============================================================================
                // 3. PARSERS (DATA EXTRACTION) — moved to modules/parsers.js
                // ============================================================================
                //   genericParser, getOfflineMetricData, getPcOver15DetailData,
                //   getPanelTimeRangeMs, scheduledMinutesInRange,
                //   formatUptimePercent, uptimePercentCellClass,
                //   normalizeOntLookupKey, compactOntLookupKey,
                //   buildRouterOntByStore(dataMap), lookupOntForOfflineStore,
                //   applyInternetUptimeToOfflineRows, combineRouterStatuses(dataMap).
                // The rebind block at the top of runGfnPanel re-binds them under their
                // original names. The closure-bound wrappers (buildRouterOntByStore /
                // combineRouterStatuses) read `dataMap` at call time.

                // ============================================================================
                // DEVICE DETAILS MODAL
                // ============================================================================
                
                /**
                 * Gather all device information for a specific location
                 */
                function getLocationDeviceDetails(locationName) {
                    const locLower = locationName.toLowerCase().trim();
                    const locStoreCode = extractStoreCode(locationName).toLowerCase();
                    const details = {
                        location: locationName,
                        devices: []
                    };
                    
                    // Helper to check if device belongs to location
                    const belongsToLocation = (deviceName) => {
                        const dName = deviceName.toLowerCase().trim();
                        const dStoreCode = extractStoreCode(deviceName).toLowerCase();
                        return dName === locLower || 
                            dName.startsWith(locLower + '-') || 
                            dName.startsWith(locLower + '_') || 
                            dName.startsWith(locLower + '.') ||
                            (locStoreCode && dStoreCode && dStoreCode === locStoreCode);
                    };
                    
                    // Router & ONT
                    const routerDevices = dataMap['routers'].filter(d => belongsToLocation(d.name));
                    
                    if (routerDevices.length > 0) {
                        const router = routerDevices[0];
                        const primaryStatus = router?.ontPrimaryStatus || 'unknown';
                        const backupStatus = router?.ontBackupStatus || 'unknown';
                        const activeLink = router?.ontStatus || 'unknown';

                        const mapOntStatusToModal = (status) => {
                            if (status === 'up') return 'active';
                            if (status === 'down') return 'inactive';
                            if (status === 'none') return 'n-a';
                            return 'n-a';
                        };

                        const mapActiveLinkToModal = (status) => {
                            if (status === 'primary') return 'active';
                            if (status === 'backup') return 'backup';
                            if (status === 'down') return 'inactive';
                            return 'n-a';
                        };
                        
                        details.devices.push({
                            category: 'Network Infrastructure',
                            icon: 'fa-network-wired',
                            items: [
                                {
                                    name: 'ONT Primary',
                                    ip: 'N/A',
                                    status: mapOntStatusToModal(primaryStatus)
                                },
                                {
                                    name: 'ONT Backup',
                                    ip: 'N/A',
                                    status: mapOntStatusToModal(backupStatus)
                                },
                                {
                                    name: 'Active Link',
                                    ip: 'N/A',
                                    status: mapActiveLinkToModal(activeLink)
                                }
                            ]
                        });
                    }
                    
                    // Switches
                    const switchPrimary = dataMap['switches-primary'].find(d => belongsToLocation(d.name));
                    const switchSecondary = dataMap['switches-secondary'].find(d => belongsToLocation(d.name));
                    
                    if (switchPrimary || switchSecondary) {
                        const switchItems = [];
                        if (switchPrimary) {
                            switchItems.push({
                                name: 'Switch Primary',
                                ip: 'N/A',
                                status: switchPrimary.status
                            });
                        }
                        if (switchSecondary) {
                            switchItems.push({
                                name: 'Switch Secondary',
                                ip: 'N/A',
                                status: switchSecondary.status
                            });
                        }
                        
                        details.devices.push({
                            category: 'Switches',
                            icon: 'fa-project-diagram',
                            items: switchItems
                        });
                    }
                    
                    // Cash Registers
                    const cashReg1 = dataMap['cash-register-1'].find(d => belongsToLocation(d.name));
                    const cashReg2 = dataMap['cash-register-2'].find(d => belongsToLocation(d.name));
                    const cashReg3 = dataMap['cash-register-3'].find(d => belongsToLocation(d.name));
                    
                    if (cashReg1 || cashReg2 || cashReg3) {
                        const cashItems = [];
                        if (cashReg1) {
                            cashItems.push({
                                name: 'Cash Register 1',
                                ip: 'N/A',
                                status: cashReg1.status
                            });
                        }
                        if (cashReg2) {
                            cashItems.push({
                                name: 'Cash Register 2',
                                ip: 'N/A',
                                status: cashReg2.status
                            });
                        }
                        if (cashReg3) {
                            cashItems.push({
                                name: 'Cash Register 3',
                                ip: 'N/A',
                                status: cashReg3.status
                            });
                        }
                        
                        details.devices.push({
                            category: 'Cash Registers',
                            icon: 'fa-cash-register',
                            items: cashItems
                        });
                    }
                    
                    // Admin PC
                    const adminPc = dataMap['admin-pc'].find(d => belongsToLocation(d.name));
                    if (adminPc) {
                        details.devices.push({
                            category: 'Administration',
                            icon: 'fa-desktop',
                            items: [
                                {
                                    name: "Admin's PC",
                                    ip: 'N/A',
                                    status: adminPc.status
                                }
                            ]
                        });
                    }
                    
                    // Music Systems
                    const insideMusic = dataMap['inside-music'].find(d => belongsToLocation(d.name));
                    const outsideMusic = dataMap['outside-music'].find(d => belongsToLocation(d.name));
                    
                    if (insideMusic || outsideMusic) {
                        const musicItems = [];
                        if (insideMusic) {
                            musicItems.push({
                                name: 'Inside Music',
                                ip: 'N/A',
                                status: insideMusic.status
                            });
                        }
                        if (outsideMusic) {
                            musicItems.push({
                                name: 'Outside Music',
                                ip: 'N/A',
                                status: outsideMusic.status
                            });
                        }
                        
                        details.devices.push({
                            category: 'Music Systems',
                            icon: 'fa-music',
                            items: musicItems
                        });
                    }
                    
                    // Price Checkers
                    const priceCheckers = dataMap['price-checkers'].filter(d => belongsToLocation(d.name));
                    const inactivePriceCheckers = priceCheckers.filter(pc => pc.status === 'inactive');
                    
                    if (priceCheckers.length > 0) {
                        let pcLabel = "Price Checkers";
                        let pcStatus = "active";

                        if (inactivePriceCheckers.length > 0) {
                            pcStatus = "inactive";
                            if (inactivePriceCheckers.length <= 5) {
                                const pNumbers = inactivePriceCheckers.map(pc => {
                                    const match = pc.name.match(/P(\d+)$/i);
                                    return match ? "P" + match[1] : pc.name;
                                }).join(", ");
                                pcLabel = "Inactive Price Checkers: " + pNumbers;
                            } else {
                                pcLabel = "Price Checkers Inactive: " + inactivePriceCheckers.length;
                            }
                        }

                        details.devices.push({
                            category: 'Price Checkers',
                            icon: 'fa-barcode',
                            items: [
                                {
                                    name: pcLabel,
                                    ip: 'N/A',
                                    status: pcStatus
                                }
                            ]
                        });
                    }
                    
                    // Printer
                    const printer = dataMap['printer'].find(d => belongsToLocation(d.name));
                    if (printer) {
                        details.devices.push({
                            category: 'Peripherals',
                            icon: 'fa-print',
                            items: [
                                {
                                    name: 'Printer',
                                    ip: 'N/A',
                                    status: printer.status
                                }
                            ]
                        });
                    }
                    
                    return details;
                }
                
                /**
                 * Show device details modal
                 */
                // Device-details modal — implementation lives in modules/modals.js.
                function showDeviceDetailsModal(locationName, htmlNode) {
                    const mod = window.GFN_MODALS;
                    if (!mod) return;
                    mod.showDeviceDetailsModal(locationName, htmlNode, {
                        getLocationDeviceDetails
                    });
                }

                function setupDeviceDetailsModal(htmlNode) {
                    const mod = window.GFN_MODALS;
                    if (!mod) return;
                    mod.setupDeviceDetailsModal(htmlNode);
                }

                // ---- normalizeDeviceKey / extractStoreCode / normalizeStoreCodeInput
                //      moved to modules/device-format.js.
                // ---- knownStoreCodesSet -> modules/parsers.js (passes dataMap explicitly).
                // ---- effectiveTicketGridDeviceType / deviceTicketLinkLookupKeys /
                //      getDeviceTicketLink / hasDeviceTicketLink /
                //      extractCrmTaskIdFromTicketUrl / normalizeLiveCrmTicketSearchQuery /
                //      sanitizeLiveCrmTicketFieldValue / unreportedLiveTicketMetaBlockHtml
                //      moved to modules/ticket-links.js. The wrappers at the top of
                //      runGfnPanel forward currentDeviceType + deviceTicketLinks.

                async function fetchLiveReportedRowsFromDb() {
                    const bounds = getEffectiveRangeBounds();
                    const spanMs = Math.max(0, Number(bounds.toMs || 0) - Number(bounds.fromMs || 0));
                    const days = Math.max(1, Math.ceil(spanMs / (1000 * 60 * 60 * 24)));
                    // Live view should not cap by Grafana range.to (it can lag by minutes);
                    // leave to_ts unset so backend evaluates against now().
                    const rangeQuery = `days=${days}&from_ms=${Math.floor(bounds.fromMs)}`;
                    const response = await apiRequest(`/reporting/reported?${rangeQuery}&limit=${LIVE_REPORTED_SOLVED_PAGE_SIZE}&offset=0`);
                    const rows = Array.isArray(response?.rows) ? response.rows : [];
                    rows.forEach((row) => {
                        const deviceName = String(row?.device_name || '').trim();
                        const ticketUrl = String(row?.ticket_url || '').trim();
                        if (!deviceName || !ticketUrl) return;
                        const dtype = String(row?.device_type || '').trim().toLowerCase();
                        const keys = deviceTicketLinkLookupKeys(deviceName, dtype);
                        keys.forEach((k) => {
                            deviceTicketLinks[k] = ticketUrl;
                        });
                    });
                    return rows;
                }

                async function fetchLiveSolvedRowsFromDb() {
                    const bounds = getEffectiveRangeBounds();
                    const spanMs = Math.max(0, Number(bounds.toMs || 0) - Number(bounds.fromMs || 0));
                    const days = Math.max(1, Math.ceil(spanMs / (1000 * 60 * 60 * 24)));
                    // Live view should not cap by Grafana range.to (it can lag by minutes);
                    // leave to_ts unset so backend evaluates against now().
                    const rangeQuery = `days=${days}&from_ms=${Math.floor(bounds.fromMs)}`;
                    const response = await apiRequest(`/reporting/solved?${rangeQuery}&limit=${LIVE_REPORTED_SOLVED_PAGE_SIZE}&offset=0`);
                    return Array.isArray(response?.rows) ? response.rows : [];
                }

                async function refreshLiveReportedAndSolvedCaches() {
                    const [reportedRows, solvedRows] = await Promise.all([
                        fetchLiveReportedRowsFromDb(),
                        fetchLiveSolvedRowsFromDb()
                    ]);
                    liveReportedRowsCache = Array.isArray(reportedRows) ? reportedRows : [];
                    liveSolvedRowsCache = Array.isArray(solvedRows) ? solvedRows : [];
                }

                // ---- ticketLookupCandidateNames moved to modules/ticket-links.js. ----
                // ---- Live dedup helpers (liveDedupStoreCode, liveIncidentDedupKeySet,
                //      liveDedupKeySetsOverlap, liveReportedSolvedRowResolvedEndMs,
                //      LIVE_UNREPORTED_DEDUP_OFFLINE_START_ALIGN_MS,
                //      liveReportedSolvedSupersedesUnreportedOpen,
                //      livePreparedReportedSolvedSupersessions,
                //      liveUnreportedSupersedesReportedOrSolved)
                //      moved to modules/incident-dedup.js. The rebind block at the top of
                //      runGfnPanel wraps the cache-bound ones (livePrepared… and
                //      liveUnreported…) so they still see liveReportedRowsCache /
                //      liveSolvedRowsCache + the local getDeviceTicketLink.

                async function refreshReportedTicketLinksForIncidentRows(rows) {
                    const list = Array.isArray(rows) ? rows : [];
                    const reportable = new Set(REPORTABLE_DEVICE_TYPES);
                    const targets = list.filter((row) => {
                        const type = String(row?.device_type || '');
                        const name = String(row?.device_name || '');
                        if (!name) return false;
                        const norm = normalizeDeviceTypeKey(type);
                        return reportable.has(type) || reportable.has(norm);
                    });
                    if (!targets.length) return;

                    await Promise.all(targets.map(async (row) => {
                        const deviceName = String(row.device_name || '');
                        const type = String(row.device_type || '');
                        const key = normalizeDeviceKey(deviceName);
                        const candidates = ticketLookupCandidateNames(deviceName, type);
                        try {
                            let ticketUrl = '';
                            let ownerName = '';
                            for (const candidateName of candidates) {
                                const payload = await apiRequest(`/tickets/${encodeURIComponent(candidateName)}`);
                                const foundUrl = payload?.ticket?.ticket_url || '';
                                if (foundUrl) {
                                    ticketUrl = foundUrl;
                                    ownerName = normalizeOwnerUsername(payload?.ticket?.owner_name || '', '');
                                    break;
                                }
                            }
                            row._ticket_url = ticketUrl;
                            row._ticket_owner = ownerName;
                            if (ticketUrl) {
                                candidates.forEach((name) => {
                                    deviceTicketLinks[normalizeDeviceKey(name)] = ticketUrl;
                                });
                                deviceTicketLinks[key] = ticketUrl;
                            }
                            // Do not delete global deviceTicketLinks on empty/error — same race as
                            // refreshReportedTicketLinksForCurrentDevices vs reported cache.
                        } catch (_error) {
                            row._ticket_url = '';
                            row._ticket_owner = '';
                        }
                    }));
                }

                /** Prefetch CRM ticket URLs for offline devices on Live device grids (not only Incidents tab). */
                function shouldPrefetchTicketLinksForDeviceGrid() {
                    return (
                        currentDashboardPage === 'live' &&
                        !isOfflineViewActive &&
                        currentDeviceType !== LIVE_UNREPORTED_DEVICE_TYPE
                    );
                }

                async function refreshReportedTicketLinksForCurrentDevices(htmlNode) {
                    if (!shouldPrefetchTicketLinksForDeviceGrid() || isOfflineViewActive) return;

                    const currentDevices = dataMap[currentDeviceType] || [];
                    const offlineDevices = currentDevices.filter(
                        (device) =>
                            device.status === 'inactive' && !hasDeviceTicketLink(device.name, currentDeviceType)
                    );
                    if (offlineDevices.length === 0) return;

                    const requests = offlineDevices.map(async (device) => {
                        const dtype = effectiveTicketGridDeviceType(device.name, currentDeviceType);
                        try {
                            const candidates = ticketLookupCandidateNames(device.name, dtype);
                            const tryNames = candidates.length ? candidates : [device.name];
                            let ticketUrl = '';
                            for (const name of tryNames) {
                                const payload = await apiRequest(`/tickets/${encodeURIComponent(name)}`);
                                const found = payload?.ticket?.ticket_url || '';
                                if (found) {
                                    ticketUrl = found;
                                    break;
                                }
                            }
                            // Only merge on success — never delete keys here. Parallel
                            // refreshLiveReportedAndSolvedCaches may have filled the same aliases;
                            // deleting on empty/error caused "Reported" to flicker off.
                            if (ticketUrl) {
                                deviceTicketLinkLookupKeys(device.name, currentDeviceType).forEach((k) => {
                                    deviceTicketLinks[k] = ticketUrl;
                                });
                            }
                            return Boolean(ticketUrl);
                        } catch (_error) {
                            return false;
                        }
                    });

                    const results = await Promise.all(requests);
                    if (results.some(Boolean)) {
                        renderDeviceCards(currentDevices, htmlNode);
                    }
                }

                function persistDeviceStatusSnapshot(snapshot) {
                    try {
                        localStorage.setItem(STORAGE_KEY_DEVICE_STATUS_SNAPSHOT, JSON.stringify(snapshot));
                    } catch (_error) {
                        // Ignore localStorage failures
                    }
                }

                function persistPrimaryDownSinceMap() {
                    try {
                        localStorage.setItem(STORAGE_KEY_PRIMARY_DOWN_SINCE, JSON.stringify(primaryDownSinceByStore));
                    } catch (_error) {
                        // Ignore localStorage failures
                    }
                }

                function persistNightFreezeState() {
                    try {
                        localStorage.setItem(STORAGE_KEY_NIGHT_FREEZE_STATE, JSON.stringify(nightFreezeState));
                    } catch (_error) {
                        // Ignore localStorage failures
                    }
                }

                // ---- Live devices "last known" snapshot ----
                // Prometheus stops scraping outside MONITORING_START..END (default
                // 07:10 → 21:00 Europe/Bucharest). Without intervention every
                // Live device tile vanishes at 21:00 ("No devices found"). We
                // persist the last good dataMap during the monitoring window and
                // restore it after 21:00 so the UI keeps showing what was true
                // at the cutoff — flagged with a badge — until Prometheus
                // resumes next morning.
                const STORAGE_KEY_LIVE_DEVICES_SNAPSHOT = 'grafana_custom_panel_live_devices_snapshot';
                let lastFrozenSnapshotMeta = null;

                function persistLiveDevicesSnapshot() {
                    try {
                        const payload = { savedAtMs: Date.now(), dataMap: dataMap };
                        localStorage.setItem(STORAGE_KEY_LIVE_DEVICES_SNAPSHOT, JSON.stringify(payload));
                    } catch (_error) {
                        // Ignore quota / serialization failures.
                    }
                }

                function loadLiveDevicesSnapshot() {
                    try {
                        const raw = localStorage.getItem(STORAGE_KEY_LIVE_DEVICES_SNAPSHOT);
                        if (!raw) return null;
                        const parsed = JSON.parse(raw);
                        if (!parsed || !parsed.dataMap) return null;
                        return parsed;
                    } catch (_error) {
                        return null;
                    }
                }

                function dataMapHasAnyDevices(map) {
                    if (!map) return false;
                    for (const k of Object.keys(map)) {
                        if (Array.isArray(map[k]) && map[k].length > 0) return true;
                    }
                    return false;
                }

                function maybeApplyFrozenSnapshot() {
                    const nightCtx = getNightWindowContext(new Date());
                    if (nightCtx.inMonitoringWindow) {
                        lastFrozenSnapshotMeta = null;
                        return false;
                    }
                    const saved = loadLiveDevicesSnapshot();
                    if (!saved || !saved.dataMap) return false;
                    let restoredAny = false;
                    for (const k of Object.keys(saved.dataMap)) {
                        const savedArr = saved.dataMap[k];
                        const currentArr = dataMap[k];
                        if (!Array.isArray(savedArr) || savedArr.length === 0) continue;
                        if (!Array.isArray(currentArr)) continue;
                        if (currentArr.length > 0) continue;
                        currentArr.push.apply(currentArr, savedArr);
                        restoredAny = true;
                    }
                    if (restoredAny) {
                        lastFrozenSnapshotMeta = {
                            savedAtMs: Number(saved.savedAtMs) || Date.now(),
                            cutoffIso: nightCtx.cutoffIso
                        };
                    } else {
                        lastFrozenSnapshotMeta = null;
                    }
                    return restoredAny;
                }

                function getNightWindowContext(now = new Date()) {
                    const minutes = now.getHours() * 60 + now.getMinutes();
                    const inMonitoringWindow = minutes >= MONITORING_START_MINUTES && minutes < MONITORING_END_MINUTES;
                    const cutoff = new Date(now);
                    if (minutes >= MONITORING_END_MINUTES) {
                        cutoff.setHours(21, 0, 0, 0);
                    } else {
                        // Before 07:10 -> use previous day 21:00
                        cutoff.setDate(cutoff.getDate() - 1);
                        cutoff.setHours(21, 0, 0, 0);
                    }
                    return {
                        inMonitoringWindow,
                        cutoffIso: cutoff.toISOString()
                    };
                }

                function updateNightFreezeBadge(htmlNode, nightContext) {
                    const badge = htmlNode.getElementById('night-freeze-badge');
                    if (!badge) return;
                    const active = !nightContext.inMonitoringWindow;
                    badge.style.display = active ? 'inline-flex' : 'none';
                    if (!active) return;
                    // When the snapshot fallback kicked in, surface the cutoff
                    // ("Showing data as of 21:00") so users know the cards are
                    // intentionally stale. Otherwise fall back to the static
                    // window range banner.
                    const cutoffMs = lastFrozenSnapshotMeta
                        ? toEpochMs(lastFrozenSnapshotMeta.cutoffIso)
                        : null;
                    if (lastFrozenSnapshotMeta && Number.isFinite(cutoffMs)) {
                        const d = new Date(cutoffMs);
                        const hh = String(d.getHours()).padStart(2, '0');
                        const mm = String(d.getMinutes()).padStart(2, '0');
                        badge.textContent = `Showing data as of ${hh}:${mm} — Prometheus paused until 07:10`;
                    } else {
                        badge.textContent = 'Night freeze active (21:00 – 07:10)';
                    }
                }

                // Prometheus scrapes only between MONITORING_START_MINUTES
                // (07:10 Europe/Bucharest) and MONITORING_END_MINUTES (21:00).
                // Any "resolved" timestamp that falls inside the current
                // monitoring-paused window is suspect: the incident may not
                // have actually recovered — the scraper just stopped. We hold
                // such rows in the Reported section until Prometheus resumes
                // and the backend re-evaluates them (the existing
                // NIGHT_GAP_REOPEN_* logic on the backend will re-open the row
                // if the device is still offline next morning).
                function getCurrentNightWindow(now = new Date()) {
                    const minutes = now.getHours() * 60 + now.getMinutes();
                    const inDay = minutes >= MONITORING_START_MINUTES && minutes < MONITORING_END_MINUTES;
                    if (inDay) return null;
                    const start = new Date(now);
                    const end = new Date(now);
                    if (minutes >= MONITORING_END_MINUTES) {
                        start.setHours(21, 0, 0, 0);
                        end.setDate(end.getDate() + 1);
                        end.setHours(7, 10, 0, 0);
                    } else {
                        start.setDate(start.getDate() - 1);
                        start.setHours(21, 0, 0, 0);
                        end.setHours(7, 10, 0, 0);
                    }
                    return { startMs: start.getTime(), endMs: end.getTime() };
                }

                function endedInsidePendingNightWindow(endedIsoOrMs, now = new Date()) {
                    if (endedIsoOrMs == null || endedIsoOrMs === '') return false;
                    const night = getCurrentNightWindow(now);
                    if (!night) return false;
                    const endedTs = typeof endedIsoOrMs === 'number'
                        ? endedIsoOrMs
                        : toEpochMs(endedIsoOrMs);
                    if (endedTs == null || !Number.isFinite(endedTs)) return false;
                    return endedTs >= night.startMs && endedTs <= night.endMs;
                }

                // Solved DB rows expose `report_to_resolve_minutes`; the
                // ended timestamp is `created_at + report_to_resolve_minutes`.
                function shouldHoldSolvedRowAsReported(row, now = new Date()) {
                    if (!row) return false;
                    const rtrMinutes = row.report_to_resolve_minutes != null
                        ? Number(row.report_to_resolve_minutes)
                        : null;
                    if (rtrMinutes == null || !Number.isFinite(rtrMinutes)) return false;
                    const reportTsMs = toEpochMs(row.created_at);
                    if (reportTsMs == null) return false;
                    const endedTs = reportTsMs + (rtrMinutes * 60000);
                    return endedInsidePendingNightWindow(endedTs, now);
                }

                function refreshPrimaryDownSinceMap(nowMs) {
                    const routerDevices = dataMap['routers'] || [];
                    const seenStores = new Set();
                    routerDevices.forEach((router) => {
                        const storeCode = extractStoreCode(router.name);
                        if (!storeCode) return;
                        seenStores.add(storeCode);
                        const isPrimaryDown = router.ontPrimaryStatus === 'down';
                        if (isPrimaryDown) {
                            if (!primaryDownSinceByStore[storeCode]) {
                                primaryDownSinceByStore[storeCode] = nowMs;
                            }
                        } else {
                            delete primaryDownSinceByStore[storeCode];
                        }
                    });

                    // Clean stale stores that no longer exist in current router snapshot.
                    Object.keys(primaryDownSinceByStore).forEach((storeCode) => {
                        if (!seenStores.has(storeCode)) {
                            delete primaryDownSinceByStore[storeCode];
                        }
                    });
                    persistPrimaryDownSinceMap();
                }

                function buildIncidentSnapshot(previousSnapshot = {}, nowMs = Date.now()) {
                    const snapshot = {};
                    const routerDevices = dataMap['routers'] || [];
                    const routerByStoreCode = Object.create(null);
                    const seenRouterStores = new Set();
                    routerDevices.forEach((router) => {
                        const storeCode = extractStoreCode(router.name);
                        if (!storeCode) return;
                        routerByStoreCode[storeCode] = router;
                        seenRouterStores.add(storeCode);
                        const blackoutNow = isStoreFullWanBlackoutRouter(router);
                        const wasBlackout = Boolean(prevIsStoreFullWanBlackoutForIncidentsByCode[storeCode]);
                        if (wasBlackout && !blackoutNow) {
                            wanIncidentRecoveryGraceUntilByCode[storeCode] = nowMs + WAN_DEPENDENT_RECOVERY_GRACE_MS;
                        }
                        if (blackoutNow) {
                            delete wanIncidentRecoveryGraceUntilByCode[storeCode];
                        }
                        prevIsStoreFullWanBlackoutForIncidentsByCode[storeCode] = blackoutNow;
                    });
                    Object.keys(prevIsStoreFullWanBlackoutForIncidentsByCode).forEach((storeCode) => {
                        if (!seenRouterStores.has(storeCode)) {
                            delete prevIsStoreFullWanBlackoutForIncidentsByCode[storeCode];
                            delete wanIncidentRecoveryGraceUntilByCode[storeCode];
                        }
                    });
                    Object.keys(wanIncidentRecoveryGraceUntilByCode).forEach((storeCode) => {
                        if (nowMs >= wanIncidentRecoveryGraceUntilByCode[storeCode]) {
                            delete wanIncidentRecoveryGraceUntilByCode[storeCode];
                        }
                    });
                    REPORTABLE_DEVICE_TYPES.forEach((type) => {
                        const devices = dataMap[type] || [];
                        devices.forEach((device) => {
                            const storeCode = extractStoreCode(device.name);
                            if (!storeCode) return;
                            const incidentDeviceName = buildIncidentDeviceName(device, type);
                            const key = normalizeIncidentKey(incidentDeviceName, type);
                            const rawStatus = device.status === 'active' ? 'online' : 'offline';
                            let status = rawStatus;

                            // Prevent list explosion when primary internet drops for a store:
                            // - keep devices that were already offline before primary drop
                            // - newly offline devices become reportable only after grace period
                            if (rawStatus === 'offline') {
                                const storeRouter = routerByStoreCode[storeCode];
                                const graceUntil = wanIncidentRecoveryGraceUntilByCode[storeCode];
                                const inPostWanRecoveryGrace = graceUntil != null && nowMs < graceUntil;
                                const inWanBlackout = storeRouter && isStoreFullWanBlackoutRouter(storeRouter);
                                // During full WAN blackout and 15m post-recovery, dependent
                                // device offline states are masked (they are expected fallout).
                                if (inWanBlackout || inPostWanRecoveryGrace) {
                                    status = 'online';
                                }
                                const previousStatus = previousSnapshot?.[key]?.status || '';
                                const primaryDownSince = Number(primaryDownSinceByStore[storeCode] || 0);
                                const graceMs = PRIMARY_DOWN_GRACE_MINUTES * 60 * 1000;
                                const withinPrimaryGrace = primaryDownSince > 0 && (nowMs - primaryDownSince) < graceMs;
                                const wasPreviouslyOffline = previousStatus === 'offline';
                                if (status === 'offline' && withinPrimaryGrace && !wasPreviouslyOffline) {
                                    status = 'online';
                                }
                            }
                            snapshot[key] = {
                                deviceName: incidentDeviceName,
                                deviceType: type,
                                storeCode,
                                status
                            };
                        });
                    });

                    routerDevices.forEach((router) => {
                        const storeCode = extractStoreCode(router.name);
                        if (!storeCode) return;
                        const pStatus = String(router.ontPrimaryStatus || '').toLowerCase();
                        const bStatus = String(router.ontBackupStatus || '').toLowerCase();
                        const pText = String(router.ontPrimaryText || '').toLowerCase();
                        const bTextRaw = String(router.ontBackupText != null ? router.ontBackupText : 'UNKNOWN').trim();
                        const bText = bTextRaw.toLowerCase();
                        const primaryIsDown = pStatus === 'down' || /\bdown\b/.test(pText);
                        const primaryIsNone = pStatus === 'none' || /\bnone\b/.test(pText);
                        const primaryIsUp = pStatus === 'up' || /\bup\b/.test(pText);
                        const hasBackupOnt = bTextRaw.toUpperCase() !== 'NONE';
                        const backupIsDown = hasBackupOnt && (bStatus === 'down' || /\bdown\b/.test(bText));
                        const backupIsNone = bStatus === 'none' || bTextRaw.toUpperCase() === 'NONE';
                        const backupIsUp = hasBackupOnt && (bStatus === 'up' || /\bup\b/.test(bText));

                        const fullInternetDown =
                            (primaryIsDown && (backupIsDown || backupIsNone)) ||
                            (primaryIsNone && backupIsDown);
                        const primaryOnlyDown = primaryIsDown && backupIsUp;
                        const backupOnlyDown = primaryIsUp && backupIsDown;

                        const internetKey = normalizeIncidentKey(`${storeCode}-INTERNET`, 'primary-link');
                        snapshot[internetKey] = {
                            deviceName: `${storeCode}-INTERNET`,
                            deviceType: 'primary-link',
                            storeCode,
                            status: fullInternetDown ? 'offline' : 'online'
                        };

                        const key = normalizeIncidentKey(`${storeCode}-PRIMARY`, 'primary-link');
                        snapshot[key] = {
                            deviceName: `${storeCode}-PRIMARY`,
                            deviceType: 'primary-link',
                            storeCode,
                            status: primaryOnlyDown ? 'offline' : 'online'
                        };

                        const backupKey = normalizeIncidentKey(`${storeCode}-BACKUP`, 'backup-link');
                        snapshot[backupKey] = {
                            deviceName: `${storeCode}-BACKUP`,
                            deviceType: 'backup-link',
                            storeCode,
                            status: backupOnlyDown ? 'offline' : 'online'
                        };
                    });
                    return snapshot;
                }

                async function syncIncidentEventsWithBackend() {
                    const previousSnapshot = lastDeviceStatusSnapshot || {};
                    const nowMs = Date.now();
                    refreshPrimaryDownSinceMap(nowMs);
                    const currentSnapshot = buildIncidentSnapshot(previousSnapshot, nowMs);
                    const nowIso = new Date(nowMs).toISOString();
                    const nightContext = getNightWindowContext(new Date(nowMs));

                    // Night freeze: keep devices that were offline at/after 21:00 as offline until 07:10.
                    if (!nightContext.inMonitoringWindow) {
                        Object.keys(currentSnapshot).forEach((key) => {
                            const current = currentSnapshot[key];
                            const previous = previousSnapshot[key];
                            const wasOffline = previous?.status === 'offline';
                            if (wasOffline) {
                                current.status = 'offline';
                                nightFreezeState[key] = { cutoffIso: nightContext.cutoffIso };
                            } else if (current.status === 'offline') {
                                // Newly offline during night window: keep as-is and mark freeze point.
                                nightFreezeState[key] = { cutoffIso: nightContext.cutoffIso };
                            }
                        });
                        persistNightFreezeState();
                    }

                    if (!ENABLE_BROWSER_INCIDENT_EVENTS) {
                        lastDeviceStatusSnapshot = currentSnapshot;
                        persistDeviceStatusSnapshot(currentSnapshot);
                        return;
                    }

                    const eventRequests = [];

                    Object.keys(currentSnapshot).forEach((key) => {
                        const current = currentSnapshot[key];
                        const previous = previousSnapshot[key];
                        const previousStatus = previous?.status || '';

                        if (!previousStatus) {
                            if (current.status === 'offline') {
                                eventRequests.push(
                                    apiRequest('/incidents/events', {
                                        method: 'POST',
                                        body: JSON.stringify({
                                            storeCode: current.storeCode,
                                            deviceName: current.deviceName,
                                            deviceType: current.deviceType,
                                            status: 'offline',
                                            eventTime: nowIso
                                        })
                                    })
                                );
                            }
                            return;
                        }

                        if (previousStatus !== current.status) {
                            let eventTime = nowIso;
                            if (
                                nightContext.inMonitoringWindow &&
                                previousStatus === 'offline' &&
                                current.status === 'online' &&
                                nightFreezeState[key]?.cutoffIso
                            ) {
                                // Device appears online when monitoring resumes; end downtime at 21:00.
                                eventTime = nightFreezeState[key].cutoffIso;
                                delete nightFreezeState[key];
                                persistNightFreezeState();
                            }
                            eventRequests.push(
                                apiRequest('/incidents/events', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                        storeCode: current.storeCode,
                                        deviceName: current.deviceName,
                                        deviceType: current.deviceType,
                                        status: current.status,
                                        eventTime
                                    })
                                })
                            );
                        } else if (current.status === 'offline') {
                            // Keep open incidents visible even after deployments/reloads.
                            // Backend deduplicates open incidents by (store, device, status='open').
                            eventRequests.push(
                                apiRequest('/incidents/events', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                        storeCode: current.storeCode,
                                        deviceName: current.deviceName,
                                        deviceType: current.deviceType,
                                        status: 'offline',
                                        eventTime: nowIso
                                    })
                                })
                            );
                        }
                    });

                    if (eventRequests.length > 0) {
                        await Promise.allSettled(eventRequests);
                    }

                    lastDeviceStatusSnapshot = currentSnapshot;
                    persistDeviceStatusSnapshot(currentSnapshot);
                }

                async function fetchTicketRecordByCandidates(deviceName, deviceType) {
                    const candidates = ticketLookupCandidateNames(deviceName, deviceType);
                    for (const candidateName of candidates) {
                        const payload = await apiRequest(`/tickets/${encodeURIComponent(candidateName)}`);
                        const ticket = payload?.ticket || null;
                        if (ticket) {
                            return { ticket, matchedDeviceName: candidateName };
                        }
                    }
                    return { ticket: null, matchedDeviceName: String(deviceName || '').trim() };
                }

                async function deleteDeviceTicketLinkFromBackend(deviceName) {
                    const query = `actorName=${encodeURIComponent(currentTicketActor)}`;
                    await apiRequest(`/tickets/${encodeURIComponent(deviceName)}?${query}`, {
                        method: 'DELETE'
                    });
                }

                function setupDeleteReportConfirmModal(htmlNode) {
                    const modal = htmlNode.getElementById('delete-report-confirm-modal');
                    if (!modal || modal._deleteConfirmWired) return;
                    modal._deleteConfirmWired = true;
                    deleteReportConfirmModalEl = modal;
                    const finish = (ok) => {
                        if (!modal.classList.contains('show')) return;
                        modal.classList.remove('show');
                        modal.setAttribute('aria-hidden', 'true');
                        modal.style.zIndex = '';
                        const res = modal._pendingResolve;
                        modal._pendingResolve = null;
                        if (typeof res === 'function') res(!!ok);
                    };
                    htmlNode.getElementById('delete-report-confirm-cancel')?.addEventListener('click', () => finish(false));
                    htmlNode.getElementById('delete-report-confirm-confirm')?.addEventListener('click', () => finish(true));
                    htmlNode.getElementById('delete-report-confirm-close')?.addEventListener('click', () => finish(false));
                    modal.addEventListener('click', (e) => {
                        if (e.target === modal) finish(false);
                    });
                    document.addEventListener(
                        'keydown',
                        (e) => {
                            if (e.key !== 'Escape' || !modal.classList.contains('show')) return;
                            e.preventDefault();
                            e.stopPropagation();
                            finish(false);
                        },
                        true
                    );
                }

                function confirmDeleteReportDialog(htmlNode, opts) {
                    const options = opts || {};
                    const modal =
                        deleteReportConfirmModalEl || htmlNode.getElementById('delete-report-confirm-modal');
                    const msgEl = htmlNode.getElementById('delete-report-confirm-message');
                    const titleEl = htmlNode.getElementById('delete-report-confirm-title');
                    const prevMsg = msgEl ? msgEl.textContent : '';
                    const prevTitle = titleEl ? titleEl.textContent : '';
                    if (options.message && msgEl) msgEl.textContent = options.message;
                    if (options.title && titleEl) titleEl.textContent = options.title;
                    const restoreCopy = () => {
                        if (msgEl) msgEl.textContent = prevMsg;
                        if (titleEl) titleEl.textContent = prevTitle;
                    };
                    if (!modal) {
                        const ok = window.confirm(
                            options.message || 'Are you sure you want to delete this report?'
                        );
                        restoreCopy();
                        return Promise.resolve(ok);
                    }
                    return new Promise((resolve) => {
                        const done = (v) => {
                            restoreCopy();
                            resolve(!!v);
                        };
                        modal._pendingResolve = done;
                        modal.style.zIndex = '2147483646';
                        modal.classList.add('show');
                        modal.setAttribute('aria-hidden', 'false');
                        const cancelBtn = htmlNode.getElementById('delete-report-confirm-cancel');
                        const okBtn = htmlNode.getElementById('delete-report-confirm-confirm');
                        (cancelBtn || okBtn)?.focus();
                    });
                }

                async function solveManualTicketFromBackend(deviceName, actorName) {
                    const query = `actorName=${encodeURIComponent(actorName || '')}`;
                    await apiRequest(`/tickets/${encodeURIComponent(deviceName)}/solve?${query}`, {
                        method: 'POST'
                    });
                }

                async function reopenTicketFromBackend(deviceName, actorName) {
                    const query = `actorName=${encodeURIComponent(actorName || '')}`;
                    await apiRequest(`/tickets/${encodeURIComponent(deviceName)}/reopen?${query}`, {
                        method: 'POST'
                    });
                }

                function closePcTicketTagMenu(htmlNode) {
                    const menu = htmlNode.getElementById('pc-ticket-tag-menu');
                    const trigger = htmlNode.getElementById('pc-ticket-tag-trigger');
                    if (menu) menu.hidden = true;
                    if (trigger) trigger.setAttribute('aria-expanded', 'false');
                }

                function openPcTicketTagMenu(htmlNode) {
                    const menu = htmlNode.getElementById('pc-ticket-tag-menu');
                    const trigger = htmlNode.getElementById('pc-ticket-tag-trigger');
                    if (menu) menu.hidden = false;
                    if (trigger) trigger.setAttribute('aria-expanded', 'true');
                }

                function updatePcTicketTagTriggerText(htmlNode) {
                    const tagEl = htmlNode.getElementById('pc-ticket-tag-select');
                    const textEl = htmlNode.getElementById('pc-ticket-tag-trigger-text');
                    if (!tagEl || !textEl) return;
                    const v = normalizeReportTag(tagEl.value);
                    if (v) {
                        textEl.textContent = reportTagLabel(v, v);
                        textEl.classList.remove('is-placeholder');
                    } else {
                        textEl.textContent = 'Select tag';
                        textEl.classList.add('is-placeholder');
                    }
                }

                function rebuildPcTicketTagMenu(htmlNode, tagKeys) {
                    const menu = htmlNode.getElementById('pc-ticket-tag-menu');
                    if (!menu) return;
                    menu.innerHTML = '';
                    const addItem = (slug, label, isPlaceholder) => {
                        const li = document.createElement('li');
                        li.setAttribute('role', 'none');
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = `pc-ticket-tag-menu-item${isPlaceholder ? ' is-placeholder-item' : ''}`;
                        btn.setAttribute('role', 'option');
                        btn.dataset.value = slug;
                        btn.textContent = label;
                        btn.addEventListener('click', (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            const sel = htmlNode.getElementById('pc-ticket-tag-select');
                            if (sel) sel.value = slug;
                            updatePcTicketTagTriggerText(htmlNode);
                            closePcTicketTagMenu(htmlNode);
                            updatePcTicketSaveButtonState(htmlNode);
                        });
                        li.appendChild(btn);
                        menu.appendChild(li);
                    };
                    addItem('', 'Select tag', true);
                    (Array.isArray(tagKeys) ? tagKeys : []).forEach((t) => {
                        const slug = normalizeReportTag(t);
                        if (!slug) return;
                        addItem(slug, reportTagLabel(slug, slug), false);
                    });
                }

                function resolvePcTicketTagForDisplay(htmlNode, tagEl) {
                    if (!tagEl) return '';
                    let v = normalizeReportTag(tagEl.value);
                    if (v) return v;
                    const linkInput = htmlNode.getElementById('pc-ticket-link-input');
                    v = normalizeReportTag(linkInput && linkInput.getAttribute('data-original-tag'));
                    return v || '';
                }

                function wirePcTicketTagPicker(htmlNode) {
                    const trigger = htmlNode.getElementById('pc-ticket-tag-trigger');
                    const menu = htmlNode.getElementById('pc-ticket-tag-menu');
                    if (!trigger || !menu || trigger._pcTicketTagPickerBound) return;
                    trigger._pcTicketTagPickerBound = true;
                    trigger.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        if (trigger.disabled) return;
                        if (menu.hidden) openPcTicketTagMenu(htmlNode);
                        else closePcTicketTagMenu(htmlNode);
                    });
                    if (!panelRuntime.pcTagDocBound) {
                        panelRuntime.pcTagDocBound = true;
                        document.addEventListener(
                            'click',
                            (ev) => {
                                const activeRoot = listenersRootNode || toastRootNode || document;
                                const activeMenu = activeRoot.getElementById && activeRoot.getElementById('pc-ticket-tag-menu');
                                if (!activeMenu || activeMenu.hidden) return;
                                if (ev.target.closest && ev.target.closest('#pc-ticket-tag-picker')) return;
                                closePcTicketTagMenu(activeRoot);
                            },
                            true
                        );
                        document.addEventListener('keydown', (ev) => {
                            const activeRoot = listenersRootNode || toastRootNode || document;
                            const activeMenu = activeRoot.getElementById && activeRoot.getElementById('pc-ticket-tag-menu');
                            if (ev.key !== 'Escape' || !activeMenu || activeMenu.hidden) return;
                            closePcTicketTagMenu(activeRoot);
                        });
                    }
                }

                function closeNiiTagMenu(htmlNode) {
                    const menu = htmlNode.getElementById('nii-tag-menu');
                    const trigger = htmlNode.getElementById('nii-tag-trigger');
                    if (menu) menu.hidden = true;
                    if (trigger) trigger.setAttribute('aria-expanded', 'false');
                }

                function openNiiTagMenu(htmlNode) {
                    const menu = htmlNode.getElementById('nii-tag-menu');
                    const trigger = htmlNode.getElementById('nii-tag-trigger');
                    if (menu) menu.hidden = false;
                    if (trigger) trigger.setAttribute('aria-expanded', 'true');
                }

                function updateNiiTagTriggerText(htmlNode) {
                    const tagEl = htmlNode.getElementById('nii-tag-select');
                    const textEl = htmlNode.getElementById('nii-tag-trigger-text');
                    if (!tagEl || !textEl) return;
                    const v = normalizeReportTag(tagEl.value);
                    if (v) {
                        textEl.textContent = reportTagLabel(v, v);
                        textEl.classList.remove('is-placeholder');
                    } else {
                        textEl.textContent = 'Select tag';
                        textEl.classList.add('is-placeholder');
                    }
                    updateNiiSaveButtonState(htmlNode);
                }

                function rebuildNiiTagMenu(htmlNode) {
                    const menu = htmlNode.getElementById('nii-tag-menu');
                    if (!menu) return;
                    menu.innerHTML = '';
                    const addItem = (slug, label, isPlaceholder) => {
                        const li = document.createElement('li');
                        li.setAttribute('role', 'none');
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = `pc-ticket-tag-menu-item${isPlaceholder ? ' is-placeholder-item' : ''}`;
                        btn.setAttribute('role', 'option');
                        btn.dataset.value = slug;
                        btn.textContent = label;
                        btn.addEventListener('click', (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            const sel = htmlNode.getElementById('nii-tag-select');
                            if (sel) sel.value = slug;
                            updateNiiTagTriggerText(htmlNode);
                            closeNiiTagMenu(htmlNode);
                        });
                        li.appendChild(btn);
                        menu.appendChild(li);
                    };
                    addItem('', 'Select tag', true);
                    DEVICE_REPORT_TAGS.forEach((t) => {
                        const slug = normalizeReportTag(t);
                        if (!slug) return;
                        addItem(slug, reportTagLabel(slug, slug), false);
                    });
                }

                function wireNiiTagPicker(htmlNode) {
                    const trigger = htmlNode.getElementById('nii-tag-trigger');
                    const menu = htmlNode.getElementById('nii-tag-menu');
                    if (!trigger || !menu || trigger._niiTagPickerBound) return;
                    trigger._niiTagPickerBound = true;
                    trigger.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        if (trigger.disabled) return;
                        if (menu.hidden) openNiiTagMenu(htmlNode);
                        else closeNiiTagMenu(htmlNode);
                    });
                    if (!panelRuntime.niiTagDocBound) {
                        panelRuntime.niiTagDocBound = true;
                        document.addEventListener(
                            'click',
                            (ev) => {
                                const activeRoot = listenersRootNode || toastRootNode || document;
                                const activeMenu = activeRoot.getElementById && activeRoot.getElementById('nii-tag-menu');
                                if (!activeMenu || activeMenu.hidden) return;
                                if (ev.target.closest && ev.target.closest('#nii-tag-picker')) return;
                                closeNiiTagMenu(activeRoot);
                            },
                            true
                        );
                        document.addEventListener('keydown', (ev) => {
                            const activeRoot = listenersRootNode || toastRootNode || document;
                            const activeMenu = activeRoot.getElementById && activeRoot.getElementById('nii-tag-menu');
                            if (ev.key !== 'Escape' || !activeMenu || activeMenu.hidden) return;
                            closeNiiTagMenu(activeRoot);
                        });
                    }
                }

                /** Save visible: require CRM URL + tag unless tag-only internet report or clearing ticket. */
                function updatePcTicketSaveButtonState(htmlNode) {
                    const saveBtn = htmlNode.getElementById('pc-ticket-save-btn');
                    const inputEl = htmlNode.getElementById('pc-ticket-link-input');
                    const tagEl = htmlNode.getElementById('pc-ticket-tag-select');
                    if (!saveBtn || !inputEl) return;
                    if (saveBtn.style.display === 'none') {
                        saveBtn.disabled = false;
                        return;
                    }
                    if (!detectLoggedInActor()) {
                        saveBtn.disabled = true;
                        return;
                    }
                    const link = inputEl.value.trim();
                    const tag = normalizeReportTag(tagEl ? tagEl.value : '');
                    const originalLink = String(inputEl.getAttribute('data-original-link') || '').trim();
                    const deviceType = inputEl.getAttribute('data-ticket-device-type') || currentDeviceType;
                    const deviceName = inputEl.getAttribute('data-device-name') || '';
                    const tagAllowsNoTicket =
                        typeof internetReportTagAllowsNoTicket === 'function' &&
                        internetReportTagAllowsNoTicket(tag) &&
                        typeof isInternetIssueType === 'function' &&
                        isInternetIssueType(deviceType, deviceName);
                    if (!link && originalLink) {
                        saveBtn.disabled = false;
                        return;
                    }
                    if (!tag) {
                        saveBtn.disabled = true;
                        return;
                    }
                    if (!link) {
                        saveBtn.disabled = !tagAllowsNoTicket;
                        return;
                    }
                    if (!isValidTicketUrl(link)) {
                        saveBtn.disabled = true;
                        return;
                    }
                    saveBtn.disabled = false;
                }

                /** View mode: tag pill; edit/create: custom tag menu + hidden select for value. */
                function syncPcTicketTagField(htmlNode, opts) {
                    const tagEl = htmlNode.getElementById('pc-ticket-tag-select');
                    const tagDisplayEl = htmlNode.getElementById('pc-ticket-tag-display');
                    const picker = htmlNode.getElementById('pc-ticket-tag-picker');
                    const trigger = htmlNode.getElementById('pc-ticket-tag-trigger');
                    if (!tagEl || !tagDisplayEl) return;
                    const isReported = !!opts.isReported;
                    const isEditMode = !!opts.isEditMode;
                    const canEdit = !!opts.canEdit;
                    const showSelect = !isReported || isEditMode;
                    const tagDisabled = !canEdit || (!isEditMode && isReported);
                    tagEl.disabled = tagDisabled;
                    if (trigger) trigger.disabled = tagDisabled;
                    tagEl.setAttribute('aria-hidden', 'true');
                    closePcTicketTagMenu(htmlNode);
                    updatePcTicketTagTriggerText(htmlNode);
                    if (showSelect) {
                        tagDisplayEl.hidden = true;
                        tagDisplayEl.setAttribute('aria-hidden', 'true');
                        if (picker) picker.hidden = false;
                    } else {
                        if (picker) picker.hidden = true;
                        const v = resolvePcTicketTagForDisplay(htmlNode, tagEl);
                        const label = v ? reportTagLabel(v, v) : '';
                        if (label) {
                            tagDisplayEl.textContent = label;
                            tagDisplayEl.hidden = false;
                            tagDisplayEl.removeAttribute('aria-hidden');
                        } else {
                            tagDisplayEl.textContent = '';
                            tagDisplayEl.hidden = true;
                            tagDisplayEl.setAttribute('aria-hidden', 'true');
                        }
                    }
                }

                async function showDeviceTicketModal(deviceName, deviceStatus, htmlNode, options = {}) {
                    const modal = htmlNode.getElementById('pc-ticket-modal');
                    const titleEl = htmlNode.getElementById('pc-ticket-device-name');
                    const reportedEl = htmlNode.getElementById('pc-ticket-reported-status');
                    const inputEl = htmlNode.getElementById('pc-ticket-link-input');
                    const tagEl = htmlNode.getElementById('pc-ticket-tag-select');
                    const linkViewEl = htmlNode.getElementById('pc-ticket-link-view');
                    const ownerMetaEl = htmlNode.getElementById('pc-ticket-owner-meta');
                    const ownerValueEl = htmlNode.getElementById('pc-ticket-owner-value');
                    const timingsMetaEl = htmlNode.getElementById('pc-ticket-timings-meta');
                    const dtStartEl = htmlNode.getElementById('pc-ticket-dt-start');
                    const dtEndEl = htmlNode.getElementById('pc-ticket-dt-end');
                    const dtDurationEl = htmlNode.getElementById('pc-ticket-dt-duration');
                    const timeToReportEl = htmlNode.getElementById('pc-ticket-time-to-report');
                    const timeToResolveEl = htmlNode.getElementById('pc-ticket-time-to-resolve');
                    const reportedAtRowEl = htmlNode.getElementById('pc-ticket-reported-at-row');
                    const solvedAtRowEl = htmlNode.getElementById('pc-ticket-solved-at-row');
                    const saveBtn = htmlNode.getElementById('pc-ticket-save-btn');
                    const solveBtn = htmlNode.getElementById('pc-ticket-solve-btn');
                    const deleteBtn = htmlNode.getElementById('pc-ticket-delete-btn');
                    const editBtn = htmlNode.getElementById('pc-ticket-edit-btn');
                    const cancelEditBtn = htmlNode.getElementById('pc-ticket-cancel-edit-btn');
                    const ownerLockEl = htmlNode.getElementById('pc-ticket-owner-lock');

                    if (!modal || !titleEl || !inputEl) return;

                    const effectiveDeviceType = options.deviceType || currentDeviceType;
                    if (options.deviceType) {
                        inputEl.setAttribute('data-ticket-device-type', options.deviceType);
                    } else {
                        inputEl.removeAttribute('data-ticket-device-type');
                    }

                    const resolvedDeviceName = resolveTicketDeviceName(deviceName, effectiveDeviceType);
                    let ticketDeviceNameForCrud = resolvedDeviceName;
                    let currentLink = '';
                    let currentTag = '';
                    let ownerName = '';
                    const prefillLink = String(options.prefillTicketUrl || '').trim();
                    const prefillOwner = String(options.prefillOwnerName || '').trim();
                    const prefillTag = normalizeReportTag(options.prefillReportTag || '');
                    try {
                        const lookup = await fetchTicketRecordByCandidates(resolvedDeviceName, effectiveDeviceType);
                        const ticket = lookup?.ticket || null;
                        ticketDeviceNameForCrud = lookup?.matchedDeviceName || resolvedDeviceName;
                        currentLink = ticket?.ticket_url || '';
                        currentTag = normalizeReportTag(ticket?.report_tag || '');
                        ownerName = normalizeOwnerUsername(ticket?.owner_name || '', '');
                        const key = normalizeDeviceKey(ticketDeviceNameForCrud);
                        if (currentLink) {
                            deviceTicketLinks[key] = currentLink;
                            ticketLookupCandidateNames(resolvedDeviceName, effectiveDeviceType).forEach((name) => {
                                deviceTicketLinks[normalizeDeviceKey(name)] = currentLink;
                            });
                        } else {
                            delete deviceTicketLinks[key];
                        }
                    } catch (error) {
                        currentLink = '';
                        showToast(`Ticket lookup failed: ${error.message}`, 'warning');
                    }
                    if (!currentLink && prefillLink) currentLink = prefillLink;
                    if (!ownerName && prefillOwner) ownerName = normalizeOwnerUsername(prefillOwner, '');
                    if (!currentTag && prefillTag) currentTag = prefillTag;
                    currentTicketActor = detectLoggedInActor();
                    titleEl.textContent = formatDeviceLabel(resolvedDeviceName, effectiveDeviceType);
                    inputEl.value = currentLink;
                    inputEl.setAttribute('data-original-link', currentLink);
                    inputEl.setAttribute('data-original-tag', currentTag);
                    inputEl.setAttribute('data-device-name', ticketDeviceNameForCrud);
                    inputEl.setAttribute('data-device-status', deviceStatus || '');
                    inputEl.setAttribute('data-owner-name', ownerName);
                    inputEl.setAttribute('data-report-source', String(options.reportSource || '').toLowerCase());
                    inputEl.setAttribute('data-incident-status', String(options.incidentStatus || '').toLowerCase());
                    if (tagEl) {
                        const tags = allowedTagsForDevice(effectiveDeviceType, resolvedDeviceName);
                        tagEl.innerHTML = ['<option value="">Select tag</option>']
                            .concat(tags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(reportTagLabel(t, t))}</option>`))
                            .join('');
                        tagEl.value = currentTag;
                        rebuildPcTicketTagMenu(htmlNode, tags);
                    }
                    const isTagOnlyReported =
                        !currentLink &&
                        typeof internetReportTagAllowsNoTicket === 'function' &&
                        internetReportTagAllowsNoTicket(currentTag) &&
                        typeof isInternetIssueType === 'function' &&
                        isInternetIssueType(effectiveDeviceType, resolvedDeviceName) &&
                        (!!String(options.reportedAt || '').trim() || !!normalizeReportTag(prefillTag));
                    const isReported = !!currentLink || isTagOnlyReported;
                    if (ownerValueEl) {
                        ownerValueEl.textContent = ownerDisplayName(ownerName, isReported ? '—' : '-');
                    }
                    if (ownerMetaEl) {
                        ownerMetaEl.style.display = isReported || !!ownerName ? 'flex' : 'none';
                    }
                    const dtStart = String(options.downtimeStart || '').trim() || '—';
                    const dtEnd = String(options.downtimeEnd || '').trim() || '—';
                    const dtDuration = String(options.downtimeDuration || '').trim() || '—';
                    const ttr = String(options.reportedAt || '').trim() || 'N/A';
                    const ttrResolve = String(options.solvedAt || '').trim() || 'Unresolved';
                    if (dtStartEl) dtStartEl.textContent = dtStart;
                    if (dtEndEl) dtEndEl.textContent = dtEnd;
                    if (dtDurationEl) dtDurationEl.textContent = dtDuration;
                    if (timeToReportEl) timeToReportEl.textContent = ttr;
                    if (timeToResolveEl) timeToResolveEl.textContent = ttrResolve;
                    if (reportedAtRowEl) reportedAtRowEl.style.display = isReported ? 'flex' : 'none';
                    if (solvedAtRowEl) solvedAtRowEl.style.display = isReported ? 'flex' : 'none';
                    if (timingsMetaEl) timingsMetaEl.style.display = 'flex';
                    const hasActor = !!currentTicketActor;
                    const canEdit = hasActor;
                    const isManualReportedIssue = String(options.reportSource || '').toLowerCase() === 'crm_manual';
                    const canSolveManual = isReported && canEdit && isManualReportedIssue;
                    const reopenBtnModal = htmlNode.getElementById('pc-ticket-reopen-btn');
                    const setMode = (mode) => {
                        const isEditMode = mode === 'edit';
                        const incidentSt = String(inputEl.getAttribute('data-incident-status') || '').toLowerCase();
                        const isClosedIncident = incidentSt === 'closed';
                        if (inputEl) {
                            inputEl.disabled = !canEdit || (!isEditMode && isReported);
                            inputEl.style.display = isEditMode || !isReported ? 'block' : 'none';
                        }
                        syncPcTicketTagField(htmlNode, { isReported, isEditMode, canEdit });
                        if (linkViewEl) {
                            if (isReported && !isEditMode) {
                                linkViewEl.href = currentLink;
                                linkViewEl.textContent = currentLink;
                                linkViewEl.style.display = 'inline-flex';
                            } else {
                                linkViewEl.style.display = 'none';
                            }
                        }
                        if (saveBtn) saveBtn.style.display = isEditMode || !isReported ? 'inline-flex' : 'none';
                        if (solveBtn) {
                            solveBtn.style.display =
                                isReported && canSolveManual && !isEditMode && !isClosedIncident ? 'inline-flex' : 'none';
                        }
                        if (reopenBtnModal) {
                            reopenBtnModal.style.display =
                                isReported &&
                                canEdit &&
                                !isEditMode &&
                                isClosedIncident &&
                                isManualReportedIssue
                                    ? 'inline-flex'
                                    : 'none';
                        }
                        if (editBtn) editBtn.style.display = isReported && canEdit && !isEditMode ? 'inline-flex' : 'none';
                        if (cancelEditBtn) cancelEditBtn.style.display = isReported && canEdit && isEditMode ? 'inline-flex' : 'none';
                        if (deleteBtn) deleteBtn.style.display = isReported && canEdit && !isEditMode ? 'inline-flex' : 'none';
                        modal.setAttribute('data-ticket-mode', mode);
                        updatePcTicketSaveButtonState(htmlNode);
                    };

                    setMode(isReported ? 'view' : 'edit');
                    if (ownerLockEl) {
                        if (!hasActor) {
                            ownerLockEl.textContent = 'Could not detect logged-in user from Grafana session.';
                            ownerLockEl.style.display = 'block';
                        } else {
                            ownerLockEl.style.display = 'none';
                        }
                    }

                    if (reportedEl) {
                        const incidentStOpen = String(inputEl.getAttribute('data-incident-status') || '').toLowerCase();
                        if (isReported && incidentStOpen === 'closed') {
                            reportedEl.textContent = 'Solved';
                            reportedEl.classList.add('reported');
                        } else {
                            reportedEl.textContent = isReported ? 'Reported' : 'Not Reported';
                            reportedEl.classList.toggle('reported', isReported);
                        }
                    }

                    modal.classList.add('show');
                    modal.setAttribute('aria-hidden', 'false');
                    if (!isReported) {
                        setTimeout(() => inputEl.focus(), 0);
                    }
                }

                function setupDeviceTicketModal(htmlNode) {
                    const modal = htmlNode.getElementById('pc-ticket-modal');
                    const closeBtn = htmlNode.getElementById('pc-ticket-close');
                    const saveBtn = htmlNode.getElementById('pc-ticket-save-btn');
                    const solveBtn = htmlNode.getElementById('pc-ticket-solve-btn');
                    const reopenBtn = htmlNode.getElementById('pc-ticket-reopen-btn');
                    const deleteBtn = htmlNode.getElementById('pc-ticket-delete-btn');
                    const editBtn = htmlNode.getElementById('pc-ticket-edit-btn');
                    const cancelEditBtn = htmlNode.getElementById('pc-ticket-cancel-edit-btn');
                    const inputEl = htmlNode.getElementById('pc-ticket-link-input');
                    const tagEl = htmlNode.getElementById('pc-ticket-tag-select');

                    if (!modal || !inputEl) return;

                    wirePcTicketTagPicker(htmlNode);

                    inputEl.addEventListener('input', () => updatePcTicketSaveButtonState(htmlNode));

                    const closeModal = () => {
                        closePcTicketTagMenu(htmlNode);
                        modal.classList.remove('show');
                        modal.setAttribute('aria-hidden', 'true');
                    };

                    if (closeBtn) closeBtn.onclick = closeModal;

                    modal.onclick = (e) => {
                        if (e.target === modal) closeModal();
                    };

                    if (editBtn) {
                        editBtn.onclick = () => {
                            const actorName = detectLoggedInActor();
                            if (!actorName) {
                                showToast('Could not detect logged-in Grafana user', 'warning');
                                return;
                            }
                            modal.setAttribute('data-ticket-mode', 'edit');
                            inputEl.style.display = 'block';
                            inputEl.disabled = false;
                            syncPcTicketTagField(htmlNode, {
                                isReported: true,
                                isEditMode: true,
                                canEdit: !!actorName
                            });
                            const linkViewEl = htmlNode.getElementById('pc-ticket-link-view');
                            if (linkViewEl) linkViewEl.style.display = 'none';
                            if (saveBtn) saveBtn.style.display = 'inline-flex';
                            if (solveBtn) solveBtn.style.display = 'none';
                            if (reopenBtn) reopenBtn.style.display = 'none';
                            if (editBtn) editBtn.style.display = 'none';
                            if (deleteBtn) deleteBtn.style.display = 'none';
                            if (cancelEditBtn) cancelEditBtn.style.display = 'inline-flex';
                            inputEl.focus();
                            updatePcTicketSaveButtonState(htmlNode);
                        };
                    }

                    if (cancelEditBtn) {
                        cancelEditBtn.onclick = () => {
                            const originalLink = inputEl.getAttribute('data-original-link') || '';
                            const originalTag = normalizeReportTag(inputEl.getAttribute('data-original-tag') || '');
                            inputEl.value = originalLink;
                            if (tagEl) tagEl.value = originalTag;
                            inputEl.style.display = 'none';
                            inputEl.disabled = true;
                            const linkViewEl = htmlNode.getElementById('pc-ticket-link-view');
                            if (linkViewEl && originalLink) {
                                linkViewEl.href = originalLink;
                                linkViewEl.textContent = originalLink;
                                linkViewEl.style.display = 'inline-flex';
                            }
                            if (saveBtn) saveBtn.style.display = 'none';
                            const actorName = detectLoggedInActor();
                            syncPcTicketTagField(htmlNode, {
                                isReported: true,
                                isEditMode: false,
                                canEdit: !!actorName
                            });
                            const reportSource = String(inputEl.getAttribute('data-report-source') || '').toLowerCase();
                            const incidentSt = String(inputEl.getAttribute('data-incident-status') || '').toLowerCase();
                            const isClosedIncident = incidentSt === 'closed';
                            const canSolveManual = actorName && reportSource === 'crm_manual';
                            if (solveBtn) {
                                solveBtn.style.display =
                                    canSolveManual && !isClosedIncident ? 'inline-flex' : 'none';
                            }
                            if (reopenBtn) {
                                reopenBtn.style.display =
                                    actorName && isClosedIncident && reportSource === 'crm_manual'
                                        ? 'inline-flex'
                                        : 'none';
                            }
                            if (editBtn) editBtn.style.display = 'inline-flex';
                            if (deleteBtn) deleteBtn.style.display = 'inline-flex';
                            if (cancelEditBtn) cancelEditBtn.style.display = 'none';
                            modal.setAttribute('data-ticket-mode', 'view');
                            updatePcTicketSaveButtonState(htmlNode);
                        };
                    }

                    if (solveBtn) {
                        solveBtn.onclick = async () => {
                            const deviceName = inputEl.getAttribute('data-device-name') || '';
                            const reportSource = String(inputEl.getAttribute('data-report-source') || '').toLowerCase();
                            const actorName = detectLoggedInActor();
                            currentTicketActor = actorName;
                            if (!deviceName || !actorName) {
                                showToast('Could not detect logged-in Grafana user', 'warning');
                                return;
                            }
                            if (reportSource !== 'crm_manual') {
                                showToast('Only Non Internet Issue reports can be solved manually', 'warning');
                                return;
                            }
                            solveBtn.disabled = true;
                            solveBtn.textContent = 'Solving…';
                            try {
                                await solveManualTicketFromBackend(deviceName, actorName);
                                showToast(`Marked as solved: ${formatDeviceToastLabel(deviceName)}`, 'success');
                                closeModal();
                                liveUnreportedRowsCache = [];
                                liveReportedRowsCache = [];
                                liveSolvedRowsCache = [];
                                liveUnreportedRawAccum = [];
                                liveUnreportedLastMeta = { total: null, sqlLoaded: 0, hasMore: false };
                                if (!(await refreshLiveIncidentSectionsInstant(htmlNode))) {
                                    updateMainView(htmlNode);
                                }
                            } catch (error) {
                                showToast(`Solve failed: ${error.message || error}`, 'error');
                            } finally {
                                solveBtn.disabled = false;
                                solveBtn.textContent = 'Solved';
                            }
                        };
                    }

                    if (reopenBtn) {
                        reopenBtn.onclick = async () => {
                            const deviceName = inputEl.getAttribute('data-device-name') || '';
                            const reportSource = String(inputEl.getAttribute('data-report-source') || '').toLowerCase();
                            const actorName = detectLoggedInActor();
                            currentTicketActor = actorName;
                            if (!deviceName || !actorName) {
                                showToast('Could not detect logged-in Grafana user', 'warning');
                                return;
                            }
                            if (reportSource !== 'crm_manual') {
                                showToast('Only Non Internet Issue reports can be reopened', 'warning');
                                return;
                            }
                            reopenBtn.disabled = true;
                            reopenBtn.textContent = 'Reopening…';
                            try {
                                await reopenTicketFromBackend(deviceName, actorName);
                                inputEl.setAttribute('data-incident-status', 'open');
                                const reportedEl = htmlNode.getElementById('pc-ticket-reported-status');
                                if (reportedEl) {
                                    reportedEl.textContent = 'Reported';
                                    reportedEl.classList.add('reported');
                                }
                                if (reopenBtn) reopenBtn.style.display = 'none';
                                if (solveBtn) {
                                    const reportSource = String(inputEl.getAttribute('data-report-source') || '').toLowerCase();
                                    if (reportSource === 'crm_manual') solveBtn.style.display = 'inline-flex';
                                }
                                showToast(`Reopened to Reported: ${formatDeviceToastLabel(deviceName)}`, 'success');
                                closeModal();
                                liveUnreportedRowsCache = [];
                                liveReportedRowsCache = [];
                                liveSolvedRowsCache = [];
                                liveUnreportedRawAccum = [];
                                liveUnreportedLastMeta = { total: null, sqlLoaded: 0, hasMore: false };
                                if (!(await refreshLiveIncidentSectionsInstant(htmlNode))) {
                                    updateMainView(htmlNode);
                                }
                            } catch (error) {
                                showToast(`Reopen failed: ${error.message || error}`, 'error');
                            } finally {
                                reopenBtn.disabled = false;
                                reopenBtn.textContent = 'Reopen';
                            }
                        };
                    }

                    if (saveBtn) {
                        saveBtn.onclick = async () => {
                            if (saveBtn.disabled) return;
                            const deviceName = inputEl.getAttribute('data-device-name') || '';
                            const key = normalizeDeviceKey(deviceName);
                            const link = inputEl.value.trim();
                            const reportTag = normalizeReportTag(tagEl ? tagEl.value : '');
                            const originalLink = String(inputEl.getAttribute('data-original-link') || '').trim();
                            const ticketDeviceType = inputEl.getAttribute('data-ticket-device-type') || currentDeviceType;
                            const actorName = detectLoggedInActor();
                            currentTicketActor = actorName;

                            if (!deviceName) return;
                            if (!actorName) {
                                showToast('Could not detect logged-in Grafana user', 'warning');
                                return;
                            }
                            if (!link) {
                                if (originalLink) {
                                    if (!(await confirmDeleteReportDialog(htmlNode))) return;
                                    try {
                                        await deleteDeviceTicketLinkFromBackend(deviceName);
                                        delete deviceTicketLinks[key];
                                        showToast(`Ticket link removed for ${formatDeviceToastLabel(deviceName)}`, 'info');
                                        closeModal();
                                        return;
                                    } catch (error) {
                                        showToast(`Delete failed: ${error.message}`, 'error');
                                        return;
                                    }
                                }
                                const tagAllowsNoTicket =
                                    typeof internetReportTagAllowsNoTicket === 'function' &&
                                    internetReportTagAllowsNoTicket(reportTag) &&
                                    typeof isInternetIssueType === 'function' &&
                                    isInternetIssueType(ticketDeviceType, deviceName);
                                if (!tagAllowsNoTicket) {
                                    showToast('CRM ticket link is required for this tag', 'warning');
                                    return;
                                }
                            } else if (!isValidTicketUrl(link)) {
                                showToast('Use a HTTPS CRM URL starting with https://crm.avroraro.lan/workgroups/group/', 'warning');
                                return;
                            }
                            if (!reportTag) {
                                showToast('Tag is required', 'warning');
                                return;
                            }

                            try {
                                const reportSource = String(inputEl.getAttribute('data-report-source') || '').toLowerCase();
                                // Non Internet Issue rows live only in crm_device_tickets; linking would
                                // create a device_incidents row and duplicate them in Live / reporting.
                                const ticketPath = `/tickets/${encodeURIComponent(deviceName)}`;
                                const ticketUrlApi =
                                    reportSource === 'crm_manual' ? `${ticketPath}?mark_incident=false` : ticketPath;
                                const payload = await apiRequest(ticketUrlApi, {
                                    method: 'PUT',
                                    body: JSON.stringify({
                                        ticketUrl: link,
                                        deviceType: ticketDeviceType,
                                        storeCode: extractStoreCode(deviceName),
                                        actorName,
                                        reportTag
                                    })
                                });
                                const savedUrl = payload?.ticket?.ticket_url || link;
                                const savedOwner = normalizeOwnerUsername(payload?.ticket?.owner_name || actorName, '');
                                deviceTicketLinks[key] = savedUrl;
                                inputEl.setAttribute('data-original-link', savedUrl);
                                inputEl.setAttribute('data-original-tag', normalizeReportTag(payload?.ticket?.report_tag || reportTag));
                                inputEl.setAttribute('data-owner-name', savedOwner);
                                if (tagEl) tagEl.value = normalizeReportTag(payload?.ticket?.report_tag || reportTag);
                                const ownerValueEl = htmlNode.getElementById('pc-ticket-owner-value');
                                if (ownerValueEl) ownerValueEl.textContent = ownerDisplayName(savedOwner, '-');
                            } catch (error) {
                                showToast(`Save failed: ${error.message}`, 'error');
                                return;
                            }
                            const reportedEl = htmlNode.getElementById('pc-ticket-reported-status');
                            if (reportedEl) {
                                reportedEl.textContent = 'Reported';
                                reportedEl.classList.add('reported');
                            }
                            showToast(`Ticket link saved for ${formatDeviceToastLabel(deviceName)}`, 'success');
                            closeModal();
                            liveUnreportedRowsCache = [];
                            liveReportedRowsCache = [];
                            liveSolvedRowsCache = [];
                            liveUnreportedRawAccum = [];
                            liveUnreportedLastMeta = { total: null, sqlLoaded: 0, hasMore: false };
                            if (!(await refreshLiveIncidentSectionsInstant(htmlNode))) {
                                updateMainView(htmlNode);
                            }
                        };
                    }

                    if (deleteBtn) {
                        deleteBtn.onclick = async () => {
                            const deviceName = inputEl.getAttribute('data-device-name') || '';
                            const key = normalizeDeviceKey(deviceName);
                            const actorName = detectLoggedInActor();
                            currentTicketActor = actorName;
                            if (!deviceName || !actorName) {
                                showToast('Could not detect logged-in Grafana user', 'warning');
                                return;
                            }
                            if (!(await confirmDeleteReportDialog(htmlNode))) return;
                            try {
                                await deleteDeviceTicketLinkFromBackend(deviceName);
                                delete deviceTicketLinks[key];
                                showToast(`Ticket link removed for ${formatDeviceToastLabel(deviceName)}`, 'info');
                                closeModal();
                                liveUnreportedRowsCache = [];
                                liveReportedRowsCache = [];
                                liveSolvedRowsCache = [];
                                liveUnreportedRawAccum = [];
                                liveUnreportedLastMeta = { total: null, sqlLoaded: 0, hasMore: false };
                                if (!(await refreshLiveIncidentSectionsInstant(htmlNode))) {
                                    updateMainView(htmlNode);
                                }
                            } catch (error) {
                                showToast(`Delete failed: ${error.message}`, 'error');
                            }
                        };
                    }
                }

                function setupNonInternetIssueModal(htmlNode) {
                    const openBtn = htmlNode.getElementById('non-internet-issue-btn');
                    const modal = htmlNode.getElementById('non-internet-issue-modal');
                    const closeBtn = htmlNode.getElementById('non-internet-issue-close');
                    const cancelBtn = htmlNode.getElementById('non-internet-issue-cancel');
                    const saveBtn = htmlNode.getElementById('non-internet-issue-save');
                    const storeInput = htmlNode.getElementById('nii-store-input');
                    const deviceSelect = htmlNode.getElementById('nii-device-select');
                    const numberRow = htmlNode.getElementById('nii-device-number-row');
                    const numberInput = htmlNode.getElementById('nii-device-number-input');
                    const cashNumberSelect = htmlNode.getElementById('nii-cash-number-select');
                    const linkInput = htmlNode.getElementById('nii-link-input');
                    const tagSelect = htmlNode.getElementById('nii-tag-select');

                    if (!openBtn || !modal || !storeInput || !deviceSelect || !linkInput || !tagSelect) return;

                    const numberMode = () => {
                        const v = String(deviceSelect.value || '').trim();
                        if (v === 'cash-register') return 'cash';
                        if (v === 'price-checkers') return 'price';
                        return 'none';
                    };

                    const syncDeviceNumberRow = () => {
                        if (!numberRow || !numberInput) return;
                        const mode = numberMode();
                        const show = mode !== 'none';
                        numberRow.style.display = show ? 'block' : 'none';
                        if (!show) {
                            numberInput.value = '';
                            numberInput.removeAttribute('maxlength');
                            if (cashNumberSelect) cashNumberSelect.value = '1';
                            return;
                        }
                        if (mode === 'cash') {
                            if (cashNumberSelect) cashNumberSelect.style.display = 'block';
                            numberInput.style.display = 'none';
                            numberInput.value = '';
                            numberInput.removeAttribute('maxlength');
                        } else {
                            if (cashNumberSelect) cashNumberSelect.style.display = 'none';
                            numberInput.style.display = 'block';
                            numberInput.setAttribute('maxlength', '2');
                            let d = normalizeStoreDigits(numberInput.value);
                            if (d.length > 2) d = d.slice(0, 2);
                            if (numberInput.value !== d) numberInput.value = d;
                        }
                    };

                    const normalizeStoreDigits = (value) => String(value || '').replace(/\D/g, '');

                    const closeModal = () => {
                        closeNiiTagMenu(htmlNode);
                        modal.classList.remove('show');
                        modal.setAttribute('aria-hidden', 'true');
                    };

                    const openModal = () => {
                        syncDeviceNumberRow();
                        closeNiiTagMenu(htmlNode);
                        updateNiiTagTriggerText(htmlNode);
                        updateNiiSaveButtonState(htmlNode);
                        modal.classList.add('show');
                        modal.setAttribute('aria-hidden', 'false');
                        setTimeout(() => storeInput.focus(), 0);
                    };

                    rebuildNiiTagMenu(htmlNode);
                    wireNiiTagPicker(htmlNode);

                    openBtn.onclick = openModal;
                    if (closeBtn) closeBtn.onclick = closeModal;
                    if (cancelBtn) cancelBtn.onclick = closeModal;
                    deviceSelect.onchange = () => {
                        syncDeviceNumberRow();
                        updateNiiSaveButtonState(htmlNode);
                    };
                    storeInput.oninput = () => {
                        const digits = normalizeStoreDigits(storeInput.value);
                        if (storeInput.value !== digits) storeInput.value = digits;
                        updateNiiSaveButtonState(htmlNode);
                    };
                    if (numberInput) {
                        numberInput.oninput = () => {
                            if (numberMode() !== 'price') return;
                            let digits = normalizeStoreDigits(numberInput.value);
                            if (digits.length > 2) digits = digits.slice(0, 2);
                            if (numberInput.value !== digits) numberInput.value = digits;
                            updateNiiSaveButtonState(htmlNode);
                        };
                    }
                    if (linkInput) {
                        linkInput.addEventListener('input', () => updateNiiSaveButtonState(htmlNode));
                    }
                    if (cashNumberSelect) {
                        cashNumberSelect.addEventListener('change', () => updateNiiSaveButtonState(htmlNode));
                    }
                    modal.onclick = (e) => {
                        if (e.target === modal) closeModal();
                    };

                    if (saveBtn) {
                        saveBtn.onclick = async () => {
                            if (saveBtn.disabled) return;
                            const actorName = detectLoggedInActor();
                            currentTicketActor = actorName;
                            if (!actorName) {
                                showToast('Could not detect logged-in Grafana user', 'warning');
                                return;
                            }

                            const storeDigits = normalizeStoreDigits(storeInput.value);
                            storeInput.value = storeDigits;
                            if (!storeDigits) {
                                showToast('Store number must contain only digits', 'warning');
                                return;
                            }
                            const normalizedStoreCode = normalizeStoreCodeInput(storeDigits);
                            if (!normalizedStoreCode || !/^AR\d+$/.test(normalizedStoreCode)) {
                                showToast('Enter a valid store number (digits only)', 'warning');
                                return;
                            }
                            const knownStores = knownStoreCodesSet();
                            if (!knownStores.has(normalizedStoreCode)) {
                                showToast(`Store ${normalizedStoreCode} does not exist in Overview`, 'warning');
                                return;
                            }
                            if (numberMode() === 'price' && numberInput) {
                                const priceDigits = normalizeStoreDigits(numberInput.value).slice(0, 2);
                                numberInput.value = priceDigits;
                                if (!priceDigits) {
                                    showToast('Device number must contain only digits', 'warning');
                                    return;
                                }
                            }

                            const link = String(linkInput.value || '').trim();
                            const reportTag = normalizeReportTag(tagSelect.value);
                            if (!isValidCrmTicketUrl(link)) {
                                showToast('Use a HTTPS CRM URL starting with https://crm.avroraro.lan/workgroups/group/', 'warning');
                                return;
                            }
                            if (!reportTag) {
                                showToast('Tag is required', 'warning');
                                return;
                            }

                            let payload;
                            try {
                                payload = buildNonInternetIssuePayload(
                                    storeInput.value,
                                    deviceSelect.value,
                                    numberInput ? numberInput.value : '',
                                    cashNumberSelect ? cashNumberSelect.value : ''
                                );
                                if (deviceSelect.value === 'price-checkers' && numberInput) {
                                    const parts = String(payload.deviceName || '').split('-');
                                    numberInput.value = parts[parts.length - 1] || numberInput.value;
                                }
                            } catch (error) {
                                showToast(error.message || String(error), 'warning');
                                return;
                            }

                            try {
                                await apiRequest(`/tickets/${encodeURIComponent(payload.deviceName)}?mark_incident=false`, {
                                    method: 'PUT',
                                    body: JSON.stringify({
                                        ticketUrl: link,
                                        deviceType: payload.deviceType,
                                        storeCode: payload.storeCode,
                                        actorName,
                                        reportTag
                                    })
                                });
                                const linkKey = normalizeDeviceKey(payload.deviceName);
                                deviceTicketLinks[linkKey] = link;
                                const aliases = ticketLookupCandidateNames(payload.deviceName, payload.deviceType);
                                aliases.forEach((name) => {
                                    if (name) deviceTicketLinks[normalizeDeviceKey(name)] = link;
                                });
                                showToast(`Ticket link saved for ${formatDeviceToastLabel(payload.deviceName)}`, 'success');
                                closeModal();
                                storeInput.value = '';
                                if (numberInput) numberInput.value = '';
                                if (cashNumberSelect) cashNumberSelect.value = '1';
                                linkInput.value = '';
                                tagSelect.value = '';
                                updateNiiTagTriggerText(htmlNode);
                                closeNiiTagMenu(htmlNode);
                                deviceSelect.value = 'price-checkers';
                                syncDeviceNumberRow();
                                updateNiiSaveButtonState(htmlNode);
                                liveUnreportedRowsCache = [];
                                liveReportedRowsCache = [];
                                liveSolvedRowsCache = [];
                                liveUnreportedRawAccum = [];
                                liveUnreportedLastMeta = { total: null, sqlLoaded: 0, hasMore: false };
                                if (!(await refreshLiveIncidentSectionsInstant(htmlNode))) {
                                    updateMainView(htmlNode);
                                }
                            } catch (error) {
                                showToast(`Save failed: ${error.message || error}`, 'error');
                            }
                        };
                    }
                }

                function canOpenTicketModalForCurrentDeviceType() {
                    // Ticket/report creation is allowed only from Live -> Incidents.
                    return (
                        currentDashboardPage === 'live' &&
                        !isOfflineViewActive &&
                        currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE
                    );
                }

                // ============================================================================
                // 4. RENDERING
                // ============================================================================

                // Offline Time Report — implementation in modules/render-offline.js.
                function buildOfflineStoreData() {
                    const mod = window.GFN_RENDER_OFFLINE;
                    if (!mod) return [];
                    return mod.buildOfflineStoreData(offlineReportData, dataMap);
                }

                async function refreshOfflineInternetReportCaches() {
                    const bounds = getEffectiveRangeBounds();
                    const rangeKey = `${Math.floor(bounds.fromMs)}_${Math.floor(bounds.toMs)}`;
                    const token = ++offlineInternetReportFetchToken;
                    const spanMs = Math.max(0, Number(bounds.toMs || 0) - Number(bounds.fromMs || 0));
                    const days = Math.max(1, Math.ceil(spanMs / (1000 * 60 * 60 * 24)));
                    const rangeQuery = `days=${days}&from_ms=${Math.floor(bounds.fromMs)}&to_ms=${Math.floor(bounds.toMs)}`;
                    try {
                        const [poRes, plannedRes] = await Promise.all([
                            apiRequest(`/reporting/internet-power-outage?${rangeQuery}`),
                            apiRequest(`/reporting/internet-power-outage?${rangeQuery}&tag=planned`)
                        ]);
                        if (token !== offlineInternetReportFetchToken) {
                            return { powerOutageByStore: offlinePowerOutageByStore, plannedByStore: offlinePlannedByStore };
                        }
                        const poRows = Array.isArray(poRes?.rows) ? poRes.rows : [];
                        const plannedRows = Array.isArray(plannedRes?.rows) ? plannedRes.rows : [];
                        offlinePowerOutageByStore = buildPowerOutageMinutesByStore(
                            poRows,
                            bounds.fromMs,
                            bounds.toMs,
                            OFFLINE_UPTIME_SCHEDULE,
                            scheduledMinutesInRange
                        );
                        offlinePlannedByStore = buildPlannedMinutesByStore(
                            plannedRows,
                            bounds.fromMs,
                            bounds.toMs,
                            OFFLINE_UPTIME_SCHEDULE,
                            scheduledMinutesInRange
                        );
                        offlineInternetReportRangeKey = rangeKey;
                    } catch (err) {
                        console.warn('[Offline Time Report] internet report fetch failed', err);
                    }
                    return { powerOutageByStore: offlinePowerOutageByStore, plannedByStore: offlinePlannedByStore };
                }

                function renderOfflineTable(htmlNode) {
                    const mod = window.GFN_RENDER_OFFLINE;
                    if (!mod) return;
                    const paint = () => {
                        mod.renderOfflineTable(htmlNode, {
                            offlineReportData,
                            searchQuery,
                            sortColumn: offlineSortColumn,
                            sortDirection: offlineSortDirection,
                            sortMode: offlineSortMode,
                            latestGrafanaData,
                            dataMap,
                            getEffectiveRangeBounds,
                            powerOutageByStore: offlinePowerOutageByStore,
                            plannedByStore: offlinePlannedByStore
                        });
                    };
                    paint();
                    refreshOfflineInternetReportCaches().then(() => {
                        if (!isOfflineViewActive) return;
                        paint();
                    }).catch(() => {});
                }

                function setupOfflineTableHeaderSorting(htmlNode) {
                    const mod = window.GFN_RENDER_OFFLINE;
                    if (!mod) return;
                    mod.setupOfflineTableHeaderSorting(htmlNode, {
                        getSort: () => ({ column: offlineSortColumn, direction: offlineSortDirection }),
                        onSortChange: (key, dir) => {
                            offlineSortColumn = key;
                            offlineSortDirection = dir;
                            localStorage.setItem(STORAGE_KEY_OFFLINE_SORT_COLUMN, offlineSortColumn);
                            localStorage.setItem(STORAGE_KEY_OFFLINE_SORT_DIRECTION, offlineSortDirection);
                            if (isOfflineViewActive) renderOfflineTable(htmlNode);
                        }
                    });
                }

                function apiHasMoreTrue(v) {
                    return v === true || v === 1;
                }

                function renderUnreportedLiveMetaBar(htmlNode, { shown, total, sqlLoaded, hasMore, loading }) {
                    const el = htmlNode.getElementById('unreported-live-meta');
                    if (!el) return;
                    // Incidents should behave like a live board, not a manual
                    // paginated report. Extra pages are loaded automatically by
                    // loadAllUnreportedLivePages(), so the old "Load more"
                    // control is intentionally hidden.
                    el.hidden = true;
                    el.innerHTML = '';
                    return;
                    if (currentDeviceType !== LIVE_UNREPORTED_DEVICE_TYPE) {
                        el.hidden = true;
                        el.innerHTML = '';
                        return;
                    }
                    if (loading && !sqlLoaded) {
                        el.hidden = true;
                        el.innerHTML = '';
                        return;
                    }
                    const totalNumForEmpty = total != null ? Number(total) : NaN;
                    const noRowsLoaded = (sqlLoaded ?? 0) === 0;
                    if (
                        (Number.isFinite(totalNumForEmpty) && totalNumForEmpty === 0) ||
                        (total == null && shown === 0 && noRowsLoaded)
                    ) {
                        el.hidden = true;
                        el.innerHTML = '';
                        return;
                    }
                    el.hidden = false;
                    let inner = '';
                    const btnDisabled = loading ? ' disabled' : '';
                    const btnLabel = loading ? 'Loading…' : 'Load more';
                    const totalNum = total != null ? Number(total) : NaN;
                    const showLoadMore =
                        apiHasMoreTrue(hasMore) &&
                        Number.isFinite(totalNum) &&
                        totalNum > LOAD_MORE_MIN_TOTAL &&
                        sqlLoaded < totalNum;
                    const loadMoreHtml = showLoadMore
                        ? `<button type="button" id="unreported-live-load-more" class="unreported-live-load-more"${btnDisabled}>${escapeHtml(btnLabel)}</button>`
                        : '';
                    if (!showLoadMore) {
                        el.hidden = true;
                        el.innerHTML = '';
                        return;
                    }
                    el.innerHTML = `<div class="unreported-live-meta-row">${inner}${loadMoreHtml}</div>`;
                    const btn = el.querySelector('#unreported-live-load-more');
                    if (btn && showLoadMore && !loading) {
                        btn.onclick = function () {
                            btn.disabled = true;
                            btn.textContent = 'Loading…';
                            fetchUnreportedLivePage(htmlNode, liveUnreportedSessionId, true, null).catch((err) => {
                                showToast(`Load more failed: ${err.message || err}`, 'warning');
                                btn.disabled = false;
                                btn.textContent = 'Load more';
                            });
                        };
                    }
                }

                async function loadAllUnreportedLivePages(htmlNode, sessionId, token) {
                    let guard = 0;
                    while (apiHasMoreTrue(liveUnreportedLastMeta.hasMore) && guard < 20) {
                        guard += 1;
                        await fetchUnreportedLivePage(htmlNode, sessionId, true, token, { skipRender: true });
                        if (token != null && token !== unreportedLiveFetchToken) return false;
                    }
                    return true;
                }

                function renderUnreportedLiveMetaFromCache(htmlNode) {
                    renderUnreportedLiveMetaBar(htmlNode, {
                        shown: liveUnreportedRowsCache.length,
                        total: liveUnreportedLastMeta.total,
                        sqlLoaded: liveUnreportedLastMeta.sqlLoaded,
                        hasMore: liveUnreportedLastMeta.hasMore,
                        loading: false
                    });
                }

                async function fetchUnreportedLivePage(htmlNode, sessionId, append, fetchToken, options = {}) {
                    const days = getEffectiveRangeDays();
                    const bounds = getEffectiveRangeBounds();
                    // Live panel: do not cap by Grafana range.to (can lag), rely on backend now().
                    const rangeQuery = `days=${days}&from_ms=${Math.floor(bounds.fromMs)}`;
                    const offset = append ? liveUnreportedRawAccum.length : 0;
                    if (!append) {
                        liveUnreportedRawAccum = [];
                    }
                    const res = await apiRequest(
                        `/reporting/unreported?${rangeQuery}&limit=${UNREPORTED_LIVE_PAGE_SIZE}&offset=${offset}`
                    );
                    if (sessionId !== liveUnreportedSessionId) return;
                    if (fetchToken != null && fetchToken !== unreportedLiveFetchToken) return;
                    const batch = Array.isArray(res.rows) ? res.rows : [];
                    liveUnreportedRawAccum = append ? liveUnreportedRawAccum.concat(batch) : batch.slice();
                    const rows = filterCascadeIncidents(liveUnreportedRawAccum);
                    liveUnreportedRowsCache = rows;
                    const total = res.total !== undefined && res.total !== null ? Number(res.total) : null;
                    const returned = batch.length;
                    let hasMore = false;
                    if (res.has_more !== undefined && res.has_more !== null) {
                        hasMore = apiHasMoreTrue(res.has_more);
                    } else if (total != null) {
                        hasMore = offset + returned < total;
                    } else {
                        hasMore = returned === UNREPORTED_LIVE_PAGE_SIZE;
                    }
                    liveUnreportedLastMeta = {
                        total,
                        sqlLoaded: liveUnreportedRawAccum.length,
                        hasMore
                    };
                    if (!options.skipRender) {
                        renderUnreportedLiveCards(htmlNode, rows, liveReportedRowsCache, liveSolvedRowsCache);
                    }
                    renderUnreportedLiveMetaBar(htmlNode, {
                        shown: rows.length,
                        total: liveUnreportedLastMeta.total,
                        sqlLoaded: liveUnreportedLastMeta.sqlLoaded,
                        hasMore: liveUnreportedLastMeta.hasMore,
                        loading: false
                    });
                }

                function updateUnreportedLiveStatistics(htmlNode, rows) {
                    const list = Array.isArray(rows) ? rows : [];
                    const setTxt = (id, val) => {
                        const el = htmlNode.getElementById(id);
                        if (el) el.textContent = val;
                    };
                    const totalEl = htmlNode.getElementById('total-stores');
                    const totalLabelEl = htmlNode.getElementById('total-stores-label');
                    const totalBoxEl = totalEl ? totalEl.closest('.stat-box') : null;
                    if (totalBoxEl) totalBoxEl.classList.remove('stat-box-breakdown');
                    if (totalLabelEl) {
                        totalLabelEl.style.display = '';
                        totalLabelEl.textContent = 'Unreported rows';
                    }
                    if (totalEl) totalEl.textContent = String(list.length);
                }

                /**
                 * Same filters as the Non Reported grid: Status + Devices + text search (+ dedup rules).
                 * CRM tag checklist applies only to Reported/Solved (`filteredLiveReportedSolvedList`) — unreported
                 * rows usually have no `report_tag`; applying tags here made Status+Device+Tags unusable together.
                 * Pass { omitDeviceGroup: true } for per-category counts that match the grid when a device chip is selected.
                 */
                function filteredLiveUnreportedList(rows, options = {}) {
                    const omitDeviceGroup = Boolean(options && options.omitDeviceGroup);
                    if (!Array.isArray(rows) || !rows.length) return [];
                    const currentRouterByStore = new Map();
                    const rememberRouter = (dev) => {
                        if (!dev) return;
                        const code = extractStoreCode(dev.name);
                        if (!code) return;
                        if (!currentRouterByStore.has(code)) currentRouterByStore.set(code, dev);
                    };
                    (dataMap['routers'] || []).forEach(rememberRouter);
                    (dataMap['project-routers'] || []).forEach(rememberRouter);
                    const shouldSuppressStalePrimaryDown = (row) => {
                        if (!row || incidentRowDeviceType(row) !== 'primary-link') return false;
                        const alertName = String(row.source_alert || '').trim();
                        // Full WAN outages ("Internet Down") remain valid here.
                        if (alertName === STORE_WAN_BLACKOUT_ALERT) return false;
                        const storeCode = String(row.store_code || '').trim().toUpperCase();
                        if (!storeCode) return false;
                        const router = currentRouterByStore.get(storeCode);
                        if (!router) return false;
                        const p = String(router.ontPrimaryStatus || '').toLowerCase();
                        // Only suppress when this store has no primary ONT — "Primary Down" is
                        // meaningless. Do NOT hide when ONT reads UP: scraping can lag behind an
                        // open alert, which made Live "Primary" counts and cards drop to zero
                        // while incidents still existed in the selected range.
                        return p === 'none';
                    };
                    // Single-pass filter avoids three intermediate arrays
                    // (status -> group -> search) on big inputs.
                    const wantOpen = liveUnreportedStatusFilter === 'still_offline';
                    const wantClosed = liveUnreportedStatusFilter === 'back_online_unreported';
                    const hasStatusFilter = wantOpen || wantClosed;
                    const hasGroupFilter =
                        !omitDeviceGroup && liveUnreportedHiddenDeviceGroups && liveUnreportedHiddenDeviceGroups.size > 0;
                    const q = searchQuery ? searchQuery.toLowerCase() : '';
                    const reportedSolvedForDedup = livePreparedReportedSolvedSupersessions();
                    const out = [];
                    for (let i = 0; i < rows.length; i++) {
                        const r = rows[i];
                        if (!unreportedPassesMinDowntimeThreshold(r)) continue;
                        if (shouldSuppressStalePrimaryDown(r)) continue;
                        if (hasStatusFilter) {
                            const st = r.incident_status;
                            if (wantOpen && st !== 'open') continue;
                            if (wantClosed && st !== 'closed') continue;
                        }
                        if (unreportedRowStaleOpenWhilePriceCheckerLiveUp(r)) continue;
                        if (hasGroupFilter) {
                            const gid = liveUnreportedGroupIdForRow(r);
                            if (gid == null) continue;
                            if (liveUnreportedHiddenDeviceGroups.has(gid)) continue;
                        }
                        if (q) {
                            const sc = String(r.store_code || '').toLowerCase();
                            const dn = String(r.device_name || '').toLowerCase();
                            const dt = String(incidentRowDeviceType(r) || '').toLowerCase();
                            if (sc.indexOf(q) === -1 && dn.indexOf(q) === -1 && dt.indexOf(q) === -1) continue;
                        }
                        if (liveUnreportedSupersedesReportedOrSolved(r, reportedSolvedForDedup)) continue;
                        out.push(r);
                    }
                    return out;
                }

                // Live page Reported / Solved: same modular filters as Unreported
                // (devices, tags, ticket search, text search). Status "Still offline"
                // narrows **Unreported** to open rows only (`filteredLiveUnreportedList`);
                // Reported still shows rows whose incident is open; Solved still shows
                // closed rows for the same device/tag filters so e.g. Price checkers + Offline
                // does not wipe the Solved column. "Back online (unreported)" only narrows
                // the Unreported list — Reported/Solved lists are unchanged by that mode.
                function filteredLiveReportedSolvedList(rows, section, options = {}) {
                    if (!Array.isArray(rows) || !rows.length) return [];
                    const omitDeviceGroup = Boolean(options && options.omitDeviceGroup);
                    const wantOpen = liveUnreportedStatusFilter === 'still_offline';
                    const hasGroupFilter =
                        !omitDeviceGroup && liveUnreportedHiddenDeviceGroups && liveUnreportedHiddenDeviceGroups.size > 0;
                    const tagFilterActive = !liveUnreportedTagAllMode;
                    const q = searchQuery ? searchQuery.toLowerCase() : '';
                    const ticketQ = normalizeLiveCrmTicketSearchQuery(liveCrmTicketSearchValue);
                    if (
                        liveUnreportedStatusFilter === 'all' &&
                        !hasGroupFilter &&
                        !q &&
                        !tagFilterActive &&
                        !ticketQ
                    ) {
                        return rows.slice();
                    }
                    const out = [];
                    for (let i = 0; i < rows.length; i++) {
                        const r = rows[i];
                        if (wantOpen && section === 'reported') {
                            const st = r.incident_status;
                            if (st != null && String(st).trim() !== '' && String(st).toLowerCase() !== 'open') continue;
                        }
                        if (tagFilterActive) {
                            const t = rowReportTagId(r);
                            if (!t) continue;
                            if (liveUnreportedHiddenReportTags.has(t)) continue;
                        }
                        if (hasGroupFilter) {
                            const gid = liveUnreportedGroupIdForRow(r);
                            if (gid == null) continue;
                            if (liveUnreportedHiddenDeviceGroups.has(gid)) continue;
                        }
                        if (ticketQ) {
                            const tid = extractCrmTaskIdFromTicketUrl(String(r.ticket_url || '').trim());
                            if (!tid || !tid.startsWith(ticketQ)) continue;
                        }
                        if (q) {
                            const sc = String(r.store_code || '').toLowerCase();
                            const dn = String(r.device_name || '').toLowerCase();
                            const dt = String(incidentRowDeviceType(r) || '').toLowerCase();
                            if (sc.indexOf(q) === -1 && dn.indexOf(q) === -1 && dt.indexOf(q) === -1) continue;
                        }
                        out.push(r);
                    }
                    return out;
                }

                /**
                 * Rows across Unreported + Reported + Solved after the same toolbar rules as the grid,
                 * except the device-category checklist. Used to decide which device-group checkboxes
                 * are visible (`present`); checklist **counts** use `liveRowsForLiveUnreportedDeviceFilterCounts`.
                 */
                function liveCombinedRowsMatchingToolbarExceptDeviceGroup() {
                    const u = filteredLiveUnreportedList(liveUnreportedRowsCache || [], { omitDeviceGroup: true });
                    const r = filteredLiveReportedSolvedList(liveReportedRowsCache || [], 'reported', { omitDeviceGroup: true });
                    const s = filteredLiveReportedSolvedList(liveSolvedRowsCache || [], 'solved', { omitDeviceGroup: true });
                    return u.concat(r).concat(s);
                }

                function renderUnreportedLiveCards(htmlNode, rows, reportedRowsFromDb = [], solvedRowsFromDb = []) {
                    const grid = htmlNode && htmlNode.id === 'stores-grid'
                        ? htmlNode
                        : htmlNode.getElementById('stores-grid');
                    if (!grid) return;
                    // Keep the Incidents grid in its dedicated styling mode on
                    // every render path, including the 30 s auto-refresh and
                    // SSE refresh. The Excel-list CSS must not depend only on
                    // updateMainView having run immediately beforehand.
                    grid.classList.add('stores-grid--unreported', 'grouped-sections');
                    // Skip the full innerHTML rebuild when the inputs haven't
                    // changed since the previous render — that wipe was the
                    // source of the "cards disappear and reappear" flicker on
                    // the Incidents page each time the 30s tick or an SSE
                    // push fired.
                    //
                    // IMPORTANT: `duration_minutes` is intentionally NOT
                    // fingerprinted. For open incidents the backend recomputes
                    // it as `NOW() - offline_started_at` on every query, so a
                    // 30 s panel tick would always see a "new" duration even
                    // when nothing structural changed → forcing a full
                    // rebuild + visible flicker. We treat structural fields
                    // (id, device, status, start/end, owner, tag, ticket) as
                    // the only signals that warrant a DOM rebuild; the
                    // displayed duration text refreshes naturally on the next
                    // genuine change (incident closed, new incident, etc.).
                    const fpInput = (r) => {
                        if (!r) return '';
                        return [
                            r.id || '',
                            r.device_name || '',
                            r.incident_status || '',
                            r.offline_started_at || '',
                            r.offline_ended_at || '',
                            r.report_status || '',
                            r.report_tag || '',
                            r.crm_task_id || ''
                        ].join('|');
                    };
                    const fpList = (arr) => Array.isArray(arr) ? arr.map(fpInput).join(';') : '';
                    // Include night-window state so that crossing the 07:10
                    // monitoring boundary invalidates the fingerprint and
                    // triggers a re-render (held Solved rows move back).
                    const fpNightCtx = getNightWindowContext(new Date());
                    const fingerprint = [
                        fpList(rows),
                        fpList(reportedRowsFromDb),
                        fpList(solvedRowsFromDb),
                        liveUnreportedStatusFilter || '',
                        fpNightCtx.inMonitoringWindow ? 'day' : 'night',
                        _LIF.fingerprintSectionState ? _LIF.fingerprintSectionState(liveIncidentSectionFilters.unreported) : '',
                        _LIF.fingerprintSectionState ? _LIF.fingerprintSectionState(liveIncidentSectionFilters.reported) : '',
                        _LIF.fingerprintSectionState ? _LIF.fingerprintSectionState(liveIncidentSectionFilters.solved) : ''
                    ].join('||');
                    if (grid.dataset.fingerprint === fingerprint) {
                        // Same data as last render — keep DOM intact.
                        return;
                    }
                    grid.dataset.fingerprint = fingerprint;
                    grid.classList.remove('grouped-sections--switches', 'grouped-sections--cash', 'grouped-sections--music');
                    const base = Array.isArray(rows) ? rows : [];
                    const listBase = filteredLiveUnreportedList(base);
                    const filterDeps = liveIncidentFilterDeps();
                    let list = _LIF.applyFiltersAndSort
                        ? _LIF.applyFiltersAndSort(listBase, 'unreported', liveIncidentSectionFilters.unreported, filterDeps)
                        : listBase.slice();
                    const hasSectionSort = liveIncidentSectionFilters.unreported && (
                        liveIncidentSectionFilters.unreported.storeOrder ||
                        liveIncidentSectionFilters.unreported.startOrder ||
                        liveIncidentSectionFilters.unreported.endOrder ||
                        liveIncidentSectionFilters.unreported.durationOrder
                    );
                    if (!hasSectionSort) {
                        list.sort((a, b) => (liveIncidentUnreportedStartMs(b) - liveIncidentUnreportedStartMs(a)));
                    }
                    const reportable = new Set(REPORTABLE_DEVICE_TYPES);
                    const renderIncidentCard = (row, isReportedCard = false) => {
                        const isOpen = row.incident_status === 'open';
                        const statusClass = isOpen ? 'inactive' : 'warning';
                        const devName = String(row.device_name || '');
                        const devType = String(row.device_type || '');
                        const startedFull = formatIsoDateTime(row.offline_started_at);
                        const endedFull = isOpen ? 'Unresolved' : formatIsoDateTime(row.offline_ended_at);
                        const durFull = unreportedLiveDurationDisplay(row);
                        const startedCompact = formatUnreportedTimelineCompact(row.offline_started_at);
                        const endedCompact = isOpen ? 'Unresolved' : formatUnreportedTimelineCompact(row.offline_ended_at);
                        const durCompact = unreportedLiveDurationCompact(row);
                        const label = formatDeviceLabel(devName, devType, row.source_alert);
                        const canTicket =
                            reportable.has(devType) || reportable.has(normalizeDeviceTypeKey(devType));
                        const startIso = row.offline_started_at ? String(row.offline_started_at) : '';
                        const ticketOwner = normalizeOwnerUsername(row._ticket_owner || '', '');
                        const ticketUrl = String(
                            row._ticket_url || getDeviceTicketLink(devName, incidentRowDeviceType(row)) || ''
                        ).trim();
                        const ticketMetaHtml = isReportedCard
                            ? unreportedLiveTicketMetaBlockHtml(ticketUrl, ownerDisplayName(ticketOwner, '-'), rowReportTagId(row))
                            : '';
                        return `
                            <div class="store-card unreported-live-card ${statusClass}${canTicket ? ' unreported-live-can-ticket' : ''}"
                                data-device-name="${escapeHtml(devName)}"
                                data-incident-device-type="${escapeHtml(devType)}"
                                data-status="${statusClass}"
                                data-dt-start="${escapeHtml(startedFull)}"
                                data-dt-end="${escapeHtml(endedFull)}"
                                data-dt-duration="${escapeHtml(durFull)}"
                                data-reported-at="N/A"
                                data-solved-at="${escapeHtml(isOpen ? 'Unresolved' : 'N/A')}">
                                <div class="unreported-live-inner">
                                    <header class="unreported-live-head">
                                        <span class="unreported-live-code">${escapeHtml(row.store_code || '—')}</span>
                                    </header>
                                    <p class="unreported-live-title">${escapeHtml(label)}</p>
                                    <div class="unreported-live-timeline" role="group" aria-label="Timeline">
                                        <time class="unreported-live-time" ${startIso ? `datetime="${escapeHtml(startIso)}"` : ''}>${escapeHtml(startedCompact)}</time>
                                        <span class="unreported-live-sep" aria-hidden="true"></span>
                                        <span class="unreported-live-end ${isOpen ? 'is-live' : ''}">${escapeHtml(endedCompact)}</span>
                                        <span class="unreported-live-sep unreported-live-sep-dot" aria-hidden="true">·</span>
                                        <span class="unreported-live-dur-compact">${escapeHtml(durCompact)}</span>
                                    </div>
                                    ${ticketMetaHtml}
                                </div>
                            </div>
                        `;
                    };

                    // Apply the live-page device-group + search filters to all
                    // three sections so toggling a category (e.g. Music) hides
                    // non-matching cards in Reported and Solved too, not only
                    // in the Unreported list.
                    const reportedRowsFilteredBase = filteredLiveReportedSolvedList(reportedRowsFromDb, 'reported');
                    const solvedRowsFilteredBase = filteredLiveReportedSolvedList(solvedRowsFromDb, 'solved');
                    // Hold "Solved" rows that closed during the current
                    // monitoring-paused window (~21:00 → 07:10
                    // Europe/Bucharest) back in Reported. Prometheus stops
                    // scraping in that window, so a closure at 21:00 is
                    // commonly an artifact, not a real recovery. Once 07:10
                    // passes and the backend re-evaluates, the row either
                    // re-opens (still offline) or stays truly Solved.
                    const heldFromSolved = [];
                    const trulySolvedRows = [];
                    const nowForHold = new Date();
                    for (const row of solvedRowsFilteredBase) {
                        if (shouldHoldSolvedRowAsReported(row, nowForHold)) {
                            heldFromSolved.push(Object.assign({}, row, { __heldFromSolved: true }));
                        } else {
                            trulySolvedRows.push(row);
                        }
                    }
                    const reportedRowsBase = reportedRowsFilteredBase.concat(heldFromSolved);
                    const solvedRowsBase = trulySolvedRows;
                    const reportedRows = _LIF.applyFiltersAndSort
                        ? _LIF.applyFiltersAndSort(reportedRowsBase, 'reported', liveIncidentSectionFilters.reported, filterDeps)
                        : reportedRowsBase.slice();
                    const solvedRows = _LIF.applyFiltersAndSort
                        ? _LIF.applyFiltersAndSort(solvedRowsBase, 'solved', liveIncidentSectionFilters.solved, filterDeps)
                        : solvedRowsBase.slice();
                    // Keep Non Reported list aligned with the same incident set used by the
                    // UNREPORTED KPI/table to avoid count mismatches between views.
                    const nonReportedRows = list.slice();
                    const nonReportedRowsRender = nonReportedRows.slice(0, LIVE_RENDER_MAX_PER_SECTION);
                    const reportedRowsRender = reportedRows.slice(0, LIVE_RENDER_MAX_PER_SECTION);
                    const solvedRowsRender = solvedRows.slice(0, LIVE_RENDER_MAX_PER_SECTION);

                    const renderReportedDbCard = (row, sectionStatus = 'Reported') => {
                        const storeCode = String(row?.store_code || '—');
                        const deviceType = String(row?.device_type || '');
                        const deviceName = String(row?.device_name || '');
                        const label = formatDeviceLabel(row?.device_name, row?.device_type, row?.source_alert);
                        const owner = normalizeOwnerUsername(row?.owner_name || '', '-');
                        const ownerNameDisplay = ownerDisplayName(owner, '-');
                        const reportTagRaw = rowReportTagId(row);
                        const ticketUrl = String(row?.ticket_url || '').trim();
                        // Manual non-internet reports have no automated downtime
                        // detection, so `incident_offline_started_at` is empty.
                        // In that case the report itself marks the start of the
                        // issue — fall back to `created_at` so Start and
                        // Duration show meaningful values instead of "—" / "N/A".
                        const isManualRow = isManualReportedRow(row);
                        const effectiveStartedIso = row?.incident_offline_started_at
                            || (isManualRow ? (row?.created_at || '') : '');
                        const startedFull = formatIsoDateTime(effectiveStartedIso);
                        const startedCompact = formatUnreportedTimelineCompact(effectiveStartedIso);
                        const ttrMinutes = row?.time_to_report_minutes != null
                            ? Number(row.time_to_report_minutes)
                            : null;
                        const timeToReport = ttrMinutes != null && Number.isFinite(ttrMinutes)
                            ? formatTime(ttrMinutes)
                            : 'N/A';
                        // A row tagged `__heldFromSolved` was reclassified
                        // from Solved → Reported because its "resolved"
                        // timestamp landed inside the Prometheus
                        // monitoring-paused window (21:00 → 07:10). Treat it
                        // as still open until backend re-evaluation.
                        const isHeldFromSolved = !!row?.__heldFromSolved;
                        const rtrMinutesRaw = row?.report_to_resolve_minutes != null
                            ? Number(row.report_to_resolve_minutes)
                            : null;
                        const rtrMinutes = isHeldFromSolved ? null : rtrMinutesRaw;
                        const hasResolved = !isHeldFromSolved
                            && rtrMinutes != null
                            && Number.isFinite(rtrMinutes);
                        const reportTsMs = toEpochMs(row?.created_at);
                        const startedTsMs = toEpochMs(effectiveStartedIso);
                        const endedIso = hasResolved && reportTsMs != null
                            ? new Date(reportTsMs + (rtrMinutes * 60000)).toISOString()
                            : '';
                        const endedFull = hasResolved
                            ? formatIsoDateTime(endedIso)
                            : 'Unresolved';
                        const endedCompact = hasResolved
                            ? formatUnreportedTimelineCompact(endedIso)
                            : 'Unresolved';
                        const durationDowntime = (() => {
                            if (startedTsMs == null) return 'N/A';
                            if (hasResolved && reportTsMs != null) {
                                return formatTime(Math.max(0, Math.floor(((reportTsMs + (rtrMinutes * 60000)) - startedTsMs) / 60000)));
                            }
                            return formatTime(Math.max(0, Math.floor((Date.now() - startedTsMs) / 60000)));
                        })();
                        const timeToResolve = hasResolved ? formatTime(rtrMinutes) : 'Unresolved';
                        const reportedAt = formatIsoDateTime(row?.created_at);
                        const reportedCompact = row?.created_at
                            ? formatUnreportedTimelineCompact(row.created_at)
                            : '—';
                        const solvedAt = hasResolved ? endedFull : 'Unresolved';
                        const solvedCompact = hasResolved
                            ? formatUnreportedTimelineCompact(endedIso)
                            : 'Unresolved';
                        const incidentStatusRaw = row?.incident_status != null && row?.incident_status !== ''
                            ? String(row.incident_status)
                            : '';
                        // Solved section gets an extra "Solved" timestamp column;
                        // Reported list omits it (incident may not yet be resolved).
                        const solvedCellHtml = sectionStatus === 'Solved'
                            ? `<span class="unreported-live-solved-at" title="Solved">${escapeHtml(solvedCompact)}</span>`
                            : '';
                        return `
                            <div class="store-card unreported-live-card inactive${isHeldFromSolved ? ' incident-held-night' : ''}"
                                data-device-name="${escapeHtml(deviceName)}"
                                data-incident-device-type="${escapeHtml(deviceType)}"
                                data-ticket-owner="${escapeHtml(owner)}"
                                data-ticket-tag="${escapeHtml(reportTagRaw)}"
                                data-ticket-url="${escapeHtml(ticketUrl)}"
                                data-report-source="${escapeHtml(String(row?.report_source || ''))}"
                                data-incident-status="${escapeHtml(incidentStatusRaw)}"
                                ${isHeldFromSolved ? 'data-incident-hold="pending-night-recheck"' : ''}
                                data-dt-start="${escapeHtml(startedFull)}"
                                data-dt-end="${escapeHtml(endedFull)}"
                                data-dt-duration="${escapeHtml(durationDowntime)}"
                                data-reported-at="${escapeHtml(reportedAt)}"
                                data-solved-at="${escapeHtml(solvedAt)}"
                                data-status="inactive">
                                <div class="unreported-live-inner">
                                    <div class="unreported-live-top">
                                        <div class="unreported-live-top-left">
                                            <header class="unreported-live-head">
                                                <span class="unreported-live-code">${escapeHtml(storeCode)}</span>
                                            </header>
                                            <p class="unreported-live-title">${escapeHtml(label)}</p>
                                        </div>
                                        ${reportedLiveCardHeaderChipsHtml(reportTagRaw, row)}
                                    </div>
                                    <time class="unreported-live-time" ${effectiveStartedIso ? `datetime="${escapeHtml(String(effectiveStartedIso))}"` : ''} title="${isManualRow && !row?.incident_offline_started_at ? 'Start (report created)' : 'Start downtime'}">${escapeHtml(startedCompact)}</time>
                                    <span class="unreported-live-end ${hasResolved ? '' : 'is-live'}${isHeldFromSolved ? ' is-held-night' : ''}" title="${isHeldFromSolved ? 'Held — closed during night monitoring gap (21:00–07:10); pending morning re-evaluation' : 'End downtime'}">${escapeHtml(endedCompact)}</span>
                                    <span class="unreported-live-dur-compact" title="Duration downtime">${escapeHtml(durationDowntime)}</span>
                                    <span class="unreported-live-reported-at" title="Reported at">${escapeHtml(reportedCompact)}</span>
                                    ${solvedCellHtml}
                                    <span class="unreported-live-issue-kind" data-kind="${isManualRow ? 'non-internet' : 'internet'}" title="Issue type">${isManualRow ? 'Non Internet' : 'Internet'}</span>
                                    ${unreportedLiveTicketMetaBlockHtml(ticketUrl, ownerNameDisplay, '')}
                                </div>
                            </div>
                        `;
                    };

                    const collapsedSet = readCollapsedIncidentSections();
                    const liveGroupedSectionTitle = (label, count, sectionId) => {
                        const n = Number(count);
                        const show = Number.isFinite(n) && n >= 1;
                        const badge = show
                            ? `<span class="grouped-device-count" aria-label="${n} ${label}">${n}</span>`
                            : '';
                        const expanded = !collapsedSet.has(sectionId);
                        return `<h4 class="grouped-device-title" role="button" tabindex="0"
                                    aria-expanded="${expanded}"
                                    aria-controls="incident-section-${sectionId}-body"
                                    title="Click to ${expanded ? 'collapse' : 'expand'} ${label}">
                                <i class="grouped-device-chevron fa-solid fa-chevron-down" aria-hidden="true"></i>
                                <span class="grouped-device-title-label">${label}</span>${badge}
                            </h4>`;
                    };
                    const sectionClasses = (id) =>
                        `grouped-device-section${collapsedSet.has(id) ? ' is-collapsed' : ''}`;
                    // Excel-style column headers per list. Same 5-column grid
                    // template is mirrored in css/shell.css so each header cell
                    // lines up with the corresponding data cell on every card.
                    const incidentListHeader = (sectionId, sectionKind, baseRows, state) => (
                        _LIF.buildSectionHeader
                            ? _LIF.buildSectionHeader(sectionId, sectionKind, baseRows, state, filterDeps)
                            : ''
                    );
                    const headerUnreported = incidentListHeader('unreported', 'unreported', listBase, liveIncidentSectionFilters.unreported);
                    const headerReported = incidentListHeader('reported', 'reported', reportedRowsBase, liveIncidentSectionFilters.reported);
                    const headerSolved = incidentListHeader('solved', 'solved', solvedRowsBase, liveIncidentSectionFilters.solved);

                    grid.classList.add('stores-grid--unreported', 'grouped-sections');
                    grid.innerHTML = `
                        <section class="${sectionClasses('unreported')}" data-incident-section="unreported">
                            ${liveGroupedSectionTitle('Unreported', nonReportedRows.length, 'unreported')}
                            <div id="incident-section-unreported-body" class="stores-grid grouped-device-grid grouped-device-grid--incident">
                                ${headerUnreported}
                                ${nonReportedRows.length
                                    ? nonReportedRowsRender.map((row) => renderIncidentCard(row, false)).join('')
                                    : '<div class="empty-state" style="grid-column: 1 / -1;"><p>No unreported incidents.</p></div>'}
                            </div>
                        </section>
                        <section class="${sectionClasses('reported')}" data-incident-section="reported">
                            ${liveGroupedSectionTitle('Reported', reportedRows.length, 'reported')}
                            <div id="incident-section-reported-body" class="stores-grid grouped-device-grid grouped-device-grid--incident">
                                ${headerReported}
                                ${reportedRows.length
                                    ? reportedRowsRender.map((row) => renderReportedDbCard(row, 'Reported')).join('')
                                    : '<div class="empty-state" style="grid-column: 1 / -1;"><p>No reported incidents.</p></div>'}
                            </div>
                        </section>
                        <section class="${sectionClasses('solved')}" data-incident-section="solved">
                            ${liveGroupedSectionTitle('Solved', solvedRows.length, 'solved')}
                            <div id="incident-section-solved-body" class="stores-grid grouped-device-grid grouped-device-grid--incident">
                                ${headerSolved}
                                ${solvedRows.length
                                    ? solvedRowsRender.map((row) => renderReportedDbCard(row, 'Solved')).join('')
                                    : '<div class="empty-state" style="grid-column: 1 / -1;"><p>No solved incidents.</p></div>'}
                            </div>
                        </section>
                    `;
                    ensureIncidentSectionTogglesDelegation(grid);
                    ensureLiveIncidentSectionFiltersDelegation(grid);
                    if (_LIF.decorateFilterSummaries) _LIF.decorateFilterSummaries(grid);
                    updateUnreportedLiveStatistics(htmlNode, list);
                    syncLiveUnreportedDeviceFilterUI(htmlNode);
                }

                async function renderUnreportedLiveView(htmlNode) {
                    const grid = htmlNode.getElementById('stores-grid');
                    if (!grid) return;
                    const viewVersion = viewStateApi()?.getVersion?.() ?? 0;
                    const token = ++unreportedLiveFetchToken;
                    liveUnreportedSessionId += 1;
                    const sessionId = liveUnreportedSessionId;
                    // Don't wipe the grid before refetching — keep whatever
                    // was rendered last so the user doesn't see an empty
                    // flash while we wait for the network. The fresh render
                    // below replaces it atomically when data arrives.
                    //
                    // IMPORTANT: only keep cards that are actually unreported-live
                    // cards. A generic `.store-card` match would also keep stale
                    // router/switch cards from a previous device view, which is
                    // what caused the "alte date pt 1 sec" flicker when entering
                    // Incidents from another live page. updateMainView already
                    // wipes those before we get here, but we re-assert it as a
                    // safety net in case this fn is invoked from another path.
                    const hasExistingCards = grid.querySelector('.unreported-live-card');
                    if (!hasExistingCards) {
                        grid.innerHTML = '';
                        delete grid.dataset.fingerprint;
                    }
                    renderUnreportedLiveMetaBar(htmlNode, {
                        shown: 0,
                        total: null,
                        sqlLoaded: 0,
                        hasMore: false,
                        loading: true
                    });
                    try {
                        await fetchUnreportedLivePage(htmlNode, sessionId, false, token, { skipRender: true });
                        if (!isViewVersionCurrent(viewVersion) || token !== unreportedLiveFetchToken) return;
                        if (!(await loadAllUnreportedLivePages(htmlNode, sessionId, token))) return;
                        if (!isViewVersionCurrent(viewVersion) || token !== unreportedLiveFetchToken) return;
                        const linksPromise = refreshReportedTicketLinksForIncidentRows(liveUnreportedRowsCache);
                        const reportedSolvedPromise = refreshLiveReportedAndSolvedCaches();
                        await linksPromise;
                        if (!isViewVersionCurrent(viewVersion) || token !== unreportedLiveFetchToken) return;
                        await reportedSolvedPromise;
                        if (!isViewVersionCurrent(viewVersion) || token !== unreportedLiveFetchToken) return;
                        renderUnreportedLiveCards(htmlNode, liveUnreportedRowsCache, liveReportedRowsCache, liveSolvedRowsCache);
                    } catch (error) {
                        if (!isViewVersionCurrent(viewVersion) || token !== unreportedLiveFetchToken) return;
                        liveUnreportedRowsCache = [];
                        liveReportedRowsCache = [];
                        liveSolvedRowsCache = [];
                        liveUnreportedRawAccum = [];
                        liveUnreportedLastMeta = { total: null, sqlLoaded: 0, hasMore: false };
                        updateUnreportedLiveStatistics(htmlNode, []);
                        const metaEl = htmlNode.getElementById('unreported-live-meta');
                        if (metaEl) {
                            metaEl.hidden = true;
                            metaEl.innerHTML = '';
                        }
                        grid.innerHTML = `
                            <div class="empty-state" style="grid-column: 1 / -1;">
                                <h4>Could not load unreported</h4>
                                <p>${escapeHtml(error.message || String(error))}</p>
                            </div>
                        `;
                        showToast(`Unreported list failed: ${error.message || error}`, 'warning');
                    }
                }

                // Live auto-refresh + SSE leader election + kiosk health guard
                // moved to modules/live-refresh.js (window.GFN_LIVE_REFRESH).
                // We keep thin wrappers here so the rest of the closure (which
                // references closure-local state like `liveIncidentSyncInFlight`
                // and `listenersRootNode`) doesn't need to change.

                function maybeTriggerLiveRefresh() {
                    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
                    if (currentDashboardPage !== 'live') return;
                    if (currentDeviceType !== LIVE_UNREPORTED_DEVICE_TYPE) return;
                    if (isOfflineViewActive) return;
                    if (liveIncidentSyncInFlight) return;
                    const root = listenersRootNode;
                    if (!root || !root.isConnected) return;
                    refreshLiveIncidentSectionsInstant(root).catch(() => {});
                }

                function startLiveAutoRefresh() {
                    const mod = window.GFN_LIVE_REFRESH;
                    if (!mod) return;
                    mod.installRefreshTrigger(maybeTriggerLiveRefresh);
                    mod.startLiveAutoRefresh({ crmApiBase: CRM_API_BASE });
                }

                function startKioskHealthGuard() {
                    const mod = window.GFN_LIVE_REFRESH;
                    if (!mod) return;
                    mod.startKioskHealthGuard({ panelRuntime });
                }

                async function refreshLiveIncidentSectionsInstant(htmlNode) {
                    if (!(currentDashboardPage === 'live' && currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE && !isOfflineViewActive)) {
                        return false;
                    }
                    if (liveIncidentSyncInFlight) return true;
                    liveIncidentSyncInFlight = true;
                    const viewVersion = viewStateApi()?.getVersion?.() ?? 0;
                    const token = ++unreportedLiveFetchToken;
                    liveUnreportedSessionId += 1;
                    const sessionId = liveUnreportedSessionId;
                    try {
                        await fetchUnreportedLivePage(htmlNode, sessionId, false, token, { skipRender: true });
                        if (!isViewVersionCurrent(viewVersion) || token !== unreportedLiveFetchToken) return true;
                        if (!(await loadAllUnreportedLivePages(htmlNode, sessionId, token))) return true;
                        if (!isViewVersionCurrent(viewVersion) || token !== unreportedLiveFetchToken) return true;
                        const linksPromise = refreshReportedTicketLinksForIncidentRows(liveUnreportedRowsCache);
                        const reportedSolvedPromise = refreshLiveReportedAndSolvedCaches();
                        await linksPromise;
                        if (!isViewVersionCurrent(viewVersion) || token !== unreportedLiveFetchToken) return true;
                        await reportedSolvedPromise;
                        if (!isViewVersionCurrent(viewVersion) || token !== unreportedLiveFetchToken) return true;
                        renderUnreportedLiveCards(htmlNode, liveUnreportedRowsCache, liveReportedRowsCache, liveSolvedRowsCache);
                        renderUnreportedLiveMetaFromCache(htmlNode);
                        return true;
                    } catch (error) {
                        console.warn('[Device Monitor] Instant live refresh failed, falling back:', error);
                        return false;
                    } finally {
                        liveIncidentSyncInFlight = false;
                    }
                }

                const RE_STORE_LOCATION = /^ar\d+$/i;
                // Build a once-per-render index of cash-register devices keyed
                // by their location prefix. Saves an O(N) `.find` per router
                // card for the "both registers down → red" check.
                function buildLocationIndex(list) {
                    const idx = Object.create(null);
                    if (!Array.isArray(list)) return idx;
                    for (let i = 0; i < list.length; i++) {
                        const d = list[i];
                        const name = d && d.name ? d.name.toLowerCase().trim() : '';
                        if (!name) continue;
                        // Match the exact location segment: "ar0001" OR "ar0001<sep>..."
                        const dash = name.indexOf('-');
                        const dot = name.indexOf('.');
                        const under = name.indexOf('_');
                        let cut = name.length;
                        if (dash > 0 && dash < cut) cut = dash;
                        if (dot > 0 && dot < cut) cut = dot;
                        if (under > 0 && under < cut) cut = under;
                        const loc = name.slice(0, cut);
                        if (!loc) continue;
                        if (!idx[loc]) idx[loc] = d;
                    }
                    return idx;
                }
                function renderDeviceCards(devices, htmlNode) {
                    const grid = htmlNode.getElementById('stores-grid');
                    if (!grid) return;
                    grid.classList.remove('grouped-sections', 'grouped-sections--switches', 'grouped-sections--cash', 'grouped-sections--music');

                    if (LIVE_GROUPED_DEVICE_TYPES[currentDeviceType]) {
                        renderGroupedLiveDeviceLists(htmlNode);
                        return;
                    }

                    // Combine with project routers if on routers view
                    let allDevices = devices;
                    if (currentDeviceType === 'routers' && dataMap['project-routers'].length > 0) {
                        allDevices = devices.concat(dataMap['project-routers']);
                    }

                    // Sort
                    const sortedDevices = allDevices.slice();
                    const routerPriorityRank = (_PS.getRouterLivePriorityRank || function () { return 99; });
                    if (currentSortMode === 'alphabetic') {
                        sortedDevices.sort((a, b) => a.name.localeCompare(b.name));
                    } else if (currentDeviceType === 'routers') {
                        sortedDevices.sort((a, b) => {
                            const ordA = routerPriorityRank(a, PRIORITY_ORDER);
                            const ordB = routerPriorityRank(b, PRIORITY_ORDER);
                            return ordA !== ordB ? ordA - ordB : a.name.localeCompare(b.name);
                        });
                    } else {
                        sortedDevices.sort((a, b) => {
                            const ordA = PRIORITY_ORDER[a.status] || 99;
                            const ordB = PRIORITY_ORDER[b.status] || 99;
                            return ordA !== ordB ? ordA - ordB : a.name.localeCompare(b.name);
                        });
                    }

                    // Skip the rebuild when nothing changed since the last
                    // render. Otherwise the tick / SSE refresh keeps wiping
                    // and rebuilding the grid, which causes the flicker.
                    const cardsFp = sortedDevices.map((d) =>
                        (d.name || '') + '|' + (d.status || '') + '|' +
                        (currentDeviceType === 'routers' && currentSortMode === 'priority'
                            ? (d.ontPrimaryStatus || '') + '|' + (d.ontBackupStatus || '') + '|'
                            : '') +
                        (d.uptimePercent != null ? d.uptimePercent : '') + '|' +
                        (d.lastSeen || '')
                    ).join(';');
                    const fpFull = currentDeviceType + '#' + currentSortMode + '#' + cardsFp;
                    if (grid.dataset.fingerprint === fpFull) return;
                    grid.dataset.fingerprint = fpFull;

                    // Apply filter
                    let filteredDevices;
                    if (currentFilterMode === 'backup-down') {
                        filteredDevices = sortedDevices.filter(d => {
                            const backupStatus = d.ontBackupStatus || 'unknown';
                            const backupText = d.ontBackupText || 'UNKNOWN';
                            const hasBackup = String(backupText).trim().toUpperCase() !== 'NONE';
                            return RE_STORE_LOCATION.test(String(d.name || '').trim()) && hasBackup && backupStatus === 'down';
                        });
                    } else if (currentFilterMode === 'no-backup') {
                        filteredDevices = sortedDevices.filter(d => {
                            const backupText = d.ontBackupText || 'UNKNOWN';
                            const hasBackup = String(backupText).trim().toUpperCase() !== 'NONE';
                            return RE_STORE_LOCATION.test(String(d.name || '').trim()) && !hasBackup;
                        });
                    } else if (currentFilterMode !== 'all') {
                        filteredDevices = sortedDevices.filter(d => d.status === currentFilterMode);
                    } else {
                        filteredDevices = sortedDevices;
                    }

                    if (filteredDevices.length === 0) {
                        grid.innerHTML = `
                            <div class="empty-state" style="grid-column: 1 / -1;">
                                <i class="fas fa-inbox"></i>
                                <h4>No devices found</h4>
                                <p>No devices match the current filter</p>
                            </div>
                        `;
                        return;
                    }

                    // Pre-build cash-register location index ONCE per render
                    // (only needed for the routers view's red-on-both-down check).
                    const isRoutersView = currentDeviceType === 'routers';
                    const cr1Idx = isRoutersView ? buildLocationIndex(dataMap['cash-register-1']) : null;
                    const cr2Idx = isRoutersView ? buildLocationIndex(dataMap['cash-register-2']) : null;

                    grid.innerHTML = filteredDevices.map(dev => {
                        let statusClass = dev.status;
                        let statusHTML = '';
                        let tooltipText = '';
                        let isReportedTicket = false;
                        const locName = dev.name.toLowerCase().trim();

                        if (isRoutersView) {
                            statusClass = dev.combinedStatus || dev.status;
                            const isOnBackupLink = dev.ontPrimaryStatus === 'down' && dev.ontBackupStatus === 'up' && dev.ontStatus === 'backup';

                            if (isOnBackupLink) {
                                statusClass = 'on-backup';
                            }

                            const cr1 = cr1Idx[locName];
                            const cr2 = cr2Idx[locName];
                            const bothRegistersDown = cr1 && cr1.status === 'inactive' && cr2 && cr2.status === 'inactive';
                            if (bothRegistersDown) {
                                statusClass = 'critical-failure';
                            }

                            if (isStoreFullWanBlackoutRouter(dev)) {
                                statusClass = 'inactive';
                                statusHTML = `
                                <div class="ont-summary" aria-label="ONT status">
                                    <span class="ont-pill internet status-both-down">Internet Down</span>
                                </div>
                            `;
                            } else {
                            const primaryStatusClass = dev.ontPrimaryClass || 'status-unknown';
                            const backupStatusClass = dev.ontBackupClass || 'status-unknown';
                            const isOnBackup = dev.ontPrimaryStatus === 'down' && dev.ontBackupStatus === 'up' && dev.ontStatus === 'backup';
                            const areBothLinksDown = dev.ontPrimaryStatus === 'down' && dev.ontBackupStatus === 'down';
                            const primaryPillClass = areBothLinksDown
                                ? 'status-both-down'
                                : (isOnBackup ? `${primaryStatusClass} status-on-backup` : primaryStatusClass);
                            const backupPillClass = areBothLinksDown
                                ? 'status-both-down'
                                : backupStatusClass;
                            
                            // Define primaryText and backupText to avoid "is not defined" error
                            const primaryText = dev.ontPrimaryText || (dev.ontPrimaryStatus === 'up' ? 'UP' : dev.ontPrimaryStatus === 'down' ? 'DOWN' : dev.ontPrimaryStatus === 'none' ? 'NONE' : 'UNKNOWN');
                            const backupText = dev.ontBackupText || (dev.ontBackupStatus === 'up' ? 'UP' : dev.ontBackupStatus === 'down' ? 'DOWN' : dev.ontBackupStatus === 'none' ? 'NONE' : 'UNKNOWN');
                            statusHTML = `
                                <div class="ont-summary" aria-label="ONT status">
                                    <span class="ont-pill primary ${primaryPillClass}">P ${primaryText}</span>
                                    <span class="ont-pill backup ${backupPillClass}">B ${backupText}</span>
                                </div>
                            `;
                            }
                            
                            // CONDITIONAL TOOLTIP - shows specific information based on status
                            tooltipText = buildConditionalTooltip(dev);
                        } else {
                            // For other device types, keep simple status display
                            const isReported = dev.status === 'inactive' && hasDeviceTicketLink(dev.name, currentDeviceType);
                            isReportedTicket = isReported;
                            statusHTML = `
                                <div class="store-value status-inline">
                                    <span class="device-status-text">${escapeHtml(dev.status)}</span>
                                    ${isReported ? '<span class="reported-tag">Reported</span>' : ''}
                                </div>
                            `;
                            
                            // Simple tooltip for non-router devices
                            tooltipText = `Device: ${dev.name}\nStatus: ${dev.status.toUpperCase()}${
                                isReported ? '\nCRM ticket on file (still offline until metric recovers)' : ''
                            }`;
                        }
                        
                        const hasWarning = (statusClass !== 'active');
                        const showTriangle = currentDeviceType !== 'price-checkers' && hasWarning;

                        return `
                            <div class="store-card ${statusClass}${dev.isProject ? ' project-router' : ''}${hasWarning ? ' has-warning' : ''}${isReportedTicket ? ' store-card--reported' : ''}" 
                                data-device-name="${escapeHtml(dev.name)}" 
                                data-status="${statusClass}"
                                ${tooltipText ? `data-tooltip="${escapeHtml(tooltipText)}"` : ''}>
                                ${showTriangle ? `<div class="card-warning-icon" title="Issue detected"></div>` : ''}
                                <div class="store-name">${escapeHtml(dev.name)}</div>
                                ${statusHTML}
                            </div>
                        `;
                    }).join('');
                }

                function renderGroupedLiveDeviceLists(htmlNode) {
                    const grid = htmlNode.getElementById('stores-grid');
                    if (!grid) return;
                    grid.classList.add('grouped-sections');
                    grid.classList.toggle('grouped-sections--switches', currentDeviceType === 'switches');
                    grid.classList.toggle('grouped-sections--cash', currentDeviceType === 'cash-registers');
                    grid.classList.toggle('grouped-sections--music', currentDeviceType === 'music');
                    const defs = LIVE_GROUPED_DEVICE_TYPES[currentDeviceType] || [];
                    // Same fingerprint short-circuit as renderDeviceCards.
                    const fpParts = [currentDeviceType, currentSortMode, currentFilterMode || '', searchQuery || ''];
                    for (const def of defs) {
                        const list = (dataMap[def.dataKey] || []);
                        for (let i = 0; i < list.length; i++) {
                            const d = list[i];
                            fpParts.push((d.name || '') + ':' + (d.status || ''));
                        }
                        fpParts.push('#');
                    }
                    const fpFull = fpParts.join('|');
                    if (grid.dataset.fingerprint === fpFull) return;
                    grid.dataset.fingerprint = fpFull;
                    const applyStatusFilter = (list) => {
                        const src = list.slice();
                        if (currentFilterMode === 'all') return src;
                        return src.filter((d) => d.status === currentFilterMode);
                    };
                    const applySearch = (list) => {
                        if (!searchQuery) return list.slice();
                        const q = searchQuery.toLowerCase();
                        return list.filter((d) => String(d.name || '').toLowerCase().includes(q));
                    };
                    const applySort = (list) => {
                        const out = list.slice();
                        if (currentSortMode === 'alphabetic') {
                            out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
                        } else {
                            out.sort((a, b) => {
                                const ordA = PRIORITY_ORDER[a.status] || 99;
                                const ordB = PRIORITY_ORDER[b.status] || 99;
                                return ordA !== ordB ? ordA - ordB : String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
                            });
                        }
                        return out;
                    };

                    const blocks = defs.map((def) => {
                        const base = Array.isArray(dataMap[def.key]) ? dataMap[def.key] : [];
                        const list = applySort(applySearch(applyStatusFilter(base)));
                        if (!list.length) return '';
                        const cards = list.map((dev) => {
                            const statusClass = dev.status || 'unknown';
                            const isReported = statusClass === 'inactive' && hasDeviceTicketLink(dev.name, def.key);
                            const statusHTML = `
                                <div class="store-value status-inline">
                                    <span>${escapeHtml(dev.status || 'unknown')}</span>
                                    ${isReported ? '<span class="reported-tag">Reported</span>' : ''}
                                </div>
                            `;
                            const tooltipText = `Device: ${dev.name}\nStatus: ${String(dev.status || 'unknown').toUpperCase()}${
                                isReported ? '\nCRM ticket on file (reported)' : ''
                            }`;
                            const hasWarning = statusClass !== 'active';
                            const showTriangle = hasWarning;
                            return `
                                <div class="store-card ${statusClass}${hasWarning ? ' has-warning' : ''}${isReported ? ' store-card--reported' : ''}" 
                                    data-device-name="${escapeHtml(dev.name)}" 
                                    data-status="${statusClass}"
                                    ${tooltipText ? `data-tooltip="${escapeHtml(tooltipText)}"` : ''}>
                                    ${showTriangle ? `<div class="card-warning-icon" title="Issue detected"></div>` : ''}
                                    <div class="store-name">${escapeHtml(dev.name)}</div>
                                    ${statusHTML}
                                </div>
                            `;
                        }).join('');
                        return `
                            <section class="grouped-device-section">
                                <h4 class="grouped-device-title">${escapeHtml(def.label)}</h4>
                                <div class="stores-grid grouped-device-grid">${cards}</div>
                            </section>
                        `;
                    }).filter(Boolean);

                    if (!blocks.length) {
                        grid.innerHTML = `
                            <div class="empty-state" style="grid-column: 1 / -1;">
                                <i class="fas fa-inbox"></i>
                                <h4>No devices found</h4>
                                <p>No devices match the current filter</p>
                            </div>
                        `;
                        return;
                    }

                    grid.innerHTML = blocks.join('');
                }

                /**
                 * Aligns with Prometheus DeviceStoreNoInternet: no usable WAN (P down + B down/none, or P none + B down).
                 * Used so Offline Devices counts do not inflate when pings fail only because the store has no internet.
                 * After recovery, use WAN_DEPENDENT_RECOVERY_GRACE_MS (15m post-recovery grace).
                 */
                const isStoreFullWanBlackoutRouter = _PS.isInternetDownRouter || function () { return false; };

                function updateStatistics(devices, htmlNode) {
                    if (currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE) {
                        updateUnreportedLiveStatistics(htmlNode, filteredLiveUnreportedList(liveUnreportedRowsCache));
                        return;
                    }

                    let totalDevicesCount = devices.length;
                    let openStoresPrimary = 0;
                    let openStoresBackup = 0;
                    let projectStoresPrimary = 0;
                    let projectStoresBackup = 0;
                    let otherPrimary = 0;
                    let otherBackup = 0;
                    let backupDownCount = 0;
                    let noBackupCount = 0;
                    let activeCount = 0;
                    let inactiveCount = 0;
                    let onBackupCount = 0;
                    let primaryOfflineCount = 0;
                    let backupOfflineCount = 0;
                    let primarySwitchOfflineCount = 0;
                    let secondarySwitchOfflineCount = 0;
                    let switchOfflineCount = 0;
                    let cashOffline = 0;
                    let musicOffline = 0;
                    let pcOffline = 0;
                    if (currentDeviceType === 'routers') {
                        const isStoreLocation = (name) => /^ar\d+$/i.test(String(name || '').trim());
                        const belongsToStore = (name) => /^ar\d+/i.test(String(name || '').trim());
                        const storeRouters = devices.filter(d => isStoreLocation(d.name));
                        const projectRouters = dataMap['project-routers'] || [];
                        const otherRouters = devices.filter(d => !isStoreLocation(d.name));

                        // Match renderDeviceCards: grid merges project-routers: refId A + M. Without this,
                        // a store that exists only under M (e.g. AR0086) shows P Down on the card but
                        // "Primary: 0 Offline" in Internet Status.
                        const storeRoutersMergedMap = new Map();
                        const storeKey = (d) => String(d?.name || '').trim().toLowerCase();
                        storeRouters.forEach((d) => storeRoutersMergedMap.set(storeKey(d), d));
                        projectRouters.filter((d) => isStoreLocation(d.name)).forEach((d) => {
                            const k = storeKey(d);
                            if (!storeRoutersMergedMap.has(k)) storeRoutersMergedMap.set(k, d);
                        });
                        const storeRoutersForOnt = [...storeRoutersMergedMap.values()];

                        const countGroupLinks = (routers) => routers.reduce((acc, d) => {
                            acc.primary += 1;
                            const backupText = d.ontBackupText || 'UNKNOWN';
                            const backupStatus = d.ontBackupStatus || 'unknown';
                            const hasBackup = String(backupText).trim().toUpperCase() !== 'NONE';
                            if (hasBackup) {
                                acc.backup += 1;
                                if (backupStatus === 'down') {
                                    acc.backupDown += 1;
                                }
                            } else {
                                acc.noBackup += 1;
                            }
                            return acc;
                        }, { primary: 0, backup: 0, backupDown: 0, noBackup: 0 });

                        const openCounts = countGroupLinks(storeRouters);
                        const projectCounts = countGroupLinks(projectRouters);
                        const otherCounts = countGroupLinks(otherRouters);

                        openStoresPrimary = openCounts.primary;
                        openStoresBackup = openCounts.backup;
                        projectStoresPrimary = projectCounts.primary;
                        projectStoresBackup = projectCounts.backup;
                        otherPrimary = otherCounts.primary;
                        otherBackup = otherCounts.backup;

                        backupDownCount = openCounts.backupDown;
                        noBackupCount = openCounts.noBackup;
                        activeCount = storeRoutersForOnt.filter((d) => String(d.ontStatus || '').toLowerCase() === 'primary').length;
                        inactiveCount = storeRoutersForOnt.filter((d) => String(d.ontStatus || '').toLowerCase() === 'down').length;
                        onBackupCount = storeRoutersForOnt.filter((d) => String(d.ontStatus || '').toLowerCase() === 'backup').length;
                        primaryOfflineCount = storeRoutersForOnt.filter((d) => {
                            const st = String(d.ontPrimaryStatus || '').toLowerCase();
                            const txt = String(d.ontPrimaryText || '').toLowerCase();
                            return st === 'down' || /\bdown\b/.test(txt);
                        }).length;
                        backupOfflineCount = storeRoutersForOnt.filter((d) => {
                            const backupText = String(d.ontBackupText || 'UNKNOWN').trim().toUpperCase();
                            const hasBackup = backupText !== 'NONE';
                            const backupStatus = String(d.ontBackupStatus || '').toLowerCase();
                            return hasBackup && backupStatus === 'down';
                        }).length;
                        totalDevicesCount = openCounts.primary + projectCounts.primary + otherCounts.primary;

                        const countByStatus = (list) => {
                            let online = 0;
                            let offline = 0;
                            list.forEach((item) => {
                                if (item.status === 'active') online += 1;
                                else offline += 1;
                            });
                            return { online, offline };
                        };

                        const routerByStoreForWan = new Map();
                        storeRoutersForOnt.forEach((r) => {
                            const code = extractStoreCode(r.name);
                            if (code) routerByStoreForWan.set(code, r);
                        });

                        const nowMs = Date.now();
                        storeRoutersForOnt.forEach((r) => {
                            const code = extractStoreCode(r.name);
                            if (!code) return;
                            const blackoutNow = isStoreFullWanBlackoutRouter(r);
                            const wasBlackout = prevIsStoreFullWanBlackoutByCode[code] === true;
                            if (wasBlackout && !blackoutNow) {
                                wanRecoveryOfflineCountGraceUntilByCode[code] = nowMs + WAN_DEPENDENT_RECOVERY_GRACE_MS;
                            }
                            if (blackoutNow) {
                                delete wanRecoveryOfflineCountGraceUntilByCode[code];
                            }
                            prevIsStoreFullWanBlackoutByCode[code] = blackoutNow;
                        });
                        Object.keys(prevIsStoreFullWanBlackoutByCode).forEach((code) => {
                            if (!routerByStoreForWan.has(code)) {
                                delete prevIsStoreFullWanBlackoutByCode[code];
                            }
                        });
                        Object.keys(wanRecoveryOfflineCountGraceUntilByCode).forEach((c) => {
                            if (nowMs >= wanRecoveryOfflineCountGraceUntilByCode[c]) {
                                delete wanRecoveryOfflineCountGraceUntilByCode[c];
                            }
                        });

                        const countByStatusExcludingWanCascadeForSummary = (list) => {
                            let online = 0;
                            let offline = 0;
                            list.forEach((item) => {
                                if (item.status === 'active') {
                                    online += 1;
                                    return;
                                }
                                const code = extractStoreCode(item.name);
                                const router = code ? routerByStoreForWan.get(code) : null;
                                const graceUntil = code ? wanRecoveryOfflineCountGraceUntilByCode[code] : null;
                                const inPostWanGrace = graceUntil != null && nowMs < graceUntil;
                                const inWanBlackoutNow = code ? prevIsStoreFullWanBlackoutByCode[code] === true : false;
                                if ((router && isStoreFullWanBlackoutRouter(router)) || inWanBlackoutNow || inPostWanGrace) {
                                    return;
                                }
                                offline += 1;
                            });
                            return { online, offline };
                        };

                        const cashAll = [
                            ...(dataMap['cash-register-1'] || []),
                            ...(dataMap['cash-register-2'] || []),
                            ...(dataMap['cash-register-3'] || [])
                        ].filter(d => belongsToStore(d.name));
                        const musicAll = [
                            ...(dataMap['inside-music'] || []),
                            ...(dataMap['outside-music'] || [])
                        ].filter(d => belongsToStore(d.name));
                        const pcAll = (dataMap['price-checkers'] || []).filter(d => belongsToStore(d.name));
                        const primarySwitchAll = (dataMap['switches-primary'] || []).filter(d => belongsToStore(d.name));
                        const secondarySwitchAll = (dataMap['switches-secondary'] || []).filter(d => belongsToStore(d.name));

                        const cashCounts = countByStatusExcludingWanCascadeForSummary(cashAll);
                        const musicCounts = countByStatusExcludingWanCascadeForSummary(musicAll);
                        const pcCounts = countByStatusExcludingWanCascadeForSummary(pcAll);
                        const primarySwitchCounts = countByStatus(primarySwitchAll);
                        const secondarySwitchCounts = countByStatus(secondarySwitchAll);

                        cashOffline = cashCounts.offline;
                        musicOffline = musicCounts.offline;
                        pcOffline = pcCounts.offline;
                        primarySwitchOfflineCount = primarySwitchCounts.offline;
                        secondarySwitchOfflineCount = secondarySwitchCounts.offline;
                        switchOfflineCount = primarySwitchOfflineCount + secondarySwitchOfflineCount;
                    }
                    
                    const setTxt = (id, val) => { 
                        const el = htmlNode.getElementById(id); 
                        if (el) el.innerText = val; 
                    };
                    const totalEl = htmlNode.getElementById('total-stores');
                    const totalLabelEl = htmlNode.getElementById('total-stores-label');
                    const totalBoxEl = totalEl ? totalEl.closest('.stat-box') : null;
                    const overviewTotalsBoxEl = htmlNode.getElementById('overview-store-totals-box');
                    const overviewTotalsEl = htmlNode.getElementById('overview-store-totals');
                    const showOverviewSummary =
                        currentDashboardPage === 'live' &&
                        currentDeviceType === 'routers' &&
                        !isOfflineViewActive;
                    if (totalEl && showOverviewSummary) {
                        if (totalBoxEl) {
                            totalBoxEl.classList.add('stat-box-breakdown');
                        }
                        if (totalLabelEl) totalLabelEl.style.display = 'none';
                        totalEl.innerHTML = `
                            <div class="total-breakdown" aria-label="Device counts breakdown">
                                <div class="internet-summary-grid">
                                    <section class="internet-summary-card">
                                        <h4 class="internet-summary-title">Internet Status</h4>
                                        <div class="internet-summary-row"><span>Primary:</span><span class="internet-summary-metric"><strong>${primaryOfflineCount}</strong> Offline</span></div>
                                        <div class="internet-summary-row"><span>Backup:</span><span class="internet-summary-metric"><strong>${backupOfflineCount}</strong> Offline</span></div>
                                        <div class="internet-summary-row"><span>Switch:</span><span class="internet-summary-metric"><strong>${switchOfflineCount}</strong> Offline</span></div>
                                    </section>
                                    <section class="internet-summary-card internet-summary-card--offline">
                                        <h4 class="internet-summary-title">Offline Devices</h4>
                                        <div class="internet-summary-row"><span>Cash Registers:</span><span class="internet-summary-metric"><strong>${cashOffline}</strong> Offline</span></div>
                                        <div class="internet-summary-row"><span>Music:</span><span class="internet-summary-metric"><strong>${musicOffline}</strong> Offline</span></div>
                                        <div class="internet-summary-row"><span>Price Checkers:</span><span class="internet-summary-metric"><strong>${pcOffline}</strong> Offline</span></div>
                                    </section>
                                </div>
                            </div>
                        `;
                        if (overviewTotalsBoxEl) overviewTotalsBoxEl.style.display = 'flex';
                        if (overviewTotalsEl) {
                            overviewTotalsEl.innerHTML = `
                                <div class="overview-metrics-strip" aria-label="Store totals">
                                    <div class="overview-metric-item"><div class="overview-metric-value">${activeCount}</div><div class="overview-metric-label">Active</div></div>
                                    <div class="overview-metric-item"><div class="overview-metric-value">${inactiveCount}</div><div class="overview-metric-label">Inactive</div></div>
                                    <div class="overview-metric-item"><div class="overview-metric-value">${onBackupCount}</div><div class="overview-metric-label">On Backup</div></div>
                                    <div class="overview-metric-item"><div class="overview-metric-value">${backupDownCount}</div><div class="overview-metric-label">Backup Down</div></div>
                                    <div class="overview-metric-item"><div class="overview-metric-value">${noBackupCount}</div><div class="overview-metric-label">No Backup</div></div>
                                </div>
                            `;
                        }
                    } else {
                        if (totalBoxEl) {
                            totalBoxEl.classList.remove('stat-box-breakdown');
                        }
                        if (overviewTotalsBoxEl) overviewTotalsBoxEl.style.display = 'none';
                        if (overviewTotalsEl) overviewTotalsEl.innerHTML = '';
                        if (totalLabelEl) {
                            totalLabelEl.style.display = '';
                            totalLabelEl.textContent = 'Total Devices';
                        }
                        setTxt('total-stores', totalDevicesCount);
                    }
                }

                function renderKpiCards(container, cards) {
                    if (!container) return;
                    container.innerHTML = cards.map((card) => `
                        <article class="analytics-kpi-card">
                            <div class="analytics-kpi-label">${escapeHtml(card.label)}</div>
                            <div class="analytics-kpi-value">${escapeHtml(String(card.value))}</div>
                        </article>
                    `).join('');
                }

                function renderSimpleTableRows(tbody, rows, columns) {
                    if (!tbody) return;
                    if (!rows || !rows.length) {
                        tbody.innerHTML = `<tr><td colspan="${columns.length}" class="analytics-empty">No data in selected range.</td></tr>`;
                        return;
                    }
                    tbody.innerHTML = rows.map((row) => `
                        <tr>
                            ${columns.map((column) => `<td>${column(row)}</td>`).join('')}
                        </tr>
                    `).join('');
                }

                /** 6-column grid (same as Top Stores): col1 = Store, col2 = Incidents / Reports */
                function renderOwnerWorkloadGrid(bodyEl, rows) {
                    if (!bodyEl) return;
                    if (!rows || !rows.length) {
                        bodyEl.innerHTML = `
                            <div class="analytics-ow-empty-row">
                                <span class="analytics-empty">No data in selected range.</span>
                            </div>`;
                        return;
                    }
                    bodyEl.innerHTML = rows.map((r) => `
                        <div class="analytics-ow-grid-row" role="row">
                            <span class="analytics-ow-cell-owner" role="gridcell">${escapeHtml(ownerDisplayName(r.owner_name || '', 'Unassigned'))}</span>
                            <span class="analytics-ow-cell-reports" role="gridcell">${escapeHtml(String(r.ticket_count ?? 0))}</span>
                        </div>
                    `).join('');
                }

                function updateReportingUnreportedPaginationUI(htmlNode, reportingRoot) {
                    const wrap = htmlNode.getElementById('reporting-unreported-pagination');
                    const summary = htmlNode.getElementById('reporting-unreported-pagination-summary');
                    const btn = wrap ? wrap.querySelector('.reporting-card-meta-load-more') : null;
                    if (!wrap || !summary || !reportingRoot) return;
                    const meta = reportingRoot._unreportedMeta;
                    if (!meta || meta.total == null) {
                        wrap.hidden = true;
                        if (btn) {
                            btn.hidden = true;
                            btn.removeAttribute('style');
                        }
                        return;
                    }
                    const total = meta.total;
                    const totalNum = Number(total);
                    const hasMore = apiHasMoreTrue(meta.has_more);
                    const sqlLoaded = meta.sqlLoaded ?? 0;
                    const shown = (reportingRoot._unreportedRowsBase || []).length;
                    const overMinTotal = Number.isFinite(totalNum) && totalNum > LOAD_MORE_MIN_TOTAL;
                    const showLoadMore = Boolean(
                        hasMore && overMinTotal && sqlLoaded < totalNum
                    );
                    wrap.hidden = false;
                    summary.textContent = '';
                    if (btn) {
                        btn.hidden = !showLoadMore;
                        if (showLoadMore) {
                            btn.style.display = 'inline-flex';
                            btn.onclick = () => appendReportingUnreportedPage(htmlNode);
                        } else {
                            btn.style.display = 'none';
                            btn.onclick = null;
                        }
                    }
                }

                function updateReportingReportedPaginationUI(htmlNode, reportingRoot) {
                    const wrap = htmlNode.getElementById('reporting-reported-pagination');
                    const summary = htmlNode.getElementById('reporting-reported-pagination-summary');
                    const btn = wrap ? wrap.querySelector('.reporting-card-meta-load-more') : null;
                    if (!wrap || !summary || !reportingRoot) return;
                    const meta = reportingRoot._reportedMeta;
                    if (!meta || meta.total == null) {
                        wrap.hidden = true;
                        if (btn) {
                            btn.hidden = true;
                            btn.removeAttribute('style');
                        }
                        return;
                    }
                    const total = meta.total;
                    const totalNum = Number(total);
                    const hasMore = apiHasMoreTrue(meta.has_more);
                    const sqlLoaded = meta.sqlLoaded ?? 0;
                    const shown = (reportingRoot._reportedRowsBase || []).length;
                    const overMinTotal = Number.isFinite(totalNum) && totalNum > LOAD_MORE_MIN_TOTAL;
                    const showLoadMore = Boolean(
                        hasMore && overMinTotal && sqlLoaded < totalNum
                    );
                    wrap.hidden = false;
                    summary.textContent = '';
                    if (btn) {
                        btn.hidden = !showLoadMore;
                        if (showLoadMore) {
                            btn.style.display = 'inline-flex';
                            btn.onclick = () => appendReportingReportedPage(htmlNode);
                        } else {
                            btn.style.display = 'none';
                            btn.onclick = null;
                        }
                    }
                }

                async function appendReportingUnreportedPage(htmlNode) {
                    const reportingRoot = htmlNode.getElementById('incident-reporting-view');
                    if (!reportingRoot || !reportingRoot._unreportedRangeQuery) return;
                    const viewVersion = viewStateApi()?.getVersion?.() ?? 0;
                    const btn = htmlNode.getElementById('reporting-unreported-load-more');
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = 'Loading…';
                    }
                    try {
                        const offset = (reportingRoot._unreportedRawAccum || []).length;
                        const res = await apiRequest(
                            `/reporting/unreported?${reportingRoot._unreportedRangeQuery}&limit=${UNREPORTED_REPORTING_PAGE_SIZE}&offset=${offset}`
                        );
                        if (!isViewVersionCurrent(viewVersion)) return;
                        const batch = Array.isArray(res.rows) ? res.rows : [];
                        reportingRoot._unreportedRawAccum = (reportingRoot._unreportedRawAccum || []).concat(batch);
                        reportingRoot._unreportedRowsBase = filterCascadeIncidents(reportingRoot._unreportedRawAccum);
                        const total =
                            res.total !== undefined && res.total !== null
                                ? Number(res.total)
                                : reportingRoot._unreportedMeta && reportingRoot._unreportedMeta.total != null
                                ? reportingRoot._unreportedMeta.total
                                : null;
                        const returned = batch.length;
                        let hasMore = false;
                        if (res.has_more !== undefined && res.has_more !== null) {
                            hasMore = apiHasMoreTrue(res.has_more);
                        } else if (total != null) {
                            hasMore = offset + returned < total;
                        } else {
                            hasMore = returned === UNREPORTED_REPORTING_PAGE_SIZE;
                        }
                        reportingRoot._unreportedMeta = {
                            total,
                            has_more: hasMore,
                            sqlLoaded: reportingRoot._unreportedRawAccum.length
                        };
                        refreshUnreportedIncidentsFromFilters(htmlNode);
                        updateReportingUnreportedPaginationUI(htmlNode, reportingRoot);
                    } catch (e) {
                        showToast(`Load more failed: ${e.message || e}`, 'warning');
                    } finally {
                        if (btn) {
                            btn.disabled = false;
                            btn.textContent = 'Load more';
                        }
                    }
                }

                async function appendReportingReportedPage(htmlNode) {
                    const reportingRoot = htmlNode.getElementById('incident-reporting-view');
                    if (!reportingRoot || !reportingRoot._reportedRangeQuery) return;
                    const viewVersion = viewStateApi()?.getVersion?.() ?? 0;
                    const btn = htmlNode.getElementById('reporting-reported-load-more');
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = 'Loading…';
                    }
                    try {
                        const offset = (reportingRoot._reportedRawAccum || []).length;
                        const res = await apiRequest(
                            `/reporting/reported?${reportingRoot._reportedRangeQuery}&limit=${REPORTED_TABLE_PAGE_SIZE}&offset=${offset}&status=all`
                        );
                        if (!isViewVersionCurrent(viewVersion)) return;
                        const batch = Array.isArray(res.rows) ? res.rows : [];
                        reportingRoot._reportedRawAccum = (reportingRoot._reportedRawAccum || []).concat(batch);
                        reportingRoot._reportedRowsBase = reportingRoot._reportedRawAccum.slice();
                        const total =
                            res.total !== undefined && res.total !== null
                                ? Number(res.total)
                                : reportingRoot._reportedMeta && reportingRoot._reportedMeta.total != null
                                ? reportingRoot._reportedMeta.total
                                : null;
                        const returned = batch.length;
                        let hasMore = false;
                        if (res.has_more !== undefined && res.has_more !== null) {
                            hasMore = apiHasMoreTrue(res.has_more);
                        } else if (total != null) {
                            hasMore = offset + returned < total;
                        } else {
                            hasMore = returned === REPORTED_TABLE_PAGE_SIZE;
                        }
                        reportingRoot._reportedMeta = {
                            total,
                            has_more: hasMore,
                            sqlLoaded: reportingRoot._reportedRawAccum.length
                        };
                        populateReportedOwnerChecklist(htmlNode, reportingRoot._reportedRawAccum);
                        populateReportedTagChecklist(htmlNode, reportingRoot._reportedRawAccum);
                        refreshReportedTicketsFromFilters(htmlNode);
                        updateReportingReportedPaginationUI(htmlNode, reportingRoot);
                    } catch (e) {
                        showToast(`Load more failed: ${e.message || e}`, 'warning');
                    } finally {
                        if (btn) {
                            btn.disabled = false;
                            btn.textContent = 'Load more';
                        }
                    }
                }

                async function renderIncidentReportingView(htmlNode, viewVersion) {
                    const vv = viewVersion !== undefined && viewVersion !== null
                        ? viewVersion
                        : (viewStateApi()?.getVersion?.() ?? 0);
                    const days = getEffectiveRangeDays();
                    const bounds = getEffectiveRangeBounds();
                    const rangeQuery = `days=${days}&from_ms=${Math.floor(bounds.fromMs)}&to_ms=${Math.floor(bounds.toMs)}`;
                    const [overviewRes, topStoresRes, topDeviceCategoriesRes, ownerRes] = await Promise.all([
                        apiRequest(`/reporting/overview?${rangeQuery}`),
                        apiRequest(`/reporting/top-stores?${rangeQuery}&limit=30`),
                        apiRequest(`/reporting/top-device-categories?${rangeQuery}`),
                        apiRequest(`/reporting/owner-workload?${rangeQuery}&limit=30`)
                    ]);
                    if (!isViewVersionCurrent(vv)) return;
                    const [unreportedRes, reportedRes] = await Promise.all([
                        apiRequest(`/reporting/unreported?${rangeQuery}&limit=${UNREPORTED_REPORTING_PAGE_SIZE}&offset=0`),
                        // Reporting page wants the full ledger of reported tickets
                        // (active + already-resolved). Live page uses the default
                        // status=open so the two sections stay disjoint.
                        apiRequest(`/reporting/reported?${rangeQuery}&limit=${REPORTED_TABLE_PAGE_SIZE}&offset=0&status=all`)
                    ]);
                    if (!isViewVersionCurrent(vv)) return;

                    const overview = overviewRes?.overview || {};
                    const reportedRows = reportedRes?.rows || [];
                    const unreportedRowsInitial = Array.isArray(unreportedRes?.rows) ? unreportedRes.rows : [];
                    // Single source of truth shared with Top Devices / Top Stores:
                    // mirrors the visible Live page sections (Unreported deduped
                    // against Reported via supersession). Totals match the
                    // section card counts the user sees on /incidents.
                    const kpiSrc = reportingKpiAlignedRowsFromArrays(
                        filterCascadeIncidents(unreportedRowsInitial),
                        reportedRows
                    ) || { unreported: [], reported: [] };
                    const incidentsKpiCount = kpiSrc.unreported.length + kpiSrc.reported.length;
                    renderKpiCards(htmlNode.getElementById('reporting-kpi-grid'), [
                        { label: 'INCIDENTS', value: incidentsKpiCount },
                        { label: 'UNREPORTED', value: kpiSrc.unreported.length },
                        { label: 'UNRESOLVED', value: 'N/A' },
                        { label: 'SOLVED', value: 'N/A' },
                        { label: 'Resolve Time', value: 'N/A' }
                    ]);

                    const reportingRoot = htmlNode.getElementById('incident-reporting-view');
                    if (reportingRoot) {
                        reportingRoot._unreportedRawAccum = unreportedRowsInitial.slice();
                        reportingRoot._unreportedRowsBase = filterCascadeIncidents(reportingRoot._unreportedRawAccum);
                        reportingRoot._unreportedRangeQuery = rangeQuery;
                        const uTotal =
                            unreportedRes && unreportedRes.total !== undefined && unreportedRes.total !== null
                                ? Number(unreportedRes.total)
                                : null;
                        const uReturned = (unreportedRes?.rows || []).length;
                        let uHasMore = false;
                        if (unreportedRes && unreportedRes.has_more !== undefined && unreportedRes.has_more !== null) {
                            uHasMore = apiHasMoreTrue(unreportedRes.has_more);
                        } else if (uTotal != null) {
                            uHasMore = uReturned < uTotal;
                        } else {
                            uHasMore = uReturned === UNREPORTED_REPORTING_PAGE_SIZE;
                        }
                        reportingRoot._unreportedMeta = {
                            total: uTotal,
                            has_more: uHasMore,
                            sqlLoaded: reportingRoot._unreportedRawAccum.length
                        };
                        reportingRoot._reportedRawAccum = Array.isArray(reportedRes?.rows) ? reportedRes.rows.slice() : [];
                        reportingRoot._reportedRowsBase = reportingRoot._reportedRawAccum.slice();
                        reportingRoot._reportedRangeQuery = rangeQuery;
                        const rTotal =
                            reportedRes && reportedRes.total !== undefined && reportedRes.total !== null
                                ? Number(reportedRes.total)
                                : null;
                        const rReturned = (reportedRes?.rows || []).length;
                        let rHasMore = false;
                        if (reportedRes && reportedRes.has_more !== undefined && reportedRes.has_more !== null) {
                            rHasMore = apiHasMoreTrue(reportedRes.has_more);
                        } else if (rTotal != null) {
                            rHasMore = rReturned < rTotal;
                        } else {
                            rHasMore = rReturned === REPORTED_TABLE_PAGE_SIZE;
                        }
                        reportingRoot._reportedMeta = {
                            total: rTotal,
                            has_more: rHasMore,
                            sqlLoaded: reportingRoot._reportedRawAccum.length
                        };
                        reportingRoot._topStoresRowsBase = topStoresRes?.rows || [];
                        reportingRoot._topDeviceCategoriesRowsBase = topDeviceCategoriesRes?.rows || [];
                        reportingRoot._ownerWorkloadRowsBase = ownerRes?.rows || [];
                    }
                    setupReportingSortButtonsDelegation(htmlNode);
                    syncAllReportingSortButtons(htmlNode);
                    bindReportingFilterDetailsOutsideClose(htmlNode);
                    setupUnreportedIncidentFilters(htmlNode);
                    refreshUnreportedIncidentsFromFilters(htmlNode);
                    if (reportingRoot) updateReportingUnreportedPaginationUI(htmlNode, reportingRoot);

                    setupReportedTicketsFilters(htmlNode);
                    populateReportedOwnerChecklist(htmlNode, reportingRoot ? reportingRoot._reportedRawAccum : reportedRows);
                    populateReportedTagChecklist(htmlNode, reportingRoot ? reportingRoot._reportedRawAccum : reportedRows);
                    refreshReportedTicketsFromFilters(htmlNode);
                    if (reportingRoot) updateReportingReportedPaginationUI(htmlNode, reportingRoot);

                    setupTopStoresFilters(htmlNode);
                    refreshTopStoresFromFilters(htmlNode);

                    setupTopDeviceCategoriesFilters(htmlNode);
                    refreshTopDeviceCategoriesFromFilters(htmlNode);

                    setupOwnerWorkloadFilters(htmlNode);
                    populateOwnerWorkloadOwnerChecklist(htmlNode, ownerRes?.rows || []);
                    refreshOwnerWorkloadFromFilters(htmlNode);
                }

                function enforceIncidentReportingCardOrder(htmlNode) {
                    const reportingRoot = htmlNode.getElementById('incident-reporting-view');
                    if (!reportingRoot) return;
                    const cards = [...reportingRoot.querySelectorAll('.analytics-table-card')];
                    if (!cards.length) return;
                    const findCardByHeading = (title) =>
                        cards.find((card) => {
                            const h3 = card.querySelector('h3');
                            return h3 && String(h3.textContent || '').trim() === title;
                        }) || null;
                    const ordered = [
                        findCardByHeading('Top Devices by Incidents'),
                        findCardByHeading('Top Stores By Downtime')
                    ].filter(Boolean);
                    const remaining = cards.filter((card) => !ordered.includes(card));
                    [...ordered, ...remaining].forEach((card) => reportingRoot.appendChild(card));
                }

                // ============================================================================
                // 5. MAIN VIEW UPDATE
                // ============================================================================

                function markPanelReady(htmlNode) {
                    try {
                        const root = htmlNode && htmlNode.documentElement
                            ? htmlNode.documentElement
                            : document.documentElement;
                        root.classList.add('gfn-panel-ready');
                        const VS = window.GFN_VIEW_STATE;
                        if (VS && typeof VS.getState === 'function' && typeof VS.syncHtmlAttributes === 'function') {
                            VS.syncHtmlAttributes(VS.getState());
                        }
                    } catch (_e) { /* ignore */ }
                }

                function updateMainView(htmlNode) {
                    markPanelReady(htmlNode);
                    const tableContainer = htmlNode.getElementById('offline-time-table-container');
                    const grid = htmlNode.getElementById('stores-grid');
                    const offlineBtn = htmlNode.getElementById('offline-time-button');
                    const offlineSortBtn = htmlNode.getElementById('offline-sort-button');
                    const exportBtn = htmlNode.getElementById('export-button');
                    const searchContainer = htmlNode.querySelector('.search-container');
                    const searchBox = htmlNode.getElementById('search-box');
                    const clearSearchBtn = htmlNode.getElementById('clear-search');
                    const sortBtn = htmlNode.getElementById('sort-toggle-button');
                    const nonInternetIssueBtn = htmlNode.getElementById('non-internet-issue-btn');
                    const statsHeader = htmlNode.querySelector('.stats-header');
                    const controlsHeader = htmlNode.querySelector('.controls-header');
                    const reportingView = htmlNode.getElementById('incident-reporting-view');
                    const routerTimelineView = htmlNode.getElementById('router-timeline-view');

                    const groupedDefs = LIVE_GROUPED_DEVICE_TYPES[currentDeviceType] || null;
                    const currentDevices = groupedDefs
                        ? groupedDefs.flatMap((d) => dataMap[d.key] || [])
                        : (dataMap[currentDeviceType] || []);
                    const showLivePage = currentDashboardPage === 'live';
                    const showReportingPage = currentDashboardPage === 'reporting';
                    const showRouterTimelinePage = currentDashboardPage === 'router-timeline';

                    if (statsHeader) statsHeader.style.display = showLivePage ? 'grid' : 'none';
                    if (controlsHeader) controlsHeader.style.display = showLivePage ? 'flex' : 'none';
                    if (tableContainer) tableContainer.classList.toggle('visible', false);
                    if (grid) {
                        // CSS rule `.stores-grid.grouped-sections { display: flex !important }`
                        // overrides a plain inline `style.display='none'`, so when leaving
                        // Incidents / grouped device views, the live cards stayed visible
                        // behind the reporting/offline panes. Strip the grouping classes
                        // and force `none` with `!important` so the hide actually wins.
                        grid.classList.remove(
                            'grouped-sections',
                            'grouped-sections--switches',
                            'grouped-sections--cash',
                            'grouped-sections--music',
                            'stores-grid--unreported'
                        );
                        grid.style.setProperty('display', 'none', 'important');
                    }
                    if (reportingView) reportingView.classList.toggle('visible', showReportingPage);
                    if (routerTimelineView) routerTimelineView.classList.toggle('visible', showRouterTimelinePage);

                    // The date selector only belongs to the date-aware views
                    // (Offline Time Report, Live Incidents, Router Timeline, Incident & Reporting).
                    // On every other Live device view (Overview, Switches, etc.)
                    // we hide the button so users can't pin those grids to a
                    // historical window — the saved filter still applies to the
                    // date-aware views.
                    const timeRangeBtn = htmlNode.getElementById('time-range-button');
                    if (timeRangeBtn) {
                        // Only the LIVE time-range button lives in #time-range-button.
                        // For non-Live date-aware views (Reporting, Summary) the topbar
                        // shows #reporting-time-range-button instead — toggled by
                        // shell.js's syncTimeRangeButtons. Avoid showing the live one
                        // alongside it.
                        const showLiveTimeBtn = showLivePage && isDateAwareView();
                        timeRangeBtn.style.display = showLiveTimeBtn ? 'inline-flex' : 'none';
                    }

                    if (showRouterTimelinePage) {
                        if (nonInternetIssueBtn) nonInternetIssueBtn.style.display = 'none';
                        try {
                            const rt = window.GFN_ROUTER_TIMELINE;
                            if (rt) {
                                if (typeof rt.isMounted === 'function' && rt.isMounted() && typeof rt.refresh === 'function') {
                                    rt.refresh(htmlNode);
                                } else if (typeof rt.init === 'function') {
                                    rt.init(htmlNode);
                                }
                            }
                        } catch (err) {
                            console.warn('[Device Monitor] Router Timeline refresh failed', err);
                        }
                        return;
                    }

                    try {
                        if (window.GFN_ROUTER_TIMELINE && typeof window.GFN_ROUTER_TIMELINE.teardown === 'function') {
                            window.GFN_ROUTER_TIMELINE.teardown();
                        }
                    } catch (err) {
                        console.warn('[Device Monitor] Router Timeline teardown failed', err);
                    }

                    if (showReportingPage) {
                        enforceIncidentReportingCardOrder(htmlNode);
                        if (nonInternetIssueBtn) nonInternetIssueBtn.style.display = 'none';
                        const reportingViewVersion = viewStateApi()?.getVersion?.() ?? 0;
                        renderIncidentReportingView(htmlNode, reportingViewVersion).catch((error) => {
                            if (!isViewVersionCurrent(reportingViewVersion)) return;
                            console.warn('[Device Monitor] Reporting view failed', error);
                            showToast(`Reporting data failed: ${error.message || error}`, 'warning');
                        });
                        return;
                    }

                    updateStatistics(currentDevices, htmlNode);

                    const isOverviewTotalsContext =
                        showLivePage &&
                        currentDeviceType === 'routers' &&
                        !isOfflineViewActive;
                    const overviewBand = htmlNode.getElementById('shell-overview-band');
                    if (overviewBand) {
                        overviewBand.style.display = isOverviewTotalsContext ? '' : 'none';
                    }
                    if (!isOverviewTotalsContext) {
                        const totalEl = htmlNode.getElementById('total-stores');
                        const totalLabelEl = htmlNode.getElementById('total-stores-label');
                        const totalBoxEl = totalEl ? totalEl.closest('.stat-box') : null;
                        const overviewTotalsBoxEl = htmlNode.getElementById('overview-store-totals-box');
                        const overviewTotalsEl = htmlNode.getElementById('overview-store-totals');
                        if (totalBoxEl) totalBoxEl.classList.remove('stat-box-breakdown');
                        if (overviewTotalsBoxEl) overviewTotalsBoxEl.style.display = 'none';
                        if (overviewTotalsEl) overviewTotalsEl.innerHTML = '';
                        /* Incidents Live: total + label come from updateUnreportedLiveStatistics / render (not device map length). */
                        if (currentDeviceType !== LIVE_UNREPORTED_DEVICE_TYPE) {
                            if (totalLabelEl) {
                                totalLabelEl.style.display = '';
                                totalLabelEl.textContent = 'Total Devices';
                            }
                            if (totalEl) totalEl.innerText = String(currentDevices.length);
                        }
                    }

                    if (isOfflineViewActive) {
                        const liveTbar = htmlNode.getElementById('live-unreported-toolbar');
                        if (liveTbar) liveTbar.hidden = true;
                        if (offlineBtn) offlineBtn.classList.add('active');
                        if (offlineSortBtn) offlineSortBtn.style.display = 'inline-flex';
                        if (exportBtn) exportBtn.style.display = 'inline-flex';
                        if (searchContainer) searchContainer.style.display = 'flex';
                        if (sortBtn) sortBtn.style.display = 'none';
                        if (nonInternetIssueBtn) nonInternetIssueBtn.style.display = 'none';
                        // Grid is already hidden (with !important) at the top of
                        // updateMainView. Re-asserting here would drop the priority
                        // and let the grouped-sections CSS rule un-hide it.
                        renderOfflineTable(htmlNode);
                        if (tableContainer) tableContainer.classList.add('visible');
                    } else {
                        if (offlineBtn) offlineBtn.classList.remove('active');
                        if (offlineSortBtn) offlineSortBtn.style.display = 'none';
                        if (exportBtn) exportBtn.style.display = 'none';
                        /* Live views: no store search (offline report keeps it). Unreported uses reporting table filters instead. */
                        if (searchContainer) searchContainer.style.display = 'none';
                        const isUnreportedIncidents =
                            showLivePage && !isOfflineViewActive && currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE;
                        // Incidents page filters (Devices / Duration / Status /
                        // Tags / Ticket) intentionally hidden — UX request to
                        // declutter the toolbar. Element kept in DOM so the
                        // existing JS bindings (status cycle, tag filter, etc.)
                        // don't crash on null lookups; defaults stay at "all".
                        const liveUnreportedToolbar = htmlNode.getElementById('live-unreported-toolbar');
                        if (liveUnreportedToolbar) liveUnreportedToolbar.hidden = true;
                        if (sortBtn) sortBtn.style.display = isUnreportedIncidents ? 'none' : 'inline-flex';
                        if (isUnreportedIncidents) {
                            updateLiveUnreportedStatusCycleButton(htmlNode);
                            updateLiveUnreportedDurationCycleButton(htmlNode);
                        }
                        if (nonInternetIssueBtn) {
                            nonInternetIssueBtn.style.display = currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE ? 'inline-flex' : 'none';
                        }
                        searchQuery = '';
                        if (searchBox) searchBox.value = '';
                        if (clearSearchBtn) clearSearchBtn.style.display = 'none';
                        if (tableContainer) tableContainer.classList.remove('visible');
                        if (grid) {
                            // Clear the forced hide from the top of updateMainView so
                            // stylesheet rules (e.g. grouped-sections flex) can apply.
                            grid.style.removeProperty('display');
                            const isUnreportedView = currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE;
                            grid.classList.toggle('stores-grid--unreported', isUnreportedView);
                            // Apply `grouped-sections` together with `stores-grid--unreported`
                            // so the Incidents layout (Unreported / Reported / Solved
                            // stacked sections) is correct from the very first paint.
                            // Without this, navigating to Incidents briefly shows the
                            // sections side-by-side with the default `auto-fill 272px`
                            // grid (visible as ~1s "wrong design" flicker) until
                            // renderUnreportedLiveCards eventually adds the class.
                            if (isUnreportedView) {
                                grid.classList.add('grouped-sections');
                                // Wipe leftover cards from another device view (e.g.
                                // router/switch `.store-card`s) before we make the grid
                                // visible again. Without this, those stale cards stay
                                // visible for ~1s under the Incidents layout while the
                                // network fetch runs (visible as "wrong data" flicker).
                                // Cards that match the current view (`.unreported-live-card`)
                                // are kept so the 30s/SSE refresh path can swap them in
                                // atomically without an empty flash.
                                const stale = grid.querySelector('.store-card:not(.unreported-live-card)');
                                if (stale) {
                                    grid.innerHTML = '';
                                    delete grid.dataset.fingerprint;
                                }
                            }
                        }
                        const liveUnreportedMetaEl = htmlNode.getElementById('unreported-live-meta');
                        if (liveUnreportedMetaEl && currentDeviceType !== LIVE_UNREPORTED_DEVICE_TYPE) {
                            liveUnreportedMetaEl.hidden = true;
                            liveUnreportedMetaEl.innerHTML = '';
                        }
                        if (currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE) {
                            if (liveUnreportedRowsCache.length > 0) {
                                renderUnreportedLiveCards(htmlNode, liveUnreportedRowsCache, liveReportedRowsCache, liveSolvedRowsCache);
                                renderUnreportedLiveMetaFromCache(htmlNode);
                                if (!liveIncidentSyncInFlight) {
                                    refreshLiveIncidentSectionsInstant(htmlNode).catch(() => {});
                                }
                            } else {
                                renderUnreportedLiveView(htmlNode);
                            }
                        } else {
                            renderDeviceCards(currentDevices, htmlNode);
                            refreshReportedTicketLinksForCurrentDevices(htmlNode).catch(() => {});
                        }
                    }
                }

                // ============================================================================
                // 6. TIME RANGE SELECTOR & DATE PICKER
                // ============================================================================
                
                function setupTimeRangeSelector(htmlNode, data) {
                    // Implementation lives in modules/time-range.js.
                    const mod = window.GFN_TIME_RANGE;
                    if (!mod || typeof mod.setupTimeRangeSelector !== 'function') return;
                    mod.setupTimeRangeSelector(htmlNode, data, {
                        formatTime,
                        showToast,
                        writeSavedDateFilter,
                        TIME_RANGE_LABELS
                    });
                }

                // ============================================================================
                // 6b. VIEW CONTROLLER (navigation + apply)
                // ============================================================================

                function syncPanelControlsFromView(htmlNode) {
                    const selector = htmlNode.getElementById('device-type-selector');
                    if (selector && selector.value !== currentDeviceType) {
                        selector.value = currentDeviceType;
                    }
                    htmlNode.querySelectorAll('.page-switch-btn').forEach((button) => {
                        const isActive = button.dataset.page === currentDashboardPage;
                        button.classList.toggle('active', isActive);
                        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
                    });
                    const offlineBtn = htmlNode.getElementById('offline-time-button');
                    if (offlineBtn) {
                        offlineBtn.classList.toggle('active', isOfflineViewActive);
                    }
                }

                function gfnPanelApplyView(htmlNode) {
                    syncViewStateFromController();
                    syncPanelControlsFromView(htmlNode);
                    unreportedLiveFetchToken += 1;
                    liveUnreportedSessionId += 1;
                    if (syncDateFilterUrlForView()) return;
                    updateMainView(htmlNode);
                }

                function bindNavigationHandlers(htmlNode) {
                    const VS = viewStateApi();
                    if (!VS) return;

                    const selector = htmlNode.getElementById('device-type-selector');
                    const pageSwitchBtns = htmlNode.querySelectorAll('.page-switch-btn');
                    const offlineBtn = htmlNode.getElementById('offline-time-button');
                    const statBoxes = htmlNode.querySelectorAll('.stat-box');

                    if (selector) {
                        selector.onchange = function () {
                            const prevType = currentDeviceType;
                            VS.setState({
                                page: 'live',
                                device: this.value,
                                offline: false
                            });
                            currentFilterMode = 'all';
                            if (prevType === LIVE_UNREPORTED_DEVICE_TYPE && this.value !== LIVE_UNREPORTED_DEVICE_TYPE) {
                                liveUnreportedHiddenDeviceGroups.clear();
                                liveUnreportedHiddenReportTags.clear();
                                liveUnreportedTagAllMode = true;
                                liveUnreportedStatusFilter = 'all';
                                liveUnreportedDurationSort = 'duration_desc';
                                localStorage.setItem(STORAGE_KEY_LIVE_UNREPORTED_DURATION_SORT, liveUnreportedDurationSort);
                                updateLiveUnreportedStatusCycleButton(htmlNode);
                                updateLiveUnreportedDurationCycleButton(htmlNode);
                                liveCrmTicketSearchValue = '';
                                const ticketSearchEl = htmlNode.getElementById('live-crm-ticket-search-input');
                                if (ticketSearchEl) ticketSearchEl.value = '';
                            }
                            statBoxes.forEach((b) => { b.style.borderColor = 'rgba(255, 255, 255, 0.1)'; });
                            gfnPanelApplyView(htmlNode);
                        };
                    }

                    pageSwitchBtns.forEach((button) => {
                        button.onclick = function () {
                            const nextPage = this.dataset.page;
                            if (!nextPage) return;
                            const cur = VS.getState();
                            if (nextPage === cur.page && !cur.offline) return;
                            VS.setState({ page: nextPage, offline: false });
                            gfnPanelApplyView(htmlNode);
                        };
                    });

                    if (offlineBtn) {
                        offlineBtn.onclick = function () {
                            const cur = VS.getState();
                            VS.setState({
                                page: 'live',
                                device: 'routers',
                                offline: !cur.offline
                            });
                            gfnPanelApplyView(htmlNode);
                        };
                    }
                }

                // ============================================================================
                // 7. INITIALIZATION
                // ============================================================================

                function initializeDashboard(data, htmlNode) {
                    currentTicketActor = detectLoggedInActor();
                    latestGrafanaData = data;
                    syncViewStateFromController();
                    if (!['live', 'reporting', 'router-timeline'].includes(currentDashboardPage)) {
                        const VS = viewStateApi();
                        if (VS) VS.setState({ page: 'live' }, { bumpVersion: false });
                        syncViewStateFromController();
                    }

                    // Reconcile the URL date-selector with the current view. The
                    // Live device grids must not be pinned to a historical window;
                    // Offline / Incidents / Reporting should restore the user's last
                    // historical pick. If the URL is rewritten, a reload is already
                    // in flight — skip the rest of the init pass.
                    if (syncDateFilterUrlForView()) return;

                    // Bind toast root to this panel instance
                    toastRootNode = htmlNode;
                    panelRuntime.toastRootNode = toastRootNode;

                    // Reset one-time listener setup if panel root node changed
                    if (listenersRootNode !== htmlNode) {
                        listenersRootNode = htmlNode;
                        listenersInitialized = false;
                        panelRuntime.listenersRootNode = listenersRootNode;
                        panelRuntime.listenersInitialized = listenersInitialized;
                    }

                    // A. Data processing — reset maps before processing
                    Object.keys(dataMap).forEach(key => dataMap[key] = []);
                    offlineReportData = [];
                    pcOver15DetailsByStore = {};
                    liveUnreportedRowsCache = [];
                    liveReportedRowsCache = [];
                    liveSolvedRowsCache = [];
                    liveUnreportedRawAccum = [];
                    liveUnreportedLastMeta = { total: null, sqlLoaded: 0, hasMore: false };
                    unreportedLiveFetchToken += 1;

                    if (data.series) {
                        data.series.forEach(series => {
                            const refId = series.refId;
                            
                            if (DEVICE_PARSERS[refId]) {
                                const config = DEVICE_PARSERS[refId];
                                const parsed = genericParser(series, config.threshold);
                                if (parsed) {
                                    dataMap[config.type].push(parsed);
                                }
                            }
                            else if (OFFLINE_METRICS[refId]) {
                                const offData = getOfflineMetricData(series, OFFLINE_METRICS[refId]);
                                if (offData && offData.store !== 'Unknown') offlineReportData.push(offData);
                            }
                            else if (refId === PC_OVER15_DETAILS_REFID) {
                                const detail = getPcOver15DetailData(series);
                                if (detail && detail.store && detail.store !== 'Unknown') {
                                    if (!pcOver15DetailsByStore[detail.store]) {
                                        pcOver15DetailsByStore[detail.store] = [];
                                    }
                                    if (!pcOver15DetailsByStore[detail.store].includes(detail.deviceName)) {
                                        pcOver15DetailsByStore[detail.store].push(detail.deviceName);
                                    }
                                }
                            }
                        });
                        
                        // Night-freeze fallback: if Prometheus has stopped
                        // scraping (outside 07:10-21:00) and the parsed
                        // dataMap came back empty, fill it from the last
                        // good day-time snapshot so the Live page keeps
                        // showing the 21:00 state instead of "No devices
                        // found".
                        maybeApplyFrozenSnapshot();

                        // Combine ONT status with Router Device status
                        combineRouterStatuses();

                        // Persist the dataMap whenever we have a populated
                        // snapshot worth keeping:
                        //   • during the monitoring window (07:10–21:00):
                        //     keep the snapshot fresh, since prom-adapter
                        //     pins live queries to the latest 21:00 cutoff
                        //     during night freeze anyway.
                        //   • outside the monitoring window, only seed once
                        //     when no prior snapshot exists — protects
                        //     against the cache being wiped on first deploy
                        //     after 21:00. We rely on prom-adapter's
                        //     cutoff-pinned queries for the actual freeze
                        //     fallback; localStorage is a secondary safety
                        //     net (e.g. tight Prometheus retention).
                        if (dataMapHasAnyDevices(dataMap)) {
                            const _nightCtxForPersist = getNightWindowContext(new Date());
                            const _existingSnap = loadLiveDevicesSnapshot();
                            const _hasPriorSnap = !!(_existingSnap && _existingSnap.dataMap);
                            if (_nightCtxForPersist.inMonitoringWindow || !_hasPriorSnap) {
                                persistLiveDevicesSnapshot();
                            }
                        }

                        syncIncidentEventsWithBackend().catch((error) => {
                            console.warn('[Device Monitor] Incident sync failed', error);
                        });
                    }

                    // B. Control setup
                    const selector = htmlNode.getElementById('device-type-selector');
                    const pageSwitchBtns = htmlNode.querySelectorAll('.page-switch-btn');
                    const sortBtn = htmlNode.getElementById('sort-toggle-button');
                    const offlineBtn = htmlNode.getElementById('offline-time-button');
                    const offlineSortBtn = htmlNode.getElementById('offline-sort-button');
                    const statBoxes = htmlNode.querySelectorAll('.stat-box');

                    // Device selector
                    if (selector) {
                        selector.value = currentDeviceType;
                    }
                    const updatePageSwitchUI = () => {
                        pageSwitchBtns.forEach((button) => {
                            const isActive = button.dataset.page === currentDashboardPage;
                            button.classList.toggle('active', isActive);
                            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
                        });
                    };
                    updatePageSwitchUI();
                    bindNavigationHandlers(htmlNode);

                    // Sort button
                    const updateSortBtnUI = () => {
                        if (!sortBtn) return;
                        const icon = currentSortMode === 'alphabetic' ? 'fa-sort-alpha-down' : 'fa-exclamation-triangle';
                        const txt = currentSortMode === 'alphabetic' ? 'Consecutive' : 'Priority';
                        sortBtn.innerHTML = `<i class="fas ${icon}"></i> Sort: ${txt}`;
                    };

                    // Offline sort button
                    const updateOfflineSortBtnUI = () => {
                        if (!offlineSortBtn) return;
                        const icon = offlineSortMode === 'consecutive' ? 'fa-sort-alpha-down' : 'fa-chart-bar';
                        const txt = offlineSortMode === 'consecutive' ? 'Consecutive' : 'Highest Time';
                        offlineSortBtn.innerHTML = `<i class="fas ${icon}"></i> ${txt}`;
                    };

                    // Keep control visual state in sync on every refresh
                    updateSortBtnUI();
                    updateOfflineSortBtnUI();
                    updateNightFreezeBadge(htmlNode, getNightWindowContext(new Date()));

                    if (!listenersInitialized) {
                        // Sort button (hidden on Live Incidents — no priority/consecutive toggle there)
                        if (sortBtn) {
                            sortBtn.onclick = function() {
                            if (currentDeviceType === LIVE_UNREPORTED_DEVICE_TYPE) return;
                            currentSortMode = currentSortMode === 'priority' ? 'alphabetic' : 'priority';
                            localStorage.setItem(STORAGE_KEY_SORT, currentSortMode);
                            updateSortBtnUI();
                            updateMainView(htmlNode);
                            };
                        }

                        setupLiveUnreportedDeviceFilters(htmlNode);
                        setupLiveUnreportedTagFilters(htmlNode);
                        setupLiveCrmTicketSearch(htmlNode);

                        // Offline sort button
                        if (offlineSortBtn) {
                            offlineSortBtn.onclick = function() {
                            offlineSortMode = offlineSortMode === 'highest' ? 'consecutive' : 'highest';
                            localStorage.setItem(STORAGE_KEY_OFFLINE_SORT, offlineSortMode);
                            offlineSortColumn = '';
                            offlineSortDirection = 'desc';
                            localStorage.removeItem(STORAGE_KEY_OFFLINE_SORT_COLUMN);
                            localStorage.removeItem(STORAGE_KEY_OFFLINE_SORT_DIRECTION);
                            updateOfflineSortBtnUI();
                            updateMainView(htmlNode);
                            };
                        }

                        // Stat box filtering (use onclick to avoid duplicate listeners on re-render)
                        const getFilterModeFromStatBox = (box) => {
                            const statId = box.querySelector('.stat-number')?.id || '';
                            return 'all';
                        };

                        statBoxes.forEach((box) => {
                            box.onclick = function() {
                                if (isOfflineViewActive) return;
                                currentFilterMode = getFilterModeFromStatBox(box);

                                statBoxes.forEach(b => {
                                    b.style.transform = 'none';
                                    b.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                                });
                                box.style.transform = 'translateY(-2px)';
                                box.style.borderColor = 'rgba(102, 126, 234, 0.8)';
                                updateMainView(htmlNode);
                            };
                        });

                    // Search box setup (only for offline report)
                    const searchBox = htmlNode.getElementById('search-box');
                    const clearSearchBtn = htmlNode.getElementById('clear-search');
                    const searchContainer = htmlNode.querySelector('.search-container');
                    
                    // Initially hide search (shown only in offline view)
                    if (searchContainer) searchContainer.style.display = 'none';
                    
                        if (searchBox) {
                            let searchTimeout;
                        
                            const updateClearButton = () => {
                                if (clearSearchBtn) {
                                    clearSearchBtn.style.display = searchBox.value ? 'flex' : 'none';
                                }
                            };
                        
                            searchBox.oninput = function() {
                                clearTimeout(searchTimeout);
                                updateClearButton();
                                searchTimeout = setTimeout(() => {
                                    searchQuery = this.value.trim();
                                    updateMainView(htmlNode);
                                }, 300);
                            };
                        
                            if (clearSearchBtn) {
                                clearSearchBtn.onclick = function() {
                                    searchBox.value = '';
                                    searchQuery = '';
                                    updateClearButton();
                                    updateMainView(htmlNode);
                                    searchBox.focus();
                                };
                            }
                        }

                        // Export button setup (use onclick to avoid duplicate listeners on re-render)
                        const exportBtn = htmlNode.getElementById('export-button');
                        if (exportBtn) {
                            exportBtn.onclick = function() {
                                const storeData = buildOfflineStoreData();
                                if (storeData.length > 0) {
                                    exportToCSV(storeData, 'offline_report');
                                } else {
                                    showToast('No data to export', 'warning');
                                }
                            };
                        }

                        const unreportedBody = htmlNode.getElementById('reporting-unreported-body');
                        if (unreportedBody) {
                            unreportedBody.onclick = function(e) {
                                const btn = e.target.closest('.incident-report-link-btn');
                                if (!btn || !unreportedBody.contains(btn)) return;
                                const deviceName = btn.getAttribute('data-device-name') || '';
                                const deviceStatus = btn.getAttribute('data-device-status') || 'inactive';
                                if (!deviceName) return;
                                showDeviceTicketModal(deviceName, deviceStatus, htmlNode);
                            };
                        }

                    // Card click navigation (event delegation; use onclick to avoid duplicate listeners)
                        const grid = htmlNode.getElementById('stores-grid');
                        if (grid) {
                            grid.onclick = function(e) {
                                // "Open Ticket" / other CRM links: native behavior, no device modal.
                                if (e.target.closest('.unreported-live-ticket-link')) return;
                                const card = e.target.closest('.store-card');
                                if (!card || !grid.contains(card)) return;

                                // Prevent modal open if warning icon itself was clicked.
                                if (e.target.closest('.card-warning-icon')) return;

                                const deviceName = card.getAttribute('data-device-name');
                                const deviceStatus = card.getAttribute('data-status') || '';
                                if (card.classList.contains('unreported-live-card')) {
                                    if (!deviceName) return;
                                    const incidentDeviceType = card.getAttribute('data-incident-device-type') || '';
                                    const prefillOwnerName = card.getAttribute('data-ticket-owner') || '';
                                    const prefillReportTag = card.getAttribute('data-ticket-tag') || '';
                                    const prefillTicketUrl = card.getAttribute('data-ticket-url') || '';
                                    const reportSource = card.getAttribute('data-report-source') || '';
                                    const incidentStatus = card.getAttribute('data-incident-status') || '';
                                    const downtimeStart = card.getAttribute('data-dt-start') || '';
                                    const downtimeEnd = card.getAttribute('data-dt-end') || '';
                                    const downtimeDuration = card.getAttribute('data-dt-duration') || '';
                                    const reportedAt = card.getAttribute('data-reported-at') || '';
                                    const solvedAt = card.getAttribute('data-solved-at') || '';
                                    showDeviceTicketModal(
                                        deviceName,
                                        'inactive',
                                        htmlNode,
                                        {
                                            ...(incidentDeviceType ? { deviceType: incidentDeviceType } : {}),
                                            ...(prefillOwnerName ? { prefillOwnerName } : {}),
                                            ...(prefillReportTag ? { prefillReportTag } : {}),
                                            ...(prefillTicketUrl ? { prefillTicketUrl } : {}),
                                            ...(reportSource ? { reportSource } : {}),
                                            ...(incidentStatus ? { incidentStatus } : {}),
                                            ...(downtimeStart ? { downtimeStart } : {}),
                                            ...(downtimeEnd ? { downtimeEnd } : {}),
                                            ...(downtimeDuration ? { downtimeDuration } : {}),
                                            ...(reportedAt ? { reportedAt } : {}),
                                            ...(solvedAt ? { solvedAt } : {})
                                        }
                                    );
                                    return;
                                }
                                if (deviceName) {
                                    if (canOpenTicketModalForCurrentDeviceType()) {
                                        if (deviceStatus !== 'inactive') {
                                            showToast('Ticket popup is available only for offline devices', 'info');
                                            return;
                                        }
                                        showDeviceTicketModal(deviceName, deviceStatus, htmlNode);
                                    } else {
                                        showDeviceDetailsModal(deviceName, htmlNode);
                                    }
                                }
                            };

                            // Setup dynamic tooltip positioning using event delegation
                            // This ensures it works even after the grid is re-rendered
                            grid.onmouseover = function(e) {
                            const card = e.target.closest('.store-card[data-tooltip]');
                            if (!card || card.dataset.tooltipChecked === 'true') return;
                            
                            card.dataset.tooltipChecked = 'true';

                            const rect = card.getBoundingClientRect();
                            const container = card.closest('.stores-container') || grid;
                            const containerRect = container.getBoundingClientRect();
                            const viewportWidth = window.innerWidth;
                            
                            // Thresholds
                            const thresholdX = 170; // Half tooltip width + margin
                            const thresholdY = 240; // Tooltip height + margin
                            
                            // Horizontal positioning
                            const cardCenter = rect.left + (rect.width / 2);
                            if (cardCenter < thresholdX) {
                                card.classList.add('tooltip-left');
                            } else if (viewportWidth - cardCenter < thresholdX) {
                                card.classList.add('tooltip-right');
                            }

                            // Vertical positioning: 
                            // If card is too close to the top of the browser OR the top of the panel container
                            const distanceToTop = Math.min(rect.top, rect.top - containerRect.top);
                            
                            if (rect.top < thresholdY || (rect.top - containerRect.top) < thresholdY) {
                                card.classList.add('tooltip-bottom');
                            }
                            };

                            // Remove positioning classes when mouse leaves the card
                            grid.onmouseout = function(e) {
                            const card = e.target.closest('.store-card[data-tooltip]');
                            if (card && !card.contains(e.relatedTarget)) {
                                // Delay removal of positioning classes to allow CSS transition to finish
                                // This prevents the tooltip from jumping to the top before disappearing
                                setTimeout(() => {
                                    if (!card.matches(':hover')) {
                                        card.classList.remove('tooltip-left', 'tooltip-right', 'tooltip-bottom');
                                        delete card.dataset.tooltipChecked;
                                    }
                                }, 200);
                            }
                            };
                        }

                        // Setup time range selector
                        setupTimeRangeSelector(htmlNode, data);
                        
                        // Setup device details modal
                        setupDeviceDetailsModal(htmlNode);
                        setupDeviceTicketModal(htmlNode);
                        setupDeleteReportConfirmModal(htmlNode);
                        setupNonInternetIssueModal(htmlNode);

                        // Setup panel info button
                        const infoBtn = htmlNode.getElementById('panel-info-btn');
                        const infoModal = htmlNode.getElementById('panel-info-modal');
                        const infoClose = htmlNode.getElementById('panel-info-close');
                        if (infoBtn && infoModal) {
                            infoBtn.onclick = () => {
                                infoModal.classList.add('show');
                                infoModal.setAttribute('aria-hidden', 'false');
                            };
                            infoModal.onclick = (e) => {
                                if (e.target === infoModal) {
                                    infoModal.classList.remove('show');
                                    infoModal.setAttribute('aria-hidden', 'true');
                                }
                            };
                            if (infoClose) {
                                infoClose.onclick = () => {
                                    infoModal.classList.remove('show');
                                    infoModal.setAttribute('aria-hidden', 'true');
                                };
                            }
                        }

                        // Setup offline table header sorting
                        setupOfflineTableHeaderSorting(htmlNode);

                        // Kick off the recurring Live auto-refresh (idempotent).
                        startLiveAutoRefresh();
                        startKioskHealthGuard();

                        listenersInitialized = true;
                        panelRuntime.listenersInitialized = listenersInitialized;
                    }

                    // Keep these hidden by default when view switches back to cards
                    if (offlineSortBtn) {
                        offlineSortBtn.style.display = 'none';
                    }
                    const exportBtn = htmlNode.getElementById('export-button');
                    if (exportBtn) {
                        exportBtn.style.display = 'none';
                    }

                    ensureLiveUnreportedToolbarCyclesDelegation(listenersRootNode || htmlNode);

                    // Initial render; then merge open reported tickets so device grids show "Reported" + green border.
                    updateMainView(htmlNode);
                    if (currentDashboardPage === 'live' && data && data.series) {
                        refreshLiveReportedAndSolvedCaches()
                            .catch(() => {})
                            .then(() => {
                                updateMainView(htmlNode);
                            });
                    }
                }

                window.gfnPanelApplyView = function (targetNode) {
                    const node = targetNode || listenersRootNode || document;
                    if (node) gfnPanelApplyView(node);
                };

                initializeDashboard(data, htmlNode);
            };