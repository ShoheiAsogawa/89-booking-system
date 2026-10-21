/**
 * 決済・ツケ払いロジックの回帰検証（admin.html と同じルールをミラー）
 * 実行: node scripts/verify-payment-logic.mjs
 */

const DEFERRED_PAYMENT_METHODS = ['ツケ払い', '保険'];

function isVoucherPaymentMethod(m) {
  return m === 'マッサージ券' || m === 'チケット' || m === '商品券';
}
const COMBINED_WALLET_METHOD = 'D払い・メルペイ';
function foldPaymentLabel(method) {
  return String(method || '').trim()
    .replace(/\u3000/g, '')
    .replace(/[Ｄｄ]/g, 'd')
    .replace(/[Ｐｐ]/g, 'p')
    .replace(/[Ａａ]/g, 'a')
    .replace(/[Ｙｙ]/g, 'y')
    .replace(/[・･]/g, '・')
    .toLowerCase();
}
function isCombinedWalletAlias(method) {
  const s = foldPaymentLabel(method);
  return s === 'd払い・メルペイ' || s === 'd払い/メルペイ' || s === 'd払い' || s === 'dpay' || s === 'メルペイ' || s === 'めるぺい' || s === 'merpay';
}
function normalizeDisplayPaymentMethod(m) {
  if (!m) return '';
  const s = String(m).trim();
  if (isVoucherPaymentMethod(s)) return 'マッサージ券';
  if (s === 'つけ払い' || s === '付け払い' || s === '掛け払い' || s === '掛払い') return 'ツケ払い';
  if (isCombinedWalletAlias(s)) return COMBINED_WALLET_METHOD;
  return s;
}
function isDeferredPaymentMethod(method) {
  return DEFERRED_PAYMENT_METHODS.indexOf(normalizeDisplayPaymentMethod(method)) >= 0;
}
function paymentMethodDbVariants(method) {
  const n = normalizeDisplayPaymentMethod(method);
  if (n === 'マッサージ券') return ['マッサージ券', 'チケット', '商品券'];
  if (n === 'ツケ払い') return ['ツケ払い', 'つけ払い', '付け払い', '掛け払い', '掛払い'];
  if (n === COMBINED_WALLET_METHOD) return [COMBINED_WALLET_METHOD, 'D払い', 'メルペイ'];
  return n ? [n] : [];
}
function buildPaymentSearchOrClause(payment) {
  return paymentMethodDbVariants(payment)
    .map((v) => `payment_method.eq.${v}`)
    .concat('payment_method.eq.分割')
    .join(',');
}
function parseBookingBreakdownRows(b) {
  if (!b || b.payment_breakdown == null || b.payment_breakdown === '') return null;
  if (Array.isArray(b.payment_breakdown)) return b.payment_breakdown;
  if (typeof b.payment_breakdown === 'string') {
    try {
      const o = JSON.parse(b.payment_breakdown);
      return Array.isArray(o) ? o : null;
    } catch {
      return null;
    }
  }
  return null;
}
function getEffectivePaymentBreakdown(b) {
  const rows = parseBookingBreakdownRows(b);
  const normalizedRows = normalizeRowsForSave(rows || []);
  if (normalizedRows.length < 2) return null;
  const method = normalizeDisplayPaymentMethod(b.payment_method || '');
  if (method !== '分割') return null;
  return normalizedRows;
}
function isBookingPaymentSettled(b) {
  const rows = getEffectivePaymentBreakdown(b);
  if (rows && rows.length > 0) {
    if (!rows.some((r) => normalizeDisplayPaymentMethod(r.method || ''))) return false;
    return rows.every((r) => {
      const m = normalizeDisplayPaymentMethod(r.method || '');
      if (!m) return false;
      if (isDeferredPaymentMethod(m)) return !!(r.payment_date || '').trim();
      return true;
    });
  }
  const m = normalizeDisplayPaymentMethod(b.payment_method || '');
  if (!m || m === '分割') return false;
  if (isDeferredPaymentMethod(m)) return !!(b.payment_date || '').trim();
  return true;
}
function buildDashboardPaymentEntries(bookings, start, end) {
  const entries = [];
  (bookings || []).forEach((b) => {
    const rows = getEffectivePaymentBreakdown(b);
    if (rows && rows.length > 0) {
      rows.forEach((r) => {
        const method = normalizeDisplayPaymentMethod(r.method || '') || '未選択';
        const amount = Number(r.amount || 0);
        const isDeferred = isDeferredPaymentMethod(method);
        const reportDate = isDeferred ? (r.payment_date || '') : b.date;
        const inRange = reportDate && reportDate >= start && reportDate <= end;
        const settled = method !== '未選択' && (!isDeferred || !!(r.payment_date || '').trim());
        if (inRange) {
          entries.push({ booking: b, method, amount, reportDate, paid: settled });
        } else if (isDeferred && !(r.payment_date || '').trim() && b.date >= start && b.date <= end) {
          entries.push({ booking: b, method, amount, reportDate: b.date, paid: false });
        }
      });
      return;
    }
    const normalizedMethod = normalizeDisplayPaymentMethod(b.payment_method);
    const method = normalizedMethod && normalizedMethod !== '分割' ? normalizedMethod : '未選択';
    const amount = Number(b.fee || 0);
    const isDeferred = isDeferredPaymentMethod(method);
    const hasPayDate = !!(b.payment_date || '').trim();
    const reportDate = isDeferred && hasPayDate ? b.payment_date : b.date;
    if (reportDate >= start && reportDate <= end) {
      const settled = method !== '未選択' && (!isDeferred || hasPayDate);
      entries.push({
        booking: b,
        method: settled ? method : isDeferred ? method : '未選択',
        amount,
        reportDate,
        paid: settled,
      });
    }
  });
  return entries;
}
function bookingSettlementReportDate(b) {
  if (!isBookingPaymentSettled(b)) return '';
  const rows = getEffectivePaymentBreakdown(b);
  if (rows && rows.length > 0) {
    const dates = rows
      .map((r) => {
        const method = normalizeDisplayPaymentMethod(r.method || '');
        return isDeferredPaymentMethod(method) ? String(r.payment_date || '').trim() : b.date;
      })
      .filter(Boolean);
    return dates.length ? dates.sort().slice(-1)[0] : '';
  }
  const method = normalizeDisplayPaymentMethod(b.payment_method || '');
  return isDeferredPaymentMethod(method) ? String(b.payment_date || '').trim() : b.date;
}
function amountCountingTowardTotalSales(b) {
  const fee = Number(b.fee || 0);
  const rows = getEffectivePaymentBreakdown(b);
  if (rows && rows.length > 0) {
    return rows.reduce((sum, r) => {
      const amt = Number(r.amount || 0);
      if (isVoucherPaymentMethod(r.method || '')) return sum;
      return sum + amt;
    }, 0);
  }
  const method = normalizeDisplayPaymentMethod(b.payment_method || '');
  if (method === '分割') return 0;
  if (isVoucherPaymentMethod(method)) return 0;
  return fee;
}
function paymentDateForSave(payState) {
  if (payState.mode === 'split') return null;
  if (isDeferredPaymentMethod(payState.method)) {
    const d = String(payState.date || '').trim();
    return d || null;
  }
  return null;
}
function calculatePaymentTotal(rows) {
  return (rows || []).reduce((sum, row) => {
    const n = Number(row && row.amount ? row.amount : 0);
    return sum + (Number.isNaN(n) ? 0 : n);
  }, 0);
}
function normalizeRowsForSave(rows) {
  return (rows || [])
    .map((r) => ({
      method: normalizeDisplayPaymentMethod(String(r && r.method ? r.method : '')),
      amount: Number(r && r.amount ? r.amount : 0),
      payment_date: String(r && r.payment_date ? r.payment_date : ''),
    }))
    .filter((r) => r.method && !Number.isNaN(r.amount) && r.amount > 0)
    .map((r) => ({
      method: r.method,
      amount: r.amount,
      payment_date: isDeferredPaymentMethod(r.method) ? r.payment_date || '' : '',
    }));
}
function validatePaymentStateBeforeSave(payState, fee) {
  if (payState.mode === 'split') {
    if (payState.rows.length < 2) return '分割決済は内訳を2件以上にしてください';
    for (const row of payState.rows) {
      const m = normalizeDisplayPaymentMethod(row.method || '');
      const amt = Number(row.amount || 0);
      if (amt > 0 && isDeferredPaymentMethod(m) && !(row.payment_date || '').trim()) {
        return `${m}の決済日を入力してください（売上の計上日）`;
      }
    }
    const total = calculatePaymentTotal(payState.rows);
    if (total <= 0) return '分割決済の金額を入力してください';
    if (total > 0 && total !== fee) {
      return `分割決済の合計（¥${total.toLocaleString()}）が料金（¥${fee.toLocaleString()}）と一致しません`;
    }
  }
  const m = normalizeDisplayPaymentMethod(payState.method || '');
  if (m && isDeferredPaymentMethod(m) && !(payState.date || '').trim()) {
    return `${m}の決済日を入力してください（売上の計上日）`;
  }
  return null;
}
function deriveDashboardSummary(bookings, start, end) {
  const paymentEntries = buildDashboardPaymentEntries(bookings, start, end);
  const paidEntries = paymentEntries.filter((e) => e.paid && !isVoucherPaymentMethod(e.method));
  const bookingSales = {};
  paidEntries.forEach((e) => {
    bookingSales[e.booking.id] = (bookingSales[e.booking.id] || 0) + Number(e.amount || 0);
  });
  const bookingSalesWithVoucher = {};
  paymentEntries.filter((e) => e.paid).forEach((e) => {
    bookingSalesWithVoucher[e.booking.id] = (bookingSalesWithVoucher[e.booking.id] || 0) + Number(e.amount || 0);
  });
  const paymentRelevantIds = new Set(paymentEntries.map((e) => e.booking.id));
  const listInRange = bookings.filter((b) => (b.date >= start && b.date <= end) || paymentRelevantIds.has(b.id));
  const fullySettledBookingIds = new Set(
    listInRange
      .filter((b) => {
        const settlementDate = bookingSettlementReportDate(b);
        return settlementDate >= start && settlementDate <= end;
      })
      .map((b) => b.id)
  );
  // スタッフ別集計をダッシュボードと同じロジックでミラー
  const staff = {};
  listInRange.forEach((b) => {
    const st = b.staff || '(none)';
    if (!staff[st]) staff[st] = { c: 0, s: 0, total: 0 };
    staff[st].total++;
  });
  listInRange.forEach((b) => {
    const st = b.staff || '(none)';
    const staffSale = Number(bookingSalesWithVoucher[b.id] || 0);
    const settled = fullySettledBookingIds.has(b.id);
    if (settled) staff[st].c++;
    if (staffSale > 0 || settled) staff[st].s += staffSale;
  });
  return {
    paidCount: fullySettledBookingIds.size,
    totalSales: paidEntries.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    bookingSales,
    bookingSalesWithVoucher,
    staff,
    staffTotalSales: Object.values(staff).reduce((sum, st) => sum + st.s, 0),
    staffTotalCount: Object.values(staff).reduce((sum, st) => sum + st.c, 0),
  };
}
function mergeDashboardBookingSources(...sources) {
  const mergedMap = new Map();
  sources.forEach((list) => {
    (list || []).forEach((b) => {
      if (!b || !b.id) return;
      if (!mergedMap.has(b.id)) {
        mergedMap.set(b.id, b);
        return;
      }
      const current = mergedMap.get(b.id);
      mergedMap.set(b.id, {
        ...current,
        payment_method: current.payment_method || b.payment_method,
        payment_date: current.payment_date || b.payment_date,
        payment_breakdown: current.payment_breakdown || b.payment_breakdown,
      });
    });
  });
  return Array.from(mergedMap.values());
}
function bookingMatchesPaymentFilter(b, payment) {
  if (payment === '未選択') return !isBookingPaymentSettled(b);
  const rows = getEffectivePaymentBreakdown(b);
  if (rows && rows.length > 0) {
    return rows.some((r) => normalizeDisplayPaymentMethod(r.method || '') === payment);
  }
  return normalizeDisplayPaymentMethod(b.payment_method || '') === payment;
}
function makeSearchPaymentQueryKind(payment) {
  if (!payment || payment === '未選択') return 'no-db-payment-filter';
  if (payment === 'マッサージ券') return 'voucher-or-split';
  return `${payment}-or-split`;
}
function makeEditorState(initial = {}) {
  return {
    currentPaymentMethod: initial.currentPaymentMethod || '',
    currentPaymentDate: initial.currentPaymentDate || '',
    currentPaymentBreakdown: initial.currentPaymentBreakdown ? initial.currentPaymentBreakdown.map((r) => ({ ...r })) : [],
    isSplitPayment: !!initial.isSplitPayment,
  };
}
function selectPaymentState(state, method) {
  const normTarget = normalizeDisplayPaymentMethod(method);
  const normCurrent = normalizeDisplayPaymentMethod(state.currentPaymentMethod || '');
  const newMethod = normCurrent === normTarget ? '' : normTarget;
  state.currentPaymentMethod = newMethod;
  if (!isDeferredPaymentMethod(newMethod)) state.currentPaymentDate = '';
  else if (normCurrent && normCurrent !== newMethod) state.currentPaymentDate = '';
  state.isSplitPayment = false;
  state.currentPaymentBreakdown = [];
  return state;
}
function addPaymentRowState(state, defaultMethod, defaultAmount) {
  state.currentPaymentBreakdown.push({
    method: defaultMethod || '現金',
    amount: Number(defaultAmount || 0),
    payment_date: '',
  });
}
function paymentPlusState(state, fee) {
  if (!state.isSplitPayment) {
    const initialMethod = normalizeDisplayPaymentMethod(state.currentPaymentMethod || '') || '現金';
    const initialDate = isDeferredPaymentMethod(initialMethod) ? state.currentPaymentDate || '' : '';
    state.isSplitPayment = true;
    state.currentPaymentBreakdown = [];
    addPaymentRowState(state, initialMethod, fee);
    if (state.currentPaymentBreakdown[0]) state.currentPaymentBreakdown[0].payment_date = initialDate;
    addPaymentRowState(state, '現金', 0);
  } else {
    addPaymentRowState(state, state.currentPaymentMethod || '現金', 0);
  }
  return state;
}
function removePaymentRowState(state, index) {
  state.currentPaymentBreakdown.splice(index, 1);
  if (state.currentPaymentBreakdown.length <= 1) {
    if (state.currentPaymentBreakdown.length === 1) {
      const row = state.currentPaymentBreakdown[0];
      state.currentPaymentMethod = normalizeDisplayPaymentMethod(row.method || '') || '';
      state.currentPaymentDate = isDeferredPaymentMethod(state.currentPaymentMethod)
        ? String(row.payment_date || '').trim()
        : '';
    }
    state.isSplitPayment = false;
    state.currentPaymentBreakdown = [];
  }
  return state;
}
function currentPaymentStateFromEditor(state) {
  if (state.isSplitPayment) {
    const rows = normalizeRowsForSave(state.currentPaymentBreakdown || []);
    if (rows.length <= 1) {
      const method = normalizeDisplayPaymentMethod(rows[0]?.method || state.currentPaymentMethod || '');
      const date = isDeferredPaymentMethod(method)
        ? String(rows[0]?.payment_date || state.currentPaymentDate || '').trim()
        : '';
      return {
        mode: 'single',
        rows: [],
        method,
        date,
        compareKey: `single:${method}:${date}`,
      };
    }
    return {
      mode: 'split',
      rows,
      method: '分割',
      date: '',
      compareKey: `split:${JSON.stringify(rows)}`,
    };
  }
  const method = normalizeDisplayPaymentMethod(state.currentPaymentMethod || '');
  const date = isDeferredPaymentMethod(method) ? String(state.currentPaymentDate || '').trim() : '';
  return { mode: 'single', rows: [], method, date, compareKey: `single:${method}:${date}` };
}
function buildSavePayloadFromPayState(payState) {
  return {
    payment_method: payState.method || null,
    payment_date: paymentDateForSave(payState),
    payment_breakdown: payState.mode === 'split' ? payState.rows : [],
  };
}
function buildExportSummary(bookings, start = '0000-01-01', end = '9999-12-31') {
  const rows = bookings.map((b) => {
    const fee = Number(b.fee || 0);
    const breakdown = getEffectivePaymentBreakdown(b);
    let method = normalizeDisplayPaymentMethod(b.payment_method || '');
    let exportFee = fee;
    if (breakdown && breakdown.length > 0) {
      method = '分割';
      exportFee = breakdown.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    } else if (method === '分割') {
      method = '';
    }
    return { booking: b, fee: exportFee, method };
  });
  return {
    totalAmount: rows.reduce((sum, r) => sum + r.fee, 0),
    paidRows: rows.filter((r) => {
      const settlementDate = bookingSettlementReportDate(r.booking);
      return settlementDate >= start && settlementDate <= end;
    }).length,
    paidTotal: buildDashboardPaymentEntries(bookings, start, end).reduce((sum, entry) => {
      if (!entry.paid || isVoucherPaymentMethod(entry.method)) return sum;
      return sum + Number(entry.amount || 0);
    }, 0),
  };
}

