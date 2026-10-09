/* ワリカン・ルーレット フロントエンド */
'use strict';

/* バージョン表記（更新時はここと index.html の ?v= をそろえて上げる） */
const APP_VERSION = '1.8.0';
const APP_UPDATED = '2026-10-09';

/* GASのURLは config.js で設定 */
const GAS_URL = (window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '';
const GAS_URL_READY = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(GAS_URL) && !GAS_URL.includes('YOUR_DEPLOYMENT_ID');

const TOKEN_KEY = 'warikan_token';
const SETTINGS_KEY = 'warikan_settings_v2';

// step: 1=金額が決まってる人 / 2=若手の頭割り（若手女性→若手男性） / 3=女性の頭割り / 4=残りを男性で割る
// 並び順＝入力・伝票・ルーレットの表示順
const DEFAULT_CATEGORIES = [
  { key: 'guestM',  step: 1, icon: '🤵', label: '主賓（男性）',   short: '主賓男性', mode: 'fixed', value: 0,     count: 0 },
  { key: 'guestF',  step: 1, icon: '👑', label: '主賓（女性）',   short: '主賓女性', mode: 'fixed', value: 0,     count: 0 },
  { key: 'inviteM', step: 1, icon: '🎩', label: '招待客（男性）', short: '招待男性', mode: 'fixed', value: 0,     count: 0 },
  { key: 'inviteF', step: 1, icon: '💐', label: '招待客（女性）', short: '招待女性', mode: 'fixed', value: 0,     count: 0 },
  { key: 'seniorM', step: 1, icon: '👴', label: '年長者（男性）', short: '年長男性', mode: 'fixed', value: 10000, count: 0 },
  { key: 'seniorF', step: 1, icon: '👵', label: '年長者（女性）', short: '年長女性', mode: 'fixed', value: 10000, count: 0 },
  { key: 'youngF',  step: 2, icon: '💁‍♀️', label: '若手（女性）', short: '若手女性', mode: 'fixed', value: 2000, count: 0, quick: [0, 1000, 2000, 3000] },
  { key: 'youngM',  step: 2, icon: '💁‍♂️', label: '若手（男性）', short: '若手男性', mode: 'fixed', value: 2000, count: 0, quick: [0, 1000, 2000, 3000] },
  { key: 'female',  step: 3, icon: '🙋‍♀️', label: '女性',         short: '女性',     mode: 'fixed', value: 3000,  count: 2 },
  { key: 'male',    step: 4, icon: '🙋‍♂️', label: '男性',         short: '男性',     mode: 'ratio', value: 1,     count: 2 }
];
const STEPS = [1, 2, 3, 4];
const QUICK_AMOUNTS = [0, 3000, 5000, 10000];

const WHEEL_COLORS = ['#FF8A3D', '#2EC4A0', '#FFD23F', '#FF6F91', '#5B8DEF', '#B48CF2', '#FFB4A2', '#7BD389'];
const WHEEL_INK = '#2B2D42';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,
  pwMode: 'initial', // 'initial'=初期設定 / 'change'=任意の変更
  categories: [],
  result: null,
  aiProposal: null,
  wheel: { rotation: 0, spinning: false, candidates: [], all: [], mode: 'unit', plan: [], hitIndex: 0, winners: [], done: false }
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
    if (saved.rouletteMode) setRadio('rouletteMode', saved.rouletteMode);
  }
}

