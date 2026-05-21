/**
 * modules/api-base.js
 *
 * Resolves the CRM/incidents REST base URL. Defaults to same-origin
 * `/incidents-api` (nginx reverse-proxy in Grafana_site)
 * unless `window.__CRM_TICKET_API_BASE__` / `window.CRM_TICKET_API_BASE`
 * overrides it.
 *
 * Pure: no DOM, no closure dependencies.
 */
(function () {
  'use strict';

  function normalizeApiBase(rawValue) {
    const value = (rawValue || '').toString().trim();
    if (!value) return '';
    return value.replace(/\/+$/, '');
  }

  function resolveApiBase() {
    const configuredBase =
      (typeof window !== 'undefined' && window.__CRM_TICKET_API_BASE__) ||
      (typeof window !== 'undefined' && window.CRM_TICKET_API_BASE) ||
      '';
    const normalizedConfiguredBase = normalizeApiBase(configuredBase);
    if (normalizedConfiguredBase) return normalizedConfiguredBase;
    return '/incidents-api';
  }

  window.GFN_API_BASE = {
    normalizeApiBase,
    resolveApiBase
  };
})();
