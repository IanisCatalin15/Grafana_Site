/**
 * modules/time-range.js
 *
 * Time-range selector + calendar date picker. Extracted from script.js so the
 * orchestrator stops growing.
 *
 * Public API:
 *   window.GFN_TIME_RANGE.setupTimeRangeSelector(htmlNode, data, deps)
 *     deps = { formatTime, showToast, writeSavedDateFilter, TIME_RANGE_LABELS }
 */
(function () {
  'use strict';

  function defaultLabelsFromConstants() {
    const _C = window.GFN_CONSTANTS || {};
    return _C.TIME_RANGE_LABELS || {};
  }

  function defaultFormatTime(minutes) {
    const m = Math.max(0, Math.floor(Number(minutes) || 0));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  }

  function defaultShowToast(msg) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[time-range]', msg);
  }

  function defaultWriteSavedDateFilter(value) {
    const _DR = window.GFN_DATE_RANGE;
    if (_DR && _DR.writeSavedDateFilter) _DR.writeSavedDateFilter(value);
  }

  function setupTimeRangeSelector(htmlNode, data, deps) {
    const d = deps || {};
    const formatTime = d.formatTime || defaultFormatTime;
    const showToast = d.showToast || defaultShowToast;
    const writeSavedDateFilter = d.writeSavedDateFilter || defaultWriteSavedDateFilter;
    const TIME_RANGE_LABELS = d.TIME_RANGE_LABELS || defaultLabelsFromConstants();

    const timeRangeBtns = Array.from(htmlNode.querySelectorAll('.time-range-button'));
    const timeRangeModal = htmlNode.getElementById('time-range-modal');
    const datePickerModal = htmlNode.getElementById('date-picker-modal');
    const timeOptions = htmlNode.querySelectorAll('.time-option[data-range]');
    const datePickerTrigger = htmlNode.querySelector('.date-picker-trigger');
    const selectionPreview = htmlNode.getElementById('current-selection-preview');
    const previewContent = htmlNode.getElementById('preview-content');
    const selectionPreviewDatePicker = htmlNode.getElementById('current-selection-preview-datepicker');
    const previewContentDatePicker = htmlNode.getElementById('preview-content-datepicker');

    if (!timeRangeModal || !datePickerModal) return;

    let currentYear = new Date().getFullYear();
    let currentMonth = new Date().getMonth();
    let selectedFromDate = null;
    let selectedToDate = null;

    const getCurrentAppliedRange = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const urlFrom = urlParams.get('from');
      const urlTo = urlParams.get('to');

      if (urlFrom && urlTo) {
        const known = TIME_RANGE_LABELS[urlFrom];
        if (known && known.isLive && urlTo === 'now') {
          return { from: urlFrom, to: urlTo };
        }
        const urlFromNum = Number(urlFrom);
        const urlToNum = Number(urlTo);
        if (!Number.isNaN(urlFromNum) && !Number.isNaN(urlToNum)) {
          return { from: urlFromNum.toString(), to: urlToNum.toString() };
        }
      }

      const rangeFrom = data && data.request && data.request.range && data.request.range.from;
      const rangeTo = data && data.request && data.request.range && data.request.range.to;
      if (rangeFrom && rangeTo) {
        const fromMs = typeof rangeFrom.valueOf === 'function' ? rangeFrom.valueOf() : new Date(rangeFrom).getTime();
        const toMs = typeof rangeTo.valueOf === 'function' ? rangeTo.valueOf() : new Date(rangeTo).getTime();
        if (!Number.isNaN(fromMs) && !Number.isNaN(toMs)) {
          return { from: fromMs.toString(), to: toMs.toString() };
        }
      }
      return { from: 'now-12h', to: 'now' };
    };

    const updateSelectionPreview = (fromParam, toParam) => {
      let previewHTML = '';
      const knownRange = TIME_RANGE_LABELS[fromParam];
      if (knownRange && knownRange.isLive) {
        previewHTML = `
          <div class="range-type live">LIVE DATA</div>
          <div class="range-details">
            ${knownRange.full}<br>
            <span style="opacity: 0.8;">Real-time monitoring with automatic updates</span>
          </div>
        `;
      } else if (!isNaN(Number(fromParam)) && !isNaN(Number(toParam))) {
        const fromDate = new Date(Number(fromParam));
        const toDate = new Date(Number(toParam));
        const dateStr = fromDate.toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });
        const fromTimeStr = fromDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        const toTimeStr = toDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

        const durationMs = toDate - fromDate;
        const durationStr = formatTime(Math.max(0, Math.floor(durationMs / 60000)));

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const fromDateOnly = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
        let dayLabel = 'Custom Date';
        if (fromDateOnly.getTime() === today.getTime()) dayLabel = 'Today';
        else if (fromDateOnly.getTime() === today.getTime() - 86400000) dayLabel = 'Yesterday';
        else if (fromDateOnly.getTime() === today.getTime() - 172800000) dayLabel = '2 Days Ago';

        previewHTML = `
          <div class="range-type historical">HISTORICAL DATA</div>
          <div class="range-details">
            <strong>${dayLabel}</strong><br>
            ${dateStr}<br>
            ${fromTimeStr} - ${toTimeStr}<br>
            <span style="opacity: 0.8;">Duration: ${durationStr}</span>
          </div>
        `;
      }

      if (previewHTML) {
        if (previewContent) {
          previewContent.innerHTML = previewHTML;
          if (selectionPreview) selectionPreview.classList.add('show');
        }
        if (previewContentDatePicker) {
          previewContentDatePicker.innerHTML = previewHTML;
          if (selectionPreviewDatePicker) selectionPreviewDatePicker.classList.add('show');
        }
      } else {
        if (selectionPreview) selectionPreview.classList.remove('show');
        if (selectionPreviewDatePicker) selectionPreviewDatePicker.classList.remove('show');
      }
    };

    const updateButtonAndHighlight = (text, selectedOption, isLive) => {
      timeRangeBtns.forEach((button) => {
        const btnSpan = button.querySelector('span');
        if (btnSpan) btnSpan.textContent = text;
        if (isLive) {
          button.classList.add('is-live');
          button.title = 'Viewing real-time data';
        } else {
          button.classList.remove('is-live');
          button.title = 'Viewing historical data';
        }
      });
      timeOptions.forEach((opt) => opt.classList.remove('active'));
      if (datePickerTrigger) datePickerTrigger.classList.remove('active');
      if (selectedOption) selectedOption.classList.add('active');
    };

    // Initialize button state
    const { from: fromParam, to: toParam } = getCurrentAppliedRange();
    if (fromParam && toParam) {
      const knownRange = TIME_RANGE_LABELS[fromParam];
      if (knownRange) {
        updateButtonAndHighlight(
          knownRange.full,
          htmlNode.querySelector(`[data-range="${fromParam}"]`),
          knownRange.isLive
        );
      } else if (!Number.isNaN(Number(fromParam)) && !Number.isNaN(Number(toParam))) {
        const fromDate = new Date(parseInt(fromParam));
        const toDate = new Date(parseInt(toParam));
        const dateStr = fromDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const fromTimeStr = fromDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        const toTimeStr = toDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        updateButtonAndHighlight(`History: ${dateStr} ${fromTimeStr}-${toTimeStr}`, datePickerTrigger, false);
      } else {
        updateButtonAndHighlight('History: Custom Range', datePickerTrigger, false);
      }
      updateSelectionPreview(fromParam, toParam);
    } else if (TIME_RANGE_LABELS['now-12h']) {
      updateButtonAndHighlight(TIME_RANGE_LABELS['now-12h'].full, htmlNode.querySelector('[data-range="now-12h"]'), true);
      updateSelectionPreview('now-12h', 'now');
    }

    timeRangeBtns.forEach((button) => {
      button.onclick = function (e) {
        e.stopPropagation();
        timeRangeModal.classList.add('show');
        const { from, to } = getCurrentAppliedRange();
        updateSelectionPreview(from, to);
      };
    });

    timeRangeModal.onclick = function (e) {
      if (e.target === timeRangeModal) timeRangeModal.classList.remove('show');
    };

    datePickerModal.onclick = function (e) {
      if (e.target === datePickerModal) datePickerModal.classList.remove('show');
    };

    timeOptions.forEach((option) => {
      option.onclick = function () {
        const range = this.dataset.range;
        let fromTime;
        let toTime;
        let buttonText;
        let isLive;
        const now = new Date();
        switch (range) {
          case 'today':
            fromTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0).getTime();
            toTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0).getTime();
            buttonText = (TIME_RANGE_LABELS['today'] || {}).full || 'Today';
            isLive = false;
            break;
          case 'yesterday': {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            fromTime = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 7, 0, 0).getTime();
            toTime = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 21, 0, 0).getTime();
            buttonText = (TIME_RANGE_LABELS['yesterday'] || {}).full || 'Yesterday';
            isLive = false;
            break;
          }
          case '2days': {
            const twoDaysAgo = new Date(now);
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
            fromTime = new Date(twoDaysAgo.getFullYear(), twoDaysAgo.getMonth(), twoDaysAgo.getDate(), 7, 0, 0).getTime();
            toTime = new Date(twoDaysAgo.getFullYear(), twoDaysAgo.getMonth(), twoDaysAgo.getDate(), 21, 0, 0).getTime();
            buttonText = 'History: 2 Days Ago (07:00-21:00)';
            isLive = false;
            break;
          }
          default:
            fromTime = range;
            toTime = 'now';
            buttonText = (TIME_RANGE_LABELS[range] || {}).full || `Live: Last ${range.replace('now-', '')}`;
            isLive = true;
        }

        updateButtonAndHighlight(buttonText, this, isLive);

        if (isLive) {
          writeSavedDateFilter(null);
        } else {
          writeSavedDateFilter({ from: String(fromTime), to: String(toTime) });
        }

        const urlParams = new URLSearchParams(window.location.search);
        urlParams.set('from', fromTime);
        urlParams.set('to', toTime);
        window.location.search = urlParams.toString();
        timeRangeModal.classList.remove('show');
      };
    });

    const fromHourInput = htmlNode.getElementById('from-hour');
    const fromMinuteInput = htmlNode.getElementById('from-minute');
    const toHourInput = htmlNode.getElementById('to-hour');
    const toMinuteInput = htmlNode.getElementById('to-minute');

    const setupTimeInput = (input, max) => {
      if (!input) return;
      input.oninput = function () {
        let val = parseInt(this.value) || 0;
        if (val < 0) val = 0;
        if (val > max) val = max;
        this.value = val.toString().padStart(2, '0');
      };
      input.onblur = function () {
        const val = parseInt(this.value) || 0;
        this.value = val.toString().padStart(2, '0');
      };
    };

    setupTimeInput(fromHourInput, 23);
    setupTimeInput(fromMinuteInput, 59);
    setupTimeInput(toHourInput, 23);
    setupTimeInput(toMinuteInput, 59);

    const updatePreviewFromInputs = () => {
      if (!selectedFromDate) return;
      const fromHour = parseInt((fromHourInput && fromHourInput.value) || 7);
      const fromMinute = parseInt((fromMinuteInput && fromMinuteInput.value) || 0);
      const toHour = parseInt((toHourInput && toHourInput.value) || 21);
      const toMinute = parseInt((toMinuteInput && toMinuteInput.value) || 0);
      const toDate = selectedToDate || selectedFromDate;
      const previewFrom = new Date(
        selectedFromDate.getFullYear(), selectedFromDate.getMonth(), selectedFromDate.getDate(),
        fromHour, fromMinute, 0
      ).getTime();
      const previewTo = new Date(
        toDate.getFullYear(), toDate.getMonth(), toDate.getDate(),
        toHour, toMinute, 0
      ).getTime();
      updateSelectionPreview(previewFrom.toString(), previewTo.toString());
    };

    if (fromHourInput) fromHourInput.onchange = updatePreviewFromInputs;
    if (fromMinuteInput) fromMinuteInput.onchange = updatePreviewFromInputs;
    if (toHourInput) toHourInput.onchange = updatePreviewFromInputs;
    if (toMinuteInput) toMinuteInput.onchange = updatePreviewFromInputs;

    if (datePickerTrigger) {
      datePickerTrigger.onclick = function (e) {
        e.stopPropagation();
        updateButtonAndHighlight('Custom', this, false);
        timeRangeModal.classList.remove('show');
        datePickerModal.classList.add('show');
        const { from, to } = getCurrentAppliedRange();
        if (!Number.isNaN(Number(from)) && !Number.isNaN(Number(to))) {
          const fromDate = new Date(Number(from));
          const toDate = new Date(Number(to));
          if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime())) {
            selectedFromDate = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
            selectedToDate = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
            currentYear = selectedFromDate.getFullYear();
            currentMonth = selectedFromDate.getMonth();
          }
        }
        renderCalendar();
        updateSelectionPreview(from, to);
      };
    }

    const prevBtn = htmlNode.getElementById('prev-month');
    const nextBtn = htmlNode.getElementById('next-month');
    const cancelBtn = htmlNode.getElementById('cancel-date');
    const setBtn = htmlNode.getElementById('set-date');

    if (prevBtn) {
      prevBtn.onclick = function () {
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar();
      };
    }

    if (nextBtn) {
      nextBtn.onclick = function () {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar();
      };
    }

    if (cancelBtn) {
      cancelBtn.onclick = function () {
        selectedFromDate = null;
        selectedToDate = null;
        datePickerModal.classList.remove('show');
        timeRangeModal.classList.add('show');
      };
    }

    if (setBtn) {
      setBtn.onclick = function () {
        if (!selectedFromDate) {
          showToast('Please select a FROM date first', 'warning');
          return;
        }
        const fromHour = parseInt((fromHourInput && fromHourInput.value) || 7);
        const fromMinute = parseInt((fromMinuteInput && fromMinuteInput.value) || 0);
        const toHour = parseInt((toHourInput && toHourInput.value) || 21);
        const toMinute = parseInt((toMinuteInput && toMinuteInput.value) || 0);
        const toDate = selectedToDate || selectedFromDate;
        const fromTime = new Date(
          selectedFromDate.getFullYear(), selectedFromDate.getMonth(), selectedFromDate.getDate(),
          fromHour, fromMinute, 0
        ).getTime();
        const toTime = new Date(
          toDate.getFullYear(), toDate.getMonth(), toDate.getDate(),
          toHour, toMinute, 59
        ).getTime();
        if (toTime <= fromTime) {
          showToast('TO must be after FROM', 'warning');
          return;
        }
        const dateStr = selectedFromDate.toDateString() === toDate.toDateString()
          ? selectedFromDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : `${selectedFromDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${toDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        const fromTimeStr = `${fromHour.toString().padStart(2, '0')}:${fromMinute.toString().padStart(2, '0')}`;
        const toTimeStr = `${toHour.toString().padStart(2, '0')}:${toMinute.toString().padStart(2, '0')}`;

        updateButtonAndHighlight(`History: ${dateStr} ${fromTimeStr}-${toTimeStr}`, datePickerTrigger, false);

        writeSavedDateFilter({ from: String(fromTime), to: String(toTime) });

        const urlParams = new URLSearchParams(window.location.search);
        urlParams.set('from', fromTime);
        urlParams.set('to', toTime);
        window.location.search = urlParams.toString();
        datePickerModal.classList.remove('show');
      };
    }

    function renderCalendar() {
      const monthYearEl = htmlNode.getElementById('month-year');
      const calendarDays = htmlNode.getElementById('calendar-days');
      if (!monthYearEl || !calendarDays) return;
      const today = new Date();
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      monthYearEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
      const firstDay = new Date(currentYear, currentMonth, 1).getDay();
      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
      let html = '';
      for (let i = firstDay - 1; i >= 0; i--) {
        html += `<div class="date-picker-day other-month">${daysInPrevMonth - i}</div>`;
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentYear, currentMonth, day);
        const isToday = date.toDateString() === today.toDateString();
        const dateTime = date.getTime();
        const fromTime = selectedFromDate
          ? new Date(selectedFromDate.getFullYear(), selectedFromDate.getMonth(), selectedFromDate.getDate()).getTime()
          : null;
        const toTime = selectedToDate
          ? new Date(selectedToDate.getFullYear(), selectedToDate.getMonth(), selectedToDate.getDate()).getTime()
          : null;
        const isSelectedStart = fromTime != null && dateTime === fromTime;
        const isSelectedEnd = toTime != null && dateTime === toTime;
        const isInRange = fromTime != null && toTime != null && dateTime > fromTime && dateTime < toTime;
        const disabled = date > today;
        html += `<div class="date-picker-day${isToday ? ' today' : ''}${isSelectedStart ? ' selected selected-start' : ''}${isSelectedEnd ? ' selected selected-end' : ''}${isInRange ? ' in-range' : ''}${disabled ? ' disabled' : ''}" data-day="${day}">${day}</div>`;
      }
      const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
      for (let day = 1; day <= totalCells - firstDay - daysInMonth; day++) {
        html += `<div class="date-picker-day other-month">${day}</div>`;
      }
      calendarDays.innerHTML = html;
    }

    const calendarDaysEl = htmlNode.getElementById('calendar-days');
    if (calendarDaysEl) {
      calendarDaysEl.onclick = function (e) {
        const dayEl = e.target.closest('.date-picker-day:not(.disabled):not(.other-month)');
        if (!dayEl) return;
        const clickedDate = new Date(currentYear, currentMonth, parseInt(dayEl.dataset.day));
        if (!selectedFromDate || (selectedFromDate && selectedToDate)) {
          selectedFromDate = clickedDate;
          selectedToDate = null;
        } else if (clickedDate.getTime() < selectedFromDate.getTime()) {
          selectedToDate = selectedFromDate;
          selectedFromDate = clickedDate;
        } else {
          selectedToDate = clickedDate;
        }
        renderCalendar();
        updatePreviewFromInputs();
      };
    }
  }

  window.GFN_TIME_RANGE = { setupTimeRangeSelector };
})();
