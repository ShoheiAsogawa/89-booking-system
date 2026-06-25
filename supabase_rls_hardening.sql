-- =====================================================
-- RLS 強化マイグレーション
-- ① anon（公開キー）による書き込みを禁止
-- ② bookings / blocks / staffs に管理者・患者向けポリシーを設定
-- =====================================================
-- Supabase SQL Editor でこのファイルを丸ごと実行してください。
-- 前提: 管理画面はメール+パスワード（JWTに email あり）、患者は LINE ログイン

-- 管理者判定: Supabase Auth のメールログインユーザーのみ true
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(TRIM(auth.jwt() ->> 'email'), '') IS NOT NULL, false);
$$;

-- =====================================================
-- bookings
-- =====================================================
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_anon_select" ON bookings;
DROP POLICY IF EXISTS "bookings_anon_insert" ON bookings;
DROP POLICY IF EXISTS "bookings_anon_update" ON bookings;
DROP POLICY IF EXISTS "bookings_anon_delete" ON bookings;
DROP POLICY IF EXISTS "bookings_select_authenticated" ON bookings;
DROP POLICY IF EXISTS "bookings_insert_policy" ON bookings;
DROP POLICY IF EXISTS "bookings_update_policy" ON bookings;
DROP POLICY IF EXISTS "bookings_delete_admin" ON bookings;
DROP POLICY IF EXISTS "Enable read access for all users" ON bookings;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON bookings;
DROP POLICY IF EXISTS "Enable update for users based on email" ON bookings;

-- 予約枠表示のため、認証済みユーザーは一覧参照可（患者アプリの空き確認に必要）
CREATE POLICY "bookings_select_authenticated" ON bookings
  FOR SELECT TO authenticated USING (true);

-- 患者: 自分の user_id で予約作成 / 管理者: 電話予約など自由に作成
CREATE POLICY "bookings_insert_policy" ON bookings
  FOR INSERT TO authenticated
  WITH CHECK (
    is_admin()
    OR (user_id IS NOT NULL AND user_id = auth.uid()::text)
  );

-- 患者: 自分の予約のみ更新（キャンセル等） / 管理者: 全件
CREATE POLICY "bookings_update_policy" ON bookings
  FOR UPDATE TO authenticated
  USING (is_admin() OR (user_id IS NOT NULL AND user_id = auth.uid()::text))
  WITH CHECK (is_admin() OR (user_id IS NOT NULL AND user_id = auth.uid()::text));

-- 物理削除は管理者のみ（通常はステータス変更で運用）
CREATE POLICY "bookings_delete_admin" ON bookings
  FOR DELETE TO authenticated
  USING (is_admin());

-- =====================================================
-- blocks
-- =====================================================
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocks_anon_select" ON blocks;
DROP POLICY IF EXISTS "blocks_anon_insert" ON blocks;
DROP POLICY IF EXISTS "blocks_anon_update" ON blocks;
DROP POLICY IF EXISTS "blocks_anon_delete" ON blocks;
DROP POLICY IF EXISTS "blocks_select_authenticated" ON blocks;
DROP POLICY IF EXISTS "blocks_write_admin" ON blocks;
DROP POLICY IF EXISTS "blocks_insert_admin" ON blocks;
DROP POLICY IF EXISTS "blocks_update_admin" ON blocks;
DROP POLICY IF EXISTS "blocks_delete_admin" ON blocks;

CREATE POLICY "blocks_select_authenticated" ON blocks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "blocks_insert_admin" ON blocks
  FOR INSERT TO authenticated WITH CHECK (is_admin());

CREATE POLICY "blocks_update_admin" ON blocks
  FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "blocks_delete_admin" ON blocks
  FOR DELETE TO authenticated USING (is_admin());

