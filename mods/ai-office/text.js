// text.js: オフィスの画面に出す文（ボタン・ツールチップ・メッセージ）の、言語ごとの表。herdr を知らない（bun test で試せる）。
// 読むのは scene.js だけで、main.js には scene.js から渡す（どちらも同じ表と同じ言語を使うように）。
// 言語は useLang で選ぶ（main.js が、上の帯の言語のボタンで選んだもの、または OS の言語にする。langOf）。表にない言語は英語、
// その言語の表にない文も英語。言語を足すときは、en と同じ名前で表を足し、LANGS にその言語での名前を足す。
// 文は文のまま訳す（言葉を差し込むだけの文も、言語ごとに言い方と区切り（「」・（））が違う）。差し込むものがある文は関数。
// オフィスのほかの mod（ai-office-ask など）は、mod のフォルダの外のここを読めないので、それぞれに小さい表を持つ。

/** 選べる言語（その言語での名前）。上の帯の言語のボタンのドロップダウンに、この順で出す。 */
export const LANGS = { en: "English", ja: "日本語" };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const TEXT = {
  en: {
    // 上の帯
    loadingThemes: "Loading themes…",
    counts: (c) => `Working ${c.working} · Waiting ${c.blocked} · Done ${c.done} · Idle ${c.idle}`,
    themeButton: (label) => `Theme: ${label}`,
    themeTip: "Click to choose a theme",
    themeSkipped: (name) => `Can't use: ${name}`,
    themeUnreadable: (message) => `can't read theme.json (${message})`,
    terminalShown: "Terminal: shown",
    terminalHidden: "Terminal: hidden",
    terminalShownTip: "The terminal on the right is shown. Click to hide it and let the office fill the window",
    terminalHiddenTip: "The terminal on the right is hidden (the office fills the window). Click to show it\n"
      + "A nameplate and the like still show a terminal, over the office",
    toastsOn: "Toasts: on",
    toastsOff: "Toasts: off",
    toastsOnTip: "Toasts at the bottom right (agents waiting, done and so on) are on. Click to turn them off",
    toastsOffTip: "Toasts at the bottom right (agents waiting, done and so on) are off. Click to turn them on",
    toastsSound: "Sounds still play (they're in Herdr's Settings > Alerts)",
    toastsElsewhere: "Has no effect in this layout (it works in the ai-office layout and layouts that draw toasts with ai-office-toast)",
    legend: "Legend",
    legendTip: "Click for the legend (how to tell the characters apart: AI and model, effort headbands)",
    langTip: (name, auto) => `Language: ${name}${auto ? " (matches the OS)" : ""}. Click to choose`,
    langAuto: "Match the OS",
    langAutoNow: (name) => `Now ${name}`,
    // 部屋
    roomPlateTip: (full) => `${full}\nClick: select this space and open its menu (rename, close). Drag: change the order of the rooms`,
    dragHold: (from) => `Holding "${from}". Drop it on another room to change the order`,
    dragTo: (from, to, after) => `"${from}" goes ${after ? "after" : "before"} "${to}" (drop to move it)`,
    newRoom: "+ Room",
    newRoomTip: "Empty room: click to make a new room (space)",
    folderPrompt: "Make it a room",
    boardTip: (plans, docs) => `Whiteboard: ${[plans ? plural(plans, "plan", "plans") : "", docs ? `${docs} .md` : ""]
      .filter(Boolean).join(", ")} (click to read)`,
    clockTip: (name, time, offset) => `${name} ${time} (${offset}): click to choose the place (time zone)`,
    placeNow: (offset, summer, time) => `${offset}${summer ? " (summer time)" : ""} · now ${time}`,
    // 席とキャラ
    shut: (close, reopen) => `Close the terminal shown over the office with ${close ? `${close} or ✕` : "✕"} (Esc goes to the agent)`
      + (reopen ? `. ${reopen} opens the last one you opened again` : ""),
    pcTip: "PC: click to show this agent's terminal (over the office while the terminal on the right is hidden). "
      + "Right-click for the tab menu (rename, close)",
    deskPlateTip: (name) => `${name} (click to show the terminal; over the office while the terminal on the right is hidden)`,
    charClick: "Click: show the terminal (over the office while the terminal on the right is hidden)",
    hireTip: "Free seat: click to hire an agent",
    silent: "No status yet (starting up, or stopped at a check before it starts)",
    askTip: "Click to answer the question",
    shelfTip: (n, more) => `Library shelf: ${plural(n, "skill", "skills")} you can use`
      + `${more > 0 ? ` (and ${more} more that don't fit)` : ""}. Click for the list`,
    // 窓の外
    noWeather: "No weather yet",
    trial: " (trying it out; herdr-app do ai-office.sky-auto goes back to the real one)",
    "weather.clear": "Clear",
    "weather.mostlyClear": "Mostly clear",
    "weather.partlyCloudy": "Partly cloudy",
    "weather.cloudy": "Cloudy",
    "weather.fog": "Fog",
    "weather.drizzle": "Drizzle",
    "weather.lightRain": "Light rain",
    "weather.heavyRain": "Heavy rain",
    "weather.rain": "Rain",
    "weather.lightSnow": "Light snow",
    "weather.heavySnow": "Heavy snow",
    "weather.snow": "Snow",
    "weather.rainShowers": "Rain showers",
    "weather.snowShowers": "Snow showers",
    "weather.thunder": "Thunderstorm",
    "weather.unknown": "Clear (unknown weather code)",
    "place.sydney": "Sydney",
    "place.tokyo": "Tokyo",
    "place.seoul": "Seoul",
    "place.shanghai": "Shanghai",
    "place.taipei": "Taipei",
    "place.singapore": "Singapore",
    "place.bangkok": "Bangkok",
    "place.delhi": "Delhi",
    "place.dubai": "Dubai",
    "place.moscow": "Moscow",
    "place.berlin": "Berlin",
    "place.paris": "Paris",
    "place.london": "London",
    "place.sao-paulo": "São Paulo",
    "place.new-york": "New York",
    "place.chicago": "Chicago",
    "place.denver": "Denver",
    "place.los-angeles": "Los Angeles",
    "place.honolulu": "Honolulu",
    // テーマの確かめ（readTheme。テーマのドロップダウンの下と scripts/check-theme.js に出る）
    "theme.notInteger": (key) => `room.${key} is not a whole number`,
    "theme.rightExit": "room.rightExit is not true or false",
    "theme.hallSide": "room.hallSide is not glass or partition",
    "theme.wanderFront": "room.wanderFront is not null or [top, bottom]",
    "theme.glass": "glass is not null or { y, height }",
    "theme.window": "window is not cross (crossed bars), slide (two sliding panes) or wood (a wooden frame)",
    "theme.imageUnreadable": (key, file) => `images.${key} (${file}) can't be read`,
    "theme.imageSize": (key, file) => `images.${key} (${file}) is not a multiple of 4 in size`,
    "theme.lane": (chairH) => `room.lane (the aisle behind the desks) must be below the wall (room.wall) and above the chairs `
      + `(room.deskBack − the chair height ${chairH})`,
    "theme.box": "Needs the desks (to room.deskBack + 21) ≦ the room frame (room.box) ≦ the row height (room.height)",
    "theme.partition": "The partition (room.partitionEnd) must end within the room frame (room.box)",
    "theme.shelf": "The library shelf (room.shelfY) and the reading spots (+ 76) don't fit in a row",
    "theme.decor": "The wall decorations (window, whiteboard; room.decorDy) don't fit on the wall",
    "theme.wallImage": (h) => `The wall image's height (${h}) is not room.wall`,
    "theme.corridorImage": "The corridor image's height is not the row height − the room frame",
    "theme.glassPlace": "The glass (glass.y, glass.height) must be in front of the desks, with its bottom at the room frame (room.box)",
    "theme.corridorY": "room.corridorY (the corridor) must be below the room frame, within the row",
    "theme.glassWander": "A glass room's room.wanderFront must be null (people wander only inside the room)",
    "theme.glassImage": "Needs images.glass (one pane of the glass wall), glass.height tall",
    "theme.doorImage": "Needs images.door (the door frame: post 2, doorway 16, post 2), glass.height + 2 tall",
    "theme.doorPanel": "images.doorPanel (the sliding door) must be at least 16 wide and at most glass.height tall",
    "theme.openCorridorY": "room.corridorY (the front aisle) must be below the desks, within the row",
    "theme.openWander": "An open room's room.wanderFront must run from below the desks to within the row",
    "theme.desk": (key, w, h) => `images.${key} (a desk) must be ${w} x ${h}`,
    "theme.chair": (w) => `images.chair and images.chair-free (the chair and the free seat's chair) must be the same size, `
      + `at most ${w} wide`,
  },
  ja: {
    loadingThemes: "テーマを読んでいます…",
    counts: (c) => `作業中 ${c.working} · 待ち ${c.blocked} · 完了 ${c.done} · 待機 ${c.idle}`,
    themeButton: (label) => `テーマ: ${label}`,
    themeTip: "クリックでテーマを選ぶ",
    themeSkipped: (name) => `使えない: ${name}`,
    themeUnreadable: (message) => `theme.json を読めない（${message}）`,
    terminalShown: "ターミナル: 出す",
    terminalHidden: "ターミナル: 出さない",
    terminalShownTip: "右のターミナルを出している。クリックで隠して、オフィスを窓いっぱいにする",
    terminalHiddenTip: "右のターミナルを出していない（オフィスが窓いっぱい）。クリックで出す\n名札などでターミナルを表示したときも出る",
    toastsOn: "通知: 出す",
    toastsOff: "通知: 出さない",
    toastsOnTip: "右下の通知（エージェントの待ち・完了など）を出している。クリックで出さないようにする",
    toastsOffTip: "右下の通知（エージェントの待ち・完了など）を出していない。クリックで出す",
    toastsSound: "音は止まらない（音は Herdr の Settings > Alerts）",
    toastsElsewhere: "このレイアウトでは効かない（効くのは ai-office のレイアウトと、通知を ai-office-toast で描くレイアウト）",
    legend: "凡例",
    legendTip: "クリックで凡例（キャラの見分け方: AI と model、effort の鉢巻き）",
    langTip: (name, auto) => `言語（Language）: ${name}${auto ? "（OS に合わせる）" : ""}。クリックで選ぶ`,
    langAuto: "OS に合わせる",
    langAutoNow: (name) => `今は ${name}`,
    roomPlateTip: (full) => `${full}\nクリック: このスペースを選んで、メニュー（名前を変える・閉じる）。ドラッグ: 部屋の順番を変える`,
    dragHold: (from) => `「${from}」をつかんでいます。ほかの部屋の上で離すと、順番が変わります`,
    dragTo: (from, to, after) => `「${from}」を「${to}」の${after ? "後ろ" : "前"}へ（離すと動かす）`,
    newRoom: "+ 部屋",
    newRoomTip: "空き部屋: クリックで新しい部屋（スペース）を作る",
    folderPrompt: "この部屋にする",
    boardTip: (plans, docs) => `ホワイトボード: ${[plans ? `プラン ${plans}` : "", docs ? `.md ${docs}` : ""]
      .filter(Boolean).join("・")}（クリックで読む）`,
    clockTip: (name, time, offset) => `${name} ${time}（${offset}）: クリックで場所（タイムゾーン）を選ぶ`,
    placeNow: (offset, summer, time) => `${offset}${summer ? "（夏時間）" : ""} · 今 ${time}`,
    shut: (close, reopen) => `重ねたターミナルは ${close ? `${close} か ✕` : "✕"} で閉じる（Esc はエージェントに届く）`
      + (reopen ? `。${reopen} で最後に開いた人をもう一度開く` : ""),
    pcTip: "PC: クリックでこのエージェントのターミナルを表示（右のターミナルを隠しているときは、オフィスの上に重ねて）。"
      + "右クリックでタブのメニュー（名前を変える・閉じる）",
    deskPlateTip: (name) => `${name}（クリックでターミナルを表示。右のターミナルを隠しているときは、オフィスの上に重ねて）`,
    charClick: "クリック: ターミナルを表示（右のターミナルを隠しているときは、オフィスの上に重ねて）",
    hireTip: "空いた席: クリックでエージェントを雇う",
    silent: "状態の報告がまだない（起動中か、起動の前の確認で止まっている）",
    askTip: "クリックで質問に答える",
    shelfTip: (n, more) => `資料室の本棚: 使える skill ${n} 冊${more > 0 ? `（棚に入りきらない ${more} 冊も）` : ""}。クリックで一覧`,
    noWeather: "天気はまだ分かりません",
    trial: "（試し中。herdr-app do ai-office.sky-auto で本物に戻す）",
    "weather.clear": "快晴",
    "weather.mostlyClear": "晴れ",
    "weather.partlyCloudy": "晴れ時々曇り",
    "weather.cloudy": "曇り",
    "weather.fog": "霧",
    "weather.drizzle": "霧雨",
    "weather.lightRain": "小雨",
    "weather.heavyRain": "大雨",
    "weather.rain": "雨",
    "weather.lightSnow": "小雪",
    "weather.heavySnow": "大雪",
    "weather.snow": "雪",
    "weather.rainShowers": "にわか雨",
    "weather.snowShowers": "にわか雪",
    "weather.thunder": "雷雨",
    "weather.unknown": "晴れ（天気コード不明）",
    "place.sydney": "シドニー",
    "place.tokyo": "東京",
    "place.seoul": "ソウル",
    "place.shanghai": "上海",
    "place.taipei": "台北",
    "place.singapore": "シンガポール",
    "place.bangkok": "バンコク",
    "place.delhi": "デリー",
    "place.dubai": "ドバイ",
    "place.moscow": "モスクワ",
    "place.berlin": "ベルリン",
    "place.paris": "パリ",
    "place.london": "ロンドン",
    "place.sao-paulo": "サンパウロ",
    "place.new-york": "ニューヨーク",
    "place.chicago": "シカゴ",
    "place.denver": "デンバー",
    "place.los-angeles": "ロサンゼルス",
    "place.honolulu": "ホノルル",
    "theme.notInteger": (key) => `room.${key} が整数でない`,
    "theme.rightExit": "room.rightExit が true か false でない",
    "theme.hallSide": "room.hallSide が glass か partition でない",
    "theme.wanderFront": "room.wanderFront が null か [上, 下] でない",
    "theme.glass": "glass が null か { y, height } でない",
    "theme.window": "window が cross（十字の桟）・slide（2 枚の引き違い）・wood（木の枠）でない",
    "theme.imageUnreadable": (key, file) => `images.${key}（${file}）が読めない`,
    "theme.imageSize": (key, file) => `images.${key}（${file}）の大きさが 4 の倍数でない`,
    "theme.lane": (chairH) => `room.lane（机の奥の通路）は、壁（room.wall）より下、椅子（room.deskBack − 椅子の高さ ${chairH}）より上に`,
    "theme.box": "机（room.deskBack + 21 まで）≦ 部屋の枠（room.box）≦ 1 列の高さ（room.height）に",
    "theme.partition": "仕切り（room.partitionEnd）は部屋の枠（room.box）まで",
    "theme.shelf": "資料室の本棚（room.shelfY）と読む所（+ 76）が 1 列に入らない",
    "theme.decor": "壁の飾り（窓・ホワイトボード。room.decorDy）が壁に入らない",
    "theme.wallImage": (h) => `壁の絵の高さ（${h}）が room.wall と違う`,
    "theme.corridorImage": "横の廊下の絵の高さが、1 列の高さ − 部屋の枠と違う",
    "theme.glassPlace": "ガラス（glass.y から glass.height）は机より手前で、下端が部屋の枠（room.box）に",
    "theme.corridorY": "room.corridorY（横の廊下）は部屋の枠の下、1 列の中に",
    "theme.glassWander": "ガラスの部屋の room.wanderFront は null（うろうろは部屋の中だけ）",
    "theme.glassImage": "images.glass（ガラスの壁の 1 枚）が要る。高さは glass.height",
    "theme.doorImage": "images.door（扉の枠。柱 2・戸口 16・柱 2）が要る。高さは glass.height + 2",
    "theme.doorPanel": "images.doorPanel（自動ドアの戸）は幅 16 以上、高さは glass.height まで",
    "theme.openCorridorY": "room.corridorY（手前の通路）は机の下、1 列の中に",
    "theme.openWander": "手前が開いた部屋の room.wanderFront は、机の下から 1 列の中まで",
    "theme.desk": (key, w, h) => `images.${key}（机）は ${w} x ${h}`,
    "theme.chair": (w) => `images.chair と images.chair-free（椅子と空いた席の椅子）は同じ大きさで、幅 ${w} まで`,
  },
};

let lang = "en";

/** 画面の言語を選ぶ（表にない言語は英語）。選んだ言語を返す。 */
export function useLang(want) {
  lang = Object.prototype.hasOwnProperty.call(TEXT, want) ? want : "en";
  return lang;
}

/**
 * 今の言語の文。差し込むものがある文は args を渡す。今の言語の表になければ英語、どこにもなければ key をそのまま
 * （画面で見れば気づく）。
 */
export function tr(key, ...args) {
  const v = TEXT[lang][key] ?? TEXT.en[key];
  if (v === undefined) return key;
  return typeof v === "function" ? v(...args) : v;
}

/** 場所（scene.js の PLACES）の、今の言語での名前。表になければ id。 */
export function placeName(place) {
  const key = `place.${place?.id}`;
  return TEXT[lang][key] ?? TEXT.en[key] ?? place?.id ?? "";
}

/**
 * 言語ごとに書ける文（theme.json の label と description）: 文字列ならそのまま、{ "en": …, "ja": … } なら今の言語、なければ英語、
 * それもなければ最初のもの。どちらでもなければ空。
 */
export function inLang(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value[lang] ?? value.en ?? Object.values(value)[0] ?? "";
}

/**
 * 画面の言語: 選んだ言語（上の帯の言語のボタン。shared の ai-office.lang）。"auto" か選んでいなければ OS の言語
 * （ai-office.os-lang。main.js が languageOf で調べる）。どちらも表になければ英語。
 */
export function langOf(choice, os) {
  const want = choice && choice !== "auto" ? choice : os;
  return Object.prototype.hasOwnProperty.call(TEXT, want) ? want : "en";
}

/**
 * OS の言語の設定から、言語（ISO 639 の 2〜3 文字。"ja" など）を読む。text は macOS の defaults read -g AppleLanguages の
 * 出力（("ja-JP", "en-JP") のような一覧。いちばん上が使う言語）か、LANG などの値（ja_JP.UTF-8）。読めなければ null
 * （C や POSIX、空も）。
 */
export function languageOf(text) {
  const first = String(text ?? "").replace(/[()",\s]+/g, " ").trim().split(" ")[0];
  return /^([a-z]{2,3})(?:[-_.@]|$)/i.exec(first)?.[1].toLowerCase() ?? null;
}