function saveSettings() {
  const data = {
    total: $('totalInput').value,
    unit: getRadio('unit'),
    method: getRadio('method'),
    organizer: $('organizerInput').value,
    rouletteMode: getRadio('rouletteMode'),
    categories: state.categories.map(({ key, mode, value, count }) => ({ key, mode, value, count }))
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (_) { /* 容量超過などは無視 */ }
}

function renderMembers() {
  STEPS.forEach((n) => { $('step' + n + 'List').innerHTML = ''; });
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
    (c.quick || QUICK_AMOUNTS).forEach((amt) => {
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
const STEP_GROUP_NAMES = { 2: '若手', 3: '女性' };

function updatePreview() {
  const total = Math.round(Number($('totalInput').value));
  const foots = STEPS.map((n) => $('step' + n + 'Foot'));
  foots.forEach((f) => { f.classList.remove('is-error'); f.innerHTML = ''; });
  if (!Number.isFinite(total) || total <= 0) {
    foots[0].textContent = '💡 支払合計を入れると、ここに残りの金額が出ます';
    return;
  }

  const span = (cls, text) => '<span class="' + cls + '">' + text + '</span>';
  const money = (n) => span('big' + (n < 0 ? ' minus' : ''), (n < 0 ? '−' : '') + yen(Math.abs(n)));
  const arrow = span('step-arrow', '→');

  // STEP1〜3：定額を順番に引いていく
  let rem = total;
  for (let step = 1; step <= 3; step++) {
    const cats = state.categories.filter((c) => c.step === step);
    const active = cats.filter((c) => c.count > 0);
    const fixed = active.filter((c) => c.mode === 'fixed').reduce((sum, c) => sum + c.value * c.count, 0);
    const ratio = active.filter((c) => c.mode === 'ratio');
    rem -= fixed;
    const foot = foots[step - 1];
    const name = STEP_GROUP_NAMES[step];

    if (step === 1) {
      foot.innerHTML = '定額の合計 ' + yen(fixed) + arrow + '残り ' + money(rem);
    } else if (!active.length) {
      foot.innerHTML = name + 'はいません' + arrow + '残り ' + money(rem);
    } else if (!ratio.length) {
      foot.innerHTML = name + 'の合計 ' + yen(fixed) + arrow + '残り ' + money(rem);
    } else {
      const who = ratio.map((c) => c.label).join('・');
      foot.innerHTML = (fixed > 0 ? name + '（定額）の合計 ' + yen(fixed) + arrow + '残り ' + money(rem) + '<br>' : '') +
        who + 'は「比率」なので、残り ' + money(rem) + ' を男性たちと一緒に分けます';
    }
    if (rem < 0) foot.classList.add('is-error');
  }

  // STEP4：実際の計算結果（丸め後）をプレビュー
  const last = foots[3];
  try {
    const r = calculate(total, state.categories, Number(getRadio('unit')), getRadio('method'));
    const ratioRows = r.rows.filter((x) => x.mode === 'ratio');
    if (!ratioRows.length) {
      last.innerHTML = '残りを割る人がいません。男性の人数を入れてください';
      if (r.remain > 0) last.classList.add('is-error');
      return;
    }
    last.innerHTML = ratioRows.map((x) =>
      '<div class="preview-row"><span>' + x.icon + ' ' + x.label + ' 1人あたり</span><span>' +
      money(x.per) + ' ' + span('preview-raw', '（丸める前 約' + yen(x.raw) + '）') + '</span></div>'
    ).join('');
  } catch (err) {
    last.textContent = '⚠️ ' + err.message;
    last.classList.add('is-error');
  }
}

/* ============================================================
 * 「どんな会？」の音声入力・AI整理
 * ============================================================ */
const VOICE_MAX_SECONDS = 90;
const voice = { recorder: null, stream: null, chunks: [], timer: null, startedAt: 0, mode: 'voice', raw: '', organized: '' };

function setVoiceStatus(text, isError) {
  const el = $('voiceStatus');
  el.textContent = text || '';
  el.classList.toggle('is-error', !!isError);
}

function pickAudioMime() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return list.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

async function toggleRecording() {
  if (voice.recorder && voice.recorder.state === 'recording') {
    voice.recorder.stop();
    return;
  }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    setVoiceStatus('このブラウザは録音に対応していません。文字で入力して「AIで整理」を使ってください', true);
    return;
  }
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setVoiceStatus('マイクが使えません。ブラウザの設定でマイクを許可してください', true);
    return;
  }
  const mime = pickAudioMime();
  voice.chunks = [];
  voice.recorder = mime ? new MediaRecorder(voice.stream, { mimeType: mime }) : new MediaRecorder(voice.stream);
  voice.recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) voice.chunks.push(e.data); });
  voice.recorder.addEventListener('stop', onRecordingStop);
  voice.recorder.start();
  voice.startedAt = Date.now();

  $('micBtn').setAttribute('aria-pressed', 'true');
  $('micBtn').textContent = '⏹ 止める';
  $('organizeBtn').disabled = true;
  $('voicePanel').hidden = true;
  const tickTimer = () => {
    const sec = Math.floor((Date.now() - voice.startedAt) / 1000);
    setVoiceStatus('🔴 録音中… ' + sec + '秒（最大' + VOICE_MAX_SECONDS + '秒）　話し終えたら「止める」');
    if (sec >= VOICE_MAX_SECONDS && voice.recorder.state === 'recording') voice.recorder.stop();
  };
  tickTimer();
  voice.timer = setInterval(tickTimer, 500);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('音声の読み込みに失敗しました'));
    r.readAsDataURL(blob);
  });
}

