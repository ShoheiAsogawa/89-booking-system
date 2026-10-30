# 本番 Worker（booking-89center）

ここが今後の正です。2026-10-30 18:42（日本時間）に Cloudflare へ出した本番そのものです。

- Worker 名: `booking-89center`
- 今の版: `3431f329-4545-41a6-8f19-1b5b304c7e2e`
- 直前の版: `879eeb25-9f84-4859-b0a7-75b35d239d09`
- `src/index.js` の sha256: `0fc699831b1d30e1e4920655c8f4d64a821477154bc11490aadd49df357f9c5e`
- 患者画面: https://www.89center.dev/
- 管理画面: https://admin.89center.dev/
- 頂点 `89center.dev` は GitHub Pages から www へ転送するだけで、この Worker ではない

本番は D1 と `/api/db`、`public/cloudflare-db-client.js`、`/api/admin/blocks/bulk` を使う版です。元の TypeScript は残っていないので、Worker の修正はこのビルド済み `src/index.js` に対して行います。`wrangler.jsonc` の `no_bundle` は true です。

## ディレクトリ

- `wrangler.jsonc` — 本番の Worker 設定。カスタムドメインは書かない。Cloudflare 側の既存ルートをそのまま使う
- `src/index.js` — 本番の Worker 本体
- `public/` — 本番の静的ファイル。管理画面は `public/admin.html`、患者画面は `public/index.html`
- `check.sh` — 本番 URL への読み取り確認。デプロイはしない

2026-10-30 の確認結果 `before.txt` と `after.txt` は入れていません。予約 ID、時刻、担当者名の実データが含まれていたためです。

## リポジトリ直下の古い静的版

リポジトリ直下の `index.html`、`admin.html`、`404.html` は、GitHub Pages（`89center.dev`）用の転送です。患者は www へ、`/admin` は `admin.89center.dev` へ送ります。直下のカレンダー、画像、SQL は、Cloudflare に移る前の静的版の残りです。

PR #10 の `admin.html` は、Supabase をブラウザから直接叩く古い管理画面です。本番より古い系統で、D1 も `/api/db` も `cloudflare-db-client.js` もありません。2026-10-30 に、その PR の5つの変更だけを本番の `public/admin.html` へ手で移して出してあります。

移した5つ:

- 新規の予約枠の右上に「新」
- ブロック作成時の色（理由の先頭に `[[#RRGGBB]]`）
- 時間外の枠からもブロックできる
- ブロック時間の「1日（予約のある時間は残す）」。内部の値は `block_day`
- 「繰り返し予約」を「先払い・つけ払い」のすぐ右へ移動

今後、管理画面を直すときは `worker/public/admin.html` を直します。患者画面は `worker/public/index.html`、API は `worker/src/index.js` です。直下の HTML を直しても本番は変わりません。

## 使わないもの

`index.js.old` や、それ以前の Worker は使いません。古い版には `/api/occupancy-sync` の認可の抜けがあります。今の `src/index.js` にその経路はありません。古いファイルを戻したり、古い Worker をデプロイしたりしないでください。

## デプロイ

このリポジトリにも、クラウドエージェントの環境にも、Cloudflare の API トークンはありません。`npx wrangler deploy` は CEO が実行します。エージェントはデプロイしません。

```bash
cd worker
npx wrangler deploy
```

トークンは CEO の手元に置き、リポジトリ、Issue、PR には書かないでください。`account_id` は `wrangler.jsonc` にあるので、通常は `CLOUDFLARE_ACCOUNT_ID` を別途付けなくてよいです。

戻すとき（CEO が実行）:

```bash
cd worker
npx wrangler rollback 879eeb25-9f84-4859-b0a7-75b35d239d09 --name booking-89center
```

`main` への push で動く GitHub Actions は GitHub Pages の更新だけで、この Worker は更新しません。

`workers.dev`（`booking-89center.uken-shohei.workers.dev`）は 2026-10-30 の時点で有効でした。以前から有効だったかは未確認です。止める場合は `wrangler.jsonc` に `"workers_dev": false` を足して、CEO が出し直します。

## 秘密情報

`SUPABASE_ANON_KEY`（`sb_publishable_...`）は公開用のキーです。患者画面と管理画面の HTML にも同じ値が入っています。このままリポジトリに置きます。Supabase の service role や秘密キーは、この一式にはありません。

`account_id`、D1 の `database_id`、KV の `id` は接続先の識別子で、それだけではデータベースを操作できません。操作には Cloudflare の API トークンが別途必要です。トークンはこのリポジトリに置いていません。

管理者のメールは API トークンではありませんが、公開リポジトリに残さないほうがよいです。理由は、管理 API の許可リスト（`ADMIN_EMAILS`）と、障害通知の宛先（`ALERT_TO_EMAIL` と Email Routing の `destination_address`）が、管理者本人のメールアドレスだと分かるためです。なりすましや、その宛先を狙ったフィッシングに使えます。

この PR では値を消していません。消した状態で `npx wrangler deploy` すると、平文の vars が本番から外れ、管理 API の許可リストと通知メールが止まります。シークレットはデプロイでは消えませんが、平文 vars は上書きされます。

CEO が分けるときの手順:

1. 本番にシークレットを入れる。値は今の `wrangler.jsonc` と同じにする。

   ```bash
   cd worker
   npx wrangler secret put ADMIN_EMAILS
   npx wrangler secret put ALERT_FROM_EMAIL
   npx wrangler secret put ALERT_TO_EMAIL
   ```

2. Cloudflare のダッシュボードで、3つがシークレットとして入っていることを確認する。
3. 確認できてから、`wrangler.jsonc` の `vars` から `ADMIN_EMAILS`、`ALERT_FROM_EMAIL`、`ALERT_TO_EMAIL` を削除する。
4. そのあとのデプロイで、平文 vars が外れ、シークレットが残る。

`send_email` の `destination_address` はバインディングの設定で、シークレットにはできません。個人の Gmail ではなく `alert@89center.dev` のような役割アドレスに変えるか、この1項目だけ設定ファイルに残します。変える場合は、Email Routing でその宛先が検証済みであることを先に確認します。
