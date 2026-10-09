/**
 * ワリカン・ルーレット（warikan-roulette） GAS バックエンド
 *
 * 機能:
 *  - 会員登録（仮パスワードをメール送信）
 *  - ログイン（5回失敗で15分ロック）
 *  - 初回／再発行後の初期パスワード設定（仮パスワードの再入力不要）
 *  - ログイン中の任意のパスワード変更（現在のパスワードが必要）
 *  - パスワード再発行（仮パスワード再送）
 *  - セッション（CacheService、sessionVersion で一括無効化）
 *  - Gemini API による AI コメント生成（キーは Script Properties のみ）
 *
 * Script Properties:
 *  - GEMINI_API_KEY : 必須（AIコメント用）
 *  - GEMINI_MODEL   : 任意（未設定時は CONFIG.DEFAULT_GEMINI_MODEL）
 *  - PEPPER         : 必須（ランダムな長い文字列。運用開始後は変更しない）
 *  - SPREADSHEET_ID : 任意（スタンドアロンGASの場合のみ）
 */

const CONFIG = {
  APP_NAME: 'ワリカン・ルーレット',
  APP_URL: 'https://kenken6291.github.io/warikan-roulette/',
  SHEET_USERS: 'Users',
  SHEET_LOGS: 'AuthLogs',
  HASH_ITERATIONS: 1000,          // 運用開始後に変えても旧ハッシュは検証可能（保存形式に回数を含む）
  SESSION_SECONDS: 21600,         // 6時間（CacheService の上限）
  MAX_FAILED: 5,
  LOCK_MINUTES: 15,
  TEMP_PW_HOURS: 24,
  RESET_COOLDOWN_SECONDS: 180,
  AI_LIMIT_PER_HOUR: 30,
  DEFAULT_GEMINI_MODEL: 'gemini-2.5-flash'
};

const USER_HEADERS = [
  'userId', 'email', 'nickname', 'salt', 'passwordHash', 'status',
  'mustChangePassword', 'tempPwExpire', 'failedCount', 'lockUntil',
  'sessionVersion', 'createdAt', 'updatedAt', 'lastLoginAt'
];
const LOG_HEADERS = ['timestamp', 'email', 'action', 'result', 'detail'];

class AppError extends Error {}

/* ============================================================
 * エントリーポイント
 * ============================================================ */

function doGet() {
  return json_({ ok: true, app: CONFIG.APP_NAME, time: new Date().toISOString() });
}