let passed = 0;
let failed = 0;
function assert(name, cond) {
  if (cond) {
    passed++;
    return;
  }
  failed++;
  console.error(`FAIL: ${name}`);
}

// 1. 旧表記の正規化
assert('legacy tsuke alias', normalizeDisplayPaymentMethod('つけ払い') === 'ツケ払い');

// 2. 現金 + 幽霊内訳1行ツケ払い → 現金扱い・決済済み
const ghostCash = {
  payment_method: '現金',
  payment_date: null,
  payment_breakdown: JSON.stringify([{ method: 'ツケ払い', amount: 10000, payment_date: '2026-05-01' }]),
  fee: 10000,
  date: '2026-06-01',
};
assert('ghost breakdown ignored', getEffectivePaymentBreakdown(ghostCash) === null);
assert('ghost cash settled', isBookingPaymentSettled(ghostCash) === true);

// 3. ツケ払い決済日なし → 未決済
const tsukePending = {
  payment_method: 'ツケ払い',
  payment_date: '',
  payment_breakdown: '[]',
  fee: 5000,
  date: '2026-06-01',
};
assert('tsuke no date not settled', isBookingPaymentSettled(tsukePending) === false);

// 4. ツケ払い決済日あり → 決済月のみ売上（6月期間に5月決済日は出ない）
const tsukePaid = {
  payment_method: 'ツケ払い',
  payment_date: '2026-05-15',
  fee: 5000,
  date: '2026-06-01',
};
const june = buildDashboardPaymentEntries([tsukePaid], '2026-06-01', '2026-06-30');
const may = buildDashboardPaymentEntries([tsukePaid], '2026-05-01', '2026-05-31');
assert('tsuke not in treatment month stats', june.filter((e) => e.paid).length === 0);
assert('tsuke in payment month stats', may.filter((e) => e.paid && e.method === 'ツケ払い').length === 1);

