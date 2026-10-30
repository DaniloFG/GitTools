<p align="center">
  <img src="media/icon.png" width="96" alt="GitTools logo" />
</p>

<h1 align="center">GitTools</h1>

<p align="center">
  <b>Git with a visual interface inside VS Code.</b><br/>
  Drag and click to merge, rebase and cherry-pick whole branches, single commits, files — or even <i>individual lines</i>.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=DaniloFG.gittools-vscode"><img alt="Marketplace version" src="https://img.shields.io/visual-studio-marketplace/v/DaniloFG.gittools-vscode?label=Marketplace&color=2f86ea" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=DaniloFG.gittools-vscode"><img alt="Installs" src="https://img.shields.io/visual-studio-marketplace/i/DaniloFG.gittools-vscode?color=2f86ea" /></a>
  <a href="https://github.com/DaniloFG/GitTools/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2f86ea" /></a>
</p>

![GitTools Dashboards inside VS Code: KPIs, commits over time, top contributors, activity calendar and most changed files](media/readme/dashboards-overview.png)

## 📊 Dashboards — your repository's history, in numbers

The new **Dashboards** tab (`Ctrl+5`) sits at the top, fills the whole panel and turns `git log` into management,
governance and audit views — no export, no BI tool, no leaving VS Code. Every dashboard opens with several distinct
charts, and **every chart can switch form with one click** (area, lines, bars, donut, treemap, heatmap, radar,
scatter, funnel, gauge, calendar…) or become a table.

| Dashboard | What it shows |
| --------- | ------------- |
| **Overview** | KPIs with change vs. the previous period, commits over time, top contributors, activity calendar, most changed files, weekday × hour, folders and commit types. |
| **People** | Ranking by commits, lines, files or active days; each person's contribution over time, effort, profile (radar), newcomers vs. returning, *bus factor*, who touches what and a full table. |
| **Code** | Most changed files, folder map, lines added/removed, code growth, commit size, file types, risk *hotspots* and files that change together. |
| **Cadence** | Activity calendar, weekday × hour, commits per hour and month, rolling pace, streaks and gaps, and a release timeline. |
| **Governance** | Message convention (*Conventional Commits*), working hours vs. off-hours vs. weekends, direct commits vs. merges vs. reverts, quality funnel, **audit flags** (no Signed-off-by, no description, author ≠ committer, huge commits…) and a list of commits to review. |
| **Repository** | Branches (age, health, ahead/behind upstream), tags and releases, repository composition by folder and size. |
| **GitTools** | What you did *here*: health of the git commands run, most used, duration, timeline and slowest. |

![Dashboards: governance and audit](media/readme/dashboards-governance.png)

![Dashboards in motion: switching dashboards, chart types, filters and the chart gallery](media/readme/dashboards.gif)

- 🎛️ **Filters in a single row**: period (7 days … all time, or exact dates), person, all branches or current only, include merges and hide bots.
- ➕ **A gallery of 46 charts**: *Add chart* opens the catalogue by category; build **your own dashboards**, rename them, and reorder and resize cards by dragging.
- 🧾 **Audit-ready**: every chart has a **table view** and *Copy CSV* to take the numbers to a spreadsheet or a report.
- 🌗 **Light and dark** (it follows your VS Code theme), 6 languages, an accessible palette (high contrast, colour-blind safe) and tooltips on every chart.

![Dashboards: people](media/readme/dashboards-people.png)
![Dashboards: code](media/readme/dashboards-code.png)
![Dashboards: cadence](media/readme/dashboards-cadence.png)
![Dashboards: repository](media/readme/dashboards-repository.png)
![Dashboards: what was done in GitTools](media/readme/dashboards-gittools.png)
![Dashboards: chart gallery](media/readme/dashboards-gallery.png)
![Dashboards in the light theme](media/readme/dashboards-light.png)

The numbers come straight from your local history, read with a single `git log --numstat` (it honours `.mailmap`),
and nothing leaves your machine.

![GitTools inside VS Code: history graph, commit details and live git log](media/readme/hero.png)

GitTools turns the git commands that are hard to remember — especially **cherry-pick** — into things you can
simply **drag and drop**. It runs on the git that is already installed on your machine, needs no account and
sends nothing anywhere.

## Why GitTools?

> **Tired of one tool for the graph, another for conflicts, and yet another to pick what goes into a commit?**
> GitTools brings together the best of what the top Git tools on the market do — in a single, lightweight,
> free interface that lives right inside VS Code.

