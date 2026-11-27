# Bash のコマンドに出てくる .md の道を 1 行ずつ出す（同じフォルダの claude-office-act.sh が jq -Rrs -f で使う。入力はコマンドの文字列）。
# 書いたかもしれない .md で、読むだけのものも入る。フックはコマンドの前の状態を覚え、あとで変わっていたものだけを書いた .md に
# するので、ここは多めに出してよい（出しすぎても、変わらなければ入らない）。拾う形:
#   - .md で終わる語（"..." と '...' の中も）。代入（OUT=x.md）とオプション（--out=x.md）は = の後ろ
#   - cp・mv・install・rsync・ditto・ln の最後の語がフォルダなら、そこに入る .md（mv x.md docs/ → docs/x.md）
# 相対の道は $cwd（セッションのフォルダ）からと、コマンドの中の cd の先から（cd docs && cat > x.md）。~/ は $home から。
# 変数・`...`・* ? の入った道は分からないので出さない（"$W/x.md" など。前はそのまま入り、ない道で一覧を
# 埋めていた）。フォルダへ入れるときの .md の名前は、フォルダの部分に変数があっても使う（cp "$W/x.md" docs/ → docs/x.md）。
# .claude/ の中（~/.claude/ のメモリや設定、プロジェクトの .claude/ の skill など）は出さない。ただし Claude Code の
# ワークツリー（<リポジトリ>/.claude/worktrees/<名前>/）はプロジェクトそのものなので出す（その中の .claude/ は出さない）。
# 一時フォルダの .md も出す（Claude Code の作業フォルダに置いた報告など）。
# jq 1.6 でも動く形で書く: flags を渡す scan(re; flags) は jq 1.7 から（1.6 では式ごと読めず、Bash の .md を 1 つも拾えない）

# 語（引用符の中、またはそれ以外の続き）の並び
def words: [match("\"((?:[^\"\\\\]|\\\\.)*)\"|'([^']*)'|([^\\s;&|<>()\"'`]+)"; "g")
  | [.captures[].string | select(. != null)][0] // ""];
def unassign: sub("^[A-Za-z_][A-Za-z0-9_]*="; "") | sub("^--?[A-Za-z0-9][A-Za-z0-9-]*="; "");
def known: length > 0 and (test("[$`*?\\n]") | not);
def ismd: test("\\.(md|markdown)$"; "i");
def norm: split("/")
  | reduce .[] as $p ([]; if $p == "" or $p == "." then . elif $p == ".." then .[:-1] else . + [$p] end)
  | "/" + join("/");
def from($base): (if startswith("/") then . elif . == "~" or startswith("~/") then $home + .[1:] else $base + "/" + . end) | norm;

. as $cmd
| ([$cwd] + [$cmd
    | match("(?:^|[;&|(\\n])\\s*(?:(?:then|do|else)\\s+)?(?:cd|pushd)\\s+(\"[^\"\\n]+\"|'[^'\\n]+'|[^\\s;&|)]+)"; "g")
    | .captures[0].string | gsub("^[\"']|[\"']$"; "") | select(known and . != "-") | from($cwd)]) as $bases
| def place: if startswith("/") or startswith("~") then from($cwd) else from($bases[]) end;
[ ($cmd | words[] | unassign | select(known and ismd) | place),
  ($cmd | [splits("&&|\\|\\||[;|\\n]")][] | words
    | until(length == 0 or (.[0] | test("^([A-Za-z_][A-Za-z0-9_]*=.*|sudo|command|env|nohup|time)$") | not); .[1:])
    | map(select(test("^-") | not))
    | select(length >= 3 and (.[0] | test("^(cp|mv|install|rsync|ditto|ln)$")))
    | .[-1] as $dest
    | select(($dest | ismd | not) and ($dest | known))
    | .[1:-1][] | select(ismd) | split("/") | last | select(known)
    | (($dest | sub("/+$"; "")) + "/" + .) | place)
]
| map(select(test("/\\.claude/(?!worktrees/)") | not))
| unique
| .[]
