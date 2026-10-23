-- 管理画面の時間外設定をスタッフ間で共有するための列。
-- 患者予約画面（index.html の WORK_HOURS）は変更しません。
-- Supabase SQL Editor で実行してください。未実行でも、設定したブラウザの localStorage には保存されます。

alter table public.staffs add column if not exists hours_start text;
alter table public.staffs add column if not exists hours_end text;