// 5. 分割: 現金 + ツケ未決済 → 一部のみ paid
const splitPartial = {
  payment_method: '分割',
  payment_breakdown: [
    { method: '現金', amount: 5000, payment_date: '' },
    { method: 'ツケ払い', amount: 5000, payment_date: '' },
  ],
  fee: 10000,
  date: '2026-06-10',
};
assert('split effective', getEffectivePaymentBreakdown(splitPartial)?.length === 2);
assert('split partial not settled', isBookingPaymentSettled(splitPartial) === false);
const splitEntries = buildDashboardPaymentEntries([splitPartial], '2026-06-01', '2026-06-30');
assert('split cash counted unpaid tsuke pending', splitEntries.filter((e) => e.method === '現金' && e.paid).length === 1);
assert('split tsuke pending entry', splitEntries.filter((e) => e.method === 'ツケ払い' && !e.paid).length === 1);

// 6. 保存時: 現金へ変更後は payment_date null
assert('cash save clears date', paymentDateForSave({ mode: 'single', method: '現金', date: '2026-05-01' }) === null);

// 7. 不正な payment_method=分割 かつ内訳1行のみ → 無効内訳
const brokenSplit = {
  payment_method: '分割',
  payment_breakdown: [{ method: 'ツケ払い', amount: 10000, payment_date: '2026-06-01' }],
  fee: 10000,
  date: '2026-06-01',
};
assert('broken split breakdown ignored', getEffectivePaymentBreakdown(brokenSplit) === null);
assert('broken split not settled', isBookingPaymentSettled(brokenSplit) === false);

// 8. 二重計上なし: ツケ払い同一予約・6月期間で1エントリのみ
const tsukeJune = {
  payment_method: 'ツケ払い',
  payment_date: '2026-06-20',
  fee: 8000,
  date: '2026-06-05',
};
const juneOne = buildDashboardPaymentEntries([tsukeJune], '2026-06-01', '2026-06-30');
assert('single tsuke one paid entry in month', juneOne.filter((e) => e.paid).length === 1);

