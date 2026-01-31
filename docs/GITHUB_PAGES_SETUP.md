# GitHub Pages デプロイ手順（GitHub Actions 設定後）

「Settings → Pages → Source: GitHub Actions」にした**あと**の流れです。

---

## 1. 初回デプロイを走らせる

### 方法A: すでに main に push 済みの場合

1. **Actions タブを開く**  
   https://github.com/ShoheiAsogawa/89-booking-system/actions

2. **「Deploy to GitHub Pages」ワークフローを実行**
   - 左の「Deploy to GitHub Pages」をクリック
   - 右の「Run workflow」→ ブランチ `main` のまま「Run workflow」をクリック

3. **完了を待つ**（数十秒〜1分）
   - 緑のチェックが付いたら成功

### 方法B: 新しく push する場合

```bash
# 何か変更をコミットして main に push
git add .
git commit -m "Deploy to GitHub Pages"
git push origin main
```

push すると **自動で**「Deploy to GitHub Pages」が実行されます。  
https://github.com/ShoheiAsogawa/89-booking-system/actions で実行状況を確認できます。

---

## 2. 公開URLを確認する

### 2.1 URLの形

GitHub Pages（Actions）のURLは次のとおりです。

| 種類 | URL |
|------|-----|
| **トップ（index.html）** | `https://shoheiasogawa.github.io/89-booking-system/` |
| **予約画面** | `https://shoheiasogawa.github.io/89-booking-system/index.html` |
| **管理画面** | `https://shoheiasogawa.github.io/89-booking-system/admin.html` |

※ ユーザー名が `ShoheiAsogawa`、リポジトリ名が `89-booking-system` の場合。  
※ 自分のリポジトリでは、`shoheiasogawa` を実際のGitHubユーザー名（小文字）に読み替えてください。

### 2.2 設定画面から確認する方法

1. リポジトリの **Settings** → 左メニュー **Pages**
2. 「GitHub Actions」がソースになっていることを確認
3. 上部に **「Your site is live at …」** と表示されていれば、そのURLが本番のアドレスです

---

## 3. 動作確認

1. **予約画面（患者向け）**  
   `https://shoheiasogawa.github.io/89-booking-system/index.html` をブラウザで開く  
   → カレンダー・予約フォームが表示されればOK

2. **管理画面**  
   `https://shoheiasogawa.github.io/89-booking-system/admin.html` を開く  
   → ログイン画面が出て、Supabase に接続できればOK

3. **Supabase の接続**  
   両方の画面で日付を変えたり予約一覧が表示されれば、Supabase も問題ありません。

---

## 4. LINE LIFF のURLを切り替える（予約をLINEで使っている場合）

1. **LINE Developers Console** を開く  
   https://developers.line.biz/console/

2. **該当のLIFFアプリ**を開く

3. **「Endpoint URL」を変更**
   - **変更前**: 今のAWSのURL（例: `https://xxxxx.amazonaws.com/...`）
   - **変更後**:  
     `https://shoheiasogawa.github.io/89-booking-system/index.html`

4. 保存後、LINE上で予約画面を開き、表示と予約ができるか確認

---

## 5. 今後の更新の流れ（2回目以降）

1. ローカルでコードを編集
2. コミットして **main に push**
   ```bash
   git add .
   git commit -m "〇〇を修正"
   git push origin main
   ```
3. 数秒〜1分で **自動で再デプロイ**される
4. ブラウザをリロードすれば新しい内容が反映（キャッシュで古い場合は強制再読込）

**手動でデプロイし直したい場合**  
Actions → 「Deploy to GitHub Pages」→ 「Run workflow」で再実行できます。

---

## 6. よくあるトラブル

### 「404 / There isn't a GitHub Pages site here」

- **Settings → Pages** で「Source」が **GitHub Actions** になっているか確認
- 初回は **Actions で「Deploy to GitHub Pages」を1回実行**する必要があります（上記「1. 初回デプロイ」）
- 実行後、2〜3分待ってから再度URLにアクセス

### デプロイは成功するが「ページが真っ白」

- ブラウザの開発者ツール（F12）→ Console でエラーを確認
- Supabase の URL/KEY が正しく設定されているか、`admin.html` と `index.html` 内を確認

### 管理画面でログインできない

- Supabase の「Authentication」で、使っているメールのユーザーが存在するか確認
- 同じ Supabase プロジェクトの URL/KEY を、AWS 時代と変えていないか確認

### デプロイワークフローが失敗する（赤い×）

- **Actions** タブで失敗した実行をクリックし、ログを確認
- 「Settings → Pages」で **Pages の権限**が「Read and write」など、デプロイ可能になっているか確認（組織リポジトリの場合は管理者設定）

---

## 7. カスタムドメインを使う場合（任意）

独自ドメイン（例: `booking.example.com`）を使う場合:

1. **Settings → Pages** の「Custom domain」にドメインを入力（例: `booking.example.com`）
2. DNS で、そのドメインを `shoheiasogawa.github.io` に向ける（CNAME または A レコード）
3. 「Enforce HTTPS」にチェックを入れて保存

詳細は [GitHub のドキュメント](https://docs.github.com/ja/pages/configuring-a-custom-domain-for-your-github-pages-site) を参照してください。

---

## まとめチェックリスト

- [ ] Settings → Pages で Source を「GitHub Actions」にした
- [ ] Actions で「Deploy to GitHub Pages」を1回実行した（または main に push した）
- [ ] 「Your site is live at …」のURLをメモした
- [ ] index.html / admin.html を開いて動作確認した
- [ ] LINE LIFF を使っている場合は Endpoint URL を新しいURLに変更した
- [ ] 問題なければ AWS のサーバーを停止・解約する
