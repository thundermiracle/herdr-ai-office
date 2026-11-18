# Bash のコマンドが書く .md の道を 1 行ずつ出す（hooks/claude-office-act.sh が jq -Rrs -f で使う。入力はコマンドの文字列）。
# 拾う形: `> x.md`・`>> x.md`・`tee [-a] x.md`（"..." と '...' の引用符も）。相対の道は $cwd（セッションのフォルダ）から、
# ~/ は $home から。~/.claude/ の中は入れない（一時フォルダの .md は入れる。Claude Code の作業フォルダに置いた報告など）
[ scan("(?:>{1,2}|\\btee(?:\\s+-a)?)\\s*(\"[^\"\\n]+\\.(?:md|markdown)\"|'[^'\\n]+\\.(?:md|markdown)'|[^\\s;&|<>()\"']+\\.(?:md|markdown))(?=$|[\\s;&|)])"; "i")[0]
  | gsub("^[\"']|[\"']$"; "")
  | if startswith("/") then .
    elif startswith("~/") then $home + .[1:]
    else $cwd + "/" + sub("^\\./"; "")
    end
  | select(test("/\\.claude/") | not)
]
| unique
| .[]
