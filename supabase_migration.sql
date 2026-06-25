-- =====================================================
-- 89CENTER 予約管理システム - Supabase マイグレーション
-- 経費テーブル + 監査ログテーブル 作成
-- =====================================================
-- SupabaseのSQLエディターでこのコードを実行してください

-- 管理者判定（メール+パスワードでログインした Supabase Auth ユーザーのみ true）
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(TRIM(auth.jwt() ->> 'email'), '') IS NOT NULL, false);
$$;

-- =====================================================
-- 1. 経費テーブル (expenses)
-- レジからの直接出金や消耗品購入などを記録
-- =====================================================
CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  category TEXT NOT NULL DEFAULT 'その他',
  item_name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  staff TEXT,
  memo TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at);

-- コメント
COMMENT ON TABLE expenses IS '経費管理テーブル - レジ出金、消耗品、交通費等の支出を記録';
COMMENT ON COLUMN expenses.date IS '経費発生日';
COMMENT ON COLUMN expenses.category IS 'カテゴリ: 銀行手数料, 駐車場代, 代引き, その他';
COMMENT ON COLUMN expenses.item_name IS '項目名（例: 駐車場代、ATM手数料 など）';
COMMENT ON COLUMN expenses.amount IS '金額（円）';
COMMENT ON COLUMN expenses.staff IS '担当スタッフ名';
COMMENT ON COLUMN expenses.memo IS '備考メモ';
COMMENT ON COLUMN expenses.created_by IS '登録者メールアドレス';
COMMENT ON COLUMN expenses.created_at IS '登録日時';

-- RLS（Row Level Security）設定
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- 管理者のみ操作可能
CREATE POLICY "expenses_select_policy" ON expenses
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "expenses_insert_policy" ON expenses
  FOR INSERT TO authenticated WITH CHECK (is_admin());

CREATE POLICY "expenses_update_policy" ON expenses
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "expenses_delete_policy" ON expenses
  FOR DELETE TO authenticated USING (is_admin());


-- =====================================================
-- 2. 監査ログテーブル (audit_logs)
-- 予約に対する全アクションを記録（改ざん防止）
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  booking_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  user_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_audit_logs_booking_id ON audit_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- コメント
COMMENT ON TABLE audit_logs IS '監査ログテーブル - 予約に対する全アクション履歴を記録（改ざん防止）';
COMMENT ON COLUMN audit_logs.booking_id IS '対象予約ID';
COMMENT ON COLUMN audit_logs.action IS 'アクション種別: 予約作成, キャンセル, 決済方法変更, 料金変更, メモ更新, 患者情報編集';
COMMENT ON COLUMN audit_logs.details IS 'アクション詳細（変更内容等）';
COMMENT ON COLUMN audit_logs.user_email IS '操作者のメールアドレス';
COMMENT ON COLUMN audit_logs.created_at IS 'アクション発生日時';

-- RLS設定
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 閲覧は管理者のみ、追記は認証済み全員（患者の予約ログ含む）
CREATE POLICY "audit_logs_select_policy" ON audit_logs
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "audit_logs_insert_policy" ON audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- 注意: audit_logsテーブルにはUPDATE/DELETEポリシーを設定しません
-- これにより改ざん防止を実現します（追記のみ可能）


-- =====================================================
-- 3. 小口経費 編集履歴テーブル (expense_audit_logs)
-- 小口経費の登録・編集・削除を記録
-- =====================================================
CREATE TABLE IF NOT EXISTS expense_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  expense_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  user_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_audit_logs_expense_id ON expense_audit_logs(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_audit_logs_created_at ON expense_audit_logs(created_at);

COMMENT ON TABLE expense_audit_logs IS '小口経費の編集履歴 - 登録・編集・削除を記録';
COMMENT ON COLUMN expense_audit_logs.expense_id IS '対象経費ID';
COMMENT ON COLUMN expense_audit_logs.action IS 'アクション: 登録, 編集, 削除';
COMMENT ON COLUMN expense_audit_logs.details IS '変更内容の詳細';
COMMENT ON COLUMN expense_audit_logs.user_email IS '操作者メールアドレス';
COMMENT ON COLUMN expense_audit_logs.created_at IS '発生日時';

ALTER TABLE expense_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_audit_logs_select" ON expense_audit_logs FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "expense_audit_logs_insert" ON expense_audit_logs FOR INSERT TO authenticated WITH CHECK (is_admin());


-- =====================================================
-- 4. 確認用クエリ（テーブル作成の確認）
-- ※ 必ず SELECT 〜 ORDER BY までをまとめて実行してください。
--    「WHERE ...」の行だけを実行すると syntax error になります。
-- =====================================================
SELECT 
  table_name, 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns 
WHERE table_name IN ('expenses', 'audit_logs', 'expense_audit_logs')
ORDER BY table_name, ordinal_position;
