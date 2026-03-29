-- 予約に複数決済の内訳を保存する列を追加
-- 実行場所: Supabase SQL Editor

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS payment_breakdown JSONB;

COMMENT ON COLUMN bookings.payment_breakdown IS
'複数決済の内訳。例: [{"method":"ペイペイ","amount":3000,"payment_date":""},{"method":"現金","amount":2000,"payment_date":""}]';