function doPost(e) {
  let res;
  try {
    const body = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const req = JSON.parse(body);
    const handlers = {
      register: handleRegister_,
      login: handleLogin_,
      changePassword: handleChangePassword_,
      resetPassword: handleResetPassword_,
      verify: handleVerify_,
      logout: handleLogout_,
      aiComment: handleAiComment_
    };
    const fn = handlers[String(req.action || '')];
    if (!fn) throw new AppError('不明な操作です');
    res = fn(req);
  } catch (err) {
    if (err instanceof AppError) {
      res = { ok: false, error: err.message };
    } else {
      console.error(err && err.stack ? err.stack : err);
      res = { ok: false, error: 'サーバーでエラーが発生しました。時間をおいて再度お試しください' };
    }
  }
  return json_(res);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
 * 初期設定（エディタから1回だけ手動実行）
 * ============================================================ */

function setupSheets() {
  getSheet_(CONFIG.SHEET_USERS, USER_HEADERS);
  getSheet_(CONFIG.SHEET_LOGS, LOG_HEADERS);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PEPPER')) {
    props.setProperty('PEPPER', randomString_(48, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'));
  }
  // 権限承認用（メール・外部通信）
  MailApp.getRemainingDailyQuota();
  UrlFetchApp.getRequest('https://generativelanguage.googleapis.com/');
  console.log('セットアップ完了。メール残り送信数: ' + MailApp.getRemainingDailyQuota());
}

/* ============================================================
 * ハンドラ
 * ============================================================ */

function handleRegister_(req) {
  const email = normalizeEmail_(req.email);
  const nickname = String(req.nickname || '').trim().slice(0, 20);
  if (!isValidEmail_(email)) throw new AppError('メールアドレスの形式が正しくありません');
  if (!nickname) throw new AppError('ニックネームを入力してください');

  return withLock_(() => {
    if (findUserByEmail_(email)) {
      log_(email, 'register', 'NG', 'duplicate');
      throw new AppError('このメールアドレスは登録済みです。パスワードを忘れた場合は「再発行」から手続きしてください');
    }
    const tempPw = generateTempPassword_();
    sendTempPasswordMail_(email, nickname, tempPw, false);

    const now = new Date();
    const salt = randomString_(32, 'abcdef0123456789');
    const user = {
      userId: 'U' + Utilities.getUuid().replace(/-/g, '').slice(0, 12),
      email: email,
      nickname: nickname,
      salt: salt,
      passwordHash: hashPassword_(tempPw, salt),
      status: 'TEMP',
      mustChangePassword: true,
      tempPwExpire: now.getTime() + CONFIG.TEMP_PW_HOURS * 3600 * 1000,
      failedCount: 0,
      lockUntil: '',
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: ''
    };
    getSheet_(CONFIG.SHEET_USERS, USER_HEADERS).appendRow(USER_HEADERS.map(h => user[h]));
    log_(email, 'register', 'OK', '');
    return { ok: true, message: '仮パスワードをメールで送りました。メールに記載のパスワードでログインしてください' };
  });
}

function handleLogin_(req) {
  const email = normalizeEmail_(req.email);
  const password = String(req.password || '');
  if (!email || !password) throw new AppError('メールアドレスとパスワードを入力してください');

  return withLock_(() => {
    const found = findUserByEmail_(email);
    if (!found) {
      log_(email, 'login', 'NG', 'no user');
      throw new AppError('メールアドレスまたはパスワードが違います');
    }
    const u = found.data;
    const now = Date.now();

    if (u.lockUntil && Number(u.lockUntil) > now) {
      const min = Math.ceil((Number(u.lockUntil) - now) / 60000);
      log_(email, 'login', 'NG', 'locked');
      throw new AppError('ログインに続けて失敗したためロック中です。約' + min + '分後に再度お試しください');
    }

    if (!verifyPassword_(password, u.salt, u.passwordHash)) {
      u.failedCount = Number(u.failedCount || 0) + 1;
      let msg = 'メールアドレスまたはパスワードが違います';
      if (u.failedCount >= CONFIG.MAX_FAILED) {
        u.lockUntil = now + CONFIG.LOCK_MINUTES * 60000;
        u.failedCount = 0;
        msg = CONFIG.MAX_FAILED + '回失敗したため' + CONFIG.LOCK_MINUTES + '分間ロックしました';
      } else {
        msg += '（あと' + (CONFIG.MAX_FAILED - u.failedCount) + '回でロック）';
      }
      u.updatedAt = new Date();
      saveUser_(found.row, u);
      log_(email, 'login', 'NG', 'bad password');
      throw new AppError(msg);
    }

    if (isTrue_(u.mustChangePassword) && u.tempPwExpire && Number(u.tempPwExpire) < now) {
      log_(email, 'login', 'NG', 'temp expired');
      throw new AppError('仮パスワードの有効期限（' + CONFIG.TEMP_PW_HOURS + '時間）が切れています。「再発行」から再度お手続きください');
    }

    u.failedCount = 0;
    u.lockUntil = '';
    u.lastLoginAt = new Date();
    u.updatedAt = new Date();
    saveUser_(found.row, u);

    const token = createSession_(u);
    log_(email, 'login', 'OK', '');
    return { ok: true, token: token, user: publicUser_(u) };
  });
}

function handleChangePassword_(req) {
  const session = requireSession_(req.token, true);
  const current = String(req.currentPassword || '');
  const next = String(req.newPassword || '');
  validateNewPassword_(next);

  return withLock_(() => {
    const found = findUserById_(session.userId);
    if (!found) throw new AppError('ユーザーが見つかりません');
    const u = found.data;
    const initial = isTrue_(u.mustChangePassword);

    if (initial) {
      // 初期設定：仮パスワードでログイン済み＝本人確認済みなので、仮パスワードの再入力は不要
      if (verifyPassword_(next, u.salt, u.passwordHash)) {
        throw new AppError('仮パスワードとは別のパスワードを設定してください');
      }
    } else {
      // 任意の変更：現在のパスワードが必要
      if (!current) throw new AppError('現在のパスワードを入力してください');
      if (!verifyPassword_(current, u.salt, u.passwordHash)) {
        log_(u.email, 'changePassword', 'NG', 'bad current');
        throw new AppError('現在のパスワードが違います');
      }
      if (current === next) throw new AppError('新しいパスワードは現在のものと別にしてください');
    }

    u.salt = randomString_(32, 'abcdef0123456789');
    u.passwordHash = hashPassword_(next, u.salt);
    u.status = 'ACTIVE';
    u.mustChangePassword = false;
    u.tempPwExpire = '';
    u.sessionVersion = Number(u.sessionVersion || 1) + 1; // 他端末のセッションを無効化
    u.updatedAt = new Date();
    saveUser_(found.row, u);

    CacheService.getScriptCache().remove(sessionKey_(req.token));
    const token = createSession_(u);
    log_(u.email, initial ? 'setPassword' : 'changePassword', 'OK', '');
    return {
      ok: true,
      token: token,
      user: publicUser_(u),
      message: initial ? 'パスワードを設定しました。ようこそ！' : 'パスワードを変更しました'
    };
  });
}

function handleResetPassword_(req) {
  const email = normalizeEmail_(req.email);
  if (!isValidEmail_(email)) throw new AppError('メールアドレスの形式が正しくありません');
  const generic = { ok: true, message: '登録済みのアドレスであれば、仮パスワードを送りました。メールをご確認ください' };

  const cache = CacheService.getScriptCache();
  const coolKey = 'reset_' + sha256Hex_(email);
  if (cache.get(coolKey)) {
    throw new AppError('再発行は' + Math.round(CONFIG.RESET_COOLDOWN_SECONDS / 60) + '分に1回までです。少し待ってからお試しください');
  }
  cache.put(coolKey, '1', CONFIG.RESET_COOLDOWN_SECONDS);

  return withLock_(() => {
    const found = findUserByEmail_(email);
    if (!found) {
      log_(email, 'resetPassword', 'NG', 'no user');
      return generic;
    }
    const u = found.data;
    const tempPw = generateTempPassword_();
    sendTempPasswordMail_(email, u.nickname, tempPw, true);

    u.salt = randomString_(32, 'abcdef0123456789');
    u.passwordHash = hashPassword_(tempPw, u.salt);
    u.status = 'TEMP';
    u.mustChangePassword = true;
    u.tempPwExpire = Date.now() + CONFIG.TEMP_PW_HOURS * 3600 * 1000;
    u.failedCount = 0;
    u.lockUntil = '';
    u.sessionVersion = Number(u.sessionVersion || 1) + 1;
    u.updatedAt = new Date();
    saveUser_(found.row, u);
    log_(email, 'resetPassword', 'OK', '');
    return generic;
  });
}

function handleVerify_(req) {
  const session = requireSession_(req.token, true);
  const found = findUserById_(session.userId);
  if (!found) throw new AppError('セッションが無効です。再度ログインしてください');
  return { ok: true, user: publicUser_(found.data) };
}

function handleLogout_(req) {
  if (req.token) CacheService.getScriptCache().remove(sessionKey_(req.token));
  return { ok: true };
}

function handleAiComment_(req) {
  const session = requireSession_(req.token, false);

  const cache = CacheService.getScriptCache();
  const rateKey = 'ai_' + session.userId + '_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMddHH');
  const used = Number(cache.get(rateKey) || 0);
  if (used >= CONFIG.AI_LIMIT_PER_HOUR) {
    return { ok: true, comment: fallbackComment_(req.kind), fallback: true, note: 'AIの利用上限に達したため定型コメントです' };
  }
  cache.put(rateKey, String(used + 1), 3700);

  const prompt = buildPrompt_(String(req.kind || ''), req.payload || {});
  try {
    const comment = callGemini_(prompt);
    return { ok: true, comment: comment };
  } catch (err) {
    console.error('Gemini error: ' + err);
    return { ok: true, comment: fallbackComment_(req.kind), fallback: true };
  }
}

/* ============================================================
 * セッション
 * ============================================================ */

function createSession_(u) {
  const token = randomString_(48, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
  const data = { userId: u.userId, v: Number(u.sessionVersion || 1) };
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(data), CONFIG.SESSION_SECONDS);
  return token;
}

function sessionKey_(token) {
  return 'sess_' + sha256Hex_(String(token || ''));
}

/**
 * @param {string} token
 * @param {boolean} allowMustChange パスワード変更前でも許可するか
 */
function requireSession_(token, allowMustChange) {
  if (!token) throw new AppError('ログインしてください');
  const raw = CacheService.getScriptCache().get(sessionKey_(token));
  if (!raw) throw new AppError('ログインの有効期限が切れました。再度ログインしてください');
  const s = JSON.parse(raw);
  const found = findUserById_(s.userId);
  if (!found || Number(found.data.sessionVersion || 1) !== Number(s.v)) {
    throw new AppError('ログインの有効期限が切れました。再度ログインしてください');
  }
  if (!allowMustChange && isTrue_(found.data.mustChangePassword)) {
    throw new AppError('先にパスワードを変更してください');
  }
  // スライディング延長
  CacheService.getScriptCache().put(sessionKey_(token), raw, CONFIG.SESSION_SECONDS);
  return { userId: s.userId, user: found.data };
}

/* ============================================================
 * パスワード・乱数
 * ============================================================ */

function hashPassword_(password, salt, iterations) {
  const iter = iterations || CONFIG.HASH_ITERATIONS;
  const pepper = PropertiesService.getScriptProperties().getProperty('PEPPER') || '';
  let h = sha256Hex_(salt + ':' + password + ':' + pepper);
  for (let i = 1; i < iter; i++) h = sha256Hex_(salt + h);
  return iter + '$' + h;
}

function verifyPassword_(password, salt, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 2) return false;
  const iter = Number(parts[0]);
  if (!iter) return false;
  return safeEqual_(hashPassword_(password, salt, iter), String(stored));
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function randomBytes_(n) {
  let out = [];
  while (out.length < n) {
    const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Utilities.getUuid() + Date.now());
    out = out.concat(d.map(b => b & 0xff));
  }
  return out.slice(0, n);
}

