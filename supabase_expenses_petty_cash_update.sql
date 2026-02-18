-- =====================================================
-- 小口経費システム 大型アップデート
-- 出金・入金対応 / 税貯項目 / 削除済み非表示対応
-- =====================================================
-- Supabase SQLエディターで実行してください
-- https://supabase.com/dashboard → プロジェクト → SQL Editor

-- =====================================================
-- 1. transaction_type（出金/入金）カラム追加
-- =====================================================
ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT '出金';

COMMENT ON COLUMN expenses.transaction_type IS '種別: 出金=支出, 入金=収入';

-- 既存データはすべて出金として扱う
UPDATE expenses SET transaction_type = '出金' WHERE transaction_type IS NULL;

-- インデックス（フィルタ用）
CREATE INDEX IF NOT EXISTS idx_expenses_transaction_type ON expenses(transaction_type);

-- =====================================================
-- 2. tax_savings（税貯）カラム追加
-- 消費税分を貯金していくための金額
-- =====================================================
ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS tax_savings INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN expenses.tax_savings IS '税貯: 消費税分の貯金額（円）。0の場合は税貯なし';

-- amount の CHECK 制約を緩和（既存の amount > 0 は維持、入金も正の値で記録）
-- ※ amount は常に正の値。出金=支出、入金=収入は transaction_type で区別

-- =====================================================
-- 3. deleted_at が未追加の場合は追加（論理削除）
-- =====================================================
ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN expenses.deleted_at IS '論理削除日時。NULLのときは有効、設定時は削除済み（一覧・集計から除外）';

CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at ON expenses(deleted_at) WHERE deleted_at IS NOT NULL;

-- =====================================================
-- 4. 確認用クエリ
-- =====================================================
SELECT 
  column_name, 
  data_type, 
  column_default,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'expenses'
ORDER BY ordinal_position;