// 9. 分割2行・ツケ払い決済日あり → 決済済み
const splitOk = {
  payment_method: '分割',
  payment_breakdown: [
    { method: '現金', amount: 3000, payment_date: '' },
    { method: 'ツケ払い', amount: 7000, payment_date: '2026-06-25' },
  ],
  fee: 10000,
  date: '2026-06-01',
};
assert('split 2 rows effective', getEffectivePaymentBreakdown(splitOk)?.length === 2);
assert('split all settled', isBookingPaymentSettled(splitOk) === true);

// 10. 空の payment_breakdown 配列
assert('empty array breakdown', getEffectivePaymentBreakdown({ payment_breakdown: '[]', payment_method: '現金' }) === null);

const brokenSplitEntries = buildDashboardPaymentEntries([brokenSplit], '2026-06-01', '2026-06-30');
assert('broken split has no paid dashboard entry', brokenSplitEntries.filter((e) => e.paid).length === 0);
assert('broken split is unpaid placeholder', brokenSplitEntries[0]?.method === '未選択' && brokenSplitEntries[0]?.paid === false);

// 11. 現金なのに古い分割2行が残っていても、単一決済を優先して内訳を無視
const staleTwoRows = {
  payment_method: '現金',
  payment_breakdown: [
    { method: '現金', amount: 3000, payment_date: '' },
    { method: 'ツケ払い', amount: 7000, payment_date: '2026-06-25' },
  ],
  payment_date: null,
  fee: 10000,
  date: '2026-06-01',
};
assert('stale two row breakdown ignored for single method', getEffectivePaymentBreakdown(staleTwoRows) === null);
assert('stale two row cash settled as single', isBookingPaymentSettled(staleTwoRows) === true);

// 12. 分割の0円行は保存対象から除外され、1行だけなら分割扱いにしない
const rowsWithZero = normalizeRowsForSave([
  { method: '現金', amount: 10000, payment_date: '' },
  { method: 'ツケ払い', amount: 0, payment_date: '2026-06-25' },
]);
assert('zero amount row removed before save', rowsWithZero.length === 1 && rowsWithZero[0].method === '現金');
assert(
  'split with zero-only second row rejected after normalization',
  validatePaymentStateBeforeSave({ mode: 'split', rows: rowsWithZero }, 10000) === '分割決済は内訳を2件以上にしてください'
);

// 13. 分割のツケ払い決済日なしは保存不可
const splitMissingDateRows = normalizeRowsForSave([
  { method: '現金', amount: 5000, payment_date: '' },
  { method: 'ツケ払い', amount: 5000, payment_date: '' },
]);
assert(
  'split deferred row requires payment date',
  validatePaymentStateBeforeSave({ mode: 'split', rows: splitMissingDateRows }, 10000) === 'ツケ払いの決済日を入力してください（売上の計上日）'
);

// 14. 一部入金は売上に入るが、決済済み件数には入れない
const partialSummary = deriveDashboardSummary([splitPartial], '2026-06-01', '2026-06-30');
assert('partial split sales counted', partialSummary.totalSales === 5000);
assert('partial split not fully paid count', partialSummary.paidCount === 0);

// 15. 分割内訳の各決済方法が患者検索フィルタにヒットする
const splitMixed = {
  payment_method: '分割',
  payment_breakdown: [
    { method: '現金', amount: 3000, payment_date: '' },
    { method: 'マッサージ券', amount: 2000, payment_date: '' },
    { method: 'ペイペイ', amount: 5000, payment_date: '' },
  ],
  fee: 10000,
  date: '2026-06-01',
};
assert('split cash search match', bookingMatchesPaymentFilter(splitMixed, '現金') === true);
assert('split voucher search match', bookingMatchesPaymentFilter(splitMixed, 'マッサージ券') === true);
assert('split paypay search match', bookingMatchesPaymentFilter(splitMixed, 'ペイペイ') === true);
assert('split credit search not match', bookingMatchesPaymentFilter(splitMixed, 'クレジット') === false);
assert('cash search db query includes split', makeSearchPaymentQueryKind('現金') === '現金-or-split');
assert('voucher search db query includes split', makeSearchPaymentQueryKind('マッサージ券') === 'voucher-or-split');

// 16. DBに0円の後払い行が残っていても、有効内訳から除外して決済済み判定を邪魔しない
const splitWithZeroDeferred = {
  payment_method: '分割',
  payment_breakdown: [
    { method: '現金', amount: 10000, payment_date: '' },
    { method: 'ツケ払い', amount: 0, payment_date: '' },
  ],
  fee: 10000,
  date: '2026-06-01',
};
assert('zero deferred row ignored in effective breakdown', getEffectivePaymentBreakdown(splitWithZeroDeferred) === null);
assert('broken zero-row split not settled', isBookingPaymentSettled(splitWithZeroDeferred) === false);

// 17. 旧データ内訳の金額文字列も数値として正規化する
const splitStringAmount = {
  payment_method: '分割',
  payment_breakdown: [
    { method: '現金', amount: '3000', payment_date: '' },
    { method: 'ツケ払い', amount: '7000', payment_date: '2026-06-20' },
  ],
  fee: 10000,
  date: '2026-06-01',
};
assert('string amount normalized', getEffectivePaymentBreakdown(splitStringAmount)?.[1].amount === 7000);
assert('string amount split settled', isBookingPaymentSettled(splitStringAmount) === true);

// 18. 編集UI: ツケ払いから現金へ変更すると決済日・分割内訳をクリア
const editorTsuke = makeEditorState({
  currentPaymentMethod: 'ツケ払い',
  currentPaymentDate: '2026-06-20',
  currentPaymentBreakdown: [{ method: 'ツケ払い', amount: 10000, payment_date: '2026-06-20' }],
  isSplitPayment: true,
});
selectPaymentState(editorTsuke, '現金');
assert('select cash clears date', editorTsuke.currentPaymentDate === '');
assert('select cash clears split rows', editorTsuke.currentPaymentBreakdown.length === 0 && editorTsuke.isSplitPayment === false);

// 19. 編集UI: 後払い同士（ツケ払い→保険）でも決済日は引き継がない
const editorDeferredSwitch = makeEditorState({ currentPaymentMethod: 'ツケ払い', currentPaymentDate: '2026-06-20' });
selectPaymentState(editorDeferredSwitch, '保険');
assert('deferred switch clears date', editorDeferredSwitch.currentPaymentMethod === '保険' && editorDeferredSwitch.currentPaymentDate === '');

// 20. 編集UI: ツケ払いから分割化すると1行目へ決済日を引き継ぐ
const editorPlus = makeEditorState({ currentPaymentMethod: 'ツケ払い', currentPaymentDate: '2026-06-20' });
paymentPlusState(editorPlus, 10000);
assert('plus carries deferred date', editorPlus.currentPaymentBreakdown[0].payment_date === '2026-06-20');
assert('plus creates second row', editorPlus.currentPaymentBreakdown.length === 2);

