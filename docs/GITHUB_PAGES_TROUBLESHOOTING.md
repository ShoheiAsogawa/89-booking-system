# GitHub Pages デプロイ失敗時の対処（Get Pages site failed / Not Found）

「Get Pages site failed」「HttpError: Not Found」が出る場合の対処です。

---

## 方法1: Settings で「GitHub Actions」を正しく設定する

1. リポジトリの **Settings** を開く  
   https://github.com/ShoheiAsogawa/89-booking-system/settings

2. 左メニューの **「Pages」** をクリック  
   （「Code and automation」の下にあります）

3. **「Build and deployment」** のところを確認
   - **Source** のドロップダウンで **「GitHub Actions」** を選ぶ  
   - 「Deploy from a branch」になっていると、このエラーになります

4. **「Save」** を押す（表示されていれば）

5. 一度 **Actions** タブに戻り、**「Deploy to GitHub Pages」** → **「Run workflow」** で再実行する

6. それでも失敗する場合は、**方法2（ブランチからデプロイ）** を使うと確実です。

---

## 方法2: ブランチからデプロイ（おすすめ・確実）

GitHub Actions を使わず、**main ブランチの内容をそのまま公開**する方法です。このリポジトリは静的HTMLだけなので、これで問題ありません。

### 手順

1. **Settings** → **Pages** を開く  
   https://github.com/ShoheiAsogawa/89-booking-system/settings/pages

2. **「Build and deployment」** で
   - **Source**: **「Deploy from a branch」** を選ぶ
   - **Branch**: **「main」** を選ぶ
   - **Folder**: **「/ (root)」** を選ぶ

3. **「Save」** を押す

4. 1〜2分待つと、ページ上部に  
   **「Your site is live at https://shoheiasogawa.github.io/89-booking-system/」**  
   のように表示されます。

5. 以下のURLでアクセスできます。
   - 予約画面: `https://shoheiasogawa.github.io/89-booking-system/` または `.../index.html`
   - 管理画面: `https://shoheiasogawa.github.io/89-booking-system/admin.html`

※ ユーザー名は実際のGitHubユーザー名（小文字）に読み替えてください。

### この方法のメリット

- **Actions が不要**なので「Get Pages site failed」が出ない
- push するだけで自動で反映される（ワークフロー実行不要）
- 設定が1回で済む

### 注意

- `deploy.yml` は使われませんが、残しておいても害はありません。  
  今後「GitHub Actions」に切り替えたいとき用にそのままでも大丈夫です。
