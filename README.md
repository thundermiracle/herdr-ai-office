# Herdr AI Office

[English](README.en.md) | 日本語

[Herdr](https://herdr.dev)（herdr-app）のスペースを部屋に、AI エージェントをキャラクターにして、カイロソフト風のドット絵のオフィスで見せる mod とレイアウト。絵はすべてこのリポジトリで描いたオリジナル。

![見本の部屋 office-test と office-test-2（偽エージェント 10 人、モダンのテーマ）](preview.png)

- エージェントの状態で、キャラの動きが変わる（作業中はタイピング、調べ物は資料室の本棚へ、質問・許可待ちは挙手、終わると ✓、手が空くとうろうろ）
- キャラをクリックすると、そのエージェントのターミナルが出る。本物のターミナルなので、そのまま話せる
- 空いた席でエージェントを雇い、「+ 部屋」のドアで部屋（スペース）を作れる
- エージェントが書いたプランと .md は部屋のホワイトボードに、使える skill は資料室の本棚に並ぶ
- 壁時計と窓の外は、選んだ町の今の時刻と天気
- 画面は英語と日本語

## 入れる

必要なもの: herdr-app（と、ついてくる `hc`）、`jq`。先に一度 herdr-app を起動しておく（キーを足す keys.json は、そのときにできる）。

いちばん簡単なのは、Herdr の中のエージェント（Claude Code など）に頼むこと:

```text
https://github.com/thundermiracle/herdr-ai-office のレイアウトを Herdr に入れて。Claude Code のフックも登録して
```

エージェントは Herdr の説明書（`~/.config/herdr-app/AGENTS.md`）と [RECIPE.md](RECIPE.md) を読み、ネットや外のファイルに触ることを先に伝えてから、レイアウトと mod をコピーし、キーを足し（使っているキーは聞いてから）、フックを登録して、レイアウトを切り替える。更新も外すのも、同じように頼めばよい。

手で入れるなら:

```sh
git clone https://github.com/thundermiracle/herdr-ai-office.git
cd herdr-ai-office
scripts/install.sh                            # mod とレイアウトのコピー・フックの登録・キー・確かめ
herdr-app do layout.switch --name ai-office   # オフィスのレイアウトにする（ctrl-shift-l でも選べる）
```

- 更新は `git pull && scripts/install.sh`
- うまく動かないときは `scripts/doctor.sh`。NG の行に直し方が出る（設定は変えない。確かめるのに、見えない使い捨てのターミナルを作って消す）
- `--no-hook`: フックを登録しない（最後の doctor でフックの行が NG になり、`install.sh` も失敗で終わる）
- `--no-keys`: keys.json にキーを足さない（⌘. と ⌘⇧. は使えない）
- `--no-hook` と `--no-keys` は足さないだけで、前に入れたものは外さない（外すのは下の「外す」）

### Claude Code のフック

フック（mod の中の `hook/claude-office-act.sh`）は、Claude Code の調べ物・使った skill・書いた .md・話しかけた相手をオフィスに伝える。なくても部屋・キャラ・タイピング・挙手・✓ は動く。mod と一緒にコピーされるので、リポジトリを動かしたり消したりしても効く。

```sh
bash ~/.config/herdr-app/mods/ai-office/hook/register.sh add      # 登録する（install.sh もこれを流す）
bash ~/.config/herdr-app/mods/ai-office/hook/register.sh status   # 登録されているか
```

- 登録には `~/.claude/settings.json` が要る（なければ `echo '{}' > ~/.claude/settings.json`）
- 新しく登録したときは、動いている Claude Code を起動し直す（フックは起動したときに読まれる）

### このオフィスが触るもの

Herdr の mod は信頼して動かすコードなので、描く以外にすること:

- **ネット**: 窓の外の天気を [Open-Meteo](https://open-meteo.com/) から取る（キーは要らない。送るのは選んだ町の緯度経度だけ）
- **入れるときに書き換えるもの**: `~/.config/herdr-app/` の `mods/` と `layouts/`、`~/.claude/settings.json`（フック）、`~/.config/herdr-app/keys.json`（キー 2 つ。元は `keys.json.before-ai-office` に残す。一度書き換えると、Herdr を更新しても新しい既定のキーが自動では入らなくなる）
- **フックが書くもの**: Claude Code が動いているターミナルのラベル（`office.*`）と、`$TMPDIR` の小さな記録
- **読むもの**（書かない）: skill（`~/.claude/skills/`、プラグイン、`~/.codex/skills/`、各スペースのフォルダの `.claude/skills/`）、model と effort（`~/.codex/config.toml`、`~/.cache/claude-model/`・`~/.cache/claude-effort/`）、エージェントが書いたプランと .md、自分で足したテーマ
- **動かすもの**: `sh`（OS の言語を調べる）、`herdr-app status`、`git rev-parse`、`hc read`・`hc keys`（質問に答えるとき）

### 外す

エージェントに「AI Office を外して」と頼むか、手で（先にほかのレイアウトにしてから）:

```sh
herdr-app do layout.switch --name main                            # Herdr の既定のレイアウトへ
bash ~/.config/herdr-app/mods/ai-office/hook/register.sh remove   # フックを外す（mod を消す前に）
scripts/keys.sh remove                                            # リポジトリで: オフィスのキーを外す（同じ割り当てなら、前からあったものも）
rm -r ~/.config/herdr-app/mods/ai-office ~/.config/herdr-app/mods/ai-office-*
rm ~/.config/herdr-app/layouts/ai-office.json
```

## 使い方

左がオフィス、右がクリックしたエージェントのターミナル。上の帯のボタンで、テーマ・右のターミナルの出し入れ・右下の通知・凡例（キャラの見分け方）・言語を選べる。

| どこ | 何が起きるか |
|---|---|
| キャラ・机の名札・ノート PC | そのエージェントのターミナルを出す（右のターミナルを隠していれば、オフィスの上に重ねて） |
| ノート PC を右クリック | そのタブのメニュー（Rename・Close）。ai-office のレイアウトにはタブバーがないので、タブはここから |
| 質問の「?」 | 質問と選択肢のダイアログ。選ぶと、ターミナルに答えを送る |
| 空いた椅子の「＋」 | 選んだエージェントを、その部屋の新しいタブで起動する |
| 「+ 部屋」のドア | フォルダを選んで、新しいスペースを作る |
| 壁の名札 | 部屋のメニュー（Rename・Close など）。奥の壁をドラッグすると、部屋の順番を変える |
| ホワイトボード | 部屋の人が書いたプランと .md を読む |
| 資料室の本棚 | 使える skill の一覧と中身 |
| 壁時計 | 町を選ぶ（時計・窓の空・天気がその町になる） |

- ほかのレイアウトの上に浮いた窓で開くなら `herdr-app do mod.open --name ai-office`（もう一度で閉じる）。自分のレイアウトに「Office」ボタンを足すこともできる（[docs/internals.md](docs/internals.md)）
- `scripts/demo.sh start` で、AI を使わない偽エージェントの見本を作れる（`python3` が要る。`stop` で消す。作る間、画面が見本へ動く）

### キー

| キー | すること |
|---|---|
| ⌘.（コマンド＋ピリオド） | オフィスの上に重ねて出したターミナルを閉じる（Esc はエージェントに届くので、閉じるのには使えない） |
| ⌘⇧.（コマンド＋シフト＋ピリオド） | 最後にオフィスで開いた人を、もう一度開く（ai-office レイアウトだけ） |

どちらも `install.sh` が Herdr の keys.json に足す（あるかは `scripts/keys.sh status`）。

## 言語

画面は英語と日本語。初めは OS の言語に合わせ（どちらでもなければ英語）、上の帯の地球のボタンで切り替えられる。タブと部屋のメニュー・右下の通知は Herdr に合わせて英語、`install.sh`・`doctor.sh` などの出力は日本語だけ。

言語を足すには、`mods/ai-office/text.js` と各 mod（`mods/ai-office-*/main.js`）の `TEXT` に `en` と同じキーで表を足し、`text.js` の `LANGS` にその言語での名前を足す。`bun test` は `text.js` の表に英語と同じ文がそろっているかを確かめる（ほかの mod の表は確かめない）。`test/text.test.js` は英語と日本語の 2 つを前提にしているので、そこも直す。

## テーマ

上の帯の「テーマ」で選ぶ。同梱はモダン（ガラスの壁の部屋）と和風（畳と障子の部屋）。

### テーマを足す

1. 同梱のテーマ（`mods/ai-office/themes/modern/` など）を `~/.config/herdr-app/ai-office-themes/<名前>/` に写す（`install.sh` で消えない。同梱と同じ名前なら、こちらが勝つ）
2. PNG と `theme.json` を変える（PNG は絵の 1 px = 4 px で描く）
3. `bun scripts/check-theme.js <フォルダ>` で確かめ（使えないなら理由が出る。[bun](https://bun.sh) が要る）、Herdr を開き直す（テーマはオフィスが起動したときに読む）

<details>
<summary>theme.json の項目</summary>

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
- 1.5 倍・2 倍で描くとき用に、同じ名前に `@6x`・`@8x` を付けた 6 倍・8 倍の PNG も置ける（なければ 4 倍の PNG を伸ばすので、少しにじむ）
- 机は img/ と同じ大きさ（左右の端 8 x 21、1 席ぶん 24 x 21）。椅子と空いた席の椅子は同じ大きさで、幅 24 まで
- 変えられるのは寸法と、床・壁・廊下・ガラス・扉・机・椅子の絵、仕切りの色、窓の枠。机の並べ方や歩き方は変えられない

</details>

## 分かっている制限

- macOS でだけ確かめている（ほかの OS では試していない）
- 資料室への調べ物・skill・ホワイトボードが出るのは、フックを登録したあとに起動した Claude Code だけ（Codex とサブエージェントは出ない）。話しかけは、送った側か受け取った側がそういう Claude Code なら出る
- サブエージェント（`hc run` で起動された、ペインのないターミナル）は、まだオフィスにいない
- Herdr の CPU は、オフィスが見えている間 約 5〜8%、隠れている間 約 1%
- Herdr のズームを 1 以外にすると、絵が少しにじむ
- 町は 19 の中から選ぶ。天気は気象モデルの「今」の値なので、実際の空と少し違うことがある

ほかの細かい制限は [docs/internals.md](docs/internals.md)。

## 開発

```sh
bun test                                    # scene.js・text.js（言語）・質問の画面の読み取り
test/hook-test.sh                           # フック（herdr-app に出ない使い捨てのターミナルで）
test/ask-test.sh                            # 質問に答える流れ（偽の質問役で）
test/keys-test.sh                           # キーを足す・外す（一時フォルダの keys.json で）
scripts/sync.sh                             # mod とレイアウトをコピーして herdr-app check（Herdr は自動で読み直す）
uv run --with pillow scripts/build-art.py   # 絵を作り直す
```

`mods/ai-office/` がオフィス本体（`scene.js` は計算だけ、`main.js` が描く、`text.js` は画面の文、`hook/` は Claude Code のフック）、`mods/ai-office-*/` はオフィスから開くダイアログやメニュー。仕組みの細かいことと開発の注意は [docs/internals.md](docs/internals.md)。

## ライセンス

MIT（[LICENSE](LICENSE)）。ただし `mods/ai-office-toast/main.js` と `mods/ai-office-tab/main.js` は、Herdr についてくる toast と menu の mod をもとにしているので Apache License 2.0（[LICENSE-APACHE](LICENSE-APACHE)、[NOTICE](NOTICE)）。

天気は [Open-Meteo](https://open-meteo.com/) のもの（Weather data by Open-Meteo.com。データは CC BY 4.0。無料の API は商用でない使い方のためのもの）。
