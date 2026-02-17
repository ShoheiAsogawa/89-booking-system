-- =====================================================
-- expenses テーブルに 論理削除用 deleted_at を追加
-- 削除時はレコードを消さず deleted_at を設定。一覧・集計では除外
-- =====================================================
-- Supabase SQLエディターで実行してください

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN expenses.deleted_at IS '論理削除日時。NULLのときは有効、設定時は削除済み（一覧・集計から除外）';

CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at ON expenses(deleted_at) WHERE deleted_at IS NOT NULL;