-- =====================================================
-- staffs（料金マスタ）
-- =====================================================
ALTER TABLE staffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staffs_anon_select" ON staffs;
DROP POLICY IF EXISTS "staffs_anon_insert" ON staffs;
DROP POLICY IF EXISTS "staffs_anon_update" ON staffs;
DROP POLICY IF EXISTS "staffs_anon_delete" ON staffs;
DROP POLICY IF EXISTS "staffs_select_authenticated" ON staffs;
DROP POLICY IF EXISTS "staffs_write_admin" ON staffs;
DROP POLICY IF EXISTS "staffs_insert_admin" ON staffs;
DROP POLICY IF EXISTS "staffs_update_admin" ON staffs;
DROP POLICY IF EXISTS "staffs_delete_admin" ON staffs;

CREATE POLICY "staffs_select_authenticated" ON staffs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "staffs_insert_admin" ON staffs
  FOR INSERT TO authenticated WITH CHECK (is_admin());

CREATE POLICY "staffs_update_admin" ON staffs
  FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "staffs_delete_admin" ON staffs
  FOR DELETE TO authenticated USING (is_admin());

-- =====================================================
-- expenses（経費）— 管理者のみ
-- =====================================================
DROP POLICY IF EXISTS "expenses_anon_select" ON expenses;
DROP POLICY IF EXISTS "expenses_anon_insert" ON expenses;
DROP POLICY IF EXISTS "expenses_anon_update" ON expenses;
DROP POLICY IF EXISTS "expenses_anon_delete" ON expenses;
DROP POLICY IF EXISTS "expenses_select_policy" ON expenses;
DROP POLICY IF EXISTS "expenses_insert_policy" ON expenses;
DROP POLICY IF EXISTS "expenses_update_policy" ON expenses;
DROP POLICY IF EXISTS "expenses_delete_policy" ON expenses;
DROP POLICY IF EXISTS "expenses_admin_all" ON expenses;

CREATE POLICY "expenses_admin_all" ON expenses
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- =====================================================
-- advance_tab_payments（先払い・つけ払い）— 管理者のみ
-- =====================================================
DROP POLICY IF EXISTS "advance_tab_payments_anon_select" ON advance_tab_payments;
DROP POLICY IF EXISTS "advance_tab_payments_anon_insert" ON advance_tab_payments;
DROP POLICY IF EXISTS "advance_tab_payments_anon_update" ON advance_tab_payments;
DROP POLICY IF EXISTS "advance_tab_payments_anon_delete" ON advance_tab_payments;
DROP POLICY IF EXISTS "advance_tab_payments_select" ON advance_tab_payments;
DROP POLICY IF EXISTS "advance_tab_payments_insert" ON advance_tab_payments;
DROP POLICY IF EXISTS "advance_tab_payments_update" ON advance_tab_payments;
DROP POLICY IF EXISTS "advance_tab_payments_delete" ON advance_tab_payments;
DROP POLICY IF EXISTS "advance_tab_payments_admin_all" ON advance_tab_payments;

CREATE POLICY "advance_tab_payments_admin_all" ON advance_tab_payments
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- =====================================================
-- audit_logs — 参照は管理者のみ、記録は認証済み全員（患者の予約ログ含む）
-- =====================================================
DROP POLICY IF EXISTS "audit_logs_anon_select" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_anon_insert" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_select_policy" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_policy" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_select_admin" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_authenticated" ON audit_logs;

CREATE POLICY "audit_logs_select_admin" ON audit_logs
  FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "audit_logs_insert_authenticated" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- =====================================================
-- expense_audit_logs — 管理者のみ
-- =====================================================
DROP POLICY IF EXISTS "expense_audit_logs_anon_select" ON expense_audit_logs;
DROP POLICY IF EXISTS "expense_audit_logs_anon_insert" ON expense_audit_logs;
DROP POLICY IF EXISTS "expense_audit_logs_select" ON expense_audit_logs;
DROP POLICY IF EXISTS "expense_audit_logs_insert" ON expense_audit_logs;
DROP POLICY IF EXISTS "expense_audit_logs_admin_all" ON expense_audit_logs;

CREATE POLICY "expense_audit_logs_admin_all" ON expense_audit_logs
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
