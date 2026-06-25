-- =====================================================
-- advance_tab_payments に患者名カラムを追加
-- 既に supabase_advance_tab_payments.sql を実行済みの場合に使用
-- =====================================================

ALTER TABLE advance_tab_payments
  ADD COLUMN IF NOT EXISTS patient_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_advance_tab_payments_patient_name ON advance_tab_payments(patient_name);

COMMENT ON COLUMN advance_tab_payments.patient_name IS '患者名';
