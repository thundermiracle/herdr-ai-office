# herdr AI Office

herdr-app のワークスペースを部屋に、AI エージェントをキャラクターにして、
カイロソフト風のドット絵オフィスで見せる mod（PoC）。

- 1 つのスペース = 1 つの部屋。部屋の真ん中に長い机があり、エージェントが増えると机と部屋が伸びる
- 1 つのエージェント = 1 人のキャラクター。状態で動きが変わる（タイピング・本棚で調べ物・うろうろ・挙手）
- 空いた椅子をクリックすると、その部屋にエージェントを雇える（新しいタブで起動）

進み具合は [TODO.md](TODO.md)。

## 中身

| 場所 | 何か |
|---|---|
| `mods/ai-office/` | mod 本体（`~/.config/herdr-app/mods/ai-office/` にコピーして使う） |
| `layouts/ai-office.json` | オフィスと、選んだエージェントのターミナルを並べたレイアウト |
| `art/`、`scripts/build-art.py` | ドット絵の元データと、それを PNG / GIF にするスクリプト |
| `hooks/` | Claude Code のフック（調べ物中を `office.act` ラベルで知らせる） |
| `scripts/fake-agent.sh` | AI を使わずに状態を切り替える、テスト用の偽エージェント |
| `spike/` | 描画の確認用 mod（PoC の判断材料） |

## 開発

```sh
scripts/sync.sh          # mods/ と layouts/ を ~/.config/herdr-app にコピーして herdr-app check
```

herdr-app はコピー先の変更を見て mod を読み直す。シンボリックリンクにしないのは、
リンク先の変更を herdr-app が検知できないことがあるため。
