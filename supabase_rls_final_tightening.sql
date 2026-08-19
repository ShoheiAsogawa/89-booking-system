-- ============================================================================
-- 適用済み記録: 患者認証と RLS の再設計（2026-08-19）
-- ============================================================================
-- このファイルは「これから実行する手順」でなく、すでに本番に適用した内容の記録。
-- 同じ状態を再現したい場合は上から順に実行すればよい。
--
-- 【背景】
--   Supabase が id_token グラントの issuer を Apple / Google / Firebase のみに制限したため
--   signInWithIdToken({provider:'custom:line'}) が使えなくなった。代わりに
--   Edge Function line-login で LINE の ID トークンを検証してセッションを発行する。
--
-- 【重要】適用の順序を間違えると危険
--   旧ポリシー「Admin Full Access」は authenticated に ALL / USING true だった。
--   これを残したまま患者にセッションを持たせると、患者が全予約の閑覧・改変・削除と
--   経費・売上・監査ログにまで到達できてしまう。必ず先にポリシーを分離する。
-- ============================================================================


-- 【STEP 1】データ整合
--   supabase_bookings_user_id_uuid_to_line.sql を実行。
--   結果: 411件を UUID → LINE userId に付け替え。UUID残存 0件。
--         バックアップ public.bookings_user_id_backup_20260819（832件、RLS有効・ポリシーなし）


-- 【STEP 2】管理者の明示管理と判定関数
create table if not exists public.admin_users (
  user_id    uuid primary key,
  email      text,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
-- ポリシーを作らない = service_role / postgres 以外からは一切読めない

-- 対象は LINE 以外（email プロバイダ）のユーザー。以下で確認できる:
--   select u.id, u.email from auth.users u
--   left join auth.identities i on i.user_id = u.id
--   group by u.id, u.email
--   having coalesce(string_agg(i.provider, ','), '') not like '%line%';
insert into public.admin_users (user_id, email, note) values
  ('0f69df31-c580-4bfd-9a80-6fba00d3c4dd', 'senseco89center@gmail.com', '管理画面'),
  ('3a521733-e784-48a3-9aef-38ae233718ab', 'uken.shohei@gmail.com',     '管理画面')
on conflict (user_id) do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$fn$;

create or replace function public.current_line_user_id()
returns text language sql stable set search_path = public as $fn$
  select nullif(trim(auth.jwt() -> 'user_metadata' ->> 'line_user_id'), '');
$fn$;

grant execute on function public.is_admin() to authenticated, anon;
grant execute on function public.current_line_user_id() to authenticated, anon;


-- 【STEP 3】表示専用ビュー（患者に見せてよい列だけを公開）
--   security_invoker = false → ビュー所有者権限で実行して元テーブルのRLSを跨ぐが、
--   公開される列は安全なものだけ。自分の予約かは is_mine で返すので user_id も出ない。

drop view if exists public.booking_slots;
create view public.booking_slots
with (security_invoker = false, security_barrier = true) as
select b.id, b.date, b.start_time, b.end_time, b.staff, b.status,
       (b.user_id is not null and b.user_id = public.current_line_user_id()) as is_mine
from public.bookings b;
revoke all on public.booking_slots from anon, authenticated;
grant select on public.booking_slots to anon, authenticated;

-- blocks.reason にはスタッフの欠勤理由（骨折、帰省、人名など）が入っているので
-- 本文は公開せず、定休日解除枠かどうかの真偽値に目潰す。
drop view if exists public.block_slots;
create view public.block_slots
with (security_invoker = false, security_barrier = true) as
select b.date, b.time, b.staff,
       (b.reason = '__OPEN_OVERRIDE__') as is_open_override
from public.blocks b;
revoke all on public.block_slots from anon, authenticated;
grant select on public.block_slots to anon, authenticated;


-- 【STEP 4】ポリシー張り替え（セッション導入より先に必ずこれをやる）
do $blk$
declare r record;
begin
  -- bookings / blocks は authenticated 向けの旧ポリシーだけを落とす
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('bookings','blocks')
      and 'authenticated' = any(roles::text[])
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  -- 管理者専用テーブルは全廃止して張り直す
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('expenses','advance_tab_payments','expense_audit_logs','audit_logs')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $blk$;

create policy "admin_all_bookings" on public.bookings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "patient_insert_bookings" on public.bookings
  for insert to authenticated
  with check (user_id is not null and user_id = public.current_line_user_id());
create policy "patient_update_own_bookings" on public.bookings
  for update to authenticated
  using      (user_id is not null and user_id = public.current_line_user_id())
  with check (user_id is not null and user_id = public.current_line_user_id());
create policy "patient_select_own_bookings" on public.bookings
  for select to authenticated
  using (user_id is not null and user_id = public.current_line_user_id());

create policy "admin_all_blocks" on public.blocks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin_all_expenses" on public.expenses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin_all_advance_tab_payments" on public.advance_tab_payments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin_all_expense_audit_logs" on public.expense_audit_logs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- audit_logs: 参照は管理者のみ、記録は認証済み全員（患者の予約ログを含む）
create policy "audit_logs_select_admin" on public.audit_logs
  for select to authenticated using (public.is_admin());
create policy "audit_logs_insert_authenticated" on public.audit_logs
  for insert to authenticated with check (true);


-- 【STEP 5】クライアントをビュー経由に切り替えてデプロイ（index.html）
--   これをやってから STEP 6 に進む。逆にするとセッション失敗時に
--   空き状況が全部空きに見えて二重予約を誘発する。


-- 【STEP 6】anon の参照を閉じる（= 公開キーでの患者情報読み取りを停止）
--   anon の INSERT は残してある。セッション確立が何らかの理由で失敗しても
--   予約自体は取れるようにするため。安定稼働を確認できたら下記で落としてもよい:
--     drop policy if exists "Public Insert Bookings" on public.bookings;
do $blk2$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('bookings','blocks')
      and 'anon' = any(roles::text[]) and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $blk2$;


-- ============================================================================
-- 検証（実施済み・全て期待値どおり）
-- ============================================================================
-- 公開キーだけで REST を叩いた結果:
--   bookings / blocks / expenses / advance_tab_payments / audit_logs /
--   admin_users / bookings_user_id_backup_20260819  → すべて [] （0件）
--   booking_slots / block_slots → 読める（PIIなし）
--
-- ペルソナ別の可視範囲を SQL で検証する場合:
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','<uuid>','role','authenticated',
--       'user_metadata', json_build_object('line_user_id','U...'))::text, true);
--   set local role authenticated;
--   select public.is_admin(), public.current_line_user_id(),
--          (select count(*) from public.bookings), (select count(*) from public.expenses);
--   rollback;


-- ============================================================================
-- ロールバック（患者が予約できなくなった場合）
-- ============================================================================
-- create policy "Public Read Bookings"    on public.bookings for select to anon using (true);
-- create policy "Public Read Only Blocks" on public.blocks   for select to anon using (true);
-- create policy "patient_select_blocks"   on public.blocks   for select to authenticated using (true);
