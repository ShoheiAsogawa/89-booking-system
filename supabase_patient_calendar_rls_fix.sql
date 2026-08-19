-- =====================================================
-- 患者予約画面が読み込み中のまま固まる件の RLS 補正
-- =====================================================
-- supabase_rls_hardening.sql を既に実行済みの場合のみ、このファイルを
-- Supabase SQL Editor で実行してください（未実行なら hardening 側を実行）。
--
-- 変更点:
-- 1. 予約カレンダー表示に必要な bookings / blocks / staffs の SELECT を
--    anon でも許可（LINE userId 運用のため、患者は常時 Auth ユーザーではない）
-- 2. 予約 INSERT/UPDATE は「auth.uid() と user_id の一致」をやめ、
--    ログイン済み（匿名含む）かつ user_id ありなら許可。
--    ※ 患者の user_id は LINE userId であり Supabase UUID ではないため
--
-- 管理者専用テーブル（expenses / advance_tab_payments 等）は変更しません。

DROP POLICY IF EXISTS "bookings_select_authenticated" ON bookings;
DROP POLICY IF EXISTS "bookings_select_calendar" ON bookings;
CREATE POLICY "bookings_select_calendar" ON bookings
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "bookings_insert_policy" ON bookings;
CREATE POLICY "bookings_insert_policy" ON bookings
  FOR INSERT TO authenticated
  WITH CHECK (
    is_admin()
    OR (user_id IS NOT NULL AND auth.uid() IS NOT NULL)
  );

DROP POLICY IF EXISTS "bookings_update_policy" ON bookings;
CREATE POLICY "bookings_update_policy" ON bookings
  FOR UPDATE TO authenticated
  USING (is_admin() OR (user_id IS NOT NULL AND auth.uid() IS NOT NULL))
  WITH CHECK (is_admin() OR (user_id IS NOT NULL AND auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "blocks_select_authenticated" ON blocks;
DROP POLICY IF EXISTS "blocks_select_calendar" ON blocks;
CREATE POLICY "blocks_select_calendar" ON blocks
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "staffs_select_authenticated" ON staffs;
DROP POLICY IF EXISTS "staffs_select_calendar" ON staffs;
CREATE POLICY "staffs_select_calendar" ON staffs
  FOR SELECT TO anon, authenticated USING (true);
