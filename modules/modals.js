/**
 * modules/modals.js
 *
 * Self-contained modals that don't require deep coupling with the panel
 * closure. For now this only carries the Device Details modal; the larger
 * ticket / non-internet-issue modals depend on too many closure helpers
 * (CRM lookups, owner detection, tag handling, …) and need a follow-up
 * refactor before they can move cleanly into a module.
 *
 * Public API:
 *   window.GFN_MODALS.showDeviceDetailsModal(locationName, htmlNode, deps)
 *     deps = { getLocationDeviceDetails }
 *   window.GFN_MODALS.setupDeviceDetailsModal(htmlNode)
 */
(function () {
  'use strict';

  function getEscapeHtml() {
    const _U = window.GFN_UTILS || {};
    return _U.escapeHtml || ((s) => String(s == null ? '' : s));
  }

  function showDeviceDetailsModal(locationName, htmlNode, deps) {
    const escapeHtml = getEscapeHtml();
    const getLocationDeviceDetails = deps && deps.getLocationDeviceDetails;
    if (typeof getLocationDeviceDetails !== 'function') return;

    const modal = htmlNode.getElementById('device-details-modal');
    const locationNameEl = htmlNode.getElementById('device-details-location-name');
    const bodyEl = htmlNode.getElementById('device-details-body');
    if (!modal || !locationNameEl || !bodyEl) return;

    locationNameEl.textContent = locationName;
    const details = getLocationDeviceDetails(locationName) || { devices: [] };

    if (!details.devices.length) {
      bodyEl.innerHTML = `
        <div class="device-details-empty">
          <i class="fas fa-inbox"></i>
          <p>No device information available for this location.</p>
        </div>
      `;
    } else {
      const allItems = [];
      details.devices.forEach((group) => {
        (group.items || []).forEach((item) => allItems.push(item));
      });
      bodyEl.innerHTML = `
        <div class="device-list-compact">
          ${allItems.map((item) => {
            let statusText = String(item.status || '').toUpperCase();
            if (item.status === 'backup') statusText = 'BACKUP CONNECTION';
            if (item.status === 'n-a') statusText = 'NONE';
            return `
              <div class="device-item-compact">
                <span class="device-name-compact">${escapeHtml(item.name)}</span>
                <span class="device-status-compact ${item.status}">${escapeHtml(statusText)}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }

  function setupDeviceDetailsModal(htmlNode) {
    const modal = htmlNode.getElementById('device-details-modal');
    if (!modal) return;
    const closeBtn = htmlNode.getElementById('device-details-close');
    const hide = () => {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
    };
    if (closeBtn) closeBtn.onclick = hide;
    modal.onclick = (e) => { if (e.target === modal) hide(); };
  }

  window.GFN_MODALS = {
    showDeviceDetailsModal,
    setupDeviceDetailsModal
  };
})();
