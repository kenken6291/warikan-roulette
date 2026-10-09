/* ワリカン・ルーレット フロントエンド */
'use strict';

/* GASのURLは config.js で設定 */
const GAS_URL = (window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '';
const GAS_URL_READY = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(GAS_URL) && !GAS_URL.includes('YOUR_DEPLOYMENT_ID');

const TOKEN_KEY = 'warikan_token';
const SETTINGS_KEY = 'warikan_settings_v1';

const DEFAULT_CATEGORIES = [
  { key: 'male',    label: '男性',           short: '男性',     mode: 'ratio', value: 1,   count: 2 },
  { key: 'female',  label: '女性',           short: '女性',     mode: 'ratio', value: 1,   count: 2 },
  { key: 'seniorM', label: '年長者（男性）', short: '年長男性', mode: 'ratio', value: 1.5, count: 0 },
  { key: 'seniorF', label: '年長者（女性）', short: '年長女性', mode: 'ratio', value: 1.5, count: 0 },
  { key: 'guestM',  label: '主賓（男性）',   short: '主賓男性', mode: 'fixed', value: 0,   count: 0 },
  { key: 'guestF',  label: '主賓（女性）',   short: '主賓女性', mode: 'fixed', value: 0,   count: 0 },
  { key: 'inviteM', label: '招待客（男性）', short: '招待男性', mode: 'fixed', value: 0,   count: 0 },
  { key: 'inviteF', label: '招待客（女性）', short: '招待女性', mode: 'fixed', value: 0,   count: 0 }
];

const WHEEL_COLORS = ['#23395B', '#F2B705', '#2F7D52', '#B8382A', '#4A6FA5', '#E8D9A8', '#6B4E8A', '#D9822B'];

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,
  categories: [],
  result: null,
  wheel: { rotation: 0, spinning: false, candidates: [] }
};

const $ = (id) => document.getElementById(id);
const yen = (n) => Math.round(n).toLocaleString('ja-JP') + '円';

/* ============================================================
 * API
 * ============================================================ */
async function api(action, data = {}) {
  if (!GAS_URL_READY) throw new Error('config.js の GAS_URL が未設定です');
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: state.token, ...data })
  });
  if (!res.ok) throw new Error('通信に失敗しました（' + res.status + '）');
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'エラーが発生しました');
  return json;
}

/* ============================================================
 * 画面切り替え・共通UI
 * ============================================================ */
function showAuth() {
  $('authView').hidden = false;
  $('appView').hidden = true;
  $('userBox').hidden = true;
  $('pwModal').hidden = true;
}

function showApp() {
  $('authView').hidden = true;
  $('appView').hidden = false;
  $('userBox').hidden = false;
  $('userName').textContent = (state.user && state.user.nickname ? state.user.nickname : '') + ' さん';
  $('pwModal').hidden = !(state.user && state.user.mustChangePassword);
  if (!$('pwModal').hidden) {
    setMsg('pwMsg', '');
    setTimeout(() => $('pwForm').currentPassword.focus(), 50);
  }
}

function setMsg(id, text, type) {
  const el = $(id);
  el.textContent = text || '';
  el.classList.toggle('is-error', type === 'error');
  el.classList.toggle('is-ok', type === 'ok');
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-show'), 2800);
}

async function withBusy(button, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '処理中…';
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/* パスワード表示切替（目のアイコン） */
const EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function setupPasswordToggles() {
  document.querySelectorAll('.pw-field').forEach((wrap) => {
    const input = wrap.querySelector('input');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'パスワードを表示');
    btn.innerHTML = EYE_OPEN;
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE_OPEN;
      btn.setAttribute('aria-label', show ? 'パスワードを隠す' : 'パスワードを表示');
    });
    wrap.appendChild(btn);
  });
}

function resetPasswordFields(form) {
  form.querySelectorAll('.pw-field input').forEach((i) => { i.type = 'password'; i.value = ''; });
  form.querySelectorAll('.pw-toggle').forEach((b) => { b.innerHTML = EYE_OPEN; b.setAttribute('aria-label', 'パスワードを表示'); });
}

