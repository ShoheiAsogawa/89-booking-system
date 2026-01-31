# 89booking.dev（Cloudflare）を GitHub Pages に設定する手順

ドメイン **89booking.dev** を Cloudflare で取得した場合の設定です。

---

## 1. GitHub 側の設定

1. リポジトリを開く → **Settings** → **Pages**
   https://github.com/ShoheiAsogawa/89-booking-system/settings/pages

2. **Custom domain** に `89booking.dev` と入力

3. **Save** を押す

4. **Enforce HTTPS** にチェックを入れる（推奨）

---

## 2. Cloudflare 側の DNS 設定

1. **Cloudflare ダッシュボード**にログイン  
   https://dash.cloudflare.com/

2. ドメイン **89booking.dev** を選択

3. 左メニュー **「DNS」** → **「Records」** を開く

4. 次のレコードを追加（既存のレコードは必要に応じて残す）

### ルートドメイン（89booking.dev）用

**方法A: CNAME 1本（Cloudflare ならこれでOK）**

| タイプ | 名前 | ターゲット | プロキシ |
|--------|------|------------|----------|
| CNAME | `@` | `shoheiasogawa.github.io` | DNS のみ（グレーの雲） |

※「名前」は `@` または `89booking.dev`（ルートを表す）  
※ ユーザー名は実際の GitHub ユーザー名（小文字）に読み替えてください。

**方法B: A レコード 4本（GitHub 公式のやり方）**

| タイプ | 名前 | IPv4 アドレス | プロキシ |
|--------|------|---------------|----------|
| A | @ | 185.199.108.153 | DNS のみ |
| A | @ | 185.199.109.153 | DNS のみ |
| A | @ | 185.199.110.153 | DNS のみ |
| A | @ | 185.199.111.153 | DNS のみ |

### www も使う場合（任意）

| タイプ | 名前 | ターゲット | プロキシ |
|--------|------|------------|----------|
| CNAME | `www` | `shoheiasogawa.github.io` | DNS のみ または プロキシ |

5. **Save** で保存

---

## 3. プロキシ（オレンジの雲）について

- **DNS のみ（グレーの雲）**: GitHub Pages が直接応答。HTTPS は GitHub が発行した証明書を使う。おすすめ。
- **プロキシ（オレンジの雲）**: Cloudflare 経由。キャッシュや DDoS 対策は強くなるが、証明書やリダイレクトで不具合が出る場合がある。

まずは **DNS のみ** で設定し、問題なければ後からプロキシを有効にしてよいです。

---

## 4. 反映の確認

- DNS の反映は **数分〜30分** 程度が目安（Cloudflare は比較的早い）
- GitHub の **Settings → Pages** で、Custom domain の横に ✅ が出れば認識済み
- ブラウザで次の URL を開く:
  - **予約画面**: https://89booking.dev/ または https://89booking.dev/index.html
  - **管理画面**: https://89booking.dev/admin.html

---

## 5. LINE LIFF の URL 変更（使っている場合）

- **変更前**: `https://shoheiasogawa.github.io/89-booking-system/index.html`
- **変更後**: `https://89booking.dev/index.html`

LINE Developers Console → 該当 LIFF アプリ → Endpoint URL を上記に変更して保存。

---

## 6. うまく表示されないとき

- **「DNS check is still in progress」** のまま → 5〜10分待つか、Cloudflare の「名前」「ターゲット」を再確認
- **404 や別サイトが出る** → GitHub の Custom domain が `89booking.dev` だけか、Enforce HTTPS を一度オフにして試す
- **HTTPS で警告** → Enforce HTTPS をオフにし、DNS 反映後に再度オンにする

以上で、**89booking.dev** で予約システムが表示されます。
