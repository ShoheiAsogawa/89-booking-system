# 「Domain is not eligible for HTTPS」エラーの対処法

GitHub Pages で「Domain 89center.dev is not eligible for HTTPS at this time」と出る場合の対処です。

---

## 原因

GitHub Pages が **Let's Encrypt で証明書を発行する前に、DNS の設定が正しく反映されていない**状態です。

---

## 対処手順（順番に試す）

### 1. Cloudflare の DNS 設定を確認

1. **Cloudflare ダッシュボード** → ドメイン **89center.dev** を選択
2. **DNS** → **Records** を開く
3. 次のレコードがあるか確認:

| タイプ | 名前 | ターゲット/コンテンツ | プロキシ |
|--------|------|----------------------|----------|
| CNAME | `@` | `shoheiasogawa.github.io` | **DNS のみ**（グレーの雲） |

**重要**: プロキシが **オレンジの雲（プロキシ有効）** になっていると、GitHub が直接ドメインを確認できず、証明書が発行されないことがあります。

4. プロキシがオレンジなら、**クリックして「DNS のみ」に変更**（グレーの雲にする）

---

### 2. GitHub の設定を一時的に調整

1. **Settings** → **Pages** を開く
2. **Custom domain** の **「Enforce HTTPS」** のチェックを**外す**（一時的）
3. **Save** を押す
4. 数分待つ（DNS の反映を待つ）

---

### 3. DNS の反映を確認

**方法A: コマンドプロンプト/PowerShell で確認**

```powershell
nslookup 89center.dev
```

または

```powershell
Resolve-DnsName 89center.dev -Type CNAME
```

**期待される結果**:  
`shoheiasogawa.github.io` を指している CNAME レコードが表示される

**方法B: オンラインツールで確認**

- https://dnschecker.org/ で `89center.dev` を検索
- 世界中の DNS サーバーで、正しく `shoheiasogawa.github.io` に解決されているか確認

---

### 4. GitHub で再度 HTTPS を有効化

DNS が正しく反映されたら（数分〜最大 48 時間、通常は 10〜30 分）:

1. **Settings** → **Pages** を開く
2. **Custom domain** の **「Enforce HTTPS」** に**チェックを入れる**
3. **Save** を押す
4. 数分〜数十分待つと、GitHub が自動で証明書を発行します

---

### 5. 証明書発行の確認

- **Settings → Pages** で、Custom domain の横に ✅ が表示されれば OK
- 「DNS check is still in progress」から「DNS check passed」に変われば、証明書発行の準備が整っています
- ブラウザで `https://89center.dev` を開いて、警告が出ずに表示されれば成功

---

## よくある原因と対処

| 原因 | 対処 |
|------|------|
| **Cloudflare のプロキシがオン** | **DNS のみ**（グレーの雲）に変更 |
| **DNS の設定が間違っている** | CNAME のターゲットが `shoheiasogawa.github.io` になっているか確認 |
| **DNS の反映待ち** | 10〜30 分待つ（最大 48 時間かかる場合も） |
| **GitHub の Custom domain が未設定** | Settings → Pages → Custom domain に `89center.dev` を入力して Save |

---

## それでも解決しない場合

1. **Custom domain を一度削除**（Settings → Pages → Custom domain を空にして Save）
2. **数分待つ**
3. **再度 `89center.dev` を入力して Save**
4. **Enforce HTTPS をオフ**にして保存
5. **DNS の反映を確認**（nslookup や dnschecker.org）
6. **Enforce HTTPS をオン**にして保存

これで多くの場合、証明書が発行されます。

---

## 補足: Cloudflare のプロキシについて

- **DNS のみ（グレー）**: GitHub が直接ドメインを確認できる → **証明書発行がスムーズ**
- **プロキシ（オレンジ）**: Cloudflare 経由のため、GitHub が直接確認しづらい → **証明書発行が遅れる/失敗する場合がある**

**推奨**: GitHub Pages の証明書発行までは **DNS のみ** にしておき、証明書が発行されて HTTPS が動いてから、必要に応じてプロキシをオンにしてもよいです。

---

## まとめ

1. Cloudflare の DNS で **プロキシを「DNS のみ」に変更**（グレーの雲）
2. GitHub で **Enforce HTTPS を一度オフ**にして Save
3. **DNS の反映を待つ**（10〜30 分）
4. **Enforce HTTPS をオン**にして Save
5. 数分〜数十分待つと証明書が発行される

これで「Domain is not eligible for HTTPS」エラーは解消されるはずです。