/* ============================================================
 * 認証
 * ============================================================ */
function setupAuth() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    setMsg('authMsg', '');
    if (!f.email.value || !f.password.value) return setMsg('authMsg', 'メールアドレスとパスワードを入力してください', 'error');
    try {
      await withBusy(f.querySelector('button[type="submit"]'), async () => {
        const r = await api('login', { email: f.email.value, password: f.password.value });
        state.token = r.token;
        state.user = r.user;
        localStorage.setItem(TOKEN_KEY, r.token);
        resetPasswordFields(f);
        showApp();
        if (!r.user.mustChangePassword) toast('ログインしました');
      });
    } catch (err) {
      setMsg('authMsg', err.message, 'error');
    }
  });

  $('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    setMsg('authMsg', '');
    if (!f.nickname.value.trim() || !f.email.value) return setMsg('authMsg', 'ニックネームとメールアドレスを入力してください', 'error');
    try {
      await withBusy(f.querySelector('button[type="submit"]'), async () => {
        const r = await api('register', { email: f.email.value, nickname: f.nickname.value });
        const email = f.email.value;
        f.reset();
        switchTab('login');
        $('loginForm').email.value = email;
        setMsg('authMsg', r.message, 'ok');
      });
    } catch (err) {
      setMsg('authMsg', err.message, 'error');
    }
  });

  $('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    setMsg('authMsg', '');
    if (!f.email.value) return setMsg('authMsg', 'メールアドレスを入力してください', 'error');
    try {
      await withBusy(f.querySelector('button[type="submit"]'), async () => {
        const r = await api('resetPassword', { email: f.email.value });
        const email = f.email.value;
        f.reset();
        switchTab('login');
        $('loginForm').email.value = email;
        setMsg('authMsg', r.message, 'ok');
      });
    } catch (err) {
      setMsg('authMsg', err.message, 'error');
    }
  });

  $('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const cur = f.currentPassword.value;
    const next = f.newPassword.value;
    const conf = f.confirmPassword.value;
    if (!cur || !next) return setMsg('pwMsg', 'すべての欄を入力してください', 'error');
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
      return setMsg('pwMsg', '新しいパスワードは英字と数字を含む8文字以上にしてください', 'error');
    }
    if (next !== conf) return setMsg('pwMsg', '確認用のパスワードが一致しません', 'error');
    try {
      await withBusy(f.querySelector('button[type="submit"]'), async () => {
        const r = await api('changePassword', { currentPassword: cur, newPassword: next });
        state.token = r.token;
        state.user = r.user;
        localStorage.setItem(TOKEN_KEY, r.token);
        resetPasswordFields(f);
        showApp();
        toast(r.message || 'パスワードを変更しました');
      });
    } catch (err) {
      setMsg('pwMsg', err.message, 'error');
    }
  });

  $('logoutBtn').addEventListener('click', logout);
  $('pwLogoutBtn').addEventListener('click', logout);
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  setMsg('authMsg', '');
}

async function logout() {
  try { await api('logout'); } catch (_) { /* 無視 */ }
  state.token = '';
  state.user = null;
  localStorage.removeItem(TOKEN_KEY);
  resetPasswordFields($('pwForm'));
  showAuth();
  switchTab('login');
}

async function restoreSession() {
  if (!state.token) return showAuth();
  try {
    const r = await api('verify');
    state.user = r.user;
    showApp();
  } catch (_) {
    localStorage.removeItem(TOKEN_KEY);
    state.token = '';
    showAuth();
  }
}

/* ============================================================
 * 参加者入力
 * ============================================================ */
