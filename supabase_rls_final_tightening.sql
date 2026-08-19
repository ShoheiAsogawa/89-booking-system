-- ============================================================================
-- 最終ステップ: anon を閉じて患者の個人情報露出を止める
-- ============================================================================
-- 【実行前の必須条件】
--   LINE アプリから実機で予約ページを開き、以下の2点を確認してから実行すること。
--     (1) 自分の予約がオレンジ色（own）で表示される
--     (2) 自分の予約をキャンセルできる
--   この2つが動いていれば = Edge Function 経由のセッション確立が成功している証拠。
--   未確認のまま実行すると、セッションが失敗していた場合に
--   患者が予約できなくなる（anon フォールバックがなくなるため）。
--
-- 【SQL Editor での確認方法】
--   select count(*) from auth.users u join auth.identities i on i.user_id = u.id
--   where u.email like '%@line.89center.dev';
--   → 1件以上あれば line-login 経由でユーザーが作られている。
-- ============================================================================

-- 1) 患者の bookings SELECT を「自分の予約のみ」に絞る。
--    空き状況は booking_slots ビュー（氏名・電話・症状を含まない）から読むので
--    本テーブルの全件参照は不要になっている。
drop policy if exists "patient_select_bookings" on public.bookings;

create policy "patient_select_own_bookings" on public.bookings
  for select to authenticated
  using (user_id is not null and user_id = public.current_line_user_id());

-- 2) anon 向けポリシーを全廃止。ここで公開キーだけの読み取りが止まる。
do $blk$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('bookings','blocks')
      and 'anon' = any(roles::text[])
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $blk$;

-- 3) 検証: ペルソナ別の可視範囲
--    期待値: admin = 全件 / patient = 自分の予約だけ / anon = 0件
create temp table _chk(persona text, bookings bigint, blocks bigint, slots bigint);
grant all on _chk to authenticated, anon;

select set_config('request.jwt.claims', json_build_object('sub','3a521733-e784-48a3-9aef-38ae233718ab','role','authenticated')::text, true);
set local role authenticated;
insert into _chk select '(a) admin',
  (select count(*) from public.bookings), (select count(*) from public.blocks),
  (select count(*) from public.booking_slots);
reset role;

select set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
set local role anon;
insert into _chk select '(c) anon',
  (select count(*) from public.bookings), (select count(*) from public.blocks),
  (select count(*) from public.booking_slots);
reset role;

select * from _chk order by persona;

-- ============================================================================
-- ロールバック（患者が予約できなくなった場合はこれを実行）
-- ============================================================================
-- create policy "Public Read Bookings"    on public.bookings for select to anon using (true);
-- create policy "Public Insert Bookings"  on public.bookings for insert to anon with check (true);
-- create policy "Public Read Only Blocks" on public.blocks   for select to anon using (true);
-- drop policy if exists "patient_select_own_bookings" on public.bookings;
-- create policy "patient_select_bookings" on public.bookings for select to authenticated using (true);

-- ============================================================================
-- 2026-08-19 に適用済みの内容（記録）
-- ============================================================================
-- ✓ bookings.user_id を UUID → LINE userId に付け替え（411件。バックアップ 832件）
-- ✓ Edge Function line-login をデプロイ（Verify JWT = OFF。関数内でLINE検証）
-- ✓ admin_users テーブル + is_admin() を作成し、管理者2アカウントを登録
-- ✓ 「Admin Full Access（authenticated なら ALL/USING true）」を廃止。
--   これが残っていると患者がセッションを持った瞬間に全権限になるため、
--   セッション導入より先に必ず廃止する必要があった。
-- ✓ expenses / advance_tab_payments / expense_audit_logs / audit_logs を is_admin() で保護
-- ✓ booking_slots ビューを作成（PIIなし、is_mine で自分の予約を表現）
-- ✓ index.html: establishSupabaseSession() 追加 / booking_slots 利用 / キャンセル行数検査
--
-- 注: docs/PATIENT_AUTH_AND_RLS_MIGRATION.md のフェーズ順序（先にセッション、
--     後でRLS）は、既存の Admin Full Access ポリシーを前提にしていなかったため
--     安全でなく、順序を入れ替えて適用した。このファイルの記録が実態。
