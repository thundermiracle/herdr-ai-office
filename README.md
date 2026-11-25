# Herdr AI Office

[English](README.en.md) | 日本語

[Herdr](https://herdr.dev)（herdr-app）のスペースを部屋に、AI エージェントをキャラクターにして、カイロソフト風の
ドット絵のオフィスで見せる mod とレイアウト。絵はすべてこのリポジトリで描いたオリジナル。

![見本の部屋 office-test と office-test-2（偽エージェント 10 人、モダンのテーマ）](docs/office.png)

- 1 つのスペース = 1 つの部屋、1 つのエージェント = 1 人のキャラクター。状態で動きが変わる（作業中はタイピング、調べ物は
  資料室の本棚へ、質問や許可待ちは手を挙げる、終わると ✓、手が空くとうろうろ）
- キャラ・名札・ノート PC をクリックすると、そのエージェントのターミナルを出す（右のターミナルを隠しているときは、オフィスの
  上に重ねて。本物のターミナルなので、そのまま話せる）
- 空いた席をクリックするとエージェントを雇え、「+ 部屋」のドアで部屋（スペース）を作れる
- エージェントが書いたプランや .md は部屋の壁のホワイトボードに、使える skill は資料室の本棚に並ぶ
- 壁時計と窓の外は、選んだ町の今の時刻と天気
- 画面は英語と日本語（OS に合わせる。右上の地球のボタンで選べる）

## 入れる前に: このオフィスが触るもの

Herdr の mod は信頼して動かすコードなので、入れる前に知っておいてほしいこと:

- **ネットにつなぐ**: 窓の外の天気を [Open-Meteo](https://open-meteo.com/) から取る（キーは要らない。送るのは選んだ町の緯度経度
  だけ。15 分ごと）
- **プログラムを動かす**:
  - `sh`: 起動したときに OS の言語を調べる（macOS は `defaults read -g AppleLanguages`、ほかは `LANG` など）
  - `herdr-app status`: ⌘⇧. を押したとき、何かを重ねて出しているか
  - `git rev-parse`: 部屋のメニューを開いたとき、そのフォルダがワークツリーか
  - `hc read`・`hc keys`: 質問の「?」から答えるとき、ターミナルの画面を読み、答えのキーを送る
- **mod のフォルダの外を読む**（書かない）:
  - skill: `~/.claude/skills/`、プラグインの skill とコマンド（`~/.claude/plugins/installed_plugins.json` の場所）、
    `~/.codex/skills/`、各スペースのフォルダの `.claude/skills/`
  - model と effort: `~/.codex/config.toml`、あれば `~/.cache/claude-model/`・`~/.cache/claude-effort/`
  - エージェントが書いたプランと .md（フックがターミナルのラベルに書いた道のもの）
  - 自分で足したテーマ: `~/.config/herdr-app/ai-office-themes/`
- **`scripts/install.sh` が書き換えるもの**:
  - `~/.config/herdr-app/` の `mods/` と `layouts/`（このリポジトリの mod とレイアウトをコピーする）
  - `~/.claude/settings.json`: Claude Code のフックを足す（`--no-hook` で足さない）
  - `~/.config/herdr-app/keys.json`: キーを 2 つ足す（`--no-keys` で足さない。初めて書き換えるときに、元を
    `keys.json.before-ai-office` に残す）
- **フックが書くもの**: Claude Code が動いているターミナルのラベル（`office.*`。`hc label` で）と、`$TMPDIR` の小さな記録

## 入れる

必要なもの: herdr-app（と、ついてくる `hc`）、`jq`、`rsync`（macOS には最初からある）。テストには `bun`、絵を作り直すには `uv`。

```sh
git clone https://github.com/thundermiracle/herdr-ai-office.git
cd herdr-ai-office
scripts/install.sh                            # mod とレイアウトのコピー・フックの登録・キー・確かめ
herdr-app do layout.switch --name ai-office   # オフィスのレイアウトにする（ctrl-shift-l でも選べる）
```

- 更新は `git pull && scripts/install.sh`。レイアウトは、ないか中身が違うときだけコピーする
- `install.sh` は最後に `scripts/doctor.sh` で用意を調べる。NG の行があれば、そこに直し方が出る
- フックを新しく登録したときは、動いている Claude Code を起動し直す（起動したときのフックを使うので）
- フックはリポジトリの場所を指すので、clone した場所で `install.sh` を流す（リポジトリを動かしたら、もう一度）
- `--no-hook`: フックを登録しない。部屋・キャラ・タイピング・挙手・完了は動くが、資料室への調べ物・skill・ホワイトボード・
  話しかけは動かない
- `--no-keys`: keys.json を書き換えない（⌘. と ⌘⇧. は効かない）。keys.json は一度書き換えると、Herdr を更新しても新しい
  既定のショートカットが自動では入らなくなる

外すとき（先にほかのレイアウトにしておく）:

```sh
herdr-app do layout.switch --name main   # Herdr の既定のレイアウトへ
hooks/register.sh remove                 # Claude Code のフックだけ外す（ほかのフックはそのまま）
scripts/keys.sh remove                   # 足したキーだけ外す
rm -r ~/.config/herdr-app/mods/ai-office ~/.config/herdr-app/mods/ai-office-*
rm ~/.config/herdr-app/layouts/ai-office.json
```

## 使い方

```sh
herdr-app do layout.switch --name ai-office   # 左にオフィス、右にクリックしたエージェントのターミナル
herdr-app do mod.open --name ai-office        # 今のレイアウトの上に、浮いた窓で開く（もう一度で閉じる）
scripts/demo.sh start                         # 見本: 偽エージェントのスペースを作る（AI は使わない）。stop で消す
```

自分のレイアウトに、タブバーの「Office」ボタンで出し入れするオフィスの列を足すこともできる（`ai-office-toggle`。足し方は
[docs/internals.md](docs/internals.md)）。

### 上の帯

左に件数（作業中・待ち・完了・待機。部屋をドラッグしている間は、離すとどうなるか）。右のボタン:

| ボタン | すること |
|---|---|
| テーマ: … | 部屋の形を選ぶ（下の「テーマ」） |
| ターミナル: 出す / 出さない | 右のターミナルを出し入れする。隠すとオフィスが窓いっぱいになり、クリックしたエージェントのターミナルはオフィスの上に重なって出る（ai-office レイアウトだけ） |
| 通知: 出す / 出さない | 右下の通知（エージェントの待ち・完了など）を出すか。音は止まらない（音は Herdr の Settings > Alerts） |
| 凡例 | キャラの見分け方（AI と model、effort の鉢巻き） |
| 地球の絵 | 画面の言語（下の「言語」） |

テーマ・通知・言語の選んだものは Herdr の shared に置くので、再起動しても残り、ほかに開いているオフィスも同じになる。

### クリック

| どこ | 何が起きるか |
|---|---|
| キャラ・机の名札・ノート PC | そのエージェントのターミナルを出す（右のターミナルを出していれば切り替え、隠していればオフィスの上に重ねて）。許可待ちの「!」や、起動前の確認で止まっている人も、そのまま答えられる |
| ノート PC を右クリック | そのタブのメニュー（Rename・Close） |
| 質問の「?」 | 質問と選択肢のダイアログ。選ぶとターミナルに答えを送る（↑↓ と Enter、1〜9、Esc で閉じる）。続く質問も、最後の答えの確認まで |
| 空いた椅子とその上の「＋」 | 選んだエージェントを、その部屋の新しいタブで起動する |
| 「+ 部屋」のドア | フォルダを選んで、新しいスペース（部屋）を作る |
| 壁の名札 | そのスペースを選んで、部屋のメニュー（Rename・ワークツリー・Close）。奥の壁をドラッグすると、部屋（スペース）の順番を変える |
| ホワイトボード | 部屋の人が書いたプランと .md を、マークダウンで読む |
| 資料室の本棚 | 使える skill の一覧。skill をクリックすると中身 |
| 壁時計 | 町（タイムゾーン）を選ぶ。壁時計・窓の空・天気がその町になる |
| 窓（マウスを乗せる） | その町の時刻と天気・気温 |

### キー

| キー | すること |
|---|---|
| ⌘.（コマンド＋ピリオド） | オフィスの上に重ねて出したターミナルを閉じる（Esc はエージェントに届くので、閉じるのに使えない。✕ でも閉じる） |
| ⌘⇧.（コマンド＋シフト＋ピリオド） | 最後にオフィスで開いた人を、もう一度開く（ai-office レイアウトだけ。何かを重ねて出している間は何もしない） |

どちらも `install.sh` が、リポジトリの `keys.json` から Herdr の keys.json に足す（`scripts/keys.sh add`。ないキーだけ足し、
同じキーをほかに使っていれば変えずに知らせる）。今あるかは `scripts/keys.sh status`。

### キャラの動き

| エージェントの状態 | キャラの動き |
|---|---|
| working（編集・コマンド） | 席でノート PC をタイピング |
| working で調べ物（Read・Grep・Web 検索。フックが知らせる） | 廊下を通って資料室へ行き、本を読む |
| skill を使った（フック） | 資料室へ小走りで行き、その skill の本を抜いて読み、戻る |
| `hc send` でほかのエージェントに話しかけた（フック） | 相手のところへ小走りで行き、送った文の札で話して戻る |
| blocked（質問・許可待ち） | 席の後ろで手を挙げる。質問は「?」、許可待ちは「!」 |
| まだ状態を報告していない（起動中・起動前の確認） | 席の後ろに立つ。3 秒たっても報告がなければ、手を挙げて「!」 |
| done（見ていない間に終わった） | 席で「✓」 |
| idle | 立ってうろうろ |

見た目は AI ごと（Claude Code は橙の上着、Codex は青緑の上着とヘッドホン、ほかは紫）で、model を髪の色と小物、effort を
鉢巻きで見分ける（上の帯の「凡例」でも見られる）:

| model（髪の色と小物） | effort（鉢巻き） |
|---|---|
| opus: こげ茶の髪・眼鏡・ネクタイ | low: なし |
| sonnet: 茶色の髪（model が分からないときも） | medium: 青 |
| haiku: 金髪・若葉 | high: 白 |
| fable: 薄紫の髪・星のピン | xhigh: 赤 |
| Codex: 黒髪・ヘッドホン | max: 赤、作業中は両側に炎 |

model と effort は起動引数（Claude Code の `--model`・`--effort`、Codex の `-m`・`-c model_reasoning_effort=`）か
`~/.codex/config.toml` から読む。Claude Code で途中から変えたものは、statusLine のスクリプトなどがセッションごとに
`~/.cache/claude-model/<セッション>`・`~/.cache/claude-effort/<セッション>` に書いていれば分かる（セッションはターミナルの
`resume.id` ラベル。詳しくは [docs/internals.md](docs/internals.md)）。

## 言語

画面（ボタン・ツールチップ・ダイアログ）は英語と日本語。初めは OS の言語に合わせる（macOS は「言語と地域」のいちばん上、
ほかは `LC_ALL`・`LC_MESSAGES`・`LANG`。オフィスが起動したときに調べる）。上の帯の地球のボタンで、「OS に合わせる」・
English・日本語から選べる。どちらでもない言語の OS では英語。

- タブと部屋のメニュー（Rename・Close など）と右下の通知は、Herdr のものに合わせて英語
- スクリプト（`install.sh`・`doctor.sh` など）の出力は日本語だけ
- テーマの名前と説明は、テーマの `theme.json` に言語ごとに書ける（下の「テーマを足す」）

言語を足すには、`mods/ai-office/text.js` の `TEXT` と、ほかの mod（`mods/ai-office-*/main.js`）の `TEXT` に、`en` と同じ
名前で表を足し、`text.js` の `LANGS` にその言語での名前を足す。`bun test` が、英語と同じ文がそろっているかを確かめる。

## 仕掛け

- **資料室の本棚**: 本 1 冊 = 使える skill 1 つ。色は出どころ（青: `~/.claude/skills`、赤: スペースのフォルダの
  `.claude/skills`、橙: claude.ai から同期、緑: プラグイン、青緑: Codex）。39 冊まで棚に並び、ほかは一覧にだけ出る。
  Claude Code に組み込みの skill（`/code-review` など）はファイルがないので入らない
- **ホワイトボード**: 部屋の誰かがプラン（Claude Code のプランモード）や .md を書くと（Write・Edit、Bash の `> x.md`・`cp`・
  `mv` など）、その部屋の壁に掛かる。何本もあれば左に一覧、開いている間は 2 秒ごとに読み直す。エージェントへの指示や設定
  （`CLAUDE.md`・`AGENTS.md` など）と、`node_modules/` などの中は載せない。そのセッションが終わるまで残る
- **話しかけに行く**: エージェントが `hc send <相手> "文"` でほかのエージェントに送ると、送った人が相手のところへ行き、
  送った文の札と相手の「…」で話して戻る（送った側か受け取った側のどちらかが、フックのある Claude Code なら見える）
- **壁時計と窓の外**: 町は 19 から選ぶ（初めは Mac の時差にいちばん近い町）。空は太陽の高さで夜・薄明・朝焼け・昼・夕焼けと
  変わり、町ごとに名物が見える（東京タワー、エッフェル塔など）。天気は晴れ・曇り・霧・雨・雪・雷雨。
  `scripts/sky.sh rain night` のように試せる（`scripts/sky.sh auto` で本物に戻す）
- **右下の通知**: 「通知: 出さない」が効くのは、いちばん外側に `"toast": "ai-office-toast"` があるレイアウト（`ai-office` など）
  だけ。その間は、エラーの通知も mod の `notify()` も出ない。`herdr-app do ai-office.toasts-off`・
  `toasts-on` でも切り替えられる

細かい決まりは [docs/internals.md](docs/internals.md)。

## Claude Code のフック

`hooks/claude-office-act.sh` は、Claude Code がこれから使うツール、使った skill、書いたプランと .md、話しかけた相手を、その
ターミナルのラベル（`office.act`・`office.skill`・`office.plan`・`office.docs`・`office.talk` など）に書く。状態（working など）
だけでは分からないことを、オフィスに伝える。Herdr のターミナルの中（`HC_TERMINAL_ID` があるとき）でだけ動き、1 回 30〜40ms。

```sh
hooks/register.sh status   # ~/.claude/settings.json に登録されているか
hooks/register.sh add      # 登録する（PreToolUse・UserPromptSubmit・Stop・SessionEnd。install.sh もこれを流す）
hooks/register.sh remove   # このフックだけ外す（ほかのフックはそのまま）
```

Codex にはまだない（Codex のエージェントは、座る・うろうろ・挙手・完了だけ）。

## テーマ

上の帯の「テーマ」で選ぶ。同梱は 2 つ:

| | モダン（初め） | 和風（フォルダは classic） |
|---|---|---|
| 部屋 | 独立した部屋。廊下側はガラスの壁と自動ドア | 畳の部屋。廊下側は障子の壁と障子戸 |
| 床と廊下 | 板の床、石のタイルの廊下 | 畳、縁側と板張りの廊下 |
| 机と椅子 | 机と椅子 | 座卓と座布団 |
| 窓 | アルミの枠の引き違い | 木の枠の引き違い |

### テーマを足す

テーマは 1 つのフォルダ（`theme.json` と PNG）で、フォルダの名前がテーマの名前になる。自分のテーマは
`~/.config/herdr-app/ai-office-themes/<名前>/` に置く（`install.sh` で消えない。同梱と同じ名前なら、こちらが勝つ）。
オフィスは起動したときにテーマを読むので、足したら `scripts/sync.sh ai-office` か Herdr を開き直す。
`bun scripts/check-theme.js <フォルダ>` で、オフィスと同じ確かめができる（使えないなら理由が出る。オフィスでは「テーマ」の
ドロップダウンの下に出る）。

```jsonc
// mods/ai-office/themes/modern/theme.json（数はどれも絵の px。オフィスは絵の 1 px を 2 論理 px で描く）
{
  "label": { "en": "Modern", "ja": "モダン" },  // 「テーマ: …」に出す名前。文字列 1 つでもよい（言語ごとなら今の言語、なければ英語）
  "description": { "en": "…", "ja": "…" },      // ツールチップに出す説明（label と同じ書き方）
  "order": 1,                        // ドロップダウンの順（小さい順。同じなら名前の順）
  "window": "slide",                 // 壁の窓: slide（2 枚の引き違い）・wood（木の枠の引き違い）・cross（十字の桟）。書かなければ cross
  "room": {
    "height": 116,         // 1 列の高さ（部屋と、その手前の廊下・通路）
    "wall": 30,            // 奥の壁の高さ（壁の絵の高さと同じに）
    "lane": 48,            // 机の奥の通路（足の y）。壁より下、椅子（deskBack − 9）より上
    "deskBack": 62,        // 机の奥の縁（机は 21 の高さ）
    "box": 100,            // 部屋の枠（選んでいる部屋の枠・ドラッグの印）。ガラスの部屋はガラスの下端
    "corridorY": 112,      // 部屋の外へ行くときに通る高さ（足の y）
    "wanderFront": null,   // 手前でうろうろする y の範囲 [上, 下]。ガラスの部屋は null（部屋の中だけ）
    "rightExit": false,    // 机の右の通り道からも部屋を出るか（手前が開いた部屋だけ true にできる）
    "partitionEnd": 100,   // 部屋の左の仕切り（壁）が、奥からどこまで
    "hallSide": "glass",   // 縦の廊下に面した左の壁: glass か partition
    "shelfY": 8,           // 資料室の本棚の上端
    "decorDy": -2          // 壁の飾り（窓・時計・ホワイトボード）を上下にずらす量
  },
  "glass": { "y": 86, "height": 14 },  // 手前の壁（ガラス。和風は障子の絵）。null なら手前は開いている
  "images": {                          // このフォルダの PNG。書かないものは img/ の既定（wall 36・floor・hall）
    "wall": "wall.png",                // 奥の壁（横に並べる）
    "corridor": "corridor.png",        // 列ごとの横の廊下の床（高さは height − box）
    "glass": "glass.png",              // ガラスの壁の 1 枚（横に並べる。高さは glass.height）
    "door": "glass-door.png",          // 扉の枠: 左の柱 2・戸口 16・右の柱 2（高さは glass.height + 2）
    "doorPanel": "glass-door-panel.png" // 自動ドアの戸（幅 16 以上・高さは glass.height まで）。書かなければ扉は開いたまま
  },                                   // 床（floor）・縦の廊下（hall）・机（desk-l・desk-m・desk-r）・椅子（chair・chair-free）も替えられる
  "colors": {}             // 仕切りとガラスの壁の色（partition・partitionEdge・partitionFace・partitionBase・sideGlass・sideGlassEdge）
}
```

- // は説明。本物の theme.json は JSON なので、コメントは書けない
- PNG は絵の 1 px = 4 px で描く（大きさは PNG から読む）。1.5 倍・2 倍で描くとき用に、同じ名前に `@6x`・`@8x` を付けた
  6 倍・8 倍の PNG も置ける（なければ 4 倍の PNG を伸ばすので、少しにじむ）
- 机は img/ と同じ大きさ（左右の端 8 x 21、1 席ぶん 24 x 21）。椅子と空いた席の椅子は同じ大きさで、幅 24 まで
- 変えられるのは寸法と、床・壁・廊下・ガラス・扉・机・椅子の絵、仕切りの色、窓の枠。机の並べ方や歩き方は変えられない

## うまく動かないとき

`scripts/doctor.sh` を流す（何も変えず、画面も動かさない）。道具と jq の版、フックの登録と動き、mod がリポジトリと同じか、
Herdr のエラー、keys.json のキー、今ホワイトボードに載るものを調べ、NG の行に直し方を出す。

## 分かっている制限

- macOS で作って確かめている（ほかの OS では試していない）
- 絵は 4 倍の PNG を 2 論理 px で描くので、Herdr のズームを 1 以外にすると少しにじむ
- アニメは 1 本のタイマーでコマを送る（窓がアクティブなとき 4fps、後ろにあるとき 2fps）。Herdr の CPU は、オフィスが見えている間
  約 5〜8%、隠れている間 約 1%
- 資料室への調べ物・skill・ホワイトボード・話しかけは、フックを登録したあとに起動した Claude Code のものだけ。Codex と
  サブエージェントのものは出ない
- サブエージェント（`hc run` で起動された、ペインのないターミナル）は、まだオフィスにいない
- 町は 19 の中から選ぶ（好きな場所は入れられない）。天気は気象モデルの「今」の値なので、実際の空と少し違うことがある

ほかの細かい制限は [docs/internals.md](docs/internals.md)。

## 開発

```sh
bun test                                    # scene.js・text.js（言語）・質問の画面の読み取り
test/hook-test.sh                           # フック（herdr-app に出ない使い捨てのターミナルで）
test/ask-test.sh                            # 質問に答える流れ（偽の質問役で）
test/keys-test.sh                           # キーを足す・外す（一時フォルダの keys.json で。本物には触らない）
scripts/sync.sh                             # mod とレイアウトをコピーして herdr-app check（Herdr は自動で読み直す）
uv run --with pillow scripts/build-art.py   # 絵を作り直す
herdr-app shot tmp/shot.png                 # 今の画面を撮って確かめる
```

| 場所 | 何か |
|---|---|
| `mods/ai-office/` | オフィス本体。`scene.js` は計算だけ（herdr も gpui-kit も import しない）、`main.js` が描く、`text.js` は画面の文（言語ごと）、`themes/` は同梱のテーマ |
| `mods/ai-office-*/` | オフィスから開くもの: 質問（ask）、ホワイトボード（docs）、雇う（hire）、凡例（legend）、ドロップダウン（pick）、skill の一覧と中身（skills・skill）、タブと部屋のメニュー（tab）、右下の通知（toast）、自分のレイアウトに置く「Office」ボタン（toggle） |
| `layouts/` | `ai-office`（オフィスと、選んだエージェントのターミナル） |
| `hooks/` | Claude Code のフックと、その登録・削除 |
| `keys.json`、`scripts/keys.sh` | オフィスのキーと、それを Herdr の keys.json に足す・外す・調べるスクリプト |
| `scripts/install.sh`・`doctor.sh`・`sync.sh` | 入れる・更新する、用意を調べる、開発中にコピーして確かめる |
| `scripts/build-art.py` | ドット絵（文字の格子で描き、4 倍・6 倍・8 倍の PNG に書き出す） |
| `scripts/demo.sh`・`fake-agent.sh`・`fake-question.py` | AI を使わない偽エージェントの見本 |
| `scripts/sky.sh`、`scripts/check-theme.js` | 窓の外を試す、テーマを確かめる |
| `test/` | `bun test` と、フック・質問・キーのテスト |
| `docs/` | スクリーンショットと、仕組みの細かいこと（`internals.md`） |
| `spike/` | 描き方を決めたときの確認用 mod |

AI（Claude Code など）がここで確かめるときは、使っている人の画面を動かすもの（`open -a Herdr`、`scripts/demo.sh start`、
`layout.toggle`、`mod.open`、`space.new`・`tab.new`）の前に、必ず人に聞く。Herdr は作ったスペースとタブをすぐ見せるので、
人が打っている最中だとキーがそちらに入る。先に、画面を動かさない確かめ方（`bun test`、`test/*.sh`、`scripts/sync.sh`）を使う。

仕組みの細かいことは [docs/internals.md](docs/internals.md)、作りながら分かったことは [TODO.md](TODO.md)（どちらも日本語）。

## ライセンス

MIT（[LICENSE](LICENSE)）。ただし `mods/ai-office-toast/main.js` と `mods/ai-office-tab/main.js` は、Herdr についてくる toast と
menu の mod をもとにしているので Apache License 2.0（[LICENSE-APACHE](LICENSE-APACHE)、[NOTICE](NOTICE)）。

天気は [Open-Meteo](https://open-meteo.com/) のもの（Weather data by Open-Meteo.com。データは CC BY 4.0。無料の API は商用でない
使い方のためのもの）。