function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (_) { saved = null; }
  state.categories = DEFAULT_CATEGORIES.map((c) => {
    const s = saved && saved.categories ? saved.categories.find((x) => x.key === c.key) : null;
    return s ? { ...c, mode: s.mode, value: Number(s.value), count: Number(s.count) } : { ...c };
  });
  if (saved) {
    if (saved.total) $('totalInput').value = saved.total;
    if (saved.unit) $('unitSelect').value = saved.unit;
    if (saved.method) $('methodSelect').value = saved.method;
    if (saved.organizer) $('organizerInput').value = saved.organizer;
  }
}

function saveSettings() {
  const data = {
    total: $('totalInput').value,
    unit: $('unitSelect').value,
    method: $('methodSelect').value,
    organizer: $('organizerInput').value,
    categories: state.categories.map(({ key, mode, value, count }) => ({ key, mode, value, count }))
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (_) { /* 容量超過などは無視 */ }
}

function renderMembers() {
  const list = $('membersList');
  list.innerHTML = '';
  state.categories.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'member' + (c.count === 0 ? ' is-empty' : '');

    const name = document.createElement('div');
    name.className = 'member-name';
    name.textContent = c.label;

    const stepper = document.createElement('div');
    stepper.className = 'stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.setAttribute('aria-label', c.label + 'を1人減らす');
    const out = document.createElement('output');
    out.textContent = c.count;
    out.setAttribute('aria-label', c.label + 'の人数');
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', c.label + 'を1人増やす');
    minus.addEventListener('click', () => changeCount(i, -1, out, row));
    plus.addEventListener('click', () => changeCount(i, 1, out, row));
    stepper.append(minus, out, plus);

    const modeWrap = document.createElement('div');
    modeWrap.className = 'member-mode';
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', c.label + 'の負担方法');
    sel.innerHTML = '<option value="ratio">比率で分ける</option><option value="fixed">定額にする</option>';
    sel.value = c.mode;
    modeWrap.appendChild(sel);

    const valWrap = document.createElement('div');
    valWrap.className = 'member-value';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.setAttribute('aria-label', c.label + 'の値');
    const unit = document.createElement('span');
    unit.className = 'unit';
    const syncMode = () => {
      if (c.mode === 'ratio') {
        input.step = '0.1';
        input.inputMode = 'decimal';
        unit.textContent = '倍';
      } else {
        input.step = '100';
        input.inputMode = 'numeric';
        unit.textContent = '円/人';
      }
      input.value = c.value;
    };
    syncMode();
    sel.addEventListener('change', () => {
      c.mode = sel.value;
      c.value = c.mode === 'ratio' ? 1 : 0;
      syncMode();
      saveSettings();
    });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      c.value = Number.isFinite(v) && v >= 0 ? v : 0;
      saveSettings();
    });
    valWrap.append(input, unit);

    row.append(name, stepper, modeWrap, valWrap);
    list.appendChild(row);
  });
  updateHeadcount();
}

function changeCount(i, delta, out, row) {
  const c = state.categories[i];
  c.count = Math.max(0, Math.min(99, c.count + delta));
  out.textContent = c.count;
  row.classList.toggle('is-empty', c.count === 0);
  updateHeadcount();
  saveSettings();
}

function updateHeadcount() {
  $('headcount').textContent = state.categories.reduce((s, c) => s + c.count, 0);
}

/* ============================================================
 * 計算ロジック
 * ============================================================ */
function roundTo(value, unit, method) {
  const q = value / unit;
  const eps = 1e-9;
  if (method === 'ceil') return Math.ceil(q - eps) * unit;
  if (method === 'floor') return Math.floor(q + eps) * unit;
  return Math.round(q) * unit;
}

/**
 * 1) 定額の人の合計を総額から引く
 * 2) 残額を「比率×人数」の重みで按分
 * 3) 1人あたりを指定単位で丸める（定額は丸めない）
 * 4) 集まる金額 − 総額 = 端数（＋余り / −不足）
 */
