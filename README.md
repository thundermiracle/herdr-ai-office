# herdr AI Office

herdr-app のワークスペースを部屋に、AI エージェントをキャラクターにして、
カイロソフト風のドット絵オフィスで見せる mod（PoC）。絵はすべてこのリポジトリで描いたオリジナル。

![office-test の部屋（見本の偽エージェント 6 人）](docs/office.png)

- 1 つのスペース = 1 つの部屋。真ん中の長い机はエージェントが増えると伸び、部屋も広がる
- 1 つのエージェント = 1 人のキャラクター。状態で動きが変わる（下の表）
- 机にはいつも空いた席が 1 つあり、クリックするとその部屋にエージェントを雇える

進み具合と、作りながら分かったこと（スパイクの計測など）は [TODO.md](TODO.md)。

## 使い方

```sh
scripts/sync.sh                                  # mods/ と layouts/ を ~/.config/herdr-app にコピー
herdr-app do layout.switch --name ai-office      # オフィスのレイアウトにする（ctrl-shift-l でも切り替わる）
herdr-app do layout.switch --name main-dots      # 元に戻す
herdr-app do mod.open --name ai-office           # 今のレイアウトの上に、浮いた窓で開く（もう一度で閉じる）
scripts/demo.sh start                            # 見本: 偽エージェント 6 人のスペース「office-test」（AI は使わない。model と effort もばらばら）
scripts/demo.sh stop                             # 見本を消す
```

`ai-office` レイアウトは、左がオフィス、右がクリックしたエージェントのターミナル。

### 右上の「Office」ボタンで出し入れする（main-dots-office）

```sh
herdr-app do layout.switch --name main-dots-office   # いつもの main-dots に「Office」ボタンとオフィスの列を足したもの
herdr-app do layout.toggle --id office               # ボタンと同じ（開く・閉じる）
```

タブバーの右上（Files・Changes の右）の「Office」ボタンで、右端のオフィスの列が開いたり閉じたりする。
開け閉めはレイアウトのクリックとして覚えられるので、再起動しても残る。閉じている間、オフィスは
コマ送りも描き直しもしない（CPU は閉じたときとほぼ同じ約 1%）。

Files・Changes のボタンは同梱の `tabs` mod に直接書かれていて増やせないので、`tabs` は複製せず
（Herdr の更新を取り込み直す手間がない）、隣に `ai-office-toggle` のブロックを置いている。
`layouts/main-dots-office.json` は main-dots からの 2 か所の変更だけで、本番では chezmoi の
`private_dot_config/herdr-app/layouts/main-dots.json` に同じ変更を入れる:

1. タブバーのブロック（`"id": "tabs"`）を、タブバーと `ai-office-toggle`（幅 88、`window_drag`）を横に並べた
   `"type": "row"`（`"id": "tabs-row"`、高さ 42、`"resizable": false`）にする
2. `work-body` の子の最後に、オフィスのブロックを足す:
   `{"id": "office", "type": "block", "hidden": true, "size": {"px": 560}, "min": 440, "max": 1400,
   "content": {"mod": "ai-office", "props": {"block": "office"}}}`（`props.block` で自分が隠れているかを調べる）
見本は質問や完了を報告するので、herdr-app の通知音とトーストが出る（全部を順に回る 1 人は 40 秒ごとに質問する）。

## 状態と動き

| エージェントの状態 | キャラの動き |
|---|---|
| working（編集・コマンド） | 席でノート PC をタイピング |
| working ＋ `office.act=read`（Read / Grep / Web 検索） | 本棚まで歩いて本を読む |
| blocked（承認・質問待ち） | 席の後ろで手を挙げる。質問は「?」、許可待ちは「!」 |
| done（見ていない間に完了） | 席で「✓」。herdr-app で一度見ると idle になる |
| idle | 立ってうろうろ（机の奥の通路と手前の床） |

見た目は AI ごとに 1 人（Claude Code は橙の上着、Codex は青緑の上着とヘッドホン、ほかは紫）で、
model と effort で見分ける（オフィスの右上の「凡例」にも出る）:

