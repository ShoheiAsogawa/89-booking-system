# 89CENTER 予約システム

89CENTERの予約管理システムです。

## 📁 プロジェクト構成

- `index.html` - ユーザー向け予約画面（LINE LIFFアプリ）
- `admin.html` - 管理者向け管理画面
- `COST_OPTIMIZATION.md` - コスト最適化の詳細
- `SECURITY_AND_COST_ANALYSIS.md` - セキュリティとコスト分析

## 🚀 ローカル開発環境のセットアップ

### 前提条件

- Node.js（v14以上推奨）
- またはPython 3.x

### 起動方法

#### 方法1: Node.jsを使用（推奨）

```bash
# http-serverをグローバルにインストール（初回のみ）
npm install -g http-server

# サーバーを起動
http-server -p 8080 -o
```

#### 方法2: Pythonを使用

```bash
# Python 3.x
python -m http.server 8080

# ブラウザで http://localhost:8080 を開く
```

#### 方法3: VS Code Live Server拡張機能

1. VS Codeに「Live Server」拡張機能をインストール
2. `index.html`または`admin.html`を右クリック
3. 「Open with Live Server」を選択

## 🔧 設定

### Supabase設定

`index.html`と`admin.html`内の以下の定数を設定してください：

```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_KEY = 'your-anon-key';
```

### LINE LIFF設定

`index.html`内のLIFF IDを設定してください：

```javascript
const LIFF_ID = 'your-liff-id';
```

## 📝 機能

### ユーザー向け機能（index.html）

- 日付・時間選択による予約
- LINEログイン連携
- 予約の確認・キャンセル
- スタッフ情報・料金表示

### 管理者向け機能（admin.html）

- 予約管理（作成・編集・キャンセル）
- スロットブロック機能
- 一括ブロック設定
- 患者検索
- ダッシュボード（売上・統計）
- 料金設定

## 🔒 セキュリティ

詳細は `SECURITY_AND_COST_ANALYSIS.md` を参照してください。

主な対策：
- Supabase RLS（Row Level Security）の推奨
- 入力値検証
- XSS対策

## 💰 コスト

詳細は `COST_OPTIMIZATION.md` と `SECURITY_AND_COST_ANALYSIS.md` を参照してください。

- Supabase: 無料プランで月間50,000リクエストまで
- GitHub Pages: 完全無料
- LINE LIFF: 完全無料

## 📚 参考資料

- [Supabase Documentation](https://supabase.com/docs)
- [LINE LIFF Documentation](https://developers.line.biz/ja/docs/liff/)

