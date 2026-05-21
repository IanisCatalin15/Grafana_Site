/**
 * modules/ticket-links.js
 *
 * Helpers for mapping device names (which differ between Prometheus FQDNs,
 * DB rows and CRM ticket IDs) to a single canonical lookup key, so the panel
 * can resolve "is this device already in CRM?" without a network call.
 *
 * Closure-bound originals took `currentDeviceType` / `deviceTicketLinks`
 * directly from runGfnPanel; here we pass them explicitly. The thin wrappers
 * rebinded in script.js forward the current closure values at call time.
 *
 * Exposes `window.GFN_TICKET_LINKS`. Pure (no DOM, no closure side effects).
 */
(function () {
  'use strict';

  function _U() {
    return (typeof window !== 'undefined' && window.GFN_UTILS) || {};
  }
  function _DF() {
    return (typeof window !== 'undefined' && window.GFN_DEVICE_FORMAT) || {};
  }
  function _escapeHtml(s) {
    const fn = _U().escapeHtml;
    return typeof fn === 'function' ? fn(s) : String(s || '');
  }
  function _normalizeDeviceKey(s) {
    const fn = _DF().normalizeDeviceKey;
    return typeof fn === 'function' ? fn(s) : String(s || '').trim().toUpperCase();
  }
  function _normalizeReportTag(s) {
    const fn = _DF().normalizeReportTag;
    return typeof fn === 'function' ? fn(s) : String(s || '').trim().toLowerCase();
  }
  function _reportTagLabel(s) {
    const fn = _DF().reportTagLabel;
    return typeof fn === 'function' ? fn(s) : '';
  }

  /** Map grouped tab / device name -> canonical type for ticket API + link map. */
  function effectiveTicketGridDeviceType(deviceName, gridDeviceType, currentDeviceType) {
    const gt = String(
      gridDeviceType != null ? gridDeviceType : currentDeviceType || ''
    ).trim().toLowerCase();
    const firstSeg = String(deviceName || '').trim().split('.')[0] || '';
    if (gt === 'cash-registers') {
      const slot =
        (firstSeg.match(/-K([123])$/i) || firstSeg.match(/-CR([123])$/i) || [])[1] ||
        (firstSeg.match(/Casa[_\-\s]?([123])/i) || [])[1];
      return slot ? `cash-register-${slot}` : gt;
    }
    if (gt === 'music') {
      if (/-M1$/i.test(firstSeg)) return 'inside-music';
      if (/-M2$/i.test(firstSeg)) return 'outside-music';
      return gt;
    }
    return gt;
  }

  /**
   * All shapes of a device name that should map to the same ticket row.
   * For price-checkers we cross-map P<n> <-> PC<n>; for cash registers
   * we cross-map K<n> <-> CR<n>; for music we synthesise -M1 / -M2 from a
   * bare store code.
   */
  function ticketLookupCandidateNames(deviceName, deviceType) {
    const base = String(deviceName || '').trim();
    if (!base) return [];
    const out = [base];
    const dot = base.indexOf('.');
    if (dot > 0) {
      const host = base.slice(0, dot).trim();
      if (host) out.push(host);
    }
    const type = String(deviceType || '').trim().toLowerCase();
    if (type === 'price-checkers') {
      const bodies = [...new Set(out)];
      for (const seg of bodies) {
        const pMatch = seg.match(/^(AR\d+)-P(\d+)$/i);
        if (pMatch) out.push(`${pMatch[1]}-PC${pMatch[2]}`);
        const pcMatch = seg.match(/^(AR\d+)-PC(\d+)$/i);
        if (pcMatch) out.push(`${pcMatch[1]}-P${pcMatch[2]}`);
      }
    }
    if (type === 'inside-music' || type === 'outside-music') {
      const suffix = type === 'inside-music' ? 'M1' : 'M2';
      const bodies = [...new Set(out)];
      for (const seg of bodies) {
        const storeOnly = seg.match(/^(AR\d+)$/i);
        if (storeOnly) out.push(`${storeOnly[1]}-${suffix}`);
      }
    }
    if (type === 'cash-register-1' || type === 'cash-register-2' || type === 'cash-register-3') {
      const slotM = type.match(/^cash-register-(\d)$/i);
      const slot = slotM ? slotM[1] : '';
      if (slot) {
        const bodies = [...new Set(out)];
        for (const seg of bodies) {
          const storeOnly = seg.match(/^(AR\d+)$/i);
          if (storeOnly) {
            out.push(`${storeOnly[1]}-K${slot}`);
            out.push(`${storeOnly[1]}-CR${slot}`);
          }
          const cr = seg.match(new RegExp(`^(AR\\d+)-CR${slot}$`, 'i'));
          if (cr) out.push(`${cr[1]}-K${slot}`);
          const kk = seg.match(new RegExp(`^(AR\\d+)-K${slot}$`, 'i'));
          if (kk) out.push(`${kk[1]}-CR${slot}`);
        }
      }
    }
    return [...new Set(out)];
  }

  /**
   * Normalized keys to match `deviceTicketLinks` (DB/API uses short ARxxxx-Pn
   * while Prometheus emits FQDNs). `gridDeviceType` is the overview tab key.
   */
  function deviceTicketLinkLookupKeys(deviceName, gridDeviceType, currentDeviceType) {
    const keys = [];
    const add = (s) => {
      const k = _normalizeDeviceKey(s);
      if (k && !keys.includes(k)) keys.push(k);
    };
    const base = String(deviceName || '').trim();
    if (!base) return [];
    add(base);
    const dot = base.indexOf('.');
    const host = dot > 0 ? base.slice(0, dot).trim() : base;
    if (host && host !== base) add(host);
    const gtRaw = String(
      gridDeviceType != null ? gridDeviceType : currentDeviceType || ''
    ).trim().toLowerCase();
    const gt = effectiveTicketGridDeviceType(deviceName, gridDeviceType, currentDeviceType);
    const looksPc =
      gt === 'price-checkers' ||
      gtRaw === 'price-checkers' ||
      /^ar\d+-(p|pc)\d+$/i.test(host) ||
      /^ar\d+-(p|pc)\d+$/i.test(base);
    if (looksPc) {
      ticketLookupCandidateNames(host, 'price-checkers').forEach(add);
      if (host !== base) ticketLookupCandidateNames(base, 'price-checkers').forEach(add);
    }
    if (gt === 'inside-music' || gt === 'outside-music') {
      ticketLookupCandidateNames(host, gt).forEach(add);
      if (host !== base) ticketLookupCandidateNames(base, gt).forEach(add);
    }
    if (/^cash-register-[123]$/i.test(gt)) {
      ticketLookupCandidateNames(host, gt).forEach(add);
      if (host !== base) ticketLookupCandidateNames(base, gt).forEach(add);
    }
    return keys;
  }

  function getDeviceTicketLink(deviceName, gridDeviceType, currentDeviceType, deviceTicketLinks) {
    if (!deviceTicketLinks) return '';
    for (const k of deviceTicketLinkLookupKeys(deviceName, gridDeviceType, currentDeviceType)) {
      const u = deviceTicketLinks[k];
      if (u) return u;
    }
    return '';
  }

  function hasDeviceTicketLink(deviceName, gridDeviceType, currentDeviceType, deviceTicketLinks) {
    return !!getDeviceTicketLink(deviceName, gridDeviceType, currentDeviceType, deviceTicketLinks);
  }

  /** Pull the numeric task id out of a CRM URL like .../tasks/task/view/57301/. */
  function extractCrmTaskIdFromTicketUrl(url) {
    if (!url) return '';
    const s = String(url).trim();
    const m =
      s.match(/\/tasks\/task\/view\/(\d+)/i) ||
      s.match(/\/view\/(\d+)(?:\/|$|\?|#)/i);
    return m ? m[1] : '';
  }

  function normalizeLiveCrmTicketSearchQuery(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const fromPath = extractCrmTaskIdFromTicketUrl(s);
    if (fromPath) return fromPath;
    return s.replace(/\D/g, '');
  }

  /** Toolbar field: digits only; pasted CRM URLs are reduced to task id. */
  function sanitizeLiveCrmTicketFieldValue(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const fromUrl = extractCrmTaskIdFromTicketUrl(s);
    if (fromUrl) return fromUrl;
    return s.replace(/\D/g, '');
  }

  function unreportedLiveTicketMetaBlockHtml(ticketUrlRaw, ownerNameDisplay, reportTagRaw = '') {
    const ticketUrl = String(ticketUrlRaw || '').trim();
    const taskId = extractCrmTaskIdFromTicketUrl(ticketUrl);
    // Excel-list mode: the Owner / Ticket column headers already label the
    // values, so don't repeat the prefix on every row. Keep raw values only.
    const ownerHtml = `<span class="unreported-live-ticket-owner" title="Owner">${_escapeHtml(ownerNameDisplay)}</span>`;
    const tagNorm = _normalizeReportTag(reportTagRaw);
    const tagHtml = tagNorm
      ? `<span class="unreported-live-ticket-tag reported-tag-text">${_escapeHtml(_reportTagLabel(reportTagRaw))}</span>`
      : '';
    let ticketHtml;
    if (ticketUrl && taskId) {
      ticketHtml = `<a class="unreported-live-ticket-link unreported-live-ticket-code" href="${_escapeHtml(ticketUrl)}" target="_blank" rel="noopener noreferrer" title="Click: use this id in Ticket filter · Ctrl+click: open CRM">${_escapeHtml(taskId)}</a>`;
    } else if (ticketUrl) {
      ticketHtml = `<a class="unreported-live-ticket-link" href="${_escapeHtml(ticketUrl)}" target="_blank" rel="noopener noreferrer" title="Ticket">Open</a>`;
    } else {
      ticketHtml = '<span class="unreported-live-ticket-link is-empty" title="Ticket">—</span>';
    }
    return `<div class="unreported-live-ticket-meta">${ownerHtml}${tagHtml}${ticketHtml}</div>`;
  }

  window.GFN_TICKET_LINKS = {
    effectiveTicketGridDeviceType,
    ticketLookupCandidateNames,
    deviceTicketLinkLookupKeys,
    getDeviceTicketLink,
    hasDeviceTicketLink,
    extractCrmTaskIdFromTicketUrl,
    normalizeLiveCrmTicketSearchQuery,
    sanitizeLiveCrmTicketFieldValue,
    unreportedLiveTicketMetaBlockHtml
  };
})();