function randomString_(len, chars) {
  return randomBytes_(len).map(b => chars[b % chars.length]).join('');
}

function generateTempPassword_() {
  // 紛らわしい文字（0/O, 1/l/I）を除外
  const letters = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  return randomString_(6, letters) + randomString_(4, digits);
}

function validateNewPassword_(pw) {
  if (pw.length < 8) throw new AppError('パスワードは8文字以上にしてください');
  if (pw.length > 64) throw new AppError('パスワードは64文字以内にしてください');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new AppError('パスワードには英字と数字の両方を含めてください');
}

/* ============================================================
 * メール
 * ============================================================ */

function sendTempPasswordMail_(email, nickname, tempPw, isReset) {
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new AppError('本日のメール送信上限に達しました。明日以降にお試しください');
  }
  const subject = '【' + CONFIG.APP_NAME + '】' + (isReset ? 'パスワード再発行' : '会員登録') + 'のお知らせ';
  const body = [
    (nickname || '') + ' さん',
    '',
    CONFIG.APP_NAME + (isReset ? ' のパスワードを再発行しました。' : ' へのご登録ありがとうございます。'),
    '',
    '仮パスワード： ' + tempPw,
    '',
    '・有効期限は' + CONFIG.TEMP_PW_HOURS + '時間です。',
    '・ログイン後、ご自身のパスワードへの変更をお願いします。',
    '',
    CONFIG.APP_URL,
    '',
    '※お心当たりのない場合は、このメールを破棄してください。'
  ].join('\n');
  try {
    MailApp.sendEmail({ to: email, subject: subject, body: body, name: CONFIG.APP_NAME });
  } catch (err) {
    console.error(err);
    throw new AppError('メールを送信できませんでした。アドレスをご確認ください');
  }
}

