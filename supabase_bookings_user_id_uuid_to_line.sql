-- =====================================================================
-- bookings.user_id: Supabase Auth の UUID → LINE userId へ付け替え
-- =====================================================================
-- 背景:
--   2026-06-17 〜 2026-08-19 の間、患者側 (index.html) は
--   supabase.auth.signInWithIdToken({provider:'custom:line'}) で
--   Supabase のユーザーを作り、bookings.user_id にその UUID を保存していた。
--   2026-08-19 頃 Supabase が id_token グラントの issuer を
--   Apple / Google / Firebase のみに制限したためこの方式は使えなくなり、
--   患者側は LIFF の profile.userId (U から始まる33文字) に戻した。
--
--   そのため 2026-06〜08 に患者自身が入れた予約は user_id が UUID のままで、
--   患者アプリから「自分の予約」として認識されない（キャンセルもできない）。
--   このSQLで UUID を対応する LINE userId に付け替える。
--
-- 実行場所: Supabase SQL Editor（service_role 権限で auth スキーマを参照する）
-- 実行順:   (1) 確認 → (2) バックアップ → (3) 付け替え → (4) 検証
-- =====================================================================


-- ---------------------------------------------------------------------
-- (1) 確認: identities に LINE の紐づけが残っているか
-- ---------------------------------------------------------------------
-- provider 名が 'line' か 'custom:line' か環境で異なるためまず一覧を見る。
select provider, count(*) as identities
from auth.identities
group by provider
order by identities desc;

-- 付け替え対象の件数を事前に把握する
select
  count(*) filter (where b.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as uuid_rows,
  count(*) filter (where b.user_id like 'U%' and length(b.user_id) = 33)                                as line_rows,
  count(*) filter (where b.user_id is null)                                                             as admin_rows
from public.bookings b;

-- 実際に対応が取れる（= 付け替えできる）行数
select count(*) as mappable_rows
from public.bookings b
join auth.identities i
  on i.user_id::text = b.user_id
where b.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and i.provider_id like 'U%'
  and length(i.provider_id) = 33;


-- ---------------------------------------------------------------------
-- (2) バックアップ（1回だけ実行。失敗時はここから戻せる）
-- ---------------------------------------------------------------------
create table if not exists public.bookings_user_id_backup_20260819 as
select id, user_id, created_at
from public.bookings
where user_id is not null;


-- ---------------------------------------------------------------------
-- (3) 付け替え
-- ---------------------------------------------------------------------
-- provider_id には OIDC の sub（= LINE userId）が入る。
-- 念のため 'U' + 32桁 の形だけを対象にし、想定外の値は触らない。
update public.bookings b
set user_id = i.provider_id
from auth.identities i
where i.user_id::text = b.user_id
  and b.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and i.provider_id like 'U%'
  and length(i.provider_id) = 33;


-- ---------------------------------------------------------------------
-- (4) 検証: UUID が残っていないこと。特に「今日以降の予約」が重要。
-- ---------------------------------------------------------------------
select
  count(*) filter (where user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as uuid_left,
  count(*) filter (where user_id like 'U%')                                                          as line_now
from public.bookings;

-- 今日以降で UUID が残っている予約（= 患者が自分でキャンセルできない予約）
-- 0件が理想。残る場合はその患者の identities が消えているケースなので、
-- 管理画面から代理キャンセルで対応する。
select id, date, start_time, staff, patient_name
from public.bookings
where date >= current_date
  and user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
order by date, start_time;


-- ---------------------------------------------------------------------
-- (5) 万一戻す場合（(3)を取り消す）
-- ---------------------------------------------------------------------
-- update public.bookings b
-- set user_id = k.user_id
-- from public.bookings_user_id_backup_20260819 k
-- where k.id = b.id;
