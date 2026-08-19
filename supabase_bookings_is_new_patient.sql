-- ============================================================================
-- 新規顧客フラグ（is_new_patient）の追加と N 接頭辞データの移行
-- 適用済み: 2026-08-19（本番に実行済みの記録）
-- ============================================================================
-- 背景: 以前は患者名の先頭に N を付けて新規顧客を表していた。
--       それを真偽値の列に移し、名前から N を取り除いた。
--
-- 実行結果:
--   対象 107件（N/n/Ｎ 先頭）をフラグ付けし、N を削除
--   N を外すと名前が空になる行: 0件（事前確認済み）
--   移行後に N 先頭の残存: 0件
--   バックアップ: public.bookings_name_backup_20260819（832件のうち対象107件）
-- ============================================================================

-- 1) 列追加
alter table public.bookings
  add column if not exists is_new_patient boolean not null default false;

-- 2) 事前確認: N を外したときに名前が空になる行がないか（0件であること）
select count(*) as n_prefixed,
       count(*) filter (where regexp_replace(patient_name, '^[NnＮｎ][ 　]*', '') = '') as would_become_empty
from public.bookings
where patient_name ~ '^[NnＮｎ]';

-- 3) バックアップ（1回だけ）
create table if not exists public.bookings_name_backup_20260819 as
select id, patient_name from public.bookings where patient_name ~ '^[NnＮｎ]';
alter table public.bookings_name_backup_20260819 enable row level security;
-- ポリシーを作らない = service_role / postgres 以外からは読めない

-- 4) 移行: フラグを立てて N を外す（空になる行は触らない）
with upd as (
  update public.bookings
  set is_new_patient = true,
      patient_name = regexp_replace(patient_name, '^[NnＮｎ][ 　]*', '')
  where patient_name ~ '^[NnＮｎ]'
    and regexp_replace(patient_name, '^[NnＮｎ][ 　]*', '') <> ''
  returning 1
)
select (select count(*) from upd) as migrated,
       (select count(*) from public.bookings_name_backup_20260819) as backed_up;

-- 5) 検証（n_prefix_left が 0 であること）
select
  count(*) filter (where is_new_patient) as new_flagged,
  count(*) filter (where patient_name ~ '^[NnＮｎ]') as n_prefix_left,
  count(distinct trim(patient_name)) filter (where is_new_patient) as distinct_new_people
from public.bookings;

-- 6) 売上画面の KPI と同じ計算（予約日ベース・氏名で名寄せ）
select to_char(date, 'YYYY-MM') as month,
       count(distinct trim(patient_name)) filter (where is_new_patient) as new_customers,
       count(*) as all_bookings
from public.bookings
where (status is null or status <> 'キャンセル')
group by 1 order by 1 desc limit 12;

-- ============================================================================
-- ロールバック（名前の N を戻してフラグを消す）
-- ============================================================================
-- update public.bookings b
-- set patient_name = k.patient_name, is_new_patient = false
-- from public.bookings_name_backup_20260819 k
-- where k.id = b.id;

-- ============================================================================
-- アプリ側の扱い
-- ============================================================================
-- 管理画面 (admin.html)
--   ・スケジュールの予約セル左上に黄色で NEW バッジ
--   ・予約登録フォームと予約詳細に「新規顧客 / 初めての来院」チェックボックス
--   ・売上画面に KPI「New Customers」（期間内の新規を氏名で名寄せした人数）
-- 患者ページ (index.html)
--   ・予約登録直前にそのLINEユーザーの既存予約を探し、0件なら自動でフラグON
--   ・セッションが無いと判定できないので false のまま。管理画面から手動修正する
--   ・電話予約で既に来院済みの方はLINE初回で新規扱いになるので、その場合は外す
-- なお booking_slots ビューには is_new_patient を含めていない。
-- 新規かどうかは管理側の情報なので、患者アプリには公開しない。
