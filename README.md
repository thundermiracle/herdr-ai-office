# herdr AI Office

herdr-app のワークスペースを部屋に、AI エージェントをキャラクターにして、
カイロソフト風のドット絵オフィスで見せる mod（PoC）。絵はすべてこのリポジトリで描いたオリジナル。

![office-test の部屋（見本の偽エージェント 6 人）](docs/office.png)

- 1 つのスペース = 1 つの部屋。部屋は 1 枚のフロアにすき間なく並び、奥の壁と左の仕切りで区切られる。
  左の縦の廊下の一番上が資料室で、本棚はここに 1 つ。真ん中の長い机はエージェントが増えると伸び、部屋も広がる
- 1 つのエージェント = 1 人のキャラクター。状態で動きが変わる（下の表）
- 机にはいつも空いた席が 1 つあり、クリックするとその部屋にエージェントを雇える
- 部屋の誰かがプラン（Claude Code のプランモード）を書くと、壁にプランのホワイトボードが掛かり、クリックで中身を読める

進み具合と、作りながら分かったこと（スパイクの計測など）は [TODO.md](TODO.md)。

## 別の PC で試す

必要なもの: herdr-app（と herdr-core）、`jq`、`rsync`（macOS には最初からある）。テストには `bun`、絵を作り直すには `uv`。

```sh
gh repo clone thundermiracle/herdr-ai-office ~/Code/herdr-ai-office
cd ~/Code/herdr-ai-office
scripts/sync.sh                                     # mod とレイアウトを ~/.config/herdr-app にコピー
herdr-app do layout.switch --name main-dots-office  # いつもの main-dots に「Office」ボタン（右上）を足したもの
hooks/register.sh add                               # 任意: 調べ物や skill で資料室へ行かせる Claude Code のフック
```

- `main-dots-office` は dotfiles（chezmoi）の main-dots を元にしていて、`spaces-dots` mod を使う。dotfiles を入れていない
  PC では、`herdr-app do layout.switch --name ai-office` か、`herdr-app do mod.open --name ai-office`（浮いた窓）で開く。
- Claude の model と effort は、dotfiles の effort-recorder（statusLine）と agent-resume（ターミナルの `resume.id` ラベル）が
  あれば分かる。ない PC では起動引数（`--model`・`--effort`）だけで、それもなければ sonnet の見た目で鉢巻きなし。
- フックはリポジトリの場所を指すので、clone した場所で `hooks/register.sh add` する。効くのはそのあとに起動した Claude から。
  やめるときは `hooks/register.sh remove`。

## 使い方

