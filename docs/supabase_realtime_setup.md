# Supabase Realtime の設定（患者予約の音付き通知用）

管理画面で「患者から予約が入ったら音で通知」するには、Supabase で **Realtime** の **Publication** に `bookings` テーブルを追加する必要があります。

---

## 方法1: ダッシュボードで設定（おすすめ）

### 1. ダッシュボードにログイン

1. [Supabase](https://app.supabase.com/) にログインする
2. 対象プロジェクト（89-booking-system 用）を開く

### 2. Publications を開く

1. 左メニューで **「Database」** をクリック
2. 左サブメニューで **「Replication」** または **「Publications」** をクリック  
   （Supabase のバージョンによっては **Database** → **Publications** の順）

   - 見つからない場合: 左メニューで **「Database」** の下にある **「Replication」** を探す  
   - または URL で直接:  
     `https://app.supabase.com/project/【あなたのプロジェクトID】/database/publications`

### 3. supabase_realtime に bookings を追加

1. **「supabase_realtime」** という名前の publication を探す
2. その publication の **「Edit」** または **「Tables」** をクリック
3. テーブル一覧から **「bookings」** にチェック（ON）を入れる
4. **「Save」** で保存

これで `bookings` への INSERT が Realtime で配信され、管理画面の通知が動くようになります。

---

## 方法2: SQL で設定

ダッシュボードの **SQL Editor** で次の SQL を実行しても同じ設定ができます。

```sql
-- Realtime で bookings の変更を配信する
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
```

- 既に追加済みの場合は「既に publication に含まれています」のようなエラーになりますが、その場合は何もしなくて大丈夫です。
- テーブルを外したいときは次で削除できます（通知は不要になった場合のみ）:
  ```sql
  ALTER PUBLICATION supabase_realtime DROP TABLE public.bookings;
  ```

---

## 動作確認

1. 管理画面にログインした状態で、予約カレンダーを表示する
2. **別のブラウザやスマホ** から患者予約画面で予約を1件入れる
3. 管理画面側で  
   - 画面上に「新しい予約が入りました」のトーストが出る  
   - 通知音が鳴る  
   - 予約タブ表示時はカレンダーが自動で更新される  

なら Realtime の設定は問題ありません。

---

## うまく動かないとき

- **通知が来ない**
  - 上記のとおり **Publications** で `bookings` が `supabase_realtime` に含まれているか確認
  - ブラウザのコンソール（F12）に `Realtime購読エラー` が出ていないか確認
- **音が鳴らない**
  - 多くのブラウザでは「ユーザーが一度クリックやタップをした後」でないと音が鳴りません。ログインやボタンクリック後に予約を入れて試してください
- **RLS（Row Level Security）**
  - 管理画面はログイン済み（`authenticated`）で `bookings` を読める前提です。Realtime の配信自体は publication の設定で行われ、RLS は「誰に変更を配信するか」に影響します。既に管理画面で予約一覧が見えていれば、通常は追加の RLS 変更は不要です

---

## 参考リンク

- [Postgres Changes | Supabase Docs](https://supabase.com/docs/guides/realtime/postgres-changes)