function calculate(total, categories, unit, method) {
  const active = categories.filter((c) => c.count > 0);
  if (!active.length) throw new Error('参加者を1人以上にしてください');

  const fixedTotal = active.filter((c) => c.mode === 'fixed').reduce((s, c) => s + c.value * c.count, 0);
  const remain = total - fixedTotal;
  if (remain < 0) throw new Error('定額の合計（' + yen(fixedTotal) + '）が総額を超えています');

  const weightSum = active.filter((c) => c.mode === 'ratio').reduce((s, c) => s + c.value * c.count, 0);
  if (remain > 0 && weightSum <= 0) {
    throw new Error('残りの ' + yen(remain) + ' を負担する人がいません。「比率」で1以上の区分を設定してください');
  }

  const rows = active.map((c) => {
    const raw = c.mode === 'fixed' ? c.value : (weightSum > 0 ? remain * c.value / weightSum : 0);
    const per = c.mode === 'fixed' ? Math.round(c.value) : roundTo(raw, unit, method);
    return { key: c.key, label: c.label, short: c.short, mode: c.mode, value: c.value, count: c.count, raw, per, subtotal: per * c.count };
  });

  const collected = rows.reduce((s, r) => s + r.subtotal, 0);
  return {
    total, fixedTotal, remain, rows, collected,
    diff: collected - total,
    people: rows.reduce((s, r) => s + r.count, 0)
  };
}

function onCalculate() {
  setMsg('calcMsg', '');
  const total = Math.round(Number($('totalInput').value));
  if (!Number.isFinite(total) || total <= 0) {
    setMsg('calcMsg', '総額を入力してください', 'error');
    $('totalInput').focus();
    return;
  }
  try {
    state.result = calculate(total, state.categories, Number($('unitSelect').value), $('methodSelect').value);
  } catch (err) {
    setMsg('calcMsg', err.message, 'error');
    $('resultBlock').hidden = true;
    $('rouletteBlock').hidden = true;
    return;
  }
  saveSettings();
  renderResult();
  setupWheel();
  $('resultBlock').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function renderResult() {
  const r = state.result;
  $('rTotal').textContent = yen(r.total);
  $('rFixed').textContent = yen(r.fixedTotal);
  $('rRemain').textContent = yen(r.remain);
  $('rCollected').textContent = yen(r.collected);

  const tbody = $('rRows');
  tbody.innerHTML = '';
  r.rows.forEach((row) => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = row.label;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = row.mode === 'fixed' ? '定額' : '×' + row.value;
    tdName.appendChild(tag);
    const tdCount = document.createElement('td');
    tdCount.textContent = row.count + '人';
    const tdPer = document.createElement('td');
    tdPer.className = 'per';
    tdPer.textContent = yen(row.per);
    const tdSub = document.createElement('td');
    tdSub.textContent = yen(row.subtotal);
    tr.append(tdName, tdCount, tdPer, tdSub);
    tbody.appendChild(tr);
  });

  const d = r.diff;
  const diffEl = $('rDiff');
  diffEl.textContent = (d > 0 ? '+' : d < 0 ? '−' : '±') + yen(Math.abs(d));
  diffEl.className = d > 0 ? 'diff-plus' : d < 0 ? 'diff-minus' : '';
  $('rDiffExplain').textContent = d > 0
    ? yen(d) + ' 多く集まります。ルーレットで当たった人が、その分安くなります。'
    : d < 0
      ? yen(-d) + ' 足りません。ルーレットで当たった人が、その分多く払います。'
      : 'ぴったり割り切れました。ルーレットは「今日のラッキーパーソン」決めにどうぞ。';

  $('resultBlock').hidden = false;
  $('rouletteBlock').hidden = false;
  $('winnerBox').hidden = true;
  $('rouletteLead').textContent = d > 0
    ? '余った ' + yen(d) + ' は誰のもの？'
    : d < 0
      ? '足りない ' + yen(-d) + ' は誰が払う？'
      : '端数はゼロ。運試しに回してみましょう。';
}

/* ============================================================
 * ルーレット
 * ============================================================ */