// 21. 編集UI: 分割から1行削除で単一決済へ戻し、後払い日付を保持
const editorRemove = makeEditorState({
  isSplitPayment: true,
  currentPaymentBreakdown: [
    { method: '現金', amount: 3000, payment_date: '' },
    { method: 'ツケ払い', amount: 7000, payment_date: '2026-06-25' },
  ],
});
removePaymentRowState(editorRemove, 0);
assert('remove to single keeps deferred method', editorRemove.currentPaymentMethod === 'ツケ払い');
assert('remove to single keeps deferred date', editorRemove.currentPaymentDate === '2026-06-25');

// 22. 保存ペイロード: 現金は payment_date と breakdown を明示クリア
const cashPayload = buildSavePayloadFromPayState(currentPaymentStateFromEditor(makeEditorState({ currentPaymentMethod: '現金', currentPaymentDate: '2026-06-20' })));
assert('cash payload clears date', cashPayload.payment_date === null);
assert('cash payload clears breakdown', Array.isArray(cashPayload.payment_breakdown) && cashPayload.payment_breakdown.length === 0);

// 23. 保存ペイロード: 分割は親 payment_date を null、内訳だけに決済日
const splitPayloadState = currentPaymentStateFromEditor(makeEditorState({
  isSplitPayment: true,
  currentPaymentBreakdown: [
    { method: '現金', amount: 3000, payment_date: '' },
    { method: 'ツケ払い', amount: 7000, payment_date: '2026-06-25' },
  ],
}));
const splitPayload = buildSavePayloadFromPayState(splitPayloadState);
assert('split payload parent date null', splitPayload.payment_date === null);
assert('split payload method split', splitPayload.payment_method === '分割');
assert('split payload carries row date', splitPayload.payment_breakdown[1].payment_date === '2026-06-25');

// 24. CSV集計: マッサージ券は決済済み行数に入るが、売上合計には含めない
const voucherOnly = {
  id: 'voucher-only',
  payment_method: 'マッサージ券',
  payment_breakdown: '[]',
  fee: 10000,
  date: '2026-06-01',
};
const exportVoucher = buildExportSummary([voucherOnly]);
assert('voucher export row settled', exportVoucher.paidRows === 1);
assert('voucher export paid total excludes voucher', exportVoucher.paidTotal === 0);

// 25. CSV集計: 分割（現金+券）は非券分だけ決済済み合計へ
const splitCashVoucher = {
  id: 'split-cash-voucher',
  payment_method: '分割',
  payment_breakdown: [
    { method: '現金', amount: 4000, payment_date: '' },
    { method: 'マッサージ券', amount: 6000, payment_date: '' },
  ],
  fee: 10000,
  date: '2026-06-01',
};
const exportSplitCashVoucher = buildExportSummary([splitCashVoucher]);
assert('split cash voucher settled', isBookingPaymentSettled(splitCashVoucher) === true);
assert('split cash voucher export paid total cash only', exportSplitCashVoucher.paidTotal === 4000);

// 26. 組み合わせ検証: 代表的な単一決済は二重エントリしない
['現金', 'クレジット', 'ペイペイ', 'マッサージ券'].forEach((method) => {
  const b = { id: `single-${method}`, payment_method: method, payment_breakdown: '[]', fee: 1234, date: '2026-06-10' };
  const entries = buildDashboardPaymentEntries([b], '2026-06-01', '2026-06-30');
  assert(`single ${method} creates one entry`, entries.length === 1);
  assert(`single ${method} entry method`, entries[0].method === normalizeDisplayPaymentMethod(method));
});

// 27. 組み合わせ検証: 後払いは決済日が範囲外なら売上エントリなし
['ツケ払い', '保険'].forEach((method) => {
  const b = { id: `deferred-${method}`, payment_method: method, payment_date: '2026-07-01', fee: 4321, date: '2026-06-10' };
  const entries = buildDashboardPaymentEntries([b], '2026-06-01', '2026-06-30');
  assert(`deferred ${method} outside payment month no entry`, entries.length === 0);
});

// 28. 不変条件スイープ: 多数の単一決済・分割決済で集計と検索の整合性を検証
const methodVariants = ['', '現金', 'クレジット', 'ペイペイ', 'マッサージ券', 'チケット', '商品券', 'つけ払い', 'ツケ払い', '保険', '分割'];
const dateVariants = ['', '2026-05-31', '2026-06-01', '2026-06-15', '2026-06-30', '2026-07-01'];
const rowTemplates = [
  [],
  [{ method: '現金', amount: 1000, payment_date: '' }],
  [
    { method: '現金', amount: 1000, payment_date: '' },
    { method: 'ツケ払い', amount: 2000, payment_date: '' },
  ],
  [
    { method: '現金', amount: 1000, payment_date: '' },
    { method: 'ツケ払い', amount: 2000, payment_date: '2026-06-15' },
  ],
  [
    { method: 'マッサージ券', amount: 1000, payment_date: '' },
    { method: '保険', amount: 2000, payment_date: '2026-06-20' },
  ],
  [
    { method: 'クレジット', amount: '1500', payment_date: '' },
    { method: 'ペイペイ', amount: '2500', payment_date: '' },
  ],
  [
    { method: '現金', amount: 3000, payment_date: '' },
    { method: 'ツケ払い', amount: 0, payment_date: '' },
  ],
];
const generatedBookings = [];
let genId = 0;
methodVariants.forEach((method) => {
  dateVariants.forEach((paymentDate) => {
    rowTemplates.forEach((rows) => {
      generatedBookings.push({
        id: `gen-${genId++}`,
        payment_method: method,
        payment_date: paymentDate,
        payment_breakdown: rows.length % 2 === 0 ? rows : JSON.stringify(rows),
        fee: 3000,
        date: '2026-06-10',
      });
    });
  });
});

const sweepEntries = buildDashboardPaymentEntries(generatedBookings, '2026-06-01', '2026-06-30');
assert('sweep paid entries report inside range', sweepEntries.filter((e) => e.paid).every((e) => e.reportDate >= '2026-06-01' && e.reportDate <= '2026-06-30'));
assert('sweep no NaN amounts', sweepEntries.every((e) => !Number.isNaN(Number(e.amount))));
assert('sweep total sales equals paid non-voucher entries', deriveDashboardSummary(generatedBookings, '2026-06-01', '2026-06-30').totalSales === sweepEntries
  .filter((e) => e.paid && !isVoucherPaymentMethod(e.method))
  .reduce((sum, e) => sum + Number(e.amount || 0), 0));
assert('sweep paid count equals bookings settled in range', deriveDashboardSummary(generatedBookings, '2026-06-01', '2026-06-30').paidCount === generatedBookings.filter((b) => {
  const settlementDate = bookingSettlementReportDate(b);
  return settlementDate >= '2026-06-01' && settlementDate <= '2026-06-30';
}).length);
['現金', 'クレジット', 'ペイペイ', 'マッサージ券', 'ツケ払い', '保険', '未選択'].forEach((payment) => {
  const filtered = generatedBookings.filter((b) => bookingMatchesPaymentFilter(b, payment));
  assert(`sweep ${payment} filter deterministic`, filtered.every((b) => bookingMatchesPaymentFilter(b, payment)));
});

