# プラン: ログインのエラーを分かりやすくし、ロックを入れる（見本）

オフィスの見本（`scripts/demo.sh start`）の reviewer が書いたことにしているプラン。
壁のプランのホワイトボードをクリックすると、これがマークダウンで出る（長いのでスクロールの確かめにも使う）。

---

## 背景

ログインに失敗したとき、今はどんな理由でも **「エラーが起きました」** としか出ない。問い合わせの 3 割がこれで、
「パスワードを間違えたのか、アカウントが止まっているのか分からない」という声が多い。

> サーバーはもう理由を返している。直すのは画面の側と、回数を数える所だけ。
> — 前回のふりかえりより

### いまの流れ

1. 画面がメールアドレスとパスワードを `POST /api/login` に送る
2. サーバーは成功なら `200` とトークン、失敗なら `401` と理由を返す
3. 画面は `401` をまとめて「エラーが起きました」にしている（`src/login.ts` の `onError`）

### サーバーが返す理由

| 理由 | いつ | 今の画面 | 直したあとの画面 |
|---|---|---|---|
| `bad_password` | パスワードが違う | エラーが起きました | パスワードが違います（あと N 回でロック） |
| `unknown_user` | そのメールのアカウントがない | エラーが起きました | パスワードが違います（同じ文にする） |
| `locked` | 5 回続けて間違えた | エラーが起きました | 15 分ロック中です（残り M 分） |
| `disabled` | 管理者が止めた | エラーが起きました | このアカウントは使えません。管理者に連絡してください |
| `rate_limited` | 同じ IP から多すぎる | エラーが起きました | しばらくしてからもう一度お試しください |

`unknown_user` を `bad_password` と同じ文にするのは、アカウントがあるかどうかを外から分からなくするため。

## 決めたこと

- ロックは **5 回で 15 分**。成功すると数え直す
- 残りの回数は 3 回目から出す（1〜2 回目は打ち間違いが多いので、脅かさない）
- ロックの残り時間は、サーバーが返す `retry_after`（秒）から出す。画面の時計は使わない
- 文はすべて `src/i18n/ja.json` に置く（英語は今回は入れない）

## 手順

### 1. サーバー: 回数を数える

- [x] `failed_logins` テーブルを足す（`user_id`、`count`、`locked_until`）
- [ ] 失敗したら `count` を 1 足し、5 になったら `locked_until = now + 15 分`
- [ ] 成功したら `count = 0`
- [ ] `401` の本文に `remaining`（残りの回数）と `retry_after` を足す

```sql
CREATE TABLE failed_logins (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id),
  count        INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);
```

### 2. 画面: 理由ごとの文

- [ ] `src/login.ts` の `onError` で、理由から文を選ぶ
- [ ] `remaining` が 3 以下なら「あと N 回でロック」を足す
- [ ] `locked` なら入力欄を止め、残り時間を 1 分ごとに減らす

```ts
const MESSAGES: Record<Reason, string> = {
  bad_password: t("login.badPassword"),
  unknown_user: t("login.badPassword"), // 同じ文（アカウントの有無を出さない）
  locked: t("login.locked"),
  disabled: t("login.disabled"),
  rate_limited: t("login.rateLimited"),
};

function onError(res: LoginError) {
  let text = MESSAGES[res.reason] ?? t("login.unknown");
  if (res.reason === "bad_password" && res.remaining <= 3) {
    text += t("login.remaining", { n: res.remaining });
  }
  showError(text);
}
```

### 3. テスト

1. サーバー
   1. 4 回間違えて 5 回目に正しいと、入れて `count` が 0 に戻る
   2. 5 回間違えると `locked` になり、15 分たつと入れる
   3. ロック中は、正しいパスワードでも `locked`
2. 画面
   1. 理由ごとに文が変わる（5 通り）
   2. `remaining` が 3 のときだけ「あと 3 回」が出る
   3. ロック中は入力欄が止まり、残り時間が減る

## 気をつけること

- **数える単位はアカウント**。IP ごとの制限（`rate_limited`）は今のまま別にある
- ロックをいたずらに使われる（他人のメールで 5 回間違える）ことはありうる。今回は 15 分と短くして受け入れる。
  長くするなら、メールでロックを解く仕組みが要る（次の段階）
- 古い画面（キャッシュされた `login.js`）は `remaining` を知らないが、今と同じ文が出るだけで壊れない

## 確かめ方

- [x] 今の動きを再現した（どの理由でも「エラーが起きました」）
- [ ] `bun test` が通る
- [ ] 画面で 5 通りの文を見る
- [ ] ロックして、15 分後に入れることを見る（テストでは時計を進める）

## やらないこと（次の段階）

- メールでロックを解くリンク
- 英語の文
- 管理画面でロックを外すボタン

詳しくは [ログインの仕様](https://example.com/spec/login) と、`docs/auth.md` の「ロック」の節。