async function onRecordingStop() {
  clearInterval(voice.timer);
  if (voice.stream) voice.stream.getTracks().forEach((t) => t.stop());
  $('micBtn').setAttribute('aria-pressed', 'false');
  $('micBtn').textContent = '🎤 話して入力';

  const type = (voice.recorder.mimeType || 'audio/webm').split(';')[0];
  const blob = new Blob(voice.chunks, { type });
  const sec = (Date.now() - voice.startedAt) / 1000;
  if (sec < 1 || blob.size < 1000) {
    setVoiceStatus('録音が短すぎました。もう一度お試しください', true);
    $('organizeBtn').disabled = false;
    return;
  }

  $('micBtn').disabled = true;
  setVoiceStatus('🤖 AIが聞き取って整理しています…');
  try {
    const audio = await blobToBase64(blob);
    const r = await api('aiNote', { audio, mimeType: type });
    showVoicePanel('voice', r.transcript, r.organized);
    setVoiceStatus('');
  } catch (err) {
    setVoiceStatus(err.message, true);
  } finally {
    $('micBtn').disabled = false;
    $('organizeBtn').disabled = false;
  }
}

async function organizeTypedNote() {
  const text = $('aiNote').value.trim();
  if (!text) {
    setVoiceStatus('先に文字を入れるか、「話して入力」を使ってください', true);
    $('aiNote').focus();
    return;
  }
  $('micBtn').disabled = true;
  try {
    await withBusy($('organizeBtn'), async () => {
      setVoiceStatus('🤖 AIが整理しています…');
      const r = await api('aiNote', { text });
      showVoicePanel('text', text, r.organized);
      setVoiceStatus('');
    });
  } catch (err) {
    setVoiceStatus(err.message, true);
  } finally {
    $('micBtn').disabled = false;
  }
}

function showVoicePanel(mode, raw, organized) {
  voice.mode = mode;
  voice.raw = raw || '';
  voice.organized = organized || '';
  const panel = $('voicePanel');
  panel.classList.toggle('is-text-mode', mode === 'text');
  $('voiceRawHead').textContent = mode === 'text' ? '✏️ いまの文章' : '🎤 聞き取った内容';
  $('voiceRaw').textContent = voice.raw || '（聞き取れませんでした）';
  $('voiceOrganized').textContent = voice.organized || '（整理できませんでした）';
  $('useOrganizedBtn').textContent = mode === 'text' ? '✨ 整理した内容に置き換える' : '✨ 整理した内容を入れる';
  $('useOrganizedBtn').disabled = !voice.organized;
  $('useRawBtn').disabled = !voice.raw;
  panel.hidden = false;
}

/* 音声のときは今の文章の後ろに追加、AI整理のときは置き換え */
function insertNote(text, replace) {
  const area = $('aiNote');
  const cur = area.value.trim();
  const next = (replace || !cur) ? text : cur + '\n' + text;
  area.value = next.slice(0, Number(area.maxLength) > 0 ? Number(area.maxLength) : 400);
  $('voicePanel').hidden = true;
  toast('「どんな会？」に入れました');
  area.focus();
}