// 29. 保存ペイロードの総当たり: 単一決済は内訳クリア、分割は親決済日を持たない
methodVariants.forEach((method) => {
  dateVariants.forEach((date) => {
    const payState = { mode: 'single', method, date, rows: [] };
    const payload = buildSavePayloadFromPayState(payState);
    assert(`single payload clears breakdown ${method}/${date}`, Array.isArray(payload.payment_breakdown) && payload.payment_breakdown.length === 0);
    if(isDeferredPaymentMethod(method) && date) {
      assert(`single deferred payload keeps date ${method}/${date}`, payload.payment_date === date);
    } else {
      assert(`single non-deferred payload clears date ${method}/${date}`, payload.payment_date === null);
    }
  });
});
rowTemplates.forEach((rows, idx) => {
  const normalizedRows = normalizeRowsForSave(rows);
  const payState = { mode: 'split', method: '分割', date: '2026-06-10', rows: normalizedRows };
  const payload = buildSavePayloadFromPayState(payState);
  assert(`split payload parent date always null ${idx}`, payload.payment_date === null);
  assert(`split payload uses rows ${idx}`, payload.payment_breakdown === normalizedRows);
});

// 30. 検索クエリのレガシー別名カバレッジ（DB完全一致による取りこぼし防止）
assert('variants tsuke includes aliases', ['ツケ払い', 'つけ払い', '付け払い', '掛け払い', '掛払い'].every((v) => paymentMethodDbVariants('ツケ払い').includes(v)));
assert('variants voucher includes aliases', ['マッサージ券', 'チケット', '商品券'].every((v) => paymentMethodDbVariants('マッサージ券').includes(v)));
assert('variants insurance single', JSON.stringify(paymentMethodDbVariants('保険')) === JSON.stringify(['保険']));
assert('variants cash single', JSON.stringify(paymentMethodDbVariants('現金')) === JSON.stringify(['現金']));
assert('variants empty', paymentMethodDbVariants('').length === 0);
['つけ払い', '付け払い', '掛け払い', '掛払い'].forEach((alias) => {
  const clause = buildPaymentSearchOrClause('ツケ払い');
  assert(`tsuke search clause covers ${alias}`, clause.includes(`payment_method.eq.${alias}`));
  // 別名で保存された予約も正規化フィルタにヒットする
  assert(`alias ${alias} matches tsuke filter`, bookingMatchesPaymentFilter({ payment_method: alias }, 'ツケ払い') === true);
  // 別名 + 決済日があれば決済済み扱い
  assert(`alias ${alias} settled with date`, isBookingPaymentSettled({ payment_method: alias, payment_date: '2026-06-10' }) === true);
  assert(`alias ${alias} unsettled without date`, isBookingPaymentSettled({ payment_method: alias }) === false);
});
assert('tsuke search clause includes split', buildPaymentSearchOrClause('ツケ払い').includes('payment_method.eq.分割'));
assert('voucher search clause includes split', buildPaymentSearchOrClause('マッサージ券').includes('payment_method.eq.分割'));
assert('voucher search clause covers ticket', buildPaymentSearchOrClause('マッサージ券').includes('payment_method.eq.チケット'));
// 別名で保存された分割内訳行も検索ヒット
assert('split with alias tsuke row matches', bookingMatchesPaymentFilter({ payment_method: '分割', payment_breakdown: [
  { method: '現金', amount: 1000 },
  { method: 'つけ払い', amount: 2000, payment_date: '2026-06-10' }
] }, 'ツケ払い') === true);

// 30b. 決済変更時の上書き・削除: 変更→保存ペイロードが旧データを確実に消す/上書きすることを検証
// A. 後払い(決済日あり) → 現金: payment_date が null に消える、breakdown は空
{
  const st = makeEditorState({ currentPaymentMethod: 'ツケ払い', currentPaymentDate: '2026-06-10' });
  selectPaymentState(st, '現金');
  const payload = buildSavePayloadFromPayState(currentPaymentStateFromEditor(st));
  assert('A: tsuke->cash method overwritten', payload.payment_method === '現金');
  assert('A: tsuke->cash payment_date cleared', payload.payment_date === null);
  assert('A: tsuke->cash breakdown cleared', Array.isArray(payload.payment_breakdown) && payload.payment_breakdown.length === 0);
}
// B. 後払いA(決済日あり) → 後払いB(保険): 前の決済日は消え、保険は未入力に
{
  const st = makeEditorState({ currentPaymentMethod: 'ツケ払い', currentPaymentDate: '2026-06-10' });
  selectPaymentState(st, '保険');
  assert('B: tsuke->insurance date cleared in state', st.currentPaymentDate === '');
  const payload = buildSavePayloadFromPayState(currentPaymentStateFromEditor(st));
  assert('B: tsuke->insurance method overwritten', payload.payment_method === '保険');
  assert('B: tsuke->insurance old date not carried over', payload.payment_date === null);
}
// C. 分割 → 単一(現金): breakdown が空に消え、method は分割ではなく現金
{
  const st = makeEditorState({ isSplitPayment: true, currentPaymentBreakdown: [
    { method: '現金', amount: 1000, payment_date: '' },
    { method: 'ツケ払い', amount: 2000, payment_date: '2026-06-12' },
  ] });
  selectPaymentState(st, '現金');
  const payload = buildSavePayloadFromPayState(currentPaymentStateFromEditor(st));
  assert('C: split->single not 分割', payload.payment_method === '現金');
  assert('C: split->single breakdown cleared', Array.isArray(payload.payment_breakdown) && payload.payment_breakdown.length === 0);
  assert('C: split->single payment_date null', payload.payment_date === null);
}
// D. 分割で行削除して単一化(残り=ツケ払い+決済日): 親 method/date に昇格、breakdown は消える
{
  const st = makeEditorState({ isSplitPayment: true, currentPaymentBreakdown: [
    { method: '現金', amount: 1000, payment_date: '' },
    { method: 'ツケ払い', amount: 2000, payment_date: '2026-06-12' },
  ] });
  removePaymentRowState(st, 0); // 現金行を削除→ツケ払いのみ残る
  assert('D: collapses to single', st.isSplitPayment === false);
  const payload = buildSavePayloadFromPayState(currentPaymentStateFromEditor(st));
  assert('D: promoted method tsuke', payload.payment_method === 'ツケ払い');
  assert('D: promoted date kept', payload.payment_date === '2026-06-12');
  assert('D: breakdown cleared after collapse', Array.isArray(payload.payment_breakdown) && payload.payment_breakdown.length === 0);
}
// E. 同じ方法を再クリックで解除(未選択): method/date/breakdown 全て消える
{
  const st = makeEditorState({ currentPaymentMethod: 'クレジット' });
  selectPaymentState(st, 'クレジット');
  const payload = buildSavePayloadFromPayState(currentPaymentStateFromEditor(st));
  assert('E: deselect method null', payload.payment_method === null);
  assert('E: deselect date null', payload.payment_date === null);
  assert('E: deselect breakdown empty', Array.isArray(payload.payment_breakdown) && payload.payment_breakdown.length === 0);
}
// F. 単一 → 分割化 → 保存: 親 payment_date は持たず(各行が保持)、breakdown が入る
{
  const st = makeEditorState({ currentPaymentMethod: 'ツケ払い', currentPaymentDate: '2026-06-10' });
  paymentPlusState(st, 5000);
  assert('F: becomes split', st.isSplitPayment === true);
  assert('F: first row carries deferred date', st.currentPaymentBreakdown[0].payment_date === '2026-06-10');
  st.currentPaymentBreakdown[1].amount = 3000; // 2行目に金額を入れて有効な分割に
  const payload = buildSavePayloadFromPayState(currentPaymentStateFromEditor(st));
  assert('F: split parent method 分割', payload.payment_method === '分割');
  assert('F: split parent date null', payload.payment_date === null);
  assert('F: split breakdown has rows', Array.isArray(payload.payment_breakdown) && payload.payment_breakdown.length >= 2);
}
// G. レガシー別名で保存された予約を現金に変更: 別名が確実に正規化・上書きされる
{
  const st = makeEditorState({ currentPaymentMethod: 'つけ払い', currentPaymentDate: '2026-06-10' });
  selectPaymentState(st, '現金');
  const payload = buildSavePayloadFromPayState(currentPaymentStateFromEditor(st));
  assert('G: legacy alias -> cash overwritten', payload.payment_method === '現金');
  assert('G: legacy alias date cleared', payload.payment_date === null);
}