```sh
scripts/sync.sh                                  # mods/ と layouts/ を ~/.config/herdr-app にコピー
herdr-app do layout.switch --name ai-office      # オフィスのレイアウトにする（ctrl-shift-l でも切り替わる）
herdr-app do layout.switch --name main-dots      # 元に戻す
herdr-app do mod.open --name ai-office           # 今のレイアウトの上に、浮いた窓で開く（もう一度で閉じる）
scripts/demo.sh start                            # 見本: 偽エージェントのスペース「office-test」（7 人）と「office-test-2」（3 人）（AI は使わない。model と effort もばらばら）
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
質問役（タブ ask）は、Claude Code の複数の質問のように 3 問を続けて聞き、最後に答えの確認を出す。

## 状態と動き

| エージェントの状態 | キャラの動き |
|---|---|
| working（編集・コマンド） | 席でノート PC をタイピング |
| working ＋ `office.act=read`（Read / Grep / Web 検索） | 部屋の手前の通路から廊下を通って資料室へ行き、本を読む（読む人が増えると並ぶ） |
| blocked（承認・質問待ち） | 席の後ろで手を挙げる。質問は「?」、許可待ちは「!」 |
| ほかのエージェントに `hc send` で話しかけた | 相手のところへ小走りで行き、話して戻る（下の「話しかけに行く」） |
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

資料室の本棚の本は 1 冊 = 1 つの skill で、色は出どころ:

| 色 | 出どころ |
|---|---|
| 青 | 自分の skill（`~/.claude/skills`） |
| 赤 | プロジェクト（各スペースの最初のターミナルの今のフォルダの `.claude/skills`。ホームは除く。同じものは 1 冊） |
| 橙 | claude.ai から同期された skill（`~/.claude/skills/synced/*/manifest.json`。呼ぶ名前は `anthropic-skills:<名前>`） |
| 緑 | プラグインの skill とコマンド（`installed_plugins.json` の場所。呼ぶ名前は `<プラグイン>:<名前>`） |
| 青緑 | Codex の skill（`~/.codex/skills`） |

本棚にマウスを乗せると冊数、クリックで一覧（名前と説明。多いとスクロール）。一覧の skill をクリックすると、
その中身（`SKILL.md`。プラグインのコマンドはその `.md`）をマークダウンで出す。Esc か「閉じる」で一覧に戻る。
`herdr-app do mod.open --name ai-office-skills` で本棚の一覧を、`--name ai-office-skill` で最後に開いた skill を開ける。1 段 13 冊 × 3 段 = 39 冊まで並び、
それより多い分は一覧にだけ出る。Claude Code に組み込みの skill（`/code-review` など）はファイルがないので入らない。
別のマシンのスペースのプロジェクトの skill は入らない（そのマシンの skill はまだ読んでいない）。60 秒ごとに読み直す。

skill を使うと（Claude の Skill ツール、または `/名前` で始まる依頼）、フックが `office.skill` と、使うたびに変わる
`office.skill_at` に書く。オフィスはそれを出来事として、キャラクターを小走りで資料室へ行かせ、その本を抜き出して 5 秒読み
（棚のその場所が空き、頭の上に skill の名前の札）、小走りで戻らせる。エージェントがすぐ次のツールに移っても途中でやめない
（質問・許可待ちだけは割り込む）。そのターンが終わるまでは、席に戻っても札が残る。

## プランのホワイトボード

Claude Code のプランモードで書いたプランは、`~/.claude/plans/<名前>.md` に残る（tmp ではない。設定 `plansDirectory` で
プロジェクトの中の別のフォルダにもできる）。名前はセッションごとの言葉の並びで、どのエージェントのプランかはファイルからは
分からないので、フック（下の「本棚（調べ物中）のフック」）がプランを書いたときに、そのターミナルのラベル `office.plan` にファイルを書く。

- その部屋の誰かに `office.plan` があると、部屋の壁（窓の左）に、橙の見出しとチェックボックスのホワイトボードが掛かる。
  広い部屋の飾りのホワイトボードの代わりに掛け、狭い部屋は名札が細くならないよう幅 200 まで広げる
- クリックすると、プランの中身をマークダウンでダイアログに出す（部屋に何人分もあれば、上に人ごとのタブ）。
  プランモードの間はプランが書き換わるので、開いている間は 2 秒ごとに読み直す。Esc か「閉じる」で閉じる
- プランは、そのセッションが終わる（Claude を終える・`/clear`）までホワイトボードに残る。プランモードを抜けて作業している間も残る

## 窓の外（東京の時刻と天気）

部屋の窓から見える空は、東京の今の時刻と天気で変わる（場所は東京に固定）。

- 時間帯は、東京の太陽の高さを計算して決める（ネットがなくても変わる。日の出・日の入りは Open-Meteo と 1 分差）:
  夜 → 薄明（日の出前の青い空）→ 朝焼け → 昼 → 夕焼け → 薄明 → 夜。暗くなるとビルの窓に明かりがつき、タワーが橙に光る
- 天気は Open-Meteo（キーは要らない。送るのは東京の緯度経度だけ）から 15 分ごと: 晴れ・晴れ時々曇り・曇り（霧も）・
  雨・雪・雷雨（ときどき稲光）。オフィスが隠れている間は取らず、開いたときに古ければすぐ取り直す。
  取れないときは前の天気のまま（3 時間より古ければ晴れ）。取った天気は shared（`ai-office.weather`）に置き、ほかのコピーも使う
- 雨と雪は 2 コマに 1 回だけ進める（雨のためだけに毎コマ描き直さない）
- 窓にマウスを乗せると、東京の時刻と天気・気温

```sh
scripts/sky.sh rain night   # 試す: 天気（clear / cloudy / overcast / fog / rain / snow / thunder）と、時刻（HH:MM か時間帯）
scripts/sky.sh lapse        # 東京の 1 日を 30 秒ほどで早送りして、本物に戻す
scripts/sky.sh auto         # 本物に戻す
```

`sky.sh` は `herdr-app do ai-office.sky-<なに>` を送るだけ。オフィスが見えているときだけ届く（閉じていると、
開き方を言って止まる）。試した天気と時刻は mod を読み直すと消える。

## クリック

| どこ | 何が起きるか |
|---|---|
| キャラクター | そのエージェントを表示（`agent.focus`。`ai-office` レイアウトなら右に出る） |
| 空いた椅子・その席のノート PC | 「雇う」ポップアップ。選んだエージェントを、その部屋のスペースの新しいタブで起動 |
| 壁の名札 | そのスペースを選んで、herdr のスペースのメニュー（名前を変える・閉じる・ワークツリー）。右クリックはメニューだけ |
| 部屋（床・壁・名札）をドラッグ | ほかの部屋の上で離すと、その部屋の位置へ動かす（後ろの部屋ならその後ろ、前の部屋ならその前）。動かすのは herdr のスペースの順番そのもので、左のスペースの一覧のドラッグと同じ（`space.move`）。持っている部屋が暗くなり、入る側に線が出る。同じマシンの部屋どうしだけ。フロアの外や自分の部屋で離すと動かさない |
| 質問の「?」 | 質問と選択肢を出す。選ぶと、その答えをターミナルに送る（↑↓ と Enter。送る直前に画面を読み直して確かめる）。質問が続くとき（Claude Code の複数の質問）は、答えるたびに次の質問を同じポップアップに出し（何問目かも）、最後の答えの確認（Submit answers）まで答えられる。もう答え待ちでなくなったら閉じる |
| 資料室の本棚 | 使える skill の一覧。その中の skill をクリックすると中身 |
| プランのホワイトボード | そのプラン（部屋の誰かがプランモードで書いた .md）の中身をマークダウンで出す |
| 空き部屋（「+ 部屋」のドア） | フォルダを選んで、新しいスペース（部屋）を作る（この Mac だけ） |
| 窓（マウスを乗せる） | 東京の時刻と天気・気温（試し中はその旨） |

## 話しかけに行く（hc send）

herdr のタブの間の会話（エージェントが `hc send <相手> "文"` で送り、相手には `<hc from="t3 名前">文</hc>` と届く）を、
ゲームのように見せる: 送った人のキャラが相手のところへ小走りで行き、送った文の札（14 文字まで）と相手の「…」の吹き出しで
交互に話して（約 5 秒）、小走りで戻る。相手が返事を `hc send` すれば、今度は相手が話しに来る。

- 相手は、アドレス（`t7`）→ hc の名前（`hc run --name`）→ タブの名前 の順で探す。自分あて・オフィスにいない相手は何もしない
- 行き先は相手が「これからいる所」: 席で作業している（届いた依頼で作業を始めた）なら椅子の後ろ、立っているならその隣。
  相手が動けば追い直し、話しかけられている人はうろうろを始めない。違う部屋へは、手前の通路（同じ列）か廊下（違う列）を通る
- 話しかけに行く途中でも、質問・許可待ちになったら、すぐ戻って手を挙げる。手を挙げている人は話しかけに行かない
- 送ったことは `hc events` に出ないので、Claude Code のフックで見る（下の「フック」）。送った人の Bash の `hc send` と、
  受け取った人に届いた `<hc from>` の両方を見るので、送った人にフックがなくても（Codex など）、受け取った人が Claude なら行く
  （Claude どうしは両方に出るので、同じ 2 人の 20 秒以内の出来事は 1 回にまとめる）
- `hc run --bg` で起動された手伝い（ペインがない）はまだオフィスにいないので、親と手伝いの間の会話は出ない

同じ部屋（スペース）の中なら、机の奥の通路を通って相手の椅子の後ろへ行く。相手が歩いている途中（作業を受けて席へ戻るなど）なら、
止まるのを待ってから話しだす。

見本（`scripts/demo.sh start`）では、30 秒ごとに、office-test の Codex（talks）が office-test-2 の reviewer へ、
office-test-2 の lead が office-test の idle（うろうろ）へ、office-test-2 の designer が同じ部屋の reviewer へ話しかけに行く。

## 本棚（調べ物中）のフック

状態（OSC 7501）だけでは「調べ物中」かどうか分からないので、Claude Code のフック
`hooks/claude-office-act.sh` が、これから使うツールをターミナルのラベル `office.act` に書く
（Skill と Read / Grep / Glob / Web 検索 → `read`、編集 → `edit`、Bash → `run`、ほか・ターンの始めと終わりは消す）。
使った skill は `office.skill` に書き、ターンの終わり（Stop）まで残す。
プランは `office.plan` に書き、セッションの終わり（SessionEnd。`/clear` も）まで残す: プランモードで書く .md
（プランモードで書けるのはプランのファイルだけ）、`~/.claude/plans/` の .md への Write / Edit / MultiEdit と、
ExitPlanMode の `planFilePath`。
Bash のコマンドに `hc send <相手> <文>` があれば、`office.talk`（相手）・`office.talk_at`（毎回変わる値）・
`office.talk_text`（文の始め 40 文字）を書く（最初の 1 つ。相手が `$変数` なら書かない）。届いた依頼が
`<hc from="t3 名前">文</hc>` なら、`office.heard`（送った人のアドレス）・`office.heard_at`・`office.heard_text` を書く。
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
| `mods/ai-office-skill/` | 一覧の skill をクリックすると出る、その skill の中身 |
| `mods/ai-office-plan/` | 壁のプランのホワイトボードをクリックすると出る、プランの中身 |
| `mods/ai-office-ask/` | 質問の「?」をクリックすると出る、質問と選択肢（`parse.js` が画面から読む） |
| `layouts/ai-office.json` | オフィスと、選んだエージェントのターミナルを並べたレイアウト |
| `layouts/main-dots-office.json` | main-dots に「Office」ボタンとオフィスの列を足したレイアウト |
| `scripts/build-art.py` | ドット絵（文字の格子で描き、4 倍の PNG に書き出す）。`tmp/art-preview.png` に一覧と部屋の見本 |
| `hooks/` | Claude Code のフックと、その登録・削除 |
| `scripts/fake-agent.sh`、`scripts/fake-question.py`、`scripts/demo.sh` | AI を使わずに状態を報告する偽エージェント、選択肢の画面で答えを受け取る偽の質問役、それを 6 人並べた見本（office-test-2 の reviewer のプランは `scripts/sample-plan.md`） |
| `scripts/sync.sh` | mod とレイアウトを ~/.config/herdr-app にコピーして `herdr-app check` |
| `scripts/sky.sh` | 窓の外を試す（天気と東京の時刻を決める、1 日の早送り、本物に戻す） |
| `spike/` | 描画方針を決めたときの確認用 mod（アニメ画像・にじみ・アニメの負荷） |
| `test/` | `bun test`（scene.js）と `test/hook-test.sh`（フック。使い捨てのターミナルで試す） |

## 開発

```sh
uv run --with pillow scripts/build-art.py   # 絵を作り直す（mods/ai-office/img/、tmp/art-preview.png、窓の見本 tmp/sky-preview.png）
bun test                                    # scene.js（窓の外は test/sky.test.js）
test/hook-test.sh                           # フック
test/ask-test.sh                            # 質問に答える流れ（偽の質問役で。1 問と、続けて 3 問）
scripts/sync.sh                             # コピーして check（herdr-app は自動で読み直す）
herdr-app shot tmp/shot.png                 # 今の画面を撮って確かめる
```

herdr-app はコピー先の変更を見て mod を読み直す。シンボリックリンクにしないのは、
リンク先の変更を herdr-app が検知できないことがあるため。Herdr の窓が最小化・別のデスクトップ・
完全に隠れていると描画が止まり、`herdr-app shot` も古い画面のままになる。

AI（Claude Code など）がここで確かめるときは、使っている人の画面を動かすもの（Herdr を前に出す `open -a Herdr`、
見本を作る `scripts/demo.sh start`、Office パネルの開け閉め `layout.toggle`、`mod.open`、`space.new`・`tab.new`）の前に、
必ず人に聞く。herdr-app は作ったスペースとタブをすぐ見せるので、人がほかのエージェントに書いている最中だと、見本の新しい
タブへ飛ばされ、打っていたキーもそちらに入る（2026-11-12 に、確かめていた AI が聞かずに何度もそうした）。先に、画面を
動かさない確かめ方を使う: `bun test`、`test/hook-test.sh` と `test/ask-test.sh`（herdr-app に出ない使い捨てのターミナル）、
`scripts/sync.sh`（check）。

## 分かっている制限

- アニメ GIF / WebP は mod では動かないので、1 本のタイマーでコマを送っている（窓がアクティブなとき 4fps、
  後ろにあるとき 2fps）。Herdr の CPU は、main-dots の横の列で開いているとき約 5〜6%（4fps。6fps だと約 15%）、
  閉じている（隠れている）間は約 1%。ネイティブのアニメは 1 つで約 20% なので使っていない
- 絵は 4 倍の PNG を 2 倍で描いてにじまないようにしているので、herdr-app のズームを 1 以外にすると少しにじむ。
  画面が広くても部屋は大きくならない（大きくするには 6 倍の絵を作って SCALE を 3 にする）
- クリックの動作（フォーカス・雇う・名札・ドア）と部屋のドラッグは自動テストがなく、手で確かめる（落とす先の計算 `dropTarget` だけテストがある）
- 窓（`mod.open`）で開いたとき、部屋の上を押しても窓は動かない（部屋のドラッグになる）。窓を動かすのは上の帯か廊下
- ドラッグしても、細い列で横・縦にスクロールしているフロアは動かない（見えている部屋の間でだけ動かせる）
- プランのホワイトボードは、フックを登録したあとに起動した Claude だけ（Codex にはない）。`claude --resume` で戻ったセッションは、
  もう一度プランを書く（直す）まで出ない。ホワイトボードとプランの中身のクリックは手で確かめる（フックは本物の Claude Code 2.1.302 で確かめた）
- `spaces-dots` はワークツリーのスペースを本体の下へ並べ直すので、ワークツリーの部屋をほかの所へ動かしても、本体の後ろに戻る（左の一覧で動かしたときと同じ）
- 見本（`scripts/demo.sh start`）を作る間（1〜2 秒）は、画面が見本のスペースへ動く（herdr-app は作ったスペースとタブを
  すぐ見せる）。終わると（途中で失敗しても）元のスペース・タブ・ペインに戻す
- 部屋が並び直したとき（窓や列の幅が変わったとき）、廊下にいた人は自分の部屋の手前に戻ってから歩き直す
- 1 枚のフロアにしても CPU は変わらない（部屋ごとに描いていた版と、同じ条件で交互に測って 8.4〜8.6% 対 7.6〜8.3%）
- サブエージェント（`hc run` で起動されたペインのないターミナル）はまだ出ない。なので、親と手伝いの間の `hc send` も出ない
- 話しかけの出来事は、送った人のフックでは `hc send` を実行する前に書くので、送れなかったとき（相手が答え待ちなど）も話しに行く
- フックのパスはこのリポジトリを指しているので、リポジトリを動かしたら `hooks/register.sh remove` → `add` し直す
- 窓の外は東京に固定（場所を選ぶ設定はまだない）。天気は Open-Meteo の「今」の値（気象モデルの値で、観測そのものではない）
  なので、実際の空と少し違うことがある。雨でも CPU は変わらない（待機 6 人で 雨あり 7.0%・なし 7.6%）

## 次の一手

- chezmoi で入れる（`.chezmoiexternal.toml` でこのリポジトリを取り込み、フックは `dot_claude/modify_settings.json` へ）
- 窓の外の場所を選べるようにする（今は東京に固定）
- 大きく描くモード（6 倍の絵）、Codex の本棚、サブエージェントを「バイト」の小さいキャラで出す
- カイロソフトっぽい演出（作業の数字がポンと出る、部屋の模様替え）
- herdr.dev/mods に出す（`RECIPE.md` と `preview.png`、トピック `herdr-mod`）
