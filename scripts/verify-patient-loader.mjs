/**
 * 患者画面のローディング固まり回帰検証
 * 実行: node scripts/verify-patient-loader.mjs
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('OK  ', msg);
  }
}

assert(!/signInWithIdToken\s*\(/.test(html), '無効な signInWithIdToken を使っていない');
assert(!html.includes("provider: 'custom:line'"), "provider: 'custom:line' を使っていない");
assert(html.includes('liff.getProfile()'), 'LINE userId 取得に getProfile を使う');
assert(html.includes('async function initPatientAuth'), 'initPatientAuth がある');
assert(/if \(!rateLimit\.allowed\) \{\s*loading\(false\);/s.test(html), 'レート制限時も loading を止める');
assert(html.includes('function withTimeout'), 'withTimeout がある');
assert(html.includes('keepWatchdog'), 'LIFF ログイン待ち中は watchdog を残す');

const withTimeoutSrc = html.match(/function withTimeout\(p, ms\) \{[\s\S]*?\n\}/);
assert(!!withTimeoutSrc, 'withTimeout の本体を抽出できる');

const sandbox = { console, setTimeout, clearTimeout, Error };
vm.createContext(sandbox);
vm.runInContext(withTimeoutSrc[0], sandbox);

const timedOut = await sandbox.withTimeout(new Promise(() => {}), 20).then(
  () => false,
  (err) => err && err.message === 'timeout'
);
assert(timedOut, 'withTimeout は時間切れで reject する');

const resolved = await sandbox.withTimeout(Promise.resolve('ok'), 200);
assert(resolved === 'ok', 'withTimeout は成功した Promise を通す');

// 旧バグ再現: session が null のときに user.id 参照で落ちる
function oldBrokenAssign(session) {
  return session.user.id;
}
let oldThrew = false;
try {
  oldBrokenAssign(null);
} catch (e) {
  oldThrew = e instanceof TypeError;
}
assert(oldThrew, '旧実装は session=null で TypeError になる（今回直した経路）');

const scriptMatch = html.match(/<script>\s*\/\/ CONFIG[\s\S]*<\/script>/);
assert(!!scriptMatch, '患者画面のメインスクリプトを抽出できる');

const loader = { style: { display: 'flex', opacity: '1' } };
const loginOverlay = {
  open: false,
  classList: {
    add(name) { if (name === 'open') loginOverlay.open = true; },
    remove(name) { if (name === 'open') loginOverlay.open = false; },
    toggle() {}
  }
};
const els = {
  loader,
  loginOverlay,
  header: { classList: { toggle() {} } },
  datePicker: { value: '', min: '', max: '', onchange: null },
  thead: { innerHTML: '' },
  staffHead: { innerHTML: '' },
  tbody: { innerHTML: '', children: [], appendChild(child) { this.children.push(child); return child; } },
  dMain: { innerHTML: '', textContent: '' },
  dSub: { textContent: '' },
  prevBtn: { disabled: false },
  nextBtn: { disabled: false },
};
function mockEl() {
  return {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    children: [],
    appendChild(child) { this.children.push(child); return child; },
  };
}
const localStore = {};
const liffMock = {
  inited: false,
  loggedIn: true,
  init: async () => { liffMock.inited = true; },
  isLoggedIn: () => liffMock.loggedIn,
  isInClient: () => false,
  login() { liffMock.loginCalled = true; },
  getProfile: async () => ({ userId: 'U_LINE_USER' }),
};

function chain(result) {
  const q = Promise.resolve(result);
  q.select = () => q;
  q.eq = () => q;
  q.or = () => q;
  q.single = () => q;
  q.maybeSingle = () => q;
  return q;
}

const dbMock = {
  from(table) {
    if (table === 'staffs') return chain({ data: [], error: null });
    if (table === 'bookings') return chain({ data: [], error: null });
    if (table === 'blocks') return chain({ data: [], error: null });
    return chain({ data: [], error: null });
  },
  auth: {
    getSession: async () => ({ data: { session: null } }),
    signInAnonymously: async () => ({ data: { session: null }, error: { message: 'Anonymous sign-ins are disabled' } }),
  },
};

const context = {
  window: { supabase: { createClient: () => dbMock }, onload: null, scrollY: 0, scrollTo() {} },
  document: {
    getElementById(id) { return els[id] || mockEl(); },
    querySelectorAll() { return []; },
    createElement() { return mockEl(); },
    body: { classList: { add() {}, remove() {} }, style: {} },
  },
  location: { hostname: '89booking.dev' },
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(localStore, k) ? localStore[k] : null; },
    setItem(k, v) { localStore[k] = String(v); },
    removeItem(k) { delete localStore[k]; },
  },
  liff: liffMock,
  console,
  setTimeout,
  clearTimeout,
  alert() {},
  navigator: { userAgent: 'test' },
  JpCustomCalendar: undefined,
  supabase: undefined,
};
context.window.document = context.document;
context.window.location = context.location;
context.window.localStorage = context.localStorage;
context.window.alert = context.alert;
vm.createContext(context);

const scriptBody = scriptMatch[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
vm.runInContext(scriptBody, context);

function stateUid() {
  return vm.runInContext('state.uid', context);
}

assert(typeof context.initPatientAuth === 'function', 'スクリプト実行後に initPatientAuth がある');
assert(typeof context.withTimeout === 'function', 'スクリプト実行後に withTimeout がある');

await context.initPatientAuth();
assert(stateUid() === 'U_LINE_USER', 'ログイン済みなら LINE userId を state.uid に入れる');
assert(loader.style.display === 'none' || loader.style.opacity === 0 || loader.style.opacity === '0', '認証成功後にローダーが消える');

// 旧バグ相当: IDトークン認証が session=null を返す状況でも予約表読み込みに進む
liffMock.getProfile = async () => ({ userId: 'U_AFTER_FAIL' });
vm.runInContext('state.uid = ""', context);
loader.style.display = 'flex';
loader.style.opacity = 1;
await context.initPatientAuth();
assert(stateUid() === 'U_AFTER_FAIL', 'Supabase 匿名ログイン失敗でも LINE userId で進む');
assert(loader.style.display === 'none' || loader.style.opacity === 0 || loader.style.opacity === '0', '匿名ログイン失敗でもローダーが消える');

// liff.init が失敗してもローダーを止めて予約表を読みに行く
liffMock.init = async () => { throw new Error('LIFF init failed'); };
vm.runInContext('state.uid = ""', context);
loader.style.display = 'flex';
loader.style.opacity = 1;
await context.initPatientAuth();
assert(loader.style.display === 'none' || loader.style.opacity === 0 || loader.style.opacity === '0', 'LIFF init 失敗でもローダーが消える');

// session.user 参照の旧コードが catch で飲み込まれたケース相当: 未ログイン外部ブラウザ
liffMock.init = async () => {};
liffMock.loggedIn = false;
loader.style.display = 'flex';
loader.style.opacity = 1;
loginOverlay.open = false;
await context.initPatientAuth();
assert(loginOverlay.open === true, '未ログイン時はログインオーバーレイを出す');
assert(loader.style.display === 'none' || loader.style.opacity === 0 || loader.style.opacity === '0', '未ログイン時もローダーが消える');

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\npatient loader checks passed');