/* ============================================================
 * AI割り振り提案
 * ============================================================ */
async function onAiSuggest() {
  setMsg('aiSuggestMsg', '');
  $('aiProposal').hidden = true;
  const total = Math.round(Number($('totalInput').value));
  if (!Number.isFinite(total) || total <= 0) {
    setMsg('aiSuggestMsg', '先に支払合計を入れてください', 'error');
    $('totalInput').focus();
    return;
  }
  const unit = Number(getRadio('unit'));
  const method = getRadio('method');
  if (!unit) {
    setMsg('aiSuggestMsg', '先に集金の単位を選んでください', 'error');
    return;
  }
  try {
    await withBusy($('aiSuggestBtn'), async () => {
      const r = await api('aiAllocate', {
        total, unit, method,
        note: $('aiNote').value.trim(),
        categories: state.categories.map(({ key, count, mode, value }) => ({ key, count, mode, value }))
      });
      state.aiProposal = { ...r.proposal, total, unit, method };
      renderAiProposal();
    });
  } catch (err) {
    setMsg('aiSuggestMsg', err.message, 'error');
  }
}

function mergeProposal(proposal) {
  return state.categories.map((c) => {
    const x = proposal.categories.find((y) => y.key === c.key);
    return x ? { ...c, count: x.count, mode: x.mode, value: x.value } : { ...c };
  });
}

function renderAiProposal() {
  const p = state.aiProposal;
  if (!p) return;
  const cats = mergeProposal(p);
  let r;
  try {
    r = calculate(p.total, cats, p.unit, p.method);
  } catch (err) {
    setMsg('aiSuggestMsg', 'AIの提案では計算できませんでした（' + err.message + '）。もう一度お試しください', 'error');
    return;
  }
  $('aiReason').textContent = p.reason || 'こんな割り振りはいかがでしょう。';

  const tbody = $('aiProposalRows');
  tbody.innerHTML = '';
  r.rows.forEach((row) => {
    const before = state.categories.find((c) => c.key === row.key);
    const changed = !before || before.count !== row.count || before.mode !== row.mode || before.value !== row.value;
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = row.icon + ' ' + row.label;
    const tdCount = document.createElement('td');
    tdCount.textContent = row.count + '人';
    const tdMode = document.createElement('td');
    tdMode.textContent = row.mode === 'fixed' ? '定額' : '×' + row.value;
    const tdPer = document.createElement('td');
    tdPer.className = 'per';
    tdPer.textContent = yen(row.per);
    if (changed) [tdCount, tdMode].forEach((td) => td.classList.add('changed'));
    tr.append(tdName, tdCount, tdMode, tdPer);
    tbody.appendChild(tr);
  });

  const d = r.diff;
  $('aiProposalSum').textContent = '集まる金額 ' + yen(r.collected) + '（ハンパ ' +
    (d > 0 ? '+' : d < 0 ? '−' : '±') + yen(Math.abs(d)) + '）';
  $('aiProposal').hidden = false;
  setMsg('aiSuggestMsg', '提案が届きました。黄色の部分が今の入力から変わるところです', 'ok');
}

