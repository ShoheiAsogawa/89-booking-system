# 患者側の認証と RLS 有効化 移行設計書

作成: 2026-08-19 / 対象: `index.html`（患者側）, Supabase プロジェクト `zzezehgnzeneueklxduy`

---

## 1. 何が起きたか

### 症状
2026-08-19 未明から、LINE アプリ内で患者が予約ページを開くと
白い画面にスピナーと「本気で治します」が出たまま固まり、予約できない。

### 切り分けの根拠

| 観測 | 内容 |
|---|---|
| 患者自己予約の発生状況 | 2026-08-18 15:15 UTC（= 08-19 00:15 JST）を最後にゼロ。それ以前は 1日 4〜15 件 |
| リポジトリの最終変更 | 2026-08-13、管理画面の CSS のみ。患者側コードは 2026-06-17 から未変更 |
| ⇒ 結論 | コード変更でなく **Supabase 側の仕様変更**が引き金 |

### 真因
`supabase.auth.signInWithIdToken({ provider: 'custom:line', token: <LINE ID token> })`
が Supabase 側で拒否されるようになった。`/auth/v1/token?grant_type=id_token` に
issuer だけを変えて投げると、プロバイダ名に関係なく issuer だけで判定されている:

| id_token の `iss` | 応答 |
|---|---|
| `https://access.line.me` | 400 `{"message":"API request is blocked. Only Apple, Google, Firebase issuer allowed."}` |
| `https://example.com` | 400 同じブロック |
| `https://securetoken.google.com/...`（Firebase） | ゲート通過（その先の署名検証で落ちる） |
| `https://appleid.apple.com`（Apple） | ゲート通過 |

つまり **id_token グラントで許可される issuer が Apple / Google / Firebase のみに制限された**。
LINE の ID トークンはもう受け付けられない。プロバイダ設定での回避は不可。

### なぜ「白画面」まで悪化したか
`index.html` 側のエラー処理が抜けていた。

1. ブロック応答に CORS ヘッダが無く、ブラウザには `Failed to fetch` としか見えない
2. supabase-js v2 は例外を投げず `{ data: { user: null, session: null }, error }` を返す
3. `state.uid = session.user.id` が `TypeError: Cannot read properties of null` を投げる
4. その例外は `catch(e)` に飲まれ、`localhost` 以外では**何もしない**
5. `loadData()` が呼ばれず `loading(false)` にも到達しない
6. `#loader` は CSS で最初から `display:flex; z-index:999` の全画面白オーバーレイ → 永久に残る

**引き金は Supabase 側、被害を白画面まで拡大させたのはこのエラー処理欠落**、という二段構造。

---

## 2. 実施済みの暂定対応（2026-08-19）

`index.html` を Supabase Auth 非依存に戻した。

- 本人識別を `liff.getProfile().userId`（LINE userId, `U` + 32桁）に戻す ＝ 2026-06 以前と同じ方式
- `catch` で**必ず** `loading(false)` を呼び、ログイン案内オーバーレイとメッセージを出す
- LIFF SDK 自体が読めない場合も同じ経路に落とす
- 20 秒の最終防衛線タイマー。起動処理がどこで止まっても白画面のままにはしない

さらに `supabase_bookings_user_id_uuid_to_line.sql` で、2026-06〜08 に
UUID で保存された `bookings.user_id` を LINE userId へ付け替える（**未実行なら要実行**）。
これをやらないと、その期間に患者自身が入れた**今日以降の予約が「自分の予約」として
認識されず、患者がキャンセルできない**。

### 暂定対応で残っているリスク

⚠️ **患者の氏名・電話番号が公開キーで誰でも読める状態**。実際に確認済み:

```
GET /rest/v1/bookings?select=*  （apikey = sb_publishable_... のみ）
→ 200, patient_name / phone / symptoms を含む全行が返る
```

