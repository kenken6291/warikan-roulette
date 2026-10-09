/* ワリカン・ルーレット フロントエンド */
'use strict';

/* バージョン表記（更新時はここと index.html の ?v= をそろえて上げる） */
const APP_VERSION = '1.4.0';
const APP_UPDATED = '2026-10-09';

/* GASのURLは config.js で設定 */
const GAS_URL = (window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '';
const GAS_URL_READY = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(GAS_URL) && !GAS_URL.includes('YOUR_DEPLOYMENT_ID');

const TOKEN_KEY = 'warikan_token';
const SETTINGS_KEY = 'warikan_settings_v2';

// step: 1=金額が決まってる人 / 2=女性の頭割り / 3=残りを男性で割る（入力・表示の順番）
const DEFAULT_CATEGORIES = [
  { key: 'guestM',  step: 1, icon: '🤵', label: '主賓（男性）',   short: '主賓男性', mode: 'fixed', value: 0,     count: 0 },
  { key: 'guestF',  step: 1, icon: '👑', label: '主賓（女性）',   short: '主賓女性', mode: 'fixed', value: 0,     count: 0 },
  { key: 'inviteM', step: 1, icon: '🎩', label: '招待客（男性）', short: '招待男性', mode: 'fixed', value: 0,     count: 0 },
  { key: 'inviteF', step: 1, icon: '💐', label: '招待客（女性）', short: '招待女性', mode: 'fixed', value: 0,     count: 0 },
  { key: 'seniorM', step: 1, icon: '👴', label: '年長者（男性）', short: '年長男性', mode: 'fixed', value: 10000, count: 0 },
  { key: 'seniorF', step: 1, icon: '👵', label: '年長者（女性）', short: '年長女性', mode: 'fixed', value: 10000, count: 0 },
  { key: 'female',  step: 2, icon: '🙋‍♀️', label: '女性',         short: '女性',     mode: 'fixed', value: 3000,  count: 2 },
  { key: 'male',    step: 3, icon: '🙋‍♂️', label: '男性',         short: '男性',     mode: 'ratio', value: 1,     count: 2 }
];
const QUICK_AMOUNTS = [0, 3000, 5000, 10000];

const WHEEL_COLORS = ['#FF8A3D', '#2EC4A0', '#FFD23F', '#FF6F91', '#5B8DEF', '#B48CF2', '#FFB4A2', '#7BD389'];
const WHEEL_INK = '#2B2D42';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,
  pwMode: 'initial', // 'initial'=初期設定 / 'change'=任意の変更
  categories: [],
  result: null,
  wheel: { rotation: 0, spinning: false, candidates: [] }
};

const $ = (id) => document.getElementById(id);
const yen = (n) => Math.round(n).toLocaleString('ja-JP') + '円';
const getRadio = (name) => {
  const el = document.querySelector('input[name="' + name + '"]:checked');
  return el ? el.value : '';
};
const setRadio = (name, value) => {
  const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
  if (el) el.checked = true;
};

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
  if (state.user && state.user.mustChangePassword) {
    openPwModal('initial');
  } else {
    closePwModal();
  }
}

/* パスワードモーダル：initial=初回ログイン時の設定 / change=ログイン中の変更 */
function openPwModal(mode) {
  state.pwMode = mode;
  const initial = mode === 'initial';
  const f = $('pwForm');
  resetPasswordFields(f);
  $('pwModalTitle').textContent = initial ? 'パスワードを設定してください' : 'パスワードを変更する';
  $('pwModalNote').textContent = initial
    ? 'これからログインに使うパスワードを決めてください。英字と数字を含む8文字以上です。'
    : '現在のパスワードと、新しいパスワードを入力してください。';
  $('pwCurrentField').hidden = initial;
  f.currentPassword.required = !initial;
  $('pwSubmitBtn').textContent = initial ? 'パスワードを設定する' : 'パスワードを変更する';
  $('pwCancelBtn').hidden = initial;
  $('pwLogoutBtn').hidden = !initial;
  setMsg('pwMsg', '');
  updatePwRules();
  $('pwModal').hidden = false;
  setTimeout(() => (initial ? f.newPassword : f.currentPassword).focus(), 50);
}

