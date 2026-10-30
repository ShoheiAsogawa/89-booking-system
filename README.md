# 89CENTER 予約システム

本番は Cloudflare Worker `booking-89center` です。患者画面は https://www.89center.dev/ 、管理画面は https://admin.89center.dev/ です。今後の修正とデプロイ手順の正は [`worker/`](worker/README.md) です。

## 本番と、リポジトリ直下のファイル

| 場所 | 役割 |
| --- | --- |
| `worker/` | 本番そのもの。Worker 本体、静的ファイル、`wrangler.jsonc` |
| 直下の `index.html` / `admin.html` / `404.html` | GitHub Pages（`89center.dev`）の転送。患者は www、`/admin` は管理画面のホストへ送る |
| 直下のカレンダー、画像、SQL | Cloudflare に移る前の静的版の残り。本番では使わない |

PR #10 の管理画面は、ブラウザから Supabase を直接叩く古い系統です。本番は D1 と `/api/db` と `worker/public/cloudflare-db-client.js` を使う版で、その5つの画面変更は 2026-10-30 に `worker/public/admin.html` へ移して本番に出してあります。管理画面の次の修正は `worker/public/admin.html` に対して行います。

`index.js.old` などの古い Worker は使いません。古い版には `/api/occupancy-sync` の認可の抜けがあります。

## デプロイ

本番へ出すコマンドは、`worker/` で実行する `npx wrangler deploy` です。Cloudflare の API トークンはこのリポジトリにもクラウドエージェントにもないので、デプロイは CEO が行います。`main` への push は GitHub Pages を更新するだけで、Worker は更新しません。

詳細、版 ID、管理者メールを公開リポジトリに残さない分け方は [`worker/README.md`](worker/README.md) に書いてあります。

## 関連ドキュメント

- `COST_OPTIMIZATION.md`
- `SECURITY_AND_COST_ANALYSIS.md`
- `SECURITY_AND_COST_EVALUATION.md`
