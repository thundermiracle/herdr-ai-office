# Bash のコマンドが書く .md の道を 1 行ずつ出す（hooks/claude-office-act.sh が jq -Rrs -f で使う。入力はコマンドの文字列）。
# 拾う形: `> x.md`・`>> x.md`・`tee [-a] x.md`（"..." と '...' の引用符も）。相対の道は $cwd（セッションのフォルダ）から、
# ~/ は $home から。.claude/ の中（~/.claude/ のメモリや設定、プロジェクトの .claude/ の skill など）は入れない。ただし
# Claude Code のワークツリー（<リポジトリ>/.claude/worktrees/<名前>/）はプロジェクトそのものなので入れる（その中の .claude/ は
# 入れない）。一時フォルダの .md は入れる（Claude Code の作業フォルダに置いた報告など）。
# jq 1.6 でも動く形で書く: flags を渡す scan(re; flags) は jq 1.7 から（1.6 では式ごと読めず、Bash の .md を 1 つも拾えない）
[ match("(?:>{1,2}|\\btee(?:\\s+-a)?)\\s*(\"[^\"\\n]+\\.(?:md|markdown)\"|'[^'\\n]+\\.(?:md|markdown)'|[^\\s;&|<>()\"']+\\.(?:md|markdown))(?=$|[\\s;&|)])"; "gi")
  | .captures[0].string
  | gsub("^[\"']|[\"']$"; "")
  | if startswith("/") then .
    elif startswith("~/") then $home + .[1:]
    else $cwd + "/" + sub("^\\./"; "")
    end
  | select(test("/\\.claude/(?!worktrees/)") | not)
]
| unique
| .[]
