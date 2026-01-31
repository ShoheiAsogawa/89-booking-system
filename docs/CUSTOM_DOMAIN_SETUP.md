# 独自ドメインで GitHub Pages を表示する手順

`〇〇.github.io/89-booking-system` ではなく、自分で取得したドメイン（例: `booking.example.com`）で表示する方法です。

---

## 1. 必要なもの

- **ドメイン**（まだ持っていない場合）
  - 例: お名前.com、ムームードメイン、Google Domains、Cloudflare などで取得
  - 例: `89center-booking.com` や `booking.89center.jp` のように予約用のドメインを1つ用意

---

## 2. GitHub 側の設定

1. リポジトリの **Settings** → **Pages** を開く  
   https://github.com/ShoheiAsogawa/89-booking-system/settings/pages

2. **「Custom domain」** の欄に、使いたいドメインを入力  
   - サブドメインを使う例: `booking.89center.jp` または `yoyaku.example.com`
   - ルートドメインを使う例: `89booking.com`

3. **「Save」** を押す

4. **「Enforce HTTPS」** にチェックを入れる（推奨）  
   - DNS の設定が正しくなると、GitHub が自動で HTTPS 用の証明書を発行します

---

## 3. DNS の設定（ドメイン管理画面で行う）

取得したドメインの **DNS 管理画面**（お名前.com やムームードメインなどの管理画面）で、次のどちらかを設定します。

### パターンA: サブドメインを使う場合（例: `booking.89center.jp`）

| 設定項目 | 値 |
|----------|-----|
| **タイプ** | CNAME |
| **名前／ホスト** | `booking`（または使いたいサブドメイン名。`www` なら `www`） |
| **値／宛先** | `shoheiasogawa.github.io` |
| **TTL** | 3600 または自動 |

※ ユーザー名は実際の GitHub ユーザー名（小文字）に読み替えてください。

### パターンB: ルートドメインを使う場合（例: `89booking.com`）

GitHub の推奨は **A レコード** を4本設定する方法です。

| タイプ | 名前 | 値 |
|--------|------|-----|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

あわせて **www** 用に CNAME を設定する場合:

| タイプ | 名前 | 値 |
|--------|------|-----|
| CNAME | www | shoheiasogawa.github.io |

※ IP は [GitHub Pages の公式ドキュメント](https://docs.github.com/ja/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain) で最新を確認してください。

---

## 4. GitHub Pages の「Custom domain」の注意点

- GitHub Pages（リポジトリ用）で設定できる **Custom domain は 1 つだけ** です。
- 設定するドメインは **このリポジトリのサイト用** になります。
  - 例: `booking.89center.jp` を設定すると、  
    `https://booking.89center.jp/` = トップ（index.html）  
    `https://booking.89center.jp/admin.html` = 管理画面  
    という形になります。

つまり「独自ドメインにしたい」＝「この 1 つのドメインで、今の GitHub Pages の内容を表示する」設定になります。

---

## 5. 反映までの時間

- DNS の反映は **数分〜最大 48 時間** かかることがあります（多くの場合は 10〜30 分）。
- GitHub の Pages 設定画面で、ドメインの横に ✅ が表示されれば認識できています。
- 「DNS check is still in progress」と出ている間は、DNS の反映待ちです。

---

## 6. 設定後の確認

1. ブラウザで **独自ドメインの URL** を開く（例: `https://booking.89center.jp/`）
2. 予約画面（index.html）が表示されるか確認
3. `https://booking.89center.jp/admin.html` で管理画面が開くか確認
4. **Enforce HTTPS** を有効にしていれば、`http://` で開いても `https://` にリダイレクトされるか確認

---

## 7. LINE LIFF の URL を変更する

独自ドメインにしたら、LINE LIFF の **Endpoint URL** を新しい URL に変更します。

- **変更前**: `https://shoheiasogawa.github.io/89-booking-system/index.html`
- **変更後**: `https://booking.89center.jp/index.html`（または設定した独自ドメイン）

LINE Developers Console → 該当 LIFF アプリ → Endpoint URL を編集して保存します。

---

## 8. よくある質問

**Q. ドメインはどこで買えばいい？**  
- 日本だと お名前.com、ムームードメイン、Xserver ドメインなど。  
  年間 1,000〜2,000 円程度の .com / .jp が一般的です。

**Q. サブドメインとルートドメイン、どっちがいい？**  
- すでに `89center.jp` などを持っていれば、`booking.89center.jp` のように **サブドメイン** が分かりやすくておすすめです。  
  新規で予約専用に 1 つ取りたいなら、`89center-booking.com` のような **ルートドメイン** でも問題ありません。

**Q. GitHub の「DNS check is still in progress」から進まない**  
- ドメインの DNS 管理画面で、CNAME または A レコードの **名前・値・タイプ** が正しいか再確認。  
- レジストラによっては「プロキシ」や「CDN」をオフにしないと CNAME が効かない場合があります。

**Q. 独自ドメインにしたら github.io の URL は使えなくなる？**  
- いいえ。独自ドメインを設定しても、  
  `https://shoheiasogawa.github.io/89-booking-system/` も **そのまま使えます**。  
  両方で同じサイトが表示されます。

---

## まとめ

1. 使いたい **ドメインを取得**（まだならレジストラで契約）
2. GitHub の **Settings → Pages → Custom domain** にそのドメインを入力して Save
3. ドメインの **DNS 管理**で、CNAME（サブドメイン）または A レコード（ルートドメイン）を設定
4. 反映を待ち、**Enforce HTTPS** を有効にして動作確認
5. LINE LIFF を使っている場合は **Endpoint URL** を独自ドメインに変更

これで「GitHub 感」の強い URL ではなく、独自ドメインで公開できます。
