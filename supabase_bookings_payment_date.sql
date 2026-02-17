-- =====================================================
-- bookings テーブルに 決済日 (payment_date) を追加
-- ツケ払い・保険は治療日と決済日が異なるため、売上カウント日に使用
-- =====================================================
-- Supabase SQLエディターで実行してください

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS payment_date DATE NULL;

COMMENT ON COLUMN bookings.payment_date IS '決済日（ツケ払い・保険のみ。売上カウント日に使用）';

CREATE INDEX IF NOT EXISTS idx_bookings_payment_date ON bookings(payment_date) WHERE payment_date IS NOT NULL;
