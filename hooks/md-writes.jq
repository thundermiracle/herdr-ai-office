# Bash のコマンドが書く .md の道を 1 行ずつ出す（hooks/claude-office-act.sh が jq -Rrs -f で使う。入力はコマンドの文字列）。
# 拾う形: `> x.md`・`>> x.md`・`tee [-a] x.md`（"..." と '...' の引用符も）。相対の道は $cwd（セッションのフォルダ）から、
# ~/ は $home から。~/.claude/ の中と、一時フォルダ（/tmp・/var/folders）の作業メモは入れない
[ scan("(?:>{1,2}|\\btee(?:\\s+-a)?)\\s*(\"[^\"\\n]+\\.(?:md|markdown)\"|'[^'\\n]+\\.(?:md|markdown)'|[^\\s;&|<>()\"']+\\.(?:md|markdown))(?=$|[\\s;&|)])"; "i")[0]
  | gsub("^[\"']|[\"']$"; "")
  | if startswith("/") then .
    elif startswith("~/") then $home + .[1:]
    else $cwd + "/" + sub("^\\./"; "")
    end
  | select((test("/\\.claude/") or test("^(/private)?/(tmp|var/folders)/")) | not)
]
| unique
| .[]