// 31. スタッフ別集計: マッサージ券はスタッフ売上に加算/全体売上には非加算、件数はKPIと一致
const staffVoucherOnly = { id: 'sv1', staff: '岡野', payment_method: 'マッサージ券', payment_breakdown: '[]', fee: 5000, date: '2026-06-10' };
const staffCash = { id: 'sc1', staff: '岡野', payment_method: '現金', payment_breakdown: '[]', fee: 3000, date: '2026-06-11' };
const staffSummary = deriveDashboardSummary([staffVoucherOnly, staffCash], '2026-06-01', '2026-06-30');
assert('staff sales include voucher', staffSummary.staff['岡野'].s === 8000);
assert('total sales exclude voucher', staffSummary.totalSales === 3000);
assert('staff settled count equals paidCount', staffSummary.staffTotalCount === staffSummary.paidCount);
assert('voucher-only booking counts in staff settled', staffSummary.staff['岡野'].c === 2);

// 部分決済の分割（現金済み + ツケ未決済）: スタッフ売上は支払済み分のみ、件数は未計上
const staffPartialSplit = { id: 'sp1', staff: '堀江', payment_method: '分割', fee: 5000, date: '2026-06-12', payment_breakdown: [
  { method: '現金', amount: 2000 },
  { method: 'ツケ払い', amount: 3000, payment_date: '' },
] };
const staffPartialSummary = deriveDashboardSummary([staffPartialSplit], '2026-06-01', '2026-06-30');
assert('partial split staff sale counts paid portion only', staffPartialSummary.staff['堀江'].s === 2000);
assert('partial split not counted as settled', staffPartialSummary.staff['堀江'].c === 0);
assert('partial split paidCount zero', staffPartialSummary.paidCount === 0);

// 分割（現金 + マッサージ券）: スタッフ売上は両方、全体売上は現金のみ
const staffSplitVoucher = { id: 'spv1', staff: '松田', payment_method: '分割', fee: 4000, date: '2026-06-13', payment_breakdown: [
  { method: '現金', amount: 2500 },
  { method: 'マッサージ券', amount: 1500 },
] };
const splitVoucherSummary = deriveDashboardSummary([staffSplitVoucher], '2026-06-01', '2026-06-30');
assert('split staff sale includes voucher portion', splitVoucherSummary.staff['松田'].s === 4000);
assert('split total sales excludes voucher portion', splitVoucherSummary.totalSales === 2500);
assert('split with voucher counts settled', splitVoucherSummary.staff['松田'].c === 1);

// スイープ全体でも スタッフ件数合計 === paidCount が常に成立
const genSummary = deriveDashboardSummary(generatedBookings, '2026-06-01', '2026-06-30');
assert('sweep staff settled count equals paidCount', genSummary.staffTotalCount === genSummary.paidCount);
// スタッフ売上合計 >= 全体売上（券を含む分だけ多い or 等しい）
assert('sweep staff sales >= total sales', genSummary.staffTotalSales >= genSummary.totalSales);

// 32. Dashboard source merge: same booking fetched by booking date/payment date/breakdown must not double count.
const dupDeferred = {
  id: 'dup-deferred',
  staff: 'A',
  payment_method: 'ツケ払い',
  payment_date: '2026-05-20',
  payment_breakdown: '[]',
  fee: 7000,
  date: '2026-05-10',
};
const dupSplit = {
  id: 'dup-split',
  staff: 'A',
  payment_method: '分割',
  payment_breakdown: [
    { method: '現金', amount: 3000, payment_date: '' },
    { method: 'ツケ払い', amount: 4000, payment_date: '2026-05-25' },
  ],
  fee: 7000,
  date: '2026-05-11',
};
const mergedDuplicates = mergeDashboardBookingSources(
  [dupDeferred, dupSplit],
  [{ ...dupDeferred }],
  [{ ...dupSplit }]
);
const duplicateSummary = deriveDashboardSummary(mergedDuplicates, '2026-05-01', '2026-05-31');
assert('merge removes duplicate booking rows', mergedDuplicates.length === 2);
assert('merged duplicate sales counted once per payment part', duplicateSummary.totalSales === 14000);
assert('merged duplicate paid count counted once per booking', duplicateSummary.paidCount === 2);

// 33. Cross-month deferred: paid in May but booked in June is counted in May, not June, and not duplicated in Apr-Jun.
const crossMonthDeferred = {
  id: 'cross-month-deferred',
  staff: 'B',
  payment_method: '保険',
  payment_date: '2026-05-31',
  payment_breakdown: '[]',
  fee: 9000,
  date: '2026-06-02',
};
assert('cross-month deferred appears in May sales', deriveDashboardSummary([crossMonthDeferred], '2026-05-01', '2026-05-31').totalSales === 9000);
assert('cross-month deferred excluded from June sales', deriveDashboardSummary([crossMonthDeferred], '2026-06-01', '2026-06-30').totalSales === 0);
assert('cross-month deferred counted once in Apr-Jun', deriveDashboardSummary([crossMonthDeferred], '2026-04-01', '2026-06-30').totalSales === 9000);
assert('cross-month deferred paid count in May only', deriveDashboardSummary([crossMonthDeferred], '2026-05-01', '2026-05-31').paidCount === 1);
assert('cross-month deferred paid count not in booking month', deriveDashboardSummary([crossMonthDeferred], '2026-06-01', '2026-06-30').paidCount === 0);
assert('cross-month deferred export paid total follows payment month', buildExportSummary([crossMonthDeferred], '2026-06-01', '2026-06-30').paidTotal === 0);