- 🌳 **A beautiful history graph** like the best visual clients: colored lanes, search, tags and columns you can rearrange.
- ✅ **Pick your commit with checkboxes**, or drag files between *staged* and *unstaged* — choose the view you like, in the same screen.
- ✂️ **Line-by-line staging**: commit only the lines that matter, straight from the diff.
- 🔀 **Side-by-side conflict editor** (*current × result × incoming*), block by block, no terminal needed.
- 🍒 **Cherry-pick on another level**: a whole branch, commits, **files** or **lines** — just drag.
- 🧹 **Visual interactive rebase**, **blame**, file history and branch comparison — one click away.
- 🧩 **A workspace your way**: move panels and tabs wherever you want, like in a modern editor.
- 🔒 **No account, no cloud, no telemetry.** It uses the git you already have installed. Open source (MIT).

*One tool. The whole Git workflow. No more switching windows.*

## Highlights

- 🍒 **Cherry-pick anything**: a whole branch, chosen commits, specific files, or just the lines you select.
- 🖱️ **Drag & drop**: drop a branch, commits or files onto another branch and pick what to do.
- 🔀 **Side-by-side conflict editor**: *current × result × incoming*, block by block.
- 🌳 **History graph** with colored branch lanes, search, tags and resizable columns.
- 🧭 **Better diffs**: line selection, whole-file view, side-by-side mode, `F7`/`F8` to jump between changes and files.
- 📁 **File list or folder tree** everywhere, with `+added −removed` line counts.
- 🎨 **Looks native**: follows your VS Code theme, fonts and the same colors VS Code uses for modified, added and deleted files, with file-type icons (can be turned off in Settings → Appearance).
- 🧩 **Arrange the workspace your way**: every panel is independent — drag any panel to any side of any other panel.
- ☑️ **Focus on a few branches**: tick the checkboxes in the branch sidebar and the history shows only those branches — the branch list itself stays put.
- ✏️ **Edit files with a git assistant**: edit any file in a built-in editor; a bubble at the end of the cursor line tells you *who* changed it, *when* and *what the commit did*.
- 💾 **Save your layouts**: name the arrangement you like and bring it back whenever you want.
- 📜 **Live git log**: see every command GitTools runs, in real time.
- 🌍 **6 languages** (English, Português, Español, 中文, हिन्दी, العربية) and a theme that follows VS Code.

---

## Cherry-pick a whole branch

Drag a branch from the sidebar onto another one and choose **Merge**, **Rebase** or **Cherry-pick every commit**.
Commits that were already applied are skipped automatically.

![Dragging a branch onto main and cherry-picking all of its commits](media/readme/cherry-pick-branch.gif)

## Cherry-pick only some **lines**

Open a commit, click or drag over the lines you want and hit **Apply lines to…**. GitTools builds a partial patch
with just those lines and applies it with `git apply --3way` — keep it staged for review, or commit it right away.

![Selecting a few lines of a commit and applying only those to the current branch](media/readme/cherry-pick-lines.gif)

## Cherry-pick Studio

One place to pick **commits, files or lines** between any two branches: *Whole branch*, *Commits*, *Files* and *Lines* tabs.
With more than one repository open, the *Source repository* selector brings commits, files or lines from **another open
repository** into the current branch — the source is never changed, and nothing is touched unless the destination is on a
branch with no operation in progress and no uncommitted changes.

![Cherry-pick Studio with the Lines tab](media/readme/studio.png)

## Resolve conflicts side by side

When a cherry-pick, merge or rebase conflicts, open the conflict editor: choose *current*, *incoming* or *both* per block
(or for the whole file), edit the result, and continue — all without leaving the panel.

![Resolving a cherry-pick conflict in the side-by-side editor](media/readme/conflict-resolution.gif)

## Folder tree and diff navigation

Switch every file list between **List** (file name + folder) and **Tree**. In any diff, `F7` / `Shift+F7` jump to the
next / previous change and `F8` / `Shift+F8` to the next / previous file.

![Folder tree and jumping between changes with F7 and F8](media/readme/diff-navigation.gif)

## Arrange the workspace

No panel is a "parent" of another: the commit list, the commit message, the commit's files and diff, the *Unstaged* and
*Staged* lists, the commit box, the changes diff, the file browser, blame, the comparison and the Git log are all
independent panels. Drag a panel's tab onto the middle of another panel to make it a tab there, next to one of its
edges to split that panel on that side, or onto the window edge — any panel, anywhere. The **History / Changes /
Files / Compare** buttons bring a screen's panels to the front wherever you left them, **▦** shows or hides any
panel, and *Restore default layout* puts everything back.

**Save your layouts**: arrange the panels the way you like and use **▦ → Save current layout…** to give the
arrangement a name; **▦ → My layouts** brings it back whenever you want (the ✕ next to a layout deletes it, and
**Settings → Appearance** lists them too). Restoring the default layout never deletes your saved ones.

![Dragging the Changes tab to the right, saving the layout, restoring the default and applying the saved one](media/readme/custom-layout.gif)

