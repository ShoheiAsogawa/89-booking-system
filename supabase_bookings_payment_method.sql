-- =====================================================
-- bookings テーブルに 決済方法 (payment_method) を追加
-- 現金・クレジット・PayPay・マッサージ券・ツケ払い・保険（旧データのチケット・商品券も互換で扱えます）
-- =====================================================
-- Supabase SQLエディターで実行してください（payment_date より先に実行しても可）

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS payment_method TEXT NULL;

COMMENT ON COLUMN bookings.payment_method IS '決済方法: 現金, クレジット, ペイペイ, マッサージ券, ツケ払い, 保険';

-- 既存データをまとめてリネームする場合（任意）
-- UPDATE bookings SET payment_method = 'マッサージ券' WHERE payment_method IN ('チケット', '商品券');

-- 決済方法で検索する場合用（任意）
CREATE INDEX IF NOT EXISTS idx_bookings_payment_method ON bookings(payment_method) WHERE payment_method IS NOT NULL;