function buildCandidates() {
  const includeFixed = $('includeFixed').checked;
  const list = [];
  state.result.rows.forEach((row) => {
    if (row.mode === 'fixed' && !includeFixed) return;
    for (let i = 1; i <= row.count; i++) {
      list.push({ name: row.count > 1 ? row.short + i : row.short, label: row.label, per: row.per });
    }
  });
  return list;
}

function setupWheel() {
  state.wheel.candidates = buildCandidates();
  state.wheel.rotation = 0;
  $('spinBtn').disabled = state.wheel.candidates.length === 0;
  if (!state.wheel.candidates.length) {
    $('rouletteLead').textContent = 'ルーレットの対象者がいません。「定額の人も対象にする」をオンにしてください。';
  }
  drawWheel();
}

function drawWheel() {
  const canvas = $('wheel');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.round(canvas.getBoundingClientRect().width || 420);
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const items = state.wheel.candidates;
  const c = size / 2;
  const r = c - 2;

  if (!items.length) {
    ctx.fillStyle = '#E4E8EE';
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const seg = (Math.PI * 2) / items.length;
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(state.wheel.rotation);
  items.forEach((item, i) => {
    const start = -Math.PI / 2 + i * seg;
    const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, start, start + seg);
    ctx.closePath();
    ctx.fillStyle = (items.length % WHEEL_COLORS.length === 1 && i === items.length - 1) ? WHEEL_COLORS[2] : color;
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.rotate(start + seg / 2);
    const light = ['#F2B705', '#E8D9A8'].includes(ctx.fillStyle.toUpperCase());
    ctx.fillStyle = light ? '#172843' : '#FFFFFF';
    const fontSize = Math.max(11, Math.min(20, size / (items.length > 12 ? 30 : 22)));
    ctx.font = '700 ' + fontSize + 'px "BIZ UDPGothic", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.name, r - 14, 0);
    ctx.restore();
  });
  ctx.restore();

  // 中心のハブ
  ctx.beginPath();
  ctx.arc(c, c, size * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#23395B';
  ctx.stroke();
}

function secureRandom() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}

let audioCtx = null;
function tick() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 1400;
    g.gain.setValueAtTime(0.06, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.04);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.05);
  } catch (_) { /* 音が出せない環境は無視 */ }
}

function spin() {
  const w = state.wheel;
  if (w.spinning || !w.candidates.length) return;
  w.spinning = true;
  $('spinBtn').disabled = true;
  $('includeFixed').disabled = true;
  $('winnerBox').hidden = true;

  const n = w.candidates.length;
  const seg = (Math.PI * 2) / n;
  const winnerIndex = Math.floor(secureRandom() * n);
  const jitter = (secureRandom() - 0.5) * seg * 0.7;

  // 針（上）が当選セグメントの中央付近を指す角度
  const twoPi = Math.PI * 2;
  const target = (((-(winnerIndex + 0.5) * seg - jitter) % twoPi) + twoPi) % twoPi;
  const startRot = w.rotation;
  const base = startRot - (((startRot % twoPi) + twoPi) % twoPi);
  const finalRot = base + twoPi * 6 + target;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduced ? 300 : 5200;
  const t0 = performance.now();
  let lastSeg = Math.floor(((-startRot % twoPi) + twoPi) % twoPi / seg);

  const frame = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - t, 4);
    w.rotation = startRot + (finalRot - startRot) * eased;
    drawWheel();

    const pointing = Math.floor((((-w.rotation) % twoPi) + twoPi) % twoPi / seg);
    if (pointing !== lastSeg) { lastSeg = pointing; if (!reduced) tick(); }

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      w.spinning = false;
      $('spinBtn').disabled = false;
      $('includeFixed').disabled = false;
      announceWinner(w.candidates[winnerIndex]);
    }
  };
  requestAnimationFrame(frame);
}