`supabase_rls_hardening.sql` はこれを塞ぐために書かれているが、
**現在の DB には適用されていない**（適用すると患者側は認証手段が無く全滅する）。
つまり「動くが情報が露出している」状態を意図的に選んでいる。恒久対応は次章。

---

## 3. 恒久対応の選択肢

| | 方式 | 追加インフラ | RLS 可否 | 評価 |
|---|---|---|---|---|
| **A** | Supabase Edge Function で LINE ID トークンを検証し、Supabase のセッションを発行 | Edge Function 1つ | ○ | **推奨** |
| B | LINE → Firebase Auth のカスタムトークン → Firebase ID トークンで `signInWithIdToken({provider:'firebase'})` | Firebase プロジェクト＋関数 | ○ | Firebase issuer は許可されているが、カスタムトークン発行に結局サーバが必要 |
| C | Edge Function がプロジェクトの JWT シークレットで自前 JWT を署名 | Edge Function 1つ | ○ | `auth.users` を経由しないため失効・监査ができない。**非推奨** |

GitHub Pages は静的ホスティングでサーバを持てないため、検証処理を置く先は
Supabase Edge Function が自然。

---

## 4. 推奨案 A の設計

### 4.1 識別子の方針（重要）

`bookings.user_id` は **LINE userId（`U`+32桁）で固定**する。
Supabase の UUID を入れると、今回のように認証方式が変わるたびに
過去データの付け替えが必要になる。LINE userId は認証経路に依存しない。

Supabase 側のユーザーには `user_metadata.line_user_id` として LINE userId を持たせ、
RLS は JWT から読んだその値と `bookings.user_id` を比較する。

```sql
create or replace function public.current_line_user_id()
returns text language sql stable
set search_path = public
as $$
  select nullif(trim(auth.jwt() -> 'user_metadata' ->> 'line_user_id'), '');
$$;
```

### 4.2 Edge Function `line-login`

```ts
// supabase/functions/line-login/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'

const LINE_CHANNEL_ID = Deno.env.get('LINE_CHANNEL_ID')!   // LIFF の LINE Login チャネルID
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!               // 実行環境に自動注入される
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { id_token } = await req.json()
  if (!id_token) return json({ error: 'id_token required' }, 400)

  // (1) LINE 公式のトークン検証エンドポイントで検証（署名・aud・expをLINE側が確認）
  const v = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token, client_id: LINE_CHANNEL_ID }),
  })
  if (!v.ok) return json({ error: 'invalid LINE id_token' }, 401)
  const payload = await v.json()           // { sub, name, picture, aud, exp, ... }
  const lineUserId: string = payload.sub

  // (2) Supabase ユーザーを LINE userId から決定的に引く／作る
  const email = `${lineUserId.toLowerCase()}@line.invalid`
  const { error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { line_user_id: lineUserId, display_name: payload.name ?? null },
  })
  if (error && !/already/i.test(error.message)) return json({ error: error.message }, 500)

  // (3) ワンタイムトークンを発行してクライアントに返す
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink', email,
  })
  if (linkErr) return json({ error: linkErr.message }, 500)

  return json({ email, token: link.properties.email_otp })
})
```

> `createUser` は既存なら 《already registered》 で失敗するので、そのエラーだけ無視して
> `generateLink` に進む（＝upsert 相当）。

### 4.3 患者側（`index.html`）

```js
const profile = await liff.getProfile();
state.uid = profile.userId;                 // DB 上の識別子は LINE userId のまま

// Supabase のセッションを取得（RLS 用）
const idToken = liff.getIDToken();
const r = await fetch(SUPABASE_URL + '/functions/v1/line-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
  body: JSON.stringify({ id_token: idToken }),
});
if (!r.ok) throw new Error('セッションの確立に失敗しました');
const { email, token } = await r.json();
const { error } = await db.auth.verifyOtp({ email, token, type: 'email' });
if (error) throw error;

await loadData();
```

**エラー処理は現行の `catch` をそのまま維持すること。** 今回の教訓は
「認証が落ちたときにローディングを解除してユーザーに伝える経路が無かった」点。

