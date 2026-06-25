-- =====================================================
-- 先払い・つけ払いテーブル (advance_tab_payments)
-- 予約とは別に、支払日ベースでスタッフ売上に計上する
-- =====================================================
-- SupabaseのSQLエディターでこのコードを実行してください
-- ※ 先に supabase_migration.sql または supabase_rls_hardening.sql で is_admin() を作成してください

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(TRIM(auth.jwt() ->> 'email'), '') IS NOT NULL, false);
$$;

CREATE TABLE IF NOT EXISTS advance_tab_payments (
  id BIGSERIAL PRIMARY KEY,
  payment_date DATE NOT NULL,
  patient_name TEXT NOT NULL DEFAULT '',
  booking_id TEXT,
  staff TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('先払い', 'つけ払い')),
  memo TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_advance_tab_payments_payment_date ON advance_tab_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_advance_tab_payments_staff ON advance_tab_payments(staff);
CREATE INDEX IF NOT EXISTS idx_advance_tab_payments_payment_type ON advance_tab_payments(payment_type);
CREATE INDEX IF NOT EXISTS idx_advance_tab_payments_deleted_at ON advance_tab_payments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_advance_tab_payments_booking_id ON advance_tab_payments(booking_id);

COMMENT ON TABLE advance_tab_payments IS '先払い・つけ払い管理 - 支払日にスタッフ売上へ計上';
COMMENT ON COLUMN advance_tab_payments.payment_date IS '支払日（売上カウント日）';
COMMENT ON COLUMN advance_tab_payments.patient_name IS '患者名';
COMMENT ON COLUMN advance_tab_payments.booking_id IS '紐づけ予約ID（bookings.id）';
COMMENT ON COLUMN advance_tab_payments.staff IS '担当スタッフ名';
COMMENT ON COLUMN advance_tab_payments.amount IS '金額（円）';
COMMENT ON COLUMN advance_tab_payments.payment_method IS '支払方法: 現金, クレジット, ペイペイ, マッサージ券 など';
COMMENT ON COLUMN advance_tab_payments.payment_type IS '分類: 先払い または つけ払い';
COMMENT ON COLUMN advance_tab_payments.memo IS '備考メモ';
COMMENT ON COLUMN advance_tab_payments.deleted_at IS '論理削除日時（NULL=有効）';

ALTER TABLE advance_tab_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advance_tab_payments_select" ON advance_tab_payments
  FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "advance_tab_payments_insert" ON advance_tab_payments
  FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "advance_tab_payments_update" ON advance_tab_payments
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "advance_tab_payments_delete" ON advance_tab_payments
  FOR DELETE TO authenticated USING (is_admin());