function announceWinner(winner) {
  const r = state.result;
  const pay = winner.per - r.diff;
  $('winnerName').textContent = winner.name + ' さん！';
  let text;
  if (r.diff > 0) {
    text = pay >= 0
      ? '支払いは ' + yen(winner.per) + ' → ' + yen(pay) + '（' + yen(r.diff) + ' おトク）'
      : '支払いは0円、さらに ' + yen(-pay) + ' 受け取り（' + yen(r.diff) + ' おトク）';
  } else if (r.diff < 0) {
    text = '支払いは ' + yen(winner.per) + ' → ' + yen(pay) + '（' + yen(-r.diff) + ' 多めに）';
  } else {
    text = '今日のラッキーパーソンです。支払いは ' + yen(winner.per) + ' のまま';
  }
  $('winnerPay').textContent = text;
  $('winnerBox').hidden = false;
  confetti();
  if (navigator.vibrate) navigator.vibrate([60, 40, 120]);

  openAi('roulette', {
    winner: winner.name + '（' + winner.label + '）',
    winnerPay: pay,
    diff: r.diff,
    people: r.people,
    total: r.total,
    organizer: $('organizerInput').value.trim()
  });
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('confetti');
  box.innerHTML = '';
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('i');
    p.style.left = (secureRandom() * 100) + 'vw';
    p.style.background = WHEEL_COLORS[i % WHEEL_COLORS.length];
    p.style.animationDelay = (secureRandom() * 0.5) + 's';
    p.style.animationDuration = (1.4 + secureRandom() * 1.2) + 's';
    box.appendChild(p);
  }
  setTimeout(() => { box.innerHTML = ''; }, 3200);
}

/* ============================================================
 * AIコメント
 * ============================================================ */
async function openAi(kind, payload) {
  const modal = $('aiModal');
  const text = $('aiText');
  text.textContent = 'AI司会がコメントを考えています…';
  text.classList.add('is-loading');
  modal.hidden = false;
  try {
    const r = await api('aiComment', { kind, payload });
    text.textContent = r.comment + (r.note ? '\n（' + r.note + '）' : '');
  } catch (err) {
    text.textContent = 'コメントを取得できませんでした：' + err.message;
  } finally {
    text.classList.remove('is-loading');
    $('aiCloseBtn').focus();
  }
}

function onAiResult() {
  const r = state.result;
  if (!r) return;
  openAi('result', {
    total: r.total,
    people: r.people,
    diff: r.diff,
    organizer: $('organizerInput').value.trim(),
    rows: r.rows.map((x) => ({ label: x.label, count: x.count, per: x.per }))
  });
}

/* ============================================================
 * 起動
 * ============================================================ */
function init() {
  if (!GAS_URL_READY) {
    console.warn('config.js の GAS_URL を設定してください');
  }
  setupPasswordToggles();
  setupAuth();
  loadSettings();
  renderMembers();

  $('calcBtn').addEventListener('click', onCalculate);
  $('totalInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') onCalculate(); });
  ['totalInput', 'unitSelect', 'methodSelect', 'organizerInput'].forEach((id) => {
    $(id).addEventListener('change', saveSettings);
  });
  $('spinBtn').addEventListener('click', spin);
  $('includeFixed').addEventListener('change', () => {
    if (!state.result) return;
    $('winnerBox').hidden = true;
    renderResultLeadOnly();
    setupWheel();
  });
  $('aiResultBtn').addEventListener('click', onAiResult);
  $('aiCloseBtn').addEventListener('click', () => { $('aiModal').hidden = true; });
  $('aiModal').addEventListener('click', (e) => { if (e.target.id === 'aiModal') $('aiModal').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('aiModal').hidden = true; });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!$('rouletteBlock').hidden) drawWheel(); }, 150);
  });

  restoreSession();
}

function renderResultLeadOnly() {
  const d = state.result.diff;
  $('rouletteLead').textContent = d > 0
    ? '余った ' + yen(d) + ' は誰のもの？'
    : d < 0
      ? '足りない ' + yen(-d) + ' は誰が払う？'
      : '端数はゼロ。運試しに回してみましょう。';
}

document.addEventListener('DOMContentLoaded', init);
