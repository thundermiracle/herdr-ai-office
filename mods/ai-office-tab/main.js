// ai-office-tab: オフィスのメニュー。机の PC を右クリックすると出る、そのエージェントのタブのメニュー（名前を変える・閉じる）と、
// 壁の名札をクリックすると出る、その部屋（スペース）のメニュー（名前を変える・ワークツリーを開く・外す・閉じる）。
// Herdr のメニュー（menu）と同じ見た目とキー（↑↓ で選び、Enter、Esc で閉じる）。Herdr のメニューにある、タブの New tab と
// スペースの New worktree は出さない（エージェントを足すのは空いた席の「＋」から、ワークツリーを作るのはエージェント）。
// props: { tab: タブの id } か { space: スペースの id }
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, spaces, panes, exec } from "herdr";

// スペースが今いるフォルダ: 最初のターミナルの今のフォルダ、なければ作ったときのフォルダ（Herdr の menu と同じ）
function place(space) {
  const tabs = new Set((space.tabs ?? []).map((t) => t.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder;
}

// フォルダの git: "main"（リポジトリそのもの）、"linked"（ワークツリー）、git でなければ null（Herdr の menu と同じ）
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

// [出す名前, コマンド, 引数, アイコン（workspace-chrome の svg。Herdr の menu と同じ）]。コマンドが worktree なら、
// Herdr のワークツリーのダイアログ（worktree）を開く。git は checkout の答え（スペースのときだけ。調べ終わるまで null）
function items(p, git) {
  if (p?.space) {
    const id = p.space;
    return [
      ["Rename", "space.rename", { id }, "square-pen"],
      ...(git ? [["Open worktree", "worktree", { space: id, action: "open" }, "git-branch"]] : []),
      ...(git === "linked" ? [["Remove worktree", "worktree", { space: id, action: "remove" }, "git-branch"]] : []),
      ["Close", "space.close", { id }, "x"],
    ];
  }
  return [
    ["Rename", "tab.rename", { id: p?.tab }, "square-pen"],
    ["Close", "tab.close", { id: p?.tab }, "x"],
  ];
}

// コマンドに付いているキー（右に出す。Herdr の menu と同じ）
function shortcut(name) {
  const k = keys().find((b) => b.section === "global" && b.action === name);
  return k ? k.keys : "";
}

export default class TabMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // 部屋のメニュー: そのスペースのフォルダが git か（ワークツリーの項目を出すか）を調べる
    const space = props()?.space && spaces().find((s) => s.id === props().space);
    const folder = space && place(space);
    if (folder) {
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
    }
  }

  choose(i) {
    const p = props() ?? {};
    const it = items(p, this.git)[i];
    if (!it) return;
    const [, command, args] = it;
    closeOverlay(p.overlay);
    if (command === "worktree") {
      openOverlay({ mod: "worktree", kind: "dialog", ...(args.action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }),
        props: args });
    } else {
      run(command, args);
    }
  }

  render() {
    const t = theme();
    const list = items(props(), this.git);
    return v_flex().id("tab-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        cx.notify();
      })
      .children(list.map(([label, command, , icon], i) => v_flex()
        .when(command.endsWith(".close"), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`mi-${i}`).h(31).px(8).gap(9).rounded(7).items_center().justify_between().text_color(t.foreground)
          .cursor_pointer()
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.choose(i))
          .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(label))
          .child(div().text_size(11).text_color(t.dim).child(shortcut(command))))));
  }
}