### 4.4 `supabase_rls_hardening.sql` の修正点

現行ファイルは患者判定を `user_id = auth.uid()::text` にしているが、
4.1 の方針だと LINE userId 比較に変える必要がある。

```sql
-- 変更前
--   OR (user_id IS NOT NULL AND user_id = auth.uid()::text)
-- 変更後
     OR (user_id IS NOT NULL AND user_id = public.current_line_user_id())
```

`bookings_insert_policy` / `bookings_update_policy` の 2 箇所。

> ⚠️ もう一点、現行ファイルは `staffs` テーブルを前提にしているが、
> このプロジェクトに `staffs` は存在しない（`PGRST205`）。
> 該当ブロックはエラーになるので、実行前に削除するかテーブルを作成する。
> なお `index.html` の `loadFees()` は失敗時 localStorage にフォールバックするため
> 現状は実害が出ていない。

---

## 5. 段階的な移行手順

各フェーズは独立してロールバックできる。**フェーズ 3 の前に必ず 2 で確認する。**

### フェーズ 0 — データ整合（先に済ませる）
- [ ] `supabase_bookings_user_id_uuid_to_line.sql` を (1)→(2)→(3)→(4) の順に実行
- [ ] (4) で「今日以降の予約に UUID が残っていない」ことを確認

### フェーズ 1 — セッション発行の追加（RLS はまだ触らない）
- [ ] `supabase/functions/line-login/` を作成し `supabase functions deploy line-login`
- [ ] `supabase secrets set LINE_CHANNEL_ID=<LINE LoginチャネルID>`
- [ ] `index.html` に 4.3 のセッション確立を追加。**失敗しても予約はできる**ようにしておく
- [ ] LINE アプリ実機で開き、`auth.users` に行が増えることを確認
- [ ] `user_metadata.line_user_id` が正しく入っているか確認

### フェーズ 2 — RLS を「追加のみ」で入れる（anon は残す）
- [ ] `current_line_user_id()` を作成
- [ ] `authenticated` 向けポリシーを作成（`CREATE POLICY` 部分のみ）
- [ ] **anon 向けの既存ポリシーはまだ DROP しない**。この時点では何も壊れない
- [ ] 実機で「予約作成」「自分の予約のキャンセル」が通ることを確認

### フェーズ 3 — anon を閉じる（ここで露出が止まる）
- [ ] フェーズ 1 のセッション確立を「失敗したらエラー表示して中断」に格上げ
- [ ] anon 向けポリシーを DROP
- [ ] 直後に検証（下記チェックリスト）
- [ ] 問題が出たら anon SELECT ポリシーを 1 本戻すだけで復旧できる

### フェーズ 4 — 検証チェックリスト
- [ ] 患者: 空き枠が正しく表示される（全部グレーになっていない）
- [ ] 患者: 予約が作成できる
- [ ] 患者: **自分の**予約が「own」表示になり、詳細・キャンセルができる
- [ ] 患者: 他人の予約枠は「予約済み」で、氏名・電話が見えない
- [ ] 公開キーだけで `GET /rest/v1/bookings` を叩き、**0 件または 401** になる
- [ ] 管理画面: ログイン、予約の登録・変更・キャンセル、経費、先払い／つけ払いが従来どおり
- [ ] 管理画面: 売上集計の数字がフェーズ 0 の前後で変わっていない

---

## 6. 監視（同じ事故を早期に検知する）

今回は「患者が予約できない」ことに気づくまでに時間がかかった。
患者自己予約は 1 日 4〜15 件あるので、**日次でゼロなら異常**と判断できる。

```sql
-- 直近 24 時間の患者自己予約件数。0 ならアラート。
select count(*) from public.bookings
where user_id is not null
  and created_at > now() - interval '24 hours';
```

Supabase の Database Webhooks / cron 拡張、あるいは外部の監視から
このクエリを 1 日 1 回叩いて 0 件なら通知する運用を推奨する。