| model（髪の色と小物） | effort（鉢巻き） |
|---|---|
| opus: こげ茶の髪・眼鏡・ネクタイ | low: なし |
| sonnet: 茶色の髪（小物なし。model が分からないときも） | medium: 青 |
| haiku: 金髪・若葉 | high: 白 |
| fable: 薄紫の髪・星のピン | xhigh: 赤 |
| Codex: 黒髪・ヘッドホン | max: 赤、作業中は両側に炎 |

model と effort は、Claude なら statusLine の effort-recorder が書くキャッシュ（`~/.cache/claude-model/<セッション>`・
`~/.cache/claude-effort/<セッション>`。セッションはターミナルの `resume.id` ラベル）を 10 秒ごとに読み、
なければ起動引数（`--model`・`--effort`）。Codex は起動引数（`-m`・`-c model_reasoning_effort=`）か `~/.codex/config.toml`。
同じ model と effort なら同じ見た目になるので、誰かはマウスを乗せたときの表示（場所・状態）で見分ける。

## 本棚（使える skill）

本棚の本は 1 冊 = 1 つの skill で、色は出どころ:

| 色 | 出どころ |
|---|---|
| 青 | 自分の skill（`~/.claude/skills`） |
| 赤 | このプロジェクト（スペースの最初のターミナルの今のフォルダの `.claude/skills`。ホームは除く） |
| 橙 | claude.ai から同期された skill（`~/.claude/skills/synced/*/manifest.json`。呼ぶ名前は `anthropic-skills:<名前>`） |
| 緑 | プラグインの skill とコマンド（`installed_plugins.json` の場所。呼ぶ名前は `<プラグイン>:<名前>`） |
| 青緑 | Codex の skill（`~/.codex/skills`） |

本棚にマウスを乗せると冊数、クリックで一覧（名前と説明。説明にマウスを乗せると全部）。
`herdr-app do mod.open --name ai-office-skills` でも、今のスペースの一覧を開ける。1 段 13 冊 × 3 段 = 39 冊まで並び、
それより多い分は一覧にだけ出る。Claude Code に組み込みの skill（`/code-review` など）はファイルがないので入らない。
別のマシンのスペースの本棚は空（そのマシンの skill はまだ読んでいない）。60 秒ごとに読み直す。

skill を使うと（Claude の Skill ツール、または `/名前` で始まる依頼）、フックが `office.skill` に書き、
キャラクターが本棚へ行ってその本を抜き出して読む（棚のその場所が空く）。頭の上に skill の名前の札が出て、
そのターンが終わるまでは席に戻っても札が残る。

## クリック

| どこ | 何が起きるか |
|---|---|
| キャラクター | そのエージェントを表示（`agent.focus`。`ai-office` レイアウトなら右に出る） |
| 空いた椅子・その席のノート PC | 「雇う」ポップアップ。選んだエージェントを、その部屋のスペースの新しいタブで起動 |
| 壁の名札 | そのスペースへ（`space.select`） |
| 本棚 | 使える skill の一覧 |
| 「+ 部屋」のドア | フォルダを選んで、新しいスペース（部屋）を作る（この Mac だけ） |

## 本棚（調べ物中）のフック

状態（OSC 7501）だけでは「調べ物中」かどうか分からないので、Claude Code のフック
`hooks/claude-office-act.sh` が、これから使うツールをターミナルのラベル `office.act` に書く
（Skill と Read / Grep / Glob / Web 検索 → `read`、編集 → `edit`、Bash → `run`、ほか・ターンの始めと終わりは消す）。
使った skill は `office.skill` に書き、ターンの終わり（Stop）まで残す。
herdr-app のターミナルの中（`HC_TERMINAL_ID` がある）だけで動き、1 回 30〜40ms で、`hc` の終わりは待たない。

```sh
hooks/register.sh status   # ~/.claude/settings.json に登録されているか
hooks/register.sh add      # 登録（PreToolUse・UserPromptSubmit・Stop・SessionEnd）
hooks/register.sh remove   # このフックだけ外す（ほかのフックはそのまま）
```