function applyAiProposal() {
  const p = state.aiProposal;
  if (!p) return;
  state.categories = mergeProposal(p);
  renderMembers();
  updatePreview();
  saveSettings();
  discardAiProposal();
  toast('AIの提案を入力しました');
  $('h-step1').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function discardAiProposal() {
  state.aiProposal = null;
  $('aiProposal').hidden = true;
  setMsg('aiSuggestMsg', '');
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
    total, fixedTotal, remain, rows, collected, unit, method,
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
    ? yen(d) + ' 多く集まります。ルーレットで当たった人が安くなります（決め方は下で選べます）。'
    : d < 0
      ? yen(-d) + ' 足りません。ルーレットで当たった人が多めに払います（決め方は下で選べます）。'
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

/**
 * 当たりの金額リストを作る
 *  single: ハンパ全額を1人に
 *  unit  : ハンパ ÷ 単位 ＝ 当たり人数（割り切れない分は1人追加）
 */
function buildHitPlan(diff, unit, mode, maxPeople) {
  const abs = Math.abs(diff);
  if (abs === 0) return [0];
  if (mode === 'single' || !unit) return [abs];
  const hits = [];
  const full = Math.floor(abs / unit);
  for (let i = 0; i < full; i++) hits.push(unit);
  const rest = abs - full * unit;
  if (rest > 0) hits.push(rest);
  if (maxPeople > 0 && hits.length > maxPeople) {
    // 対象者より当たりが多いときは、あふれた分を先頭から上乗せ
    const merged = hits.slice(0, maxPeople);
    hits.slice(maxPeople).forEach((amt, i) => { merged[i % maxPeople] += amt; });
    return merged;
  }
  return hits;
}

function setupWheel() {
  const w = state.wheel;
  const r = state.result;
  w.all = buildCandidates();
  w.candidates = w.all.slice();
  w.rotation = 0;
  w.mode = getRadio('rouletteMode') || 'unit';
  w.plan = buildHitPlan(r.diff, r.unit, w.mode, w.all.length);
  w.hitIndex = 0;
  w.winners = [];
  w.done = false;
  $('winnerBox').hidden = true;
  $('winnerList').innerHTML = '';
  renderRoulettePlan();
  updateSpinButton();
  drawWheel();
}

function renderRoulettePlan() {
  const w = state.wheel;
  const r = state.result;
  const el = $('roulettePlan');
  const abs = Math.abs(r.diff);
  const big = (t) => '<span class="big">' + t + '</span>';
  const effect = r.diff > 0 ? 'おトク' : '多めに払う';

  if (!w.all.length) {
    el.textContent = 'ルーレットの対象者がいません。「定額の人も参加させる」をオンにしてください。';
    return;
  }
  if (abs === 0) {
    el.innerHTML = 'ハンパはゼロ。' + big('1人') + 'だけ「今日のラッキーパーソン」を決めます';
    return;
  }
  if (w.plan.length === 1) {
    el.innerHTML = big('1人') + 'が ' + yen(abs) + ' まるごと' + effect + '（1回まわします）';
    return;
  }
  // 金額ごとにまとめて内訳表示
  const groups = [];
  w.plan.forEach((amt) => {
    const g = groups.find((x) => x.amt === amt);
    if (g) g.n++; else groups.push({ amt, n: 1 });
  });
  const detail = groups.map((g) => yen(g.amt) + '×' + g.n + '人').join('＋');
  const head = (w.mode === 'unit' && abs % r.unit === 0 && groups.length === 1)
    ? yen(abs) + ' ÷ ' + yen(r.unit) + ' ＝ '
    : yen(abs) + ' → ';
  el.innerHTML = head + big(w.plan.length + '人') + 'が当たり！' +
    '<br>当たった人は ' + (groups.length === 1 ? '1人 ' + yen(groups[0].amt) + ' ずつ' : detail + ' で') + effect +
    '（' + w.plan.length + '回まわします）';
}

function updateSpinButton() {
  const w = state.wheel;
  const btn = $('spinBtn');
  if (!w.all.length) {
    btn.disabled = true;
    btn.textContent = 'ぐるぐる回す！';
    return;
  }
  btn.disabled = w.spinning;
  if (w.done) {
    btn.textContent = '🔁 もう一度はじめから';
  } else {
    const remaining = w.plan.length - w.hitIndex;
    btn.textContent = w.plan.length > 1
      ? '🎰 回す！（あと' + remaining + '回）'
      : 'ぐるぐる回す！';
  }
}

function onSpinClick() {
  if (state.wheel.done) {
    setupWheel();
    return;
  }
  spin();
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
  document.querySelectorAll('input[name="rouletteMode"]').forEach((x) => { x.disabled = true; });

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
      onHit(winnerIndex);
    }
  };
  requestAnimationFrame(frame);
}

