# ワリカン・ルーレット（warikan-roulette）

傾斜つき割り勘計算 ＋ 端数ルーレット ＋ AI司会コメントのWebアプリ。
GitHub Pages（フロント）＋ GAS（API）＋ スプレッドシート（会員・ログ）＋ Gemini API。

```
warikan-roulette/
├── index.html
├── config.js      ← GAS URL の設定
├── style.css
├── script.js
└── Code.gs        ← GASエディタに貼る（リポジトリには置かなくてもOK）
```

---

## 1. スプレッドシートのカラム構成

`setupSheets()` を実行すると自動で作成されます。

### シート `Users`

| 列 | カラム名 | 型・例 | 説明 |
|---|---|---|---|
| A | userId | `U3f9a2c1b7d0e` | 内部ID |
| B | email | `ken@example.com` | 小文字に正規化して保存 |
| C | nickname | `ケン` | 20文字まで |
| D | salt | 32桁の16進文字列 | ユーザーごとのソルト（パスワード変更のたびに再生成） |
| E | passwordHash | `1000$ab12…` | `反復回数$SHA-256` 形式。平文は保存しない |
| F | status | `TEMP` / `ACTIVE` | TEMP＝仮パスワード状態 |
| G | mustChangePassword | `TRUE` / `FALSE` | TRUEの間は変更モーダルで利用制限 |
| H | tempPwExpire | ミリ秒（数値） | 仮パスワードの有効期限（24時間） |
| I | failedCount | `0`〜`4` | 連続失敗回数 |
| J | lockUntil | ミリ秒（数値） | ロック解除時刻（5回失敗で15分） |
| K | sessionVersion | `1`, `2`… | 変更・再発行時に+1して全端末のログインを無効化 |
| L | createdAt | 日時 | 登録日時 |
| M | updatedAt | 日時 | 更新日時 |
| N | lastLoginAt | 日時 | 最終ログイン |

### シート `AuthLogs`

| 列 | カラム名 | 例 |
|---|---|---|
| A | timestamp | 日時 |
| B | email | `ken@example.com` |
| C | action | `register` / `login` / `changePassword` / `resetPassword` |
| D | result | `OK` / `NG` |
| E | detail | `bad password` / `locked` / `temp expired` など |

> セッションはシートに保存せず CacheService（6時間・操作のたびに延長）で管理しています。

---

## 2. GAS のセットアップ

1. 新しいスプレッドシートを作成 →「拡張機能」→「Apps Script」
2. `Code.gs` の中身を全部貼り替えて保存
3. `CONFIG.APP_URL` を公開URL（例 `https://kenken6291.github.io/warikan-roulette/`）に合わせる
4. 関数 `setupSheets` を選んで実行 → 権限を承認
   - シート2枚が作成され、`PEPPER` が自動生成されます
5. 「プロジェクトの設定」→「スクリプト プロパティ」に追加

| プロパティ | 必須 | 内容 |
|---|---|---|
| `GEMINI_API_KEY` | ○ | Google AI Studio で発行したキー |
| `GEMINI_MODEL` | 任意 | 使うモデル名。未設定なら `gemini-2.5-flash` |
| `PEPPER` | ○ | 自動生成済み。**運用開始後は絶対に変更しない**（全員ログイン不可になる） |
| `SPREADSHEET_ID` | 任意 | スタンドアロンGASにした場合のみ |

6. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
   - 実行ユーザー：**自分**
   - アクセスできるユーザー：**全員**
7. 表示されたウェブアプリURL（`…/exec`）をコピー

### ⚠ コードを修正したとき
GASは保存しただけでは反映されません。
「デプロイ」→「デプロイを管理」→ 鉛筆アイコン →「バージョン：新バージョン」→「デプロイ」。
この方法ならURLは変わりません（「新しいデプロイ」を作るとURLが変わるので、その場合は `config.js` の `GAS_URL` を更新）。

---

## 3. フロントエンドの設置（GitHub Pages）

1. `config.js` の `GAS_URL` を手順2-7のURLに書き換え
2. リポジトリ `warikan-roulette` に `index.html` / `config.js` / `style.css` / `script.js` をpush
3. Settings → Pages → Branch: `main` / root → Save
4. `https://kenken6291.github.io/warikan-roulette/` で公開

CORS対策として、フロントは `Content-Type: text/plain` で POST しています（プリフライトが発生しないため GAS で受けられます）。

> Googleドライブの「ウェブホスティング」機能は2016年に終了しているため、ドライブ上のHTMLを直接公開する方式は使えません。GitHub Pages を推奨します。

---

## 4. Gemini APIキーの取り扱い

- キーは **GAS のスクリプトプロパティだけ** に置く。`config.js` / `script.js` や GitHub には絶対に書かない（公開リポジトリは誰でも読めます）
- Google Cloud コンソールでキーの「APIの制限」を Generative Language API のみに絞る
- 無料枠では入力内容がGoogleの改善に使われる場合があるため、個人情報（実名・メール）は送らない設計にしています（送るのは区分名・人数・金額・幹事名のみ）
- 乱用対策として1ユーザー1時間30回までに制限。上限超過やAPIエラー時は定型コメントに自動で切り替わります

---

## 5. 計算ルール

1. 定額の区分（例：主賓0円、年長者1万円）の合計を総額から引く
2. 残額を「比率 × 人数」の重みで按分（比率1.5＝一般の1.5倍）
3. 1人あたりを指定単位（10/100/500/1,000円）で切り上げ・切り下げ・四捨五入（定額は丸めない）
4. 集まる金額 − 総額 ＝ 端数
   - ＋なら集めすぎ → ルーレット当選者がその分安くなる
   - −なら不足 → 当選者がその分多く払う
5. ルーレット対象は比率で払う人。チェックを入れると定額の人も対象に入ります

---

## 6. 運用メモ

- Gmail（MailApp）の送信上限は無料アカウントで1日100通程度。上限時は登録・再発行がエラーになります
- 再発行は同じアドレスで3分に1回まで
- 入力した総額・人数・比率はブラウザに保存され、次回も残ります