// 34. Split with cash on booking date and deferred row in next month is split across periods, not double counted.
const splitAcrossMonths = {
  id: 'split-across-months',
  staff: 'C',
  payment_method: '分割',
  payment_breakdown: [
    { method: '現金', amount: 2000, payment_date: '' },
    { method: 'ツケ払い', amount: 5000, payment_date: '2026-06-05' },
  ],
  fee: 7000,
  date: '2026-05-28',
};
assert('split across months May has cash only', deriveDashboardSummary([splitAcrossMonths], '2026-05-01', '2026-05-31').totalSales === 2000);
assert('split across months June has deferred only', deriveDashboardSummary([splitAcrossMonths], '2026-06-01', '2026-06-30').totalSales === 5000);
assert('split across months combined has both once', deriveDashboardSummary([splitAcrossMonths], '2026-05-01', '2026-06-30').totalSales === 7000);
assert('split across months not counted settled before final payment', deriveDashboardSummary([splitAcrossMonths], '2026-05-01', '2026-05-31').paidCount === 0);
assert('split across months counted settled on final payment month', deriveDashboardSummary([splitAcrossMonths], '2026-06-01', '2026-06-30').paidCount === 1);
assert('split across months May export paid total cash only', buildExportSummary([splitAcrossMonths], '2026-05-01', '2026-05-31').paidTotal === 2000);
assert('split across months June export paid total deferred only', buildExportSummary([splitAcrossMonths], '2026-06-01', '2026-06-30').paidTotal === 5000);

// 35. Voucher-only and voucher portions never inflate total sales, but still count as settled/staff sales.
const voucherAudit = {
  id: 'voucher-audit',
  staff: 'D',
  payment_method: '分割',
  payment_breakdown: [
    { method: 'マッサージ券', amount: 6000, payment_date: '' },
    { method: '現金', amount: 1000, payment_date: '' },
  ],
  fee: 7000,
  date: '2026-05-12',
};
const voucherAuditSummary = deriveDashboardSummary([voucherAudit], '2026-05-01', '2026-05-31');
assert('voucher portion excluded from total sales', voucherAuditSummary.totalSales === 1000);
assert('voucher portion included in staff sales', voucherAuditSummary.staff.D.s === 7000);
assert('voucher split counts settled once', voucherAuditSummary.paidCount === 1);

// 36. Merge fills missing payment fields from richer later sources without duplicating the booking.
const thinBookingRow = {
  id: 'thin-merge',
  staff: 'E',
  payment_method: null,
  payment_date: null,
  payment_breakdown: null,
  fee: 8000,
  date: '2026-05-03',
};
const richBookingRow = {
  id: 'thin-merge',
  payment_method: '分割',
  payment_breakdown: [
    { method: '現金', amount: 3000, payment_date: '' },
    { method: 'ツケ払い', amount: 5000, payment_date: '2026-05-15' },
  ],
};
const mergedRich = mergeDashboardBookingSources([thinBookingRow], [richBookingRow]);
assert('merge keeps one thin/rich booking', mergedRich.length === 1);
assert('merge fills payment method from rich source', mergedRich[0].payment_method === '分割');
assert('merge fills payment breakdown from rich source', getEffectivePaymentBreakdown(mergedRich[0])?.length === 2);
assert('merge-filled rich source contributes full sales', deriveDashboardSummary(mergedRich, '2026-05-01', '2026-05-31').totalSales === 8000);

// 37. Pagination helper keeps fetching past exact 1000-row pages and stops on the first short page.
async function verifyPagedFetch(pageSize, totalRows) {
  const allRows = Array.from({ length: totalRows }, (_, i) => ({ id: `row-${i}` }));
  const ranges = [];
  async function fetchDashboardPagesForTest(makeQuery) {
    const all = [];
    let from = 0;
    while (true) {
      const to = from + pageSize - 1;
      const res = await makeQuery().range(from, to);
      if (res.error) return res;
      const rows = res.data || [];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return { data: all, error: null };
  }
  const res = await fetchDashboardPagesForTest(() => ({
    range(from, to) {
      ranges.push([from, to]);
      return Promise.resolve({ data: allRows.slice(from, to + 1), error: null });
    },
  }));
  return { count: res.data.length, ranges };
}
const pagedExact = await verifyPagedFetch(1000, 2000);
assert('pagination fetches exact full pages plus empty sentinel', pagedExact.count === 2000 && pagedExact.ranges.length === 3);
const pagedShort = await verifyPagedFetch(1000, 2001);
assert('pagination fetches short final page', pagedShort.count === 2001 && pagedShort.ranges.length === 3);

// 38. D払いとメルペイは1つの決済方法に正規化し、売上は合算する
assert('dbarai alias', normalizeDisplayPaymentMethod('D払い') === 'D払い・メルペイ');
assert('merpay alias', normalizeDisplayPaymentMethod('メルペイ') === 'D払い・メルペイ');
assert('merpay en alias', normalizeDisplayPaymentMethod('Merpay') === 'D払い・メルペイ');
assert('combined label stays combined', normalizeDisplayPaymentMethod('D払い・メルペイ') === 'D払い・メルペイ');
assert('wallet variants include both names', ['D払い・メルペイ', 'D払い', 'メルペイ'].every((v) => paymentMethodDbVariants('D払い').includes(v)));
assert('wallet search covers merpay', buildPaymentSearchOrClause('メルペイ').includes('payment_method.eq.D払い'));
assert('wallet search covers combined', buildPaymentSearchOrClause('D払い・メルペイ').includes('payment_method.eq.メルペイ'));
assert('stored dbarai matches combined filter', bookingMatchesPaymentFilter({ payment_method: 'D払い', payment_breakdown: '[]' }, 'D払い・メルペイ') === true);
assert('stored merpay matches combined filter', bookingMatchesPaymentFilter({ payment_method: 'メルペイ', payment_breakdown: '[]' }, 'D払い・メルペイ') === true);
const walletEntries = buildDashboardPaymentEntries([
  { id: 'd1', payment_method: 'D払い', payment_breakdown: '[]', fee: 3000, date: '2026-06-10' },
  { id: 'm1', payment_method: 'メルペイ', payment_breakdown: '[]', fee: 2000, date: '2026-06-11' },
], '2026-06-01', '2026-06-30');
assert('wallet entries share one method', walletEntries.length === 2 && walletEntries.every((e) => e.method === 'D払い・メルペイ' && e.paid));
assert('wallet sales are summed', walletEntries.reduce((sum, e) => sum + e.amount, 0) === 5000);
assert('split wallet row matches combined filter', bookingMatchesPaymentFilter({
  payment_method: '分割',
  payment_breakdown: [
    { method: '現金', amount: 1000, payment_date: '' },
    { method: 'D払い', amount: 2000, payment_date: '' },
  ],
}, 'D払い・メルペイ') === true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