function payText(h) {
  const r = state.result;
  if (r.diff > 0) {
    return h.pay >= 0
      ? yen(h.per) + ' → ' + yen(h.pay) + '（' + yen(h.amount) + ' おトク）'
      : '0円、さらに ' + yen(-h.pay) + ' 受け取り（' + yen(h.amount) + ' おトク）';
  }
  if (r.diff < 0) return yen(h.per) + ' → ' + yen(h.pay) + '（' + yen(h.amount) + ' 多めに）';
  return '今日のラッキーパーソン！支払いは ' + yen(h.per) + ' のまま';
}

function onHit(index) {
  const w = state.wheel;
  const r = state.result;
  const cand = w.candidates[index];
  const amount = w.plan[w.hitIndex];
  const pay = cand.per + (r.diff > 0 ? -amount : r.diff < 0 ? amount : 0);
  const hit = { ...cand, amount, pay };
  w.winners.push(hit);
  w.hitIndex++;
  const multi = w.plan.length > 1;

  // 最新の当たり
  $('winnerLabel').textContent = multi
    ? '🎉 ' + w.hitIndex + '人目の当たり 🎉'
    : '🎉 決まりました 🎉';
  $('winnerName').textContent = hit.icon + ' ' + hit.name + ' さん！';
  $('winnerPay').textContent = payText(hit);
  const box = $('winnerBox');
  box.hidden = true;
  void box.offsetWidth;
  box.hidden = false;

  // 当たり一覧（複数のとき）
  if (multi) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'w-name';
    name.textContent = hit.icon + ' ' + hit.name + ' さん';
    const p = document.createElement('span');
    p.className = 'w-pay';
    p.textContent = payText(hit);
    li.append(name, p);
    $('winnerList').appendChild(li);
  }

  confetti();
  if (navigator.vibrate) navigator.vibrate([60, 40, 120]);

  w.done = w.hitIndex >= w.plan.length;
  if (multi && !w.done) {
    // 当たった人をルーレットから外して、少し見せてから描き直す
    w.candidates.splice(index, 1);
    $('spinBtn').disabled = true;
    setTimeout(() => {
      w.rotation = 0;
      drawWheel();
      updateSpinButton();
    }, 900);
  } else {
    updateSpinButton();
  }

  if (w.done) {
    $('includeFixed').disabled = false;
    document.querySelectorAll('input[name="rouletteMode"]').forEach((x) => { x.disabled = false; });
    openAi('roulette', {
      mode: w.mode,
      unit: r.unit,
      winners: w.winners.map((x) => ({ name: x.name + '（' + x.label + '）', pay: x.pay, amount: x.amount })),
      winner: w.winners[0].name + '（' + w.winners[0].label + '）',
      winnerPay: w.winners[0].pay,
      diff: r.diff,
      people: r.people,
      total: r.total,
      organizer: $('organizerInput').value.trim()
    });
  }
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
  // 支払合計・単位が変わったら、古いAI提案は取り消す
  $('totalInput').addEventListener('input', () => { updatePreview(); if (state.aiProposal) discardAiProposal(); });
  document.querySelectorAll('input[name="unit"], input[name="method"]').forEach((r) => {
    r.addEventListener('change', () => { saveSettings(); updatePreview(); if (state.aiProposal) discardAiProposal(); });
  });
  $('aiSuggestBtn').addEventListener('click', onAiSuggest);
  $('micBtn').addEventListener('click', toggleRecording);
  $('organizeBtn').addEventListener('click', organizeTypedNote);
  $('useOrganizedBtn').addEventListener('click', () => insertNote(voice.organized, voice.mode === 'text'));
  $('useRawBtn').addEventListener('click', () => insertNote(voice.raw, false));
  $('voiceCancelBtn').addEventListener('click', () => { $('voicePanel').hidden = true; });
  $('aiApplyBtn').addEventListener('click', applyAiProposal);
  $('aiDiscardBtn').addEventListener('click', discardAiProposal);
  $('spinBtn').addEventListener('click', onSpinClick);
  document.querySelectorAll('input[name="rouletteMode"]').forEach((x) => {
    x.addEventListener('change', () => {
      saveSettings();
      if (state.result) setupWheel();
    });
  });
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