/* ============================================================
 * Gemini
 * ============================================================ */

function buildPrompt_(kind, p) {
  const s = v => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, 60);
  const n = v => Math.round(Number(v) || 0);
  const rule = [
    'あなたは宴会の会計係を盛り上げる、気の利いた関西弁まじりの司会者です。',
    '条件: 日本語で100〜140文字。絵文字は1〜2個まで。',
    '性別・年齢・容姿をからかう表現は禁止。誰も傷つけない、軽い冗談にすること。',
    '前置きや見出しは書かず、コメント本文だけを出力すること。'
  ].join('\n');

  if (kind === 'roulette') {
    const diff = n(p.diff);
    const situation = diff > 0
      ? '端数' + diff + '円が余ったので、当選者はその分安くなる（ボーナス）'
      : diff < 0
        ? '端数' + Math.abs(diff) + '円が足りないので、当選者がその分多く払う'
        : '端数はゼロ。当選者は「今日のラッキーパーソン」';
    return rule + '\n\n' + [
      '状況: 割り勘の端数ルーレットの結果発表です。',
      '当選者: ' + s(p.winner),
      '結果: ' + situation,
      '当選者の支払額: ' + n(p.winnerPay) + '円',
      '参加人数: ' + n(p.people) + '人 / 総額: ' + n(p.total) + '円',
      p.organizer ? '幹事: ' + s(p.organizer) + '（最後にひと言ねぎらうこと）' : '幹事名は不明（最後に幹事へのねぎらいをひと言入れること）',
      '「なぜこの人が選ばれたのか」をもっともらしい屁理屈で説明してください。'
    ].join('\n');
  }

  const rows = Array.isArray(p.rows) ? p.rows.slice(0, 8) : [];
  const lines = rows.map(r => '・' + s(r.label) + ' ' + n(r.count) + '人：1人' + n(r.per) + '円').join('\n');
  return rule + '\n\n' + [
    '状況: 割り勘の計算結果です。この結果に、場が和む寸評をしてください。',
    '総額: ' + n(p.total) + '円 / 参加人数: ' + n(p.people) + '人',
    '内訳:\n' + lines,
    '端数: ' + n(p.diff) + '円（プラスは集めすぎ、マイナスは不足）',
    p.organizer ? '幹事: ' + s(p.organizer) : ''
  ].join('\n');
}

