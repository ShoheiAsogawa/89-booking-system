-- =====================================================
-- 旧「ツケ払い」予約を advance_tab_payments（新つけ払い）へ移行
-- =====================================================
-- 実行前: supabase_advance_tab_payments.sql を実行済みであること
-- 効果:
--   1. 予約の payment_method=ツケ払い（別名含む）を advance_tab_payments に移す
--   2. 予約側のツケ払いフラグをクリア（二重計上防止）
-- 注意: 本番実行前にバックアップを取ってください

BEGIN;

-- 単一決済の旧ツケ払い → つけ払いとして登録
INSERT INTO advance_tab_payments (
  payment_date,
  patient_name,
  booking_id,
  staff,
  amount,
  payment_method,
  payment_type,
  memo,
  created_by
)
SELECT
  COALESCE(NULLIF(TRIM(b.payment_date::text), '')::date, b.date::date),
  COALESCE(NULLIF(TRIM(b.patient_name), ''), '（名前なし）'),
  b.id::text,
  COALESCE(NULLIF(TRIM(b.staff), ''), '未設定'),
  GREATEST(COALESCE(b.fee, 0), 1),
  '現金',
  'つけ払い',
  '旧予約ツケ払いから自動移行（単一決済）',
  'migration'
FROM bookings b
WHERE COALESCE(b.status, '') <> 'キャンセル'
  AND b.payment_method IN ('ツケ払い', 'つけ払い', '付け払い', '掛け払い', '掛払い')
  AND COALESCE(b.fee, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM advance_tab_payments atp
    WHERE atp.booking_id = b.id::text
      AND atp.deleted_at IS NULL
  );

-- 分割決済内訳の旧ツケ払い行 → つけ払いとして登録
INSERT INTO advance_tab_payments (
  payment_date,
  patient_name,
  booking_id,
  staff,
  amount,
  payment_method,
  payment_type,
  memo,
  created_by
)
SELECT
  COALESCE(
    NULLIF(TRIM(row.elem->>'payment_date'), '')::date,
    NULLIF(TRIM(b.payment_date::text), '')::date,
    b.date::date
  ),
  COALESCE(NULLIF(TRIM(b.patient_name), ''), '（名前なし）'),
  b.id::text,
  COALESCE(NULLIF(TRIM(b.staff), ''), '未設定'),
  GREATEST((row.elem->>'amount')::int, 1),
  '現金',
  'つけ払い',
  '旧予約ツケ払いから自動移行（分割内訳）',
  'migration'
FROM bookings b
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN b.payment_breakdown IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(b.payment_breakdown) = 'array' THEN b.payment_breakdown
    ELSE '[]'::jsonb
  END
) AS row(elem)
WHERE COALESCE(b.status, '') <> 'キャンセル'
  AND b.payment_method = '分割'
  AND row.elem->>'method' IN ('ツケ払い', 'つけ払い', '付け払い', '掛け払い', '掛払い')
  AND COALESCE((row.elem->>'amount')::int, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM advance_tab_payments atp
    WHERE atp.booking_id = b.id::text
      AND atp.deleted_at IS NULL
      AND atp.memo LIKE '%分割内訳%'
      AND atp.amount = GREATEST((row.elem->>'amount')::int, 1)
  );

-- 単一決済の旧ツケ払いを予約からクリア
UPDATE bookings b
SET
  payment_method = NULL,
  payment_date = NULL
WHERE COALESCE(b.status, '') <> 'キャンセル'
  AND b.payment_method IN ('ツケ払い', 'つけ払い', '付け払い', '掛け払い', '掛払い')
  AND EXISTS (
    SELECT 1
    FROM advance_tab_payments atp
    WHERE atp.booking_id = b.id::text
      AND atp.deleted_at IS NULL
  );

-- 分割決済: 内訳からツケ払い行を除去し、残り1行なら単一決済へ昇格
UPDATE bookings b
SET payment_breakdown = sub.new_breakdown
FROM (
  SELECT
    bk.id,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'method', elem->>'method',
          'amount', (elem->>'amount')::int,
          'payment_date', COALESCE(elem->>'payment_date', '')
        )
      ) FILTER (
        WHERE elem->>'method' NOT IN ('ツケ払い', 'つけ払い', '付け払い', '掛け払い', '掛払い')
      ),
      '[]'::jsonb
    ) AS new_breakdown
  FROM bookings bk
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN bk.payment_breakdown IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(bk.payment_breakdown) = 'array' THEN bk.payment_breakdown
      ELSE '[]'::jsonb
    END
  ) AS elem
  WHERE bk.payment_method = '分割'
  GROUP BY bk.id
) sub
WHERE b.id = sub.id
  AND b.payment_method = '分割'
  AND sub.new_breakdown IS NOT NULL;

UPDATE bookings b
SET
  payment_method = sub.only_method,
  payment_date = NULLIF(sub.only_date, ''),
  payment_breakdown = NULL
FROM (
  SELECT
    bk.id,
    elem->>'method' AS only_method,
    COALESCE(elem->>'payment_date', '') AS only_date
  FROM bookings bk
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN bk.payment_breakdown IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(bk.payment_breakdown) = 'array' THEN bk.payment_breakdown
      ELSE '[]'::jsonb
    END
  ) AS elem
  WHERE bk.payment_method = '分割'
    AND jsonb_array_length(
      CASE
        WHEN bk.payment_breakdown IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(bk.payment_breakdown) = 'array' THEN bk.payment_breakdown
        ELSE '[]'::jsonb
      END
    ) = 1
) sub
WHERE b.id = sub.id;

UPDATE bookings b
SET
  payment_method = NULL,
  payment_date = NULL,
  payment_breakdown = NULL
WHERE b.payment_method = '分割'
  AND (
    b.payment_breakdown IS NULL
    OR b.payment_breakdown = '[]'::jsonb
    OR jsonb_array_length(b.payment_breakdown) = 0
  );

COMMIT;

-- 移行結果の確認用（任意）
-- SELECT payment_type, COUNT(*) FROM advance_tab_payments WHERE memo LIKE '%自動移行%' GROUP BY payment_type;
-- SELECT payment_method, COUNT(*) FROM bookings WHERE payment_method IN ('ツケ払い','つけ払い','付け払い','掛け払い','掛払い') GROUP BY payment_method;
