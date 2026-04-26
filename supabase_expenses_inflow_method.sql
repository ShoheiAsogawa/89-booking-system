-- =====================================================
-- expenses テーブルに 決済方法カラムを追加
-- 出金/入金の方法（現金 / カード / PayPay / その他）を保存する拡張
-- =====================================================
-- Supabase SQLエディターで実行してください

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS inflow_method TEXT;

COMMENT ON COLUMN expenses.inflow_method IS '出金/入金の方法。現金 / カード / PayPay / その他';

-- 値のゆらぎ防止（未入力は許可）
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_inflow_method_check;
ALTER TABLE expenses
ADD CONSTRAINT expenses_inflow_method_check
CHECK (inflow_method IS NULL OR inflow_method IN ('現金', 'カード', 'PayPay', 'その他'));

-- 既存データ移行:
-- この機能導入前の出金データは「現金」扱いにする
UPDATE expenses
SET inflow_method = '現金'
WHERE (flow = 'out' OR flow IS NULL)
  AND (inflow_method IS NULL OR inflow_method = '');