function callGemini_(prompt) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const model = props.getProperty('GEMINI_MODEL') || CONFIG.DEFAULT_GEMINI_MODEL;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.0, maxOutputTokens: 1024 }
    })
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  }
  const data = JSON.parse(res.getContentText());
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts.filter(x => x.text && !x.thought).map(x => x.text).join('').trim();
  if (!text) throw new Error('empty response');
  return text.slice(0, 400);
}

function fallbackComment_(kind) {
  const roulette = [
    '運命のルーレットが選んだのは、今日いちばん笑顔がよかったあなた！端数くらい、その笑顔でチャラにしましょ🎯 幹事さん、段取りおつかれさまでした！',
    '数字は嘘をつきません。でもルーレットはちょっとだけ気まぐれです。選ばれたのはきっと日頃の行い…ということにしておきましょう🍻 幹事さんに拍手！',
    'おめでとうございます、本日の端数担当大臣に任命です！任期は会計が終わるまで。幹事さん、今日もありがとう👏'
  ];
  const result = [
    'きれいに割れました！これで心おきなく二次会の相談ができますね🍶 幹事さん、計算おつかれさまでした。',
    '傾斜もばっちり、文句なしの割り勘です。お財布の準備ができたら、最後にもう一回乾杯しましょう🍻'
  ];
  const list = kind === 'roulette' ? roulette : result;
  return list[Math.floor(Math.random() * list.length)];
}

/* ============================================================
 * スプレッドシート
 * ============================================================ */

function getSS_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name, headers) {
  const ss = getSS_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function rowToUser_(row) {
  const o = {};
  USER_HEADERS.forEach((h, i) => { o[h] = row[i]; });
  return o;
}

function findUserBy_(field, value) {
  const sh = getSheet_(CONFIG.SHEET_USERS, USER_HEADERS);
  const last = sh.getLastRow();
  if (last < 2) return null;
  const values = sh.getRange(2, 1, last - 1, USER_HEADERS.length).getValues();
  const idx = USER_HEADERS.indexOf(field);
  for (let i = 0; i < values.length; i++) {
    const cell = String(values[i][idx]);
    if ((field === 'email' ? cell.toLowerCase() : cell) === value) {
      return { row: i + 2, data: rowToUser_(values[i]) };
    }
  }
  return null;
}

function findUserByEmail_(email) { return findUserBy_('email', email); }
function findUserById_(id) { return findUserBy_('userId', String(id)); }

function saveUser_(row, u) {
  const sh = getSheet_(CONFIG.SHEET_USERS, USER_HEADERS);
  sh.getRange(row, 1, 1, USER_HEADERS.length)
    .setValues([USER_HEADERS.map(h => (u[h] === undefined || u[h] === null) ? '' : u[h])]);
}

function publicUser_(u) {
  return { email: u.email, nickname: u.nickname, mustChangePassword: isTrue_(u.mustChangePassword) };
}

function log_(email, action, result, detail) {
  try {
    getSheet_(CONFIG.SHEET_LOGS, LOG_HEADERS).appendRow([new Date(), email, action, result, detail]);
  } catch (err) {
    console.error(err);
  }
}

/* ============================================================
 * ユーティリティ
 * ============================================================ */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new AppError('混み合っています。少し待ってから再度お試しください');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function normalizeEmail_(v) {
  return String(v || '').trim().toLowerCase().slice(0, 254);
}

function isValidEmail_(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}