今は PoC として ~/.claude/settings.json に直接登録している。あとで外すか、chezmoi
（dotfiles の `dot_claude/modify_settings.json`）に移す。Claude Code は起動したときのフックを使うので、
登録より前から動いている Claude には効かない。Codex にはまだない（座る・うろうろ・挙手だけ）。

## 中身

| 場所 | 何か |
|---|---|
| `mods/ai-office/` | mod 本体。`scene.js` は計算だけ（herdr も gpui-kit も import しない）、`main.js` が描く |
| `mods/ai-office-hire/` | 空いた席をクリックすると出る「雇う」ポップアップ |
| `mods/ai-office-toggle/` | タブバーの右隣の「Office」ボタン（`layout.toggle`） |
| `mods/ai-office-skills/` | 本棚をクリックすると出る、使える skill の一覧 |
| `layouts/ai-office.json` | オフィスと、選んだエージェントのターミナルを並べたレイアウト |
| `layouts/main-dots-office.json` | main-dots に「Office」ボタンとオフィスの列を足したレイアウト |
| `scripts/build-art.py` | ドット絵（文字の格子で描き、4 倍の PNG に書き出す）。`tmp/art-preview.png` に一覧と部屋の見本 |
| `hooks/` | Claude Code のフックと、その登録・削除 |
| `scripts/fake-agent.sh`、`scripts/demo.sh` | AI を使わずに状態を報告する偽エージェントと、それを 6 人並べた見本 |
| `scripts/sync.sh` | mod とレイアウトを ~/.config/herdr-app にコピーして `herdr-app check` |
| `spike/` | 描画方針を決めたときの確認用 mod（アニメ画像・にじみ・アニメの負荷） |
| `test/` | `bun test`（scene.js）と `test/hook-test.sh`（フック。使い捨てのターミナルで試す） |

## 開発

```sh
uv run --with pillow scripts/build-art.py   # 絵を作り直す（mods/ai-office/img/ と tmp/art-preview.png）
bun test                                    # scene.js
test/hook-test.sh                           # フック
scripts/sync.sh                             # コピーして check（herdr-app は自動で読み直す）
herdr-app shot tmp/shot.png                 # 今の画面を撮って確かめる
```

herdr-app はコピー先の変更を見て mod を読み直す。シンボリックリンクにしないのは、
リンク先の変更を herdr-app が検知できないことがあるため。Herdr の窓が最小化・別のデスクトップ・
完全に隠れていると描画が止まり、`herdr-app shot` も古い画面のままになる。

## 分かっている制限

- アニメ GIF / WebP は mod では動かないので、1 本のタイマーでコマを送っている（窓がアクティブなとき 4fps、
  後ろにあるとき 2fps）。Herdr の CPU は、main-dots の横の列で開いているとき約 5〜6%（4fps。6fps だと約 15%）、
  閉じている（隠れている）間は約 1%。ネイティブのアニメは 1 つで約 20% なので使っていない
- 絵は 4 倍の PNG を 2 倍で描いてにじまないようにしているので、herdr-app のズームを 1 以外にすると少しにじむ。
  画面が広くても部屋は大きくならない（大きくするには 6 倍の絵を作って SCALE を 3 にする）
- クリックの動作（フォーカス・雇う・名札・ドア）は自動テストがなく、手で確かめる
- サブエージェント（`hc run` で起動されたペインのないターミナル）はまだ出ない
- フックのパスはこのリポジトリを指しているので、リポジトリを動かしたら `hooks/register.sh remove` → `add` し直す

## 次の一手

- chezmoi で入れる（`.chezmoiexternal.toml` でこのリポジトリを取り込み、フックは `dot_claude/modify_settings.json` へ）
- 大きく描くモード（6 倍の絵）、Codex の本棚、サブエージェントを「バイト」の小さいキャラで出す
- カイロソフトっぽい演出（作業の数字がポンと出る、部屋の模様替え）
- herdr.dev/mods に出す（`RECIPE.md` と `preview.png`、トピック `herdr-mod`）