function closePwModal() {
  $('pwModal').hidden = true;
  resetPasswordFields($('pwForm'));
}

function updatePwRules() {
  const f = $('pwForm');
  const v = f.newPassword.value;
  const checks = {
    len: v.length >= 8,
    alpha: /[A-Za-z]/.test(v),
    digit: /[0-9]/.test(v),
    match: v.length > 0 && v === f.confirmPassword.value
  };
  document.querySelectorAll('#pwRules li').forEach((li) => {
    li.classList.toggle('is-ok', !!checks[li.dataset.rule]);
  });
  return checks;
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
    const initial = state.pwMode === 'initial';
    const cur = f.currentPassword.value;
    const next = f.newPassword.value;
    const checks = updatePwRules();
    if (!initial && !cur) return setMsg('pwMsg', '現在のパスワードを入力してください', 'error');
    if (!next) return setMsg('pwMsg', '新しいパスワードを入力してください', 'error');
    if (!checks.len || !checks.alpha || !checks.digit) {
      return setMsg('pwMsg', '新しいパスワードは英字と数字を含む8文字以上にしてください', 'error');
    }
    if (!checks.match) return setMsg('pwMsg', '確認用のパスワードが一致しません', 'error');
    try {
      await withBusy($('pwSubmitBtn'), async () => {
        const payload = initial ? { newPassword: next } : { currentPassword: cur, newPassword: next };
        const r = await api('changePassword', payload);
        state.token = r.token;
        state.user = r.user;
        localStorage.setItem(TOKEN_KEY, r.token);
        closePwModal();
        showApp();
        toast(r.message || (initial ? 'パスワードを設定しました' : 'パスワードを変更しました'));
      });
    } catch (err) {
      setMsg('pwMsg', err.message, 'error');
    }
  });

  ['newPassword', 'confirmPassword'].forEach((name) => {
    $('pwForm')[name].addEventListener('input', updatePwRules);
  });
  $('changePwBtn').addEventListener('click', () => openPwModal('change'));
  $('pwCancelBtn').addEventListener('click', closePwModal);

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
  closePwModal();
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
    if (saved.unit) setRadio('unit', saved.unit);
    if (saved.method) setRadio('method', saved.method);
    if (saved.organizer) $('organizerInput').value = saved.organizer;
  }
}

function saveSettings() {
  const data = {
    total: $('totalInput').value,
    unit: getRadio('unit'),
    method: getRadio('method'),
    organizer: $('organizerInput').value,
    categories: state.categories.map(({ key, mode, value, count }) => ({ key, mode, value, count }))
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (_) { /* 容量超過などは無視 */ }
}

function renderMembers() {
  [1, 2, 3].forEach((n) => { $('step' + n + 'List').innerHTML = ''; });
  state.categories.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'member' + (c.count === 0 ? ' is-empty' : '');

    const icon = document.createElement('div');
    icon.className = 'member-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = c.icon;

    const name = document.createElement('div');
    name.className = 'member-name';
    name.textContent = c.label;

    // 人数
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
    plus.className = 'plus';
    plus.textContent = '+';
    plus.setAttribute('aria-label', c.label + 'を1人増やす');
    minus.addEventListener('click', () => changeCount(i, -1, out, row));
    plus.addEventListener('click', () => changeCount(i, 1, out, row));
    stepper.append(minus, out, plus);

    // 比率／定額 切り替え
    const toggle = document.createElement('div');
    toggle.className = 'mode-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', c.label + 'の負担方法');
    const btnRatio = document.createElement('button');
    btnRatio.type = 'button';
    btnRatio.textContent = '比率';
    const btnFixed = document.createElement('button');
    btnFixed.type = 'button';
    btnFixed.textContent = '定額';
    toggle.append(btnRatio, btnFixed);

    // 値
    const valWrap = document.createElement('div');
    valWrap.className = 'member-value';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.setAttribute('aria-label', c.label + 'の値');
    const unit = document.createElement('span');
    unit.className = 'unit';
    valWrap.append(input, unit);

    // 定額のクイック入力
    const quick = document.createElement('div');
    quick.className = 'quick-amounts';
    QUICK_AMOUNTS.forEach((amt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = amt === 0 ? '0円' : amt.toLocaleString('ja-JP') + '円';
      b.setAttribute('aria-label', c.label + 'を1人' + amt + '円にする');
      b.addEventListener('click', () => {
        c.value = amt;
        input.value = amt;
        saveSettings();
        updatePreview();
      });
      quick.appendChild(b);
    });

    const syncMode = () => {
      const ratio = c.mode === 'ratio';
      row.classList.toggle('is-ratio', ratio);
      btnRatio.setAttribute('aria-pressed', String(ratio));
      btnFixed.setAttribute('aria-pressed', String(!ratio));
      input.step = ratio ? '0.1' : '100';
      input.inputMode = ratio ? 'decimal' : 'numeric';
      unit.textContent = ratio ? '倍' : '円/人';
      input.value = c.value;
    };
    const setMode = (mode) => {
      if (c.mode === mode) return;
      c.mode = mode;
      c.value = mode === 'ratio' ? 1 : 0;
      syncMode();
      saveSettings();
      updatePreview();
    };
    btnRatio.addEventListener('click', () => setMode('ratio'));
    btnFixed.addEventListener('click', () => setMode('fixed'));
    input.addEventListener('input', () => {
      const v = Number(input.value);
      c.value = Number.isFinite(v) && v >= 0 ? v : 0;
      saveSettings();
      updatePreview();
    });
    syncMode();

    const controls = document.createElement('div');
    controls.className = 'member-controls';
    controls.append(toggle, valWrap);

    row.append(icon, name, stepper, controls, quick);
    $('step' + c.step + 'List').appendChild(row);
  });
  updateHeadcount();
}

