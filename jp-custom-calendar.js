/**
 * ネイティブ date ピッカーの代わりに表示するカスタムカレンダー。
 * 当月セル＝薄緑、日曜＝赤、土曜＝青、祝日＝赤（japanese-holidays 利用）
 */
(function (global) {
  'use strict';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function ymd(y, m, d) {
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  function parseYMD(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function startOfDay(d) {
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function eraLabel(year) {
    if (year >= 2019) return '令和' + (year - 2018);
    if (year >= 1989) return '平成' + (year - 1988);
    if (year >= 1926) return '昭和' + (year - 1925);
    return '';
  }
  function isJpHolidayLocal(y, m, d) {
    try {
      if (global.JapaneseHolidays && typeof global.JapaneseHolidays.isHoliday === 'function') {
        return !!global.JapaneseHolidays.isHoliday(new Date(y, m - 1, d));
      }
    } catch (e) {}
    return false;
  }

  var root = null;
  var viewYear;
  var viewMonth;
  var selected;
  var minD = null;
  var maxD = null;
  var onSelectCb = null;
  var showEra = true;

  function ensureDom() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'jpCustomCalendarOverlay';
    root.className = 'jp-cal-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML =
      '<div class="jp-cal-panel" onclick="event.stopPropagation()">' +
      '<div class="jp-cal-header">' +
      '<button type="button" class="jp-cal-nav" data-act="prev" aria-label="前の月">‹</button>' +
      '<div class="jp-cal-title" id="jpCalTitle"></div>' +
      '<button type="button" class="jp-cal-nav" data-act="next" aria-label="次の月">›</button>' +
      '</div>' +
      '<div class="jp-cal-weekdays"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>' +
      '<div class="jp-cal-grid" id="jpCalGrid"></div>' +
      '<div class="jp-cal-footer">' +
      '<button type="button" data-act="clear">削除</button>' +
      '<button type="button" data-act="today">今日</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(root);

    root.addEventListener('click', function () {
      close();
    });
    root.querySelector('.jp-cal-panel').addEventListener('click', function (e) {
      e.stopPropagation();
    });
    root.querySelector('[data-act="prev"]').addEventListener('click', function () {
      viewMonth--;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
      }
      render();
    });
    root.querySelector('[data-act="next"]').addEventListener('click', function () {
      viewMonth++;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
      }
      render();
    });
    root.querySelector('[data-act="clear"]').addEventListener('click', function () {
      close();
    });
    root.querySelector('[data-act="today"]').addEventListener('click', function () {
      var t = startOfDay(new Date());
      if (!inRange(t)) {
        alert('この日付は選択できません');
        return;
      }
      commit(t);
    });
  }

  function inRange(d) {
    if (minD && d < minD) return false;
    if (maxD && d > maxD) return false;
    return true;
  }

  function commit(d) {
    if (!inRange(d)) return;
    if (typeof onSelectCb === 'function') onSelectCb(d);
    close();
  }

  function render() {
    var titleEl = root.querySelector('#jpCalTitle');
    var grid = root.querySelector('#jpCalGrid');
    var y = viewYear;
    var m = viewMonth;
    var era = eraLabel(y);
    titleEl.textContent = showEra && era ? y + '年（' + era + '年） ' + (m + 1) + '月' : y + '年 ' + (m + 1) + '月';

    var first = new Date(y, m, 1);
    var startPad = first.getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var prevMonthDays = new Date(y, m, 0).getDate();

    grid.innerHTML = '';
    var i;
    for (i = 0; i < startPad; i++) {
      var pd = prevMonthDays - startPad + i + 1;
      var pm = m === 0 ? 11 : m - 1;
      var py = m === 0 ? y - 1 : y;
      grid.appendChild(makeCell(py, pm + 1, pd, true));
    }
    for (i = 1; i <= daysInMonth; i++) {
      grid.appendChild(makeCell(y, m + 1, i, false));
    }
    var cells = 42;
    var used = startPad + daysInMonth;
    var nextDay = 1;
    var nm = m === 11 ? 0 : m + 1;
    var ny = m === 11 ? y + 1 : y;
    for (i = used; i < cells; i++) {
      grid.appendChild(makeCell(ny, nm + 1, nextDay, true));
      nextDay++;
    }

    var now = new Date();
    var panel = root.querySelector('.jp-cal-panel');
    if (panel) {
      var isViewingRealThisMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();
      panel.classList.toggle('jp-cal-panel--this-real-month', isViewingRealThisMonth);
    }

    updateNavDisabled();
  }

  function makeCell(year, month, day, otherMonth) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jp-cal-day';
    btn.textContent = String(day);

    var dow = new Date(year, month - 1, day).getDay();
    if (dow === 0) btn.classList.add('is-sun');
    if (dow === 6) btn.classList.add('is-sat');

    if (otherMonth) {
      btn.classList.add('is-other-month');
    } else {
      btn.classList.add('is-current-month');
    }

    if (isJpHolidayLocal(year, month, day)) btn.classList.add('is-holiday');

    var d = startOfDay(new Date(year, month - 1, day));
    if (!inRange(d)) btn.classList.add('is-disabled');

    var sel = selected && startOfDay(selected).getTime() === d.getTime();
    if (sel) btn.classList.add('is-selected');

    btn.addEventListener('click', function () {
      if (!inRange(d)) return;
      if (otherMonth) {
        viewYear = year;
        viewMonth = month - 1;
        render();
        return;
      }
      commit(d);
    });

    return btn;
  }

  function updateNavDisabled() {
    var prevBtn = root.querySelector('[data-act="prev"]');
    var nextBtn = root.querySelector('[data-act="next"]');
    if (minD) {
      var lastPrevMonth = new Date(viewYear, viewMonth, 0);
      lastPrevMonth.setHours(0, 0, 0, 0);
      var min0 = startOfDay(minD);
      prevBtn.disabled = lastPrevMonth.getTime() < min0.getTime();
    } else {
      prevBtn.disabled = false;
    }
    if (maxD) {
      var firstNextMonth = new Date(viewYear, viewMonth + 1, 1);
      firstNextMonth.setHours(0, 0, 0, 0);
      var max0 = startOfDay(maxD);
      nextBtn.disabled = firstNextMonth.getTime() > max0.getTime();
    } else {
      nextBtn.disabled = false;
    }
  }

  function open(opts) {
    opts = opts || {};
    ensureDom();
    onSelectCb = opts.onSelect || null;
    showEra = opts.showEra !== false;

    var base = opts.anchorDate ? startOfDay(opts.anchorDate) : startOfDay(new Date());
    selected = base;

    minD = null;
    maxD = null;
    if (opts.inputEl && opts.inputEl.min) minD = startOfDay(parseYMD(opts.inputEl.min));
    if (opts.inputEl && opts.inputEl.max) maxD = startOfDay(parseYMD(opts.inputEl.max));
    if (opts.minDate) minD = startOfDay(opts.minDate);
    if (opts.maxDate) maxD = startOfDay(opts.maxDate);

    viewYear = base.getFullYear();
    viewMonth = base.getMonth();

    render();
    root.classList.add('jp-cal-open');
  }

  function close() {
    if (root) root.classList.remove('jp-cal-open');
    onSelectCb = null;
  }

  global.JpCustomCalendar = { open: open, close: close };
})(typeof window !== 'undefined' ? window : this);