![The Panels menu with Save current layout and My layouts](media/readme/layouts-salvos.png)

## Edit files — with a git assistant at the end of the line

Click a file in **Files** to edit it right there: line numbers, `Tab` indents (using the file's own indentation),
`Ctrl+S` saves, and what you typed is kept if you switch files or screens (files with unsaved changes get a ●).
Line endings (LF / CRLF) and BOM are preserved, and the editor warns you if the file changes on disk meanwhile.
Double-click a panel's tab (or press ⤢) to maximize it.

The **inline git assistant** shows a bubble at the end of the line your cursor is on: **who** changed it, **when**
and **what the commit did** — click it to open the commit. Lines you just wrote read *You · editing now*, and saved
but uncommitted ones *You · saved, not committed yet*. It is on by default; turn it off in **Settings → Editor and diff →
Git assistant in the editor**.

![The inline git assistant following the cursor while editing a file](media/readme/inline-assistant.gif)

![The editor with the assistant bubble at the end of the cursor line](media/readme/editor-inline.png)

## Focus on a few branches

Tick the checkboxes of the branches you care about and the history (and its timelines) shows only theirs. The branch
list is your reference, so it **does not move**: the filter strip always has the same height, the branch colors stay
the same and no other panel jumps to the front. *Show all* brings everything back.

![Two branches ticked: the history shows only theirs while the branch list stays the same](media/readme/filtro-branches.png)

## Compare, blame and file history

Compare any two branches, tags or commits and bring over lines or whole files; see who changed every line with
**Blame**; follow a file through renames in its **history**.

| Compare | Blame |
| --- | --- |
| ![Comparing two branches](media/readme/compare.png) | ![Blame for a file](media/readme/blame.png) |

---

## Getting started

1. Open a folder that is a git repository (or use **GitTools: Open a repository…**).
2. Run **GitTools: Open GitTools** — `Ctrl+Alt+G` (`⌘⌥G` on macOS) — or click **⑂ GitTools** in the status bar.

| Command | What it does |
| --- | --- |
| **GitTools: Open GitTools** | Opens (or reveals) the GitTools panel. |
| **GitTools: Open a repository…** | Picks another repository folder. |
| **Open this folder in GitTools** | Explorer context menu on a folder. |
| **Show this file's changes in GitTools** | Opens the diff of the current file in a panel beside it (editor title button). |

Right-click a commit in the history for **Copy message ▸** (full message, title only or description only).

Files that GitTools opens (*Open in editor*, file menus, conflict files) open in **VS Code's own editor**, beside the panel;
*Open in editor* on the project reveals it in VS Code's Explorer (or opens it in a new window if it isn't the open folder).

## Keyboard shortcuts (inside the panel)

| Action | Shortcut |
| --- | --- |
| History / Changes / Files / Compare / Dashboards | `Ctrl+1` … `Ctrl+5` |
| Search the history | `Ctrl+F` |
| Cherry-pick Studio | `Ctrl+Shift+P` |
| Next / previous change in a diff | `F7` / `Shift+F7` |
| Next / previous file in the list | `F8` / `Shift+F8` |
| Fetch / Pull / Push | `Ctrl+Shift+F` / `Ctrl+Shift+L` / `Ctrl+Shift+K` |
| Force push (with lease) | `Ctrl+Alt+Shift+K` |
| All shortcuts | `F1` |

Every shortcut can be changed in **⚙ Settings → Keyboard shortcuts**.

## Settings

Open **⚙** in the panel's top bar: language, theme, file icons and change letters (M, A, D…), diff layout and whether
diffs show only the changed parts or the whole file, **date and time format** (ISO `2026-12-31 23:59:59` by default, the system's, 24-hour or 12-hour),
notification position and size, your git identity (`user.name` / `user.email`, global or per repository) and **remotes**
(add, rename, change URL, remove, and several push destinations per remote). **Apply** saves and keeps Settings open.

Open repositories are kept in memory per tab: switching tabs, screens and panels does not reload what was already loaded
(unless the repository changed), and only the panels on screen load their data.

## Requirements

- [Git](https://git-scm.com/) 2.23 or newer on your `PATH`.
- VS Code 1.90 or newer.

## Privacy

Everything runs locally. GitTools only runs `git` commands on your machine; it has no telemetry, no account and no
network calls of its own (git itself talks to your remotes when you fetch, pull, push or clone).

## Links

- 💻 Source code & issues: <https://github.com/DaniloFG/GitTools>
- 🖥️ Also available as a standalone desktop app (Windows, macOS, Linux) from the same repository.

Released under the [MIT License](https://github.com/DaniloFG/GitTools/blob/main/LICENSE).

## Credits

File-type icons are a subset of an open-source icon set (MIT) — credits and license in `THIRD_PARTY_NOTICES.md`.
