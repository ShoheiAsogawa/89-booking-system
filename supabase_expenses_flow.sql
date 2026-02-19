-- =====================================================
-- expenses テーブルに 出金/入金 区分 (flow) を追加
-- 小口経費の大型アップデート: 出金と入金を区別
-- =====================================================
-- Supabase SQLエディターで実行してください

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS flow TEXT NOT NULL DEFAULT 'out';

COMMENT ON COLUMN expenses.flow IS '出金=out, 入金=in。既存レコードは出金(out)として扱う';

-- 既存行が NULL になる可能性がある場合の保険
UPDATE expenses SET flow = 'out' WHERE flow IS NULL;
