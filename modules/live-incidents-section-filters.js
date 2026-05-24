/**
 * Per-section column filters for Live Incidents (Unreported / Reported / Solved lists).
 */
(function () {
  'use strict';

  const DEVICE_GROUP_LABELS = {
    primary: 'Primary',
    backup: 'Backup',
    switches: 'Switches',
    cash: 'Cash registers',
    music: 'Music',
    price: 'Price checkers'
  };

  const SORT_CYCLE = ['', 'asc', 'desc'];

  function sortSymbol(state) {
    if (state === 'asc') return '\u2191';
    if (state === 'desc') return '\u2193';
    return '-';
  }

  function typeFilterSymbol(state) {
    if (state === 'internet') return 'Internet';
    if (state === 'non_internet') return 'Non Internet';
    return '-';
  }

  function cycleSort(current) {
    const i = SORT_CYCLE.indexOf(current || '');
    return SORT_CYCLE[(i >= 0 ? i + 1 : 0) % SORT_CYCLE.length];
  }

  function cycleTypeFilter(current) {
    if (current === 'all' || !current) return 'internet';
    if (current === 'internet') return 'non_internet';
    return 'all';
  }

  function createSectionState() {
    return {
      storeOrder: '',
      startOrder: '',
      endOrder: '',
      durationOrder: '',
      reportedOrder: '',
      solvedOrder: '',
      typeFilter: 'all',
      ticketQuery: '',
      hiddenDeviceGroups: new Set(),
      hiddenOwners: new Set(),
      hiddenTags: new Set(),
      deviceAllMode: true,
      ownerAllMode: true,
      tagAllMode: true
    };
  }

  function cloneSectionState(state) {
    const s = createSectionState();
    if (!state) return s;
    s.storeOrder = state.storeOrder || '';
    s.startOrder = state.startOrder || '';
    s.endOrder = state.endOrder || '';
    s.durationOrder = state.durationOrder || '';
    s.reportedOrder = state.reportedOrder || '';
    s.solvedOrder = state.solvedOrder || '';
    s.typeFilter = state.typeFilter || 'all';
    s.ticketQuery = String(state.ticketQuery || '').replace(/\D/g, '');
    s.deviceAllMode = state.deviceAllMode !== false;
    s.ownerAllMode = state.ownerAllMode !== false;
    s.tagAllMode = state.tagAllMode !== false;
    s.hiddenDeviceGroups = new Set(state.hiddenDeviceGroups || []);
    s.hiddenOwners = new Set(state.hiddenOwners || []);
    s.hiddenTags = new Set(state.hiddenTags || []);
    return s;
  }

  const STORAGE_KEY = 'grafana_custom_panel_live_incident_section_filters';

  function serializeSectionState(state) {
    if (!state) return null;
    return {
      storeOrder: state.storeOrder || '',
      startOrder: state.startOrder || '',
      endOrder: state.endOrder || '',
      durationOrder: state.durationOrder || '',
      reportedOrder: state.reportedOrder || '',
      solvedOrder: state.solvedOrder || '',
      typeFilter: state.typeFilter || 'all',
      ticketQuery: String(state.ticketQuery || '').replace(/\D/g, ''),
      deviceAllMode: state.deviceAllMode !== false,
      ownerAllMode: state.ownerAllMode !== false,
      tagAllMode: state.tagAllMode !== false,
      hiddenDeviceGroups: [...(state.hiddenDeviceGroups || [])],
      hiddenOwners: [...(state.hiddenOwners || [])],
      hiddenTags: [...(state.hiddenTags || [])]
    };
  }

  function deserializeSectionState(raw) {
    if (!raw || typeof raw !== 'object') return createSectionState();
    const s = createSectionState();
    s.storeOrder = String(raw.storeOrder || '');
    s.startOrder = String(raw.startOrder || '');
    s.endOrder = String(raw.endOrder || '');
    s.durationOrder = String(raw.durationOrder || '');
    s.reportedOrder = String(raw.reportedOrder || '');
    s.solvedOrder = String(raw.solvedOrder || '');
    s.typeFilter = raw.typeFilter === 'internet' || raw.typeFilter === 'non_internet' ? raw.typeFilter : 'all';
    s.ticketQuery = String(raw.ticketQuery || '').replace(/\D/g, '');
    s.deviceAllMode = raw.deviceAllMode !== false;
    s.ownerAllMode = raw.ownerAllMode !== false;
    s.tagAllMode = raw.tagAllMode !== false;
    s.hiddenDeviceGroups = new Set(Array.isArray(raw.hiddenDeviceGroups) ? raw.hiddenDeviceGroups : []);
    s.hiddenOwners = new Set(Array.isArray(raw.hiddenOwners) ? raw.hiddenOwners : []);
    s.hiddenTags = new Set(Array.isArray(raw.hiddenTags) ? raw.hiddenTags : []);
    return s;
  }

  function loadAllSectionFilters() {
    const defaults = {
      unreported: createSectionState(),
      reported: createSectionState(),
      solved: createSectionState()
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaults;
      return {
        unreported: deserializeSectionState(parsed.unreported),
        reported: deserializeSectionState(parsed.reported),
        solved: deserializeSectionState(parsed.solved)
      };
    } catch (_e) {
      return defaults;
    }
  }

  function persistAllSectionFilters(all) {
    if (!all) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        unreported: serializeSectionState(all.unreported),
        reported: serializeSectionState(all.reported),
        solved: serializeSectionState(all.solved)
      }));
    } catch (_e) {
      /* ignore quota / private mode */
    }
    if (typeof window !== 'undefined') {
      window.__GFN_LIVE_INCIDENT_SECTION_FILTERS__ = all;
    }
  }

  function getOrLoadAllSectionFilters() {
    if (typeof window !== 'undefined' && window.__GFN_LIVE_INCIDENT_SECTION_FILTERS__) {
      const cached = window.__GFN_LIVE_INCIDENT_SECTION_FILTERS__;
      if (cached.unreported && cached.reported && cached.solved) return cached;
    }
    const loaded = loadAllSectionFilters();
    if (typeof window !== 'undefined') {
      window.__GFN_LIVE_INCIDENT_SECTION_FILTERS__ = loaded;
    }
    return loaded;
  }

  function finalizeExclusiveCheckboxFilter(s, cbs, allModeKey, hiddenKey) {
    if (!cbs.length) {
      s[allModeKey] = true;
      s[hiddenKey].clear();
      return;
    }
    const anyChecked = cbs.some((cb) => cb.checked);
    if (!anyChecked || cbs.every((cb) => cb.checked)) {
      s[allModeKey] = true;
      s[hiddenKey].clear();
    }
  }

  function fingerprintSectionState(state) {
    if (!state) return '';
    return [
      state.storeOrder,
      state.startOrder,
      state.endOrder,
      state.durationOrder,
      state.reportedOrder,
      state.solvedOrder,
      state.typeFilter,
      state.ticketQuery,
      state.deviceAllMode ? '1' : '0',
      state.ownerAllMode ? '1' : '0',
      state.tagAllMode ? '1' : '0',
      [...(state.hiddenDeviceGroups || [])].sort().join(','),
      [...(state.hiddenOwners || [])].sort().join(','),
      [...(state.hiddenTags || [])].sort().join(',')
    ].join('|');
  }

  function escapeHtml(str) {
    const U = window.GFN_UTILS || {};
    if (typeof U.escapeHtml === 'function') return U.escapeHtml(str);
    return String(str == null ? '' : str);
  }

  function escapeAttr(str) {
    const U = window.GFN_UTILS || {};
    if (typeof U.escapeAttr === 'function') return U.escapeAttr(str);
    return String(str || '').replace(/"/g, '&quot;');
  }

  function deviceCountsFromRows(rows, groupIdForRow) {
    const counts = new Map();
    (rows || []).forEach((row) => {
      const gid = groupIdForRow(row);
      if (!gid) return;
      counts.set(gid, (counts.get(gid) || 0) + 1);
    });
    return counts;
  }

  function keyCountsFromRows(rows, keyFn) {
    const counts = new Map();
    (rows || []).forEach((row) => {
      const k = keyFn(row);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    return counts;
  }

  function buildDeviceChecklistHtml(sectionId, rows, state, groupIdForRow) {
    const counts = deviceCountsFromRows(rows, groupIdForRow);
    if (!counts.size) {
      return '<span class="live-tag-filter-none-msg">No devices in list</span>';
    }
    const keys = [...counts.keys()].sort((a, b) => {
      const la = DEVICE_GROUP_LABELS[a] || a;
      const lb = DEVICE_GROUP_LABELS[b] || b;
      return la.localeCompare(lb, undefined, { sensitivity: 'base' });
    });
    const total = rows.length;
    const allChecked = state.deviceAllMode && !state.hiddenDeviceGroups.size;
    const parts = [
      `<label class="unreported-cb-label"><input type="checkbox" class="live-inc-dev-all" data-section="${escapeAttr(sectionId)}" ${allChecked ? 'checked' : ''} /> All <span class="filter-checklist-count">(${total})</span></label>`
    ];
    keys.forEach((gid) => {
      const n = counts.get(gid) || 0;
      const label = DEVICE_GROUP_LABELS[gid] || gid;
      const checked = state.deviceAllMode
        ? false
        : !state.hiddenDeviceGroups.has(gid);
      const showChecked = state.deviceAllMode ? false : checked;
      parts.push(
        `<label class="unreported-cb-label"><input type="checkbox" class="live-inc-dev-cb" data-section="${escapeAttr(sectionId)}" data-group="${escapeAttr(gid)}" ${showChecked ? 'checked' : ''} /> ${escapeHtml(label)} <span class="filter-checklist-count">(${n})</span></label>`
      );
    });
    return parts.join('');
  }

  function buildOwnerChecklistHtml(sectionId, rows, state, ownerKeyFn, ownerLabelFn) {
    const counts = keyCountsFromRows(rows, ownerKeyFn);
    if (!counts.size) {
      return '<span class="live-tag-filter-none-msg">No owners in list</span>';
    }
    const keys = [...counts.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const total = rows.length;
    const allChecked = state.ownerAllMode && !state.hiddenOwners.size;
    const parts = [
      `<label class="unreported-cb-label"><input type="checkbox" class="live-inc-owner-all" data-section="${escapeAttr(sectionId)}" ${allChecked ? 'checked' : ''} /> All <span class="filter-checklist-count">(${total})</span></label>`
    ];
    keys.forEach((k) => {
      const n = counts.get(k) || 0;
      const enc = encodeURIComponent(k);
      const checked = state.ownerAllMode ? false : !state.hiddenOwners.has(k);
      parts.push(
        `<label class="unreported-cb-label"><input type="checkbox" class="live-inc-owner-cb" data-section="${escapeAttr(sectionId)}" data-owner="${escapeAttr(enc)}" ${checked ? 'checked' : ''} /> ${escapeHtml(ownerLabelFn(k))} <span class="filter-checklist-count">(${n})</span></label>`
      );
    });
    return parts.join('');
  }

  function buildTagChecklistHtml(sectionId, rows, state, tagKeyFn, tagLabelFn) {
    const counts = keyCountsFromRows(rows, tagKeyFn);
    const keys = [...counts.keys()].filter((k) => k !== '').sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const withEmpty = counts.has('') ? 1 : 0;
    if (!keys.length && !withEmpty) {
      return '<span class="live-tag-filter-none-msg">No tags in list</span>';
    }
    const total = rows.length;
    const allChecked = state.tagAllMode && !state.hiddenTags.size;
    const parts = [
      `<label class="unreported-cb-label"><input type="checkbox" class="live-inc-tag-all" data-section="${escapeAttr(sectionId)}" ${allChecked ? 'checked' : ''} /> All <span class="filter-checklist-count">(${total})</span></label>`
    ];
    if (counts.has('')) {
      const n = counts.get('') || 0;
      const checked = state.tagAllMode ? false : !state.hiddenTags.has('');
      parts.push(
        `<label class="unreported-cb-label"><input type="checkbox" class="live-inc-tag-cb" data-section="${escapeAttr(sectionId)}" data-tag="" ${checked ? 'checked' : ''} /> — <span class="filter-checklist-count">(${n})</span></label>`
      );
    }
    keys.forEach((k) => {
      const n = counts.get(k) || 0;
      const enc = encodeURIComponent(k);
      const checked = state.tagAllMode ? false : !state.hiddenTags.has(k);
      parts.push(
        `<label class="unreported-cb-label"><input type="checkbox" class="live-inc-tag-cb" data-section="${escapeAttr(sectionId)}" data-tag="${escapeAttr(enc)}" ${checked ? 'checked' : ''} /> ${escapeHtml(tagLabelFn(k))} <span class="filter-checklist-count">(${n})</span></label>`
      );
    });
    return parts.join('');
  }

  function sortBtn(sectionId, colKey, label, orderVal) {
    return `<button type="button" class="analytics-th-sort-btn live-inc-sort-btn" data-section="${escapeAttr(sectionId)}" data-sort-key="${escapeAttr(colKey)}" aria-label="Sort by ${escapeAttr(label)}">
      <span class="analytics-th-sort-name">${escapeHtml(label)}</span><span class="analytics-th-sort-sep"> </span><span class="analytics-th-sort-symbol">${sortSymbol(orderVal)}</span>
    </button>`;
  }

  const FILTER_CHEVRON_SVG = '<svg class="filter-funnel-icon" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true" focusable="false"><path d="M3 5h18l-7 9v4l-4 2v-6L3 5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

  function deviceFilterCell(sectionId, rows, state, deps) {
    const body = buildDeviceChecklistHtml(sectionId, rows, state, deps.groupIdForRow);
    return `<span class="unreported-h-group unreported-th-filter-device">
      <details class="analytics-filter-device-details live-inc-device-details" data-section="${escapeAttr(sectionId)}">
        <summary class="analytics-filter-summary-mini live-inc-device-summary" title="Filter devices in this list">
          <span class="unreported-h-text">Device</span>${FILTER_CHEVRON_SVG}
        </summary>
        <div class="analytics-filter-checklist live-inc-device-checklist" role="group" aria-label="Filter by device">${body}</div>
      </details>
    </span>`;
  }

  function ownerFilterCell(sectionId, rows, state, deps) {
    const body = buildOwnerChecklistHtml(sectionId, rows, state, deps.ownerKey, deps.ownerLabel);
    return `<span class="unreported-h-group unreported-th-filter-device">
      <details class="analytics-filter-device-details live-inc-owner-details" data-section="${escapeAttr(sectionId)}">
        <summary class="analytics-filter-summary-mini live-inc-owner-summary" title="Filter owners in this list">
          <span class="unreported-h-text">Owner</span>${FILTER_CHEVRON_SVG}
        </summary>
        <div class="analytics-filter-checklist live-inc-owner-checklist" role="group" aria-label="Filter by owner">${body}</div>
      </details>
    </span>`;
  }

  function tagFilterCell(sectionId, rows, state, deps) {
    const body = buildTagChecklistHtml(sectionId, rows, state, deps.tagKey, deps.tagLabel);
    return `<span class="unreported-h-group unreported-th-filter-device">
      <details class="analytics-filter-device-details live-inc-tag-details" data-section="${escapeAttr(sectionId)}">
        <summary class="analytics-filter-summary-mini live-inc-tag-summary" title="Filter tags in this list">
          <span class="unreported-h-text">Tag</span>${FILTER_CHEVRON_SVG}
        </summary>
        <div class="analytics-filter-checklist live-inc-tag-checklist" role="group" aria-label="Filter by tag">${body}</div>
      </details>
    </span>`;
  }

  function typeFilterCell(sectionId, state) {
    return `<button type="button" class="analytics-th-sort-btn live-inc-type-btn" data-section="${escapeAttr(sectionId)}" aria-label="Filter by issue type">
      <span class="analytics-th-sort-name">Type</span><span class="analytics-th-sort-sep"> </span><span class="analytics-th-sort-symbol">${typeFilterSymbol(state.typeFilter)}</span>
    </button>`;
  }

  function ticketFilterCell(sectionId, state) {
    const q = String(state.ticketQuery || '');
    const active = q.length > 0;
    return `<span class="incident-col-ticket-wrap${active ? ' is-active' : ''}">
      <button type="button" class="analytics-th-sort-btn live-inc-ticket-btn${active ? ' is-hidden' : ''}" data-section="${escapeAttr(sectionId)}">Ticket</button>
      <input type="text" class="live-inc-ticket-input" data-section="${escapeAttr(sectionId)}" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="№" value="${escapeAttr(q)}" aria-label="Filter by ticket number" ${active ? '' : 'hidden'} />
    </span>`;
  }

  function buildSectionHeader(sectionId, sectionKind, baseRows, state, deps) {
    const s = state || createSectionState();
    const cells = [];

    cells.push(`<span class="incident-list-header-cell" role="columnheader">${sortBtn(sectionId, 'store', 'Store', s.storeOrder)}</span>`);
    cells.push(`<span class="incident-list-header-cell incident-col-filter" role="columnheader">${deviceFilterCell(sectionId, baseRows, s, deps)}</span>`);
    cells.push(`<span class="incident-list-header-cell" role="columnheader">${sortBtn(sectionId, 'start', 'Start', s.startOrder)}</span>`);
    cells.push(`<span class="incident-list-header-cell" role="columnheader">${sortBtn(sectionId, 'end', 'End', s.endOrder)}</span>`);
    cells.push(`<span class="incident-list-header-cell" role="columnheader">${sortBtn(sectionId, 'duration', 'Duration', s.durationOrder)}</span>`);

    if (sectionKind === 'reported' || sectionKind === 'solved') {
      cells.push(`<span class="incident-list-header-cell" role="columnheader">${sortBtn(sectionId, 'reported', 'Reported', s.reportedOrder)}</span>`);
    }
    if (sectionKind === 'solved') {
      cells.push(`<span class="incident-list-header-cell" role="columnheader">${sortBtn(sectionId, 'solved', 'Solved', s.solvedOrder)}</span>`);
    }
    if (sectionKind === 'reported' || sectionKind === 'solved') {
      cells.push(`<span class="incident-list-header-cell incident-col-filter" role="columnheader">${ownerFilterCell(sectionId, baseRows, s, deps)}</span>`);
      cells.push(`<span class="incident-list-header-cell incident-col-filter" role="columnheader">${typeFilterCell(sectionId, s)}</span>`);
      cells.push(`<span class="incident-list-header-cell incident-col-filter" role="columnheader">${tagFilterCell(sectionId, baseRows, s, deps)}</span>`);
      cells.push(`<span class="incident-list-header-cell incident-col-ticket" role="columnheader">${ticketFilterCell(sectionId, s)}</span>`);
    }

    return `<div class="incident-list-header live-inc-section-header" data-incident-section="${escapeAttr(sectionId)}" role="row">${cells.join('')}</div>`;
  }

  function compareWithOrder(a, b, order) {
    if (!order) return 0;
    const cmp = a < b ? -1 : a > b ? 1 : 0;
    return order === 'desc' ? -cmp : cmp;
  }

  function applyFiltersAndSort(rows, sectionKind, state, deps) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const s = state || createSectionState();
    let out = list;

    if (!s.deviceAllMode && s.hiddenDeviceGroups.size) {
      out = out.filter((r) => {
        const gid = deps.groupIdForRow(r);
        if (!gid) return false;
        return !s.hiddenDeviceGroups.has(gid);
      });
    } else if (!s.deviceAllMode) {
      out = [];
    }

    if (sectionKind === 'reported' || sectionKind === 'solved') {
      if (s.typeFilter === 'internet') {
        out = out.filter((r) => !deps.isManualRow(r));
      } else if (s.typeFilter === 'non_internet') {
        out = out.filter((r) => deps.isManualRow(r));
      }

      if (!s.ownerAllMode) {
        if (!s.hiddenOwners.size) out = [];
        else {
          out = out.filter((r) => !s.hiddenOwners.has(deps.ownerKey(r)));
        }
      }

      if (!s.tagAllMode) {
        if (!s.hiddenTags.size) out = [];
        else {
          out = out.filter((r) => !s.hiddenTags.has(deps.tagKey(r)));
        }
      }

      const ticketQ = String(s.ticketQuery || '').replace(/\D/g, '');
      if (ticketQ) {
        out = out.filter((r) => {
          const tid = deps.ticketIdFromRow(r);
          return tid && tid.indexOf(ticketQ) !== -1;
        });
      }
    }

    const sortKeys = [
      ['store', s.storeOrder, (r) => deps.storeSortKey(r)],
      ['start', s.startOrder, (r) => deps.startSortKey(r, sectionKind)],
      ['end', s.endOrder, (r) => deps.endSortKey(r, sectionKind)],
      ['duration', s.durationOrder, (r) => deps.durationSortKey(r, sectionKind)],
      ['reported', s.reportedOrder, (r) => deps.reportedSortKey(r, sectionKind)],
      ['solved', s.solvedOrder, (r) => deps.solvedSortKey(r, sectionKind)]
    ];

    const active = sortKeys.filter(([, ord]) => ord === 'asc' || ord === 'desc');
    if (active.length) {
      out.sort((a, b) => {
        for (let i = 0; i < active.length; i++) {
          const [, ord, fn] = active[i];
          const cmp = compareWithOrder(fn(a), fn(b), ord);
          if (cmp !== 0) return cmp;
        }
        return 0;
      });
    }

    return out;
  }

  function updateStateFromCheckboxChange(sectionId, state, target) {
    const s = cloneSectionState(state);
    if (!target) return s;

    if (target.classList.contains('live-inc-dev-all')) {
      if (target.checked) {
        s.deviceAllMode = true;
        s.hiddenDeviceGroups.clear();
      } else {
        s.deviceAllMode = false;
        s.hiddenDeviceGroups.clear();
        const wrap = target.closest('.live-inc-device-checklist');
        wrap?.querySelectorAll('.live-inc-dev-cb').forEach((cb) => {
          const g = cb.getAttribute('data-group');
          if (g) s.hiddenDeviceGroups.add(g);
        });
      }
      return s;
    }
    if (target.classList.contains('live-inc-dev-cb')) {
      const wrap = target.closest('.live-inc-device-checklist');
      const groupCbs = wrap ? [...wrap.querySelectorAll('.live-inc-dev-cb')] : [];
      s.deviceAllMode = false;
      s.hiddenDeviceGroups.clear();
      groupCbs.forEach((cb) => {
        const g = cb.getAttribute('data-group');
        if (g && !cb.checked) s.hiddenDeviceGroups.add(g);
      });
      finalizeExclusiveCheckboxFilter(s, groupCbs, 'deviceAllMode', 'hiddenDeviceGroups');
      return s;
    }

    if (target.classList.contains('live-inc-owner-all')) {
      if (target.checked) {
        s.ownerAllMode = true;
        s.hiddenOwners.clear();
      } else {
        s.ownerAllMode = false;
        s.hiddenOwners.clear();
        const wrap = target.closest('.live-inc-owner-checklist');
        wrap?.querySelectorAll('.live-inc-owner-cb').forEach((cb) => {
          try {
            s.hiddenOwners.add(decodeURIComponent(cb.getAttribute('data-owner') || ''));
          } catch (_e) {
            s.hiddenOwners.add(String(cb.getAttribute('data-owner') || ''));
          }
        });
      }
      return s;
    }
    if (target.classList.contains('live-inc-owner-cb')) {
      const wrap = target.closest('.live-inc-owner-checklist');
      const ownerCbs = wrap ? [...wrap.querySelectorAll('.live-inc-owner-cb')] : [];
      s.ownerAllMode = false;
      s.hiddenOwners.clear();
      ownerCbs.forEach((cb) => {
        if (!cb.checked) {
          try {
            s.hiddenOwners.add(decodeURIComponent(cb.getAttribute('data-owner') || ''));
          } catch (_e) {
            s.hiddenOwners.add(String(cb.getAttribute('data-owner') || ''));
          }
        }
      });
      finalizeExclusiveCheckboxFilter(s, ownerCbs, 'ownerAllMode', 'hiddenOwners');
      return s;
    }

    if (target.classList.contains('live-inc-tag-all')) {
      if (target.checked) {
        s.tagAllMode = true;
        s.hiddenTags.clear();
      } else {
        s.tagAllMode = false;
        s.hiddenTags.clear();
        const wrap = target.closest('.live-inc-tag-checklist');
        wrap?.querySelectorAll('.live-inc-tag-cb').forEach((cb) => {
          try {
            s.hiddenTags.add(decodeURIComponent(cb.getAttribute('data-tag') || ''));
          } catch (_e) {
            s.hiddenTags.add(String(cb.getAttribute('data-tag') || ''));
          }
        });
      }
      return s;
    }
    if (target.classList.contains('live-inc-tag-cb')) {
      const wrap = target.closest('.live-inc-tag-checklist');
      const tagCbs = wrap ? [...wrap.querySelectorAll('.live-inc-tag-cb')] : [];
      s.tagAllMode = false;
      s.hiddenTags.clear();
      tagCbs.forEach((cb) => {
        if (!cb.checked) {
          try {
            s.hiddenTags.add(decodeURIComponent(cb.getAttribute('data-tag') || ''));
          } catch (_e) {
            s.hiddenTags.add(String(cb.getAttribute('data-tag') || ''));
          }
        }
      });
      finalizeExclusiveCheckboxFilter(s, tagCbs, 'tagAllMode', 'hiddenTags');
      return s;
    }

    return s;
  }

  window.GFN_LIVE_INCIDENT_FILTERS = {
    DEVICE_GROUP_LABELS,
    STORAGE_KEY,
    createSectionState,
    cloneSectionState,
    serializeSectionState,
    deserializeSectionState,
    loadAllSectionFilters,
    persistAllSectionFilters,
    getOrLoadAllSectionFilters,
    fingerprintSectionState,
    buildSectionHeader,
    applyFiltersAndSort,
    updateStateFromCheckboxChange,
    cycleSort,
    cycleTypeFilter,
    sortSymbol,
    typeFilterSymbol
  };
})();
