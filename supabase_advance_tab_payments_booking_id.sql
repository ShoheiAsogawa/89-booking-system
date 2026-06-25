-- =====================================================
-- advance_tab_payments に予約紐づけカラムを追加
-- 既に supabase_advance_tab_payments.sql を実行済みの場合に使用
-- =====================================================

ALTER TABLE advance_tab_payments
  ADD COLUMN IF NOT EXISTS booking_id TEXT;

CREATE INDEX IF NOT EXISTS idx_advance_tab_payments_booking_id ON advance_tab_payments(booking_id);

COMMENT ON COLUMN advance_tab_payments.booking_id IS '紐づけ予約ID（bookings.id）';