function changeCount(i, delta, out, row) {
  const c = state.categories[i];
  const before = c.count;
  c.count = Math.max(0, Math.min(99, c.count + delta));
  if (c.count === before) return;
  out.textContent = c.count;
  out.classList.remove('bump');
  void out.offsetWidth; // アニメーション再生用
  out.classList.add('bump');
  row.classList.toggle('is-empty', c.count === 0);
  updateHeadcount();
  saveSettings();
  updatePreview();
}

/* 各ステップの下に「ここまでの残り」を表示 */
function updatePreview() {
  const total = Math.round(Number($('totalInput').value));
  const foots = [1, 2, 3].map((n) => $('step' + n + 'Foot'));
  foots.forEach((f) => { f.classList.remove('is-error'); f.innerHTML = ''; });
  if (!Number.isFinite(total) || total <= 0) {
    foots[0].textContent = '💡 お会計の総額を入れると、ここに残りの金額が出ます';
    return;
  }

  const fixedOf = (step) => state.categories
    .filter((c) => c.step === step && c.count > 0 && c.mode === 'fixed')
    .reduce((sum, c) => sum + c.value * c.count, 0);
  const span = (cls, text) => '<span class="' + cls + '">' + text + '</span>';
  const money = (n) => span('big' + (n < 0 ? ' minus' : ''), (n < 0 ? '−' : '') + yen(Math.abs(n)));
  const arrow = span('step-arrow', '→');

  // STEP1
  const fixed1 = fixedOf(1);
  const rem1 = total - fixed1;
  foots[0].innerHTML = '定額の合計 ' + yen(fixed1) + arrow + '残り ' + money(rem1);
  if (rem1 < 0) foots[0].classList.add('is-error');

  // STEP2
  const female = state.categories.filter((c) => c.step === 2);
  const femaleCount = female.reduce((sum, c) => sum + c.count, 0);
  const fixed2 = fixedOf(2);
  const rem2 = rem1 - fixed2;
  if (femaleCount === 0) {
    foots[1].innerHTML = '女性はいません' + arrow + '残り ' + money(rem2);
  } else if (female.every((c) => c.mode === 'fixed' || c.count === 0)) {
    foots[1].innerHTML = '女性の合計 ' + yen(fixed2) + arrow + '残り ' + money(rem2);
  } else {
    foots[1].innerHTML = '女性は「比率」なので、男性と一緒に残り ' + money(rem2) + ' を分けます';
  }
  if (rem2 < 0) foots[1].classList.add('is-error');

  // STEP3：実際の計算結果（丸め後）をプレビュー
  try {
    const r = calculate(total, state.categories, Number(getRadio('unit')), getRadio('method'));
    const ratioRows = r.rows.filter((x) => x.mode === 'ratio');
    if (!ratioRows.length) {
      foots[2].innerHTML = '残りを割る人がいません。男性の人数を入れてください';
      if (r.remain > 0) foots[2].classList.add('is-error');
      return;
    }
    foots[2].innerHTML = ratioRows.map((x) =>
      '<div class="preview-row"><span>' + x.icon + ' ' + x.label + ' 1人あたり</span><span>' +
      money(x.per) + ' ' + span('preview-raw', '（丸める前 約' + yen(x.raw) + '）') + '</span></div>'
    ).join('');
  } catch (err) {
    foots[2].textContent = '⚠️ ' + err.message;
    foots[2].classList.add('is-error');
  }
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
    return { key: c.key, icon: c.icon, label: c.label, short: c.short, mode: c.mode, value: c.value, count: c.count, raw, per, subtotal: per * c.count };
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
    state.result = calculate(total, state.categories, Number(getRadio('unit')), getRadio('method'));
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
    const rowIcon = document.createElement('span');
    rowIcon.className = 'row-icon';
    rowIcon.setAttribute('aria-hidden', 'true');
    rowIcon.textContent = row.icon;
    tdName.append(rowIcon, document.createTextNode(row.label));
    const tag = document.createElement('span');
    tag.className = 'tag' + (row.mode === 'fixed' ? ' fixed' : '');
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

  const block = $('resultBlock');
  block.hidden = false;
  block.classList.remove('is-new');
  void block.offsetWidth;
  block.classList.add('is-new');
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
      list.push({ name: row.count > 1 ? row.short + i : row.short, icon: row.icon, label: row.label, per: row.per });
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
  const size = Math.round(canvas.getBoundingClientRect().width || 400);
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const items = state.wheel.candidates;
  const c = size / 2;
  const r = c;

  if (!items.length) {
    ctx.fillStyle = '#E9EDF2';
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const n = items.length;
  const seg = (Math.PI * 2) / n;
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(state.wheel.rotation);
  items.forEach((item, i) => {
    const start = -Math.PI / 2 + i * seg;
    // 最後と最初が同じ色にならないように調整
    let color = WHEEL_COLORS[i % WHEEL_COLORS.length];
    if (n > 1 && i === n - 1 && (n - 1) % WHEEL_COLORS.length === 0) color = WHEEL_COLORS[2];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, start, start + seg);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = WHEEL_INK;
    ctx.lineWidth = 3;
    ctx.stroke();

    // 名前（アイコン＋名前）
    ctx.save();
    ctx.rotate(start + seg / 2);
    const fontSize = Math.max(11, Math.min(19, size / (n > 12 ? 30 : n > 8 ? 25 : 21)));
    ctx.font = '700 ' + fontSize + 'px "Zen Maru Gothic", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const label = (n <= 12 ? item.icon + ' ' : '') + item.name;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineJoin = 'round';
    ctx.strokeText(label, r - 16, 0);
    ctx.fillStyle = WHEEL_INK;
    ctx.fillText(label, r - 16, 0);
    ctx.restore();
  });
  ctx.restore();
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
  $('winnerName').textContent = winner.icon + ' ' + winner.name + ' さん！';
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
  text.textContent = 'AI司会がネタを考え中';
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
  $('appVersion').textContent = 'v' + APP_VERSION + '（' + APP_UPDATED.replace(/-/g, '.') + ' 更新）';
  if (!GAS_URL_READY) {
    console.warn('config.js の GAS_URL を設定してください');
  }
  setupPasswordToggles();
  setupAuth();
  loadSettings();
  renderMembers();
  updatePreview();

  $('calcBtn').addEventListener('click', onCalculate);
  $('totalInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') onCalculate(); });
  ['totalInput', 'organizerInput'].forEach((id) => {
    $(id).addEventListener('change', saveSettings);
  });
  $('totalInput').addEventListener('input', updatePreview);
  document.querySelectorAll('input[name="unit"], input[name="method"]').forEach((r) => {
    r.addEventListener('change', () => { saveSettings(); updatePreview(); });
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
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    $('aiModal').hidden = true;
    if (state.pwMode === 'change' && !$('pwModal').hidden) closePwModal();
  });

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
