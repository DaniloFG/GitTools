# Changelog

All notable changes to the GitTools extension for VS Code are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Conflicts screen: lists the conflicted files with filters, edits each file in an embedded editor, and applies batch actions from a footer.
- Guided tour of the interface, offered on the welcome screen and available in Settings, in all six languages.
- Optional automatic continue after the last conflict of a cherry-pick, revert or rebase (off by default). Choices of "ours" or "theirs" carry over to the next stop, after a summary to apply or ignore them.
- Cherry-pick across several commits shows "step N of M" at each stop, for sequences started in the app.
- Line wrapping in the diff can be turned on or off, in Settings or in the diff's ⋯ menu.
- Settings search looks across the sections and shows where each match is.
- Cherry-pick Studio has a search box.
- Compare: "Apply whole file" in the menu.

### Changed

- Opening a workspace with several repositories no longer scans its folders by default. Turn on multi-repository detection in GitTools settings.
- Appearance settings group the toolbar, the dynamic panels and the screens. The top screen buttons (History, Changes, Files, Compare, Branches, Git Log, Dashboards) can be hidden; the open screen always stays visible.
- Each repository tab keeps its own open screen, and a new tab starts on History.
- The commit box no longer has the "Include all files" checkbox. After a push attempt, its push mode returns to normal.
- The History tag menu no longer has Force push (with lease); the sidebar and the toolbar keep it.
- The buttons above the diff moved into the "Options" submenu of the diff's ⋯ menu.
- File menus in History, Changes, Files and Compare share the same items, and "Open in editor" is named after the editor in use. The "Open in editor" button left the toolbar.
- The conflict editor opens only regular files up to 2 MB.

### Fixed

- A renamed file with a small edit now shows only the changed lines, not the whole file as new, in Changes (staged), Compare and the file history.
- The diff window now opens the whole file when "Whole file" is turned on in Settings.
- Clicking "Uncommitted changes" in History updates the file panel.
- A button clicked twice no longer runs its action twice.
- Switching files in the conflict editor keeps the choices made per hunk.
- Esc closes only the conflict editor and returns focus to the screen.
- The Conflicts screen no longer closes when a cherry-pick stops at a new conflict.
- Cherry-pick of commits with the same date applies the parent commit first.
- Symbolic links that point outside the repository, or are broken, no longer break the diff of untracked files or the details of conflicted files.
- Conflict details no longer follow a relative path out of the repository.
- Changes made in the repository right after an action in the app are no longer missed, so the screen refreshes.
- The "Open in new window" action in History shows the diff of a renamed file.
- The side-by-side diff keeps a text selection on the side where the mouse was pressed.
- Resizing panels can no longer shrink the Commit diff to just its headers.
- The "Open" button of the uncommitted row in History fits in 320 px wide windows.
- Dashboards at 320 px wide no longer scroll sideways.
- The column resize handle in History can be clicked.
- Controls reached by keyboard have accessible names and a visible focus ring.
- On Windows, a git command that finishes no longer fails with a "file is busy" error (EBUSY).

## [0.13.0] - 2026-11-11

### Changed

- The GitTools panel in VS Code opens without waiting for the workspace scan, which runs in the background.
- Only the active interface language is loaded at first, so the first load is smaller.
- Screens that are not shown at startup load on demand.
- Dashboards keep their results in memory and on disk until the history changes.
- Branches, tags, stashes and file icons do less repeated work on each redraw.
- The sidebar list draws only the rows on screen.
- The Changes screen redraws less when it opens.

### Fixed

- Diff windows show their first frame in the language saved in settings.

## [0.12.0] - 2026-11-10

### Added

- Colored diffs, with a change ruler on the scrollbar.
- Branches can be shown as a tree or as a list.
- View options in a ⋯ menu.
- Long lines wrap in the diff.
- Multi-repository detection in VS Code: each repository in the workspace opens in its own tab.
- Panels stack vertically in narrow windows.

### Changed

- A single top bar, with a close button on each panel and settings laid out in rows.

## [0.11.0] - 2026-11-06

### Added

- Copy menu on commits: full message, title, description or SHA.
- "Edit message…" on the latest commit; staged changes are left out of it.
- Context menu on files in Changes, with Blame, File history, Open in editor and Copy path.
- Blame has a context menu with "Open in history" and "Copy SHA".
- Ctrl+click on files in "Unstaged" marks them for the next commit.

### Changed

- Each screen keeps its own panel sizes, and saved layouts keep the sizes of all screens.
- "Save current layout" suggests the name of the layout in use.
- Opening Compare, Branches or blame no longer switches to History.
- Force push (with lease) left the Push menu; the push dialog still offers it.
- Each VS Code window keeps its own open projects, and a new window starts without the projects of other windows.

## [0.10.0] - 2026-10-31

### Added

- Sponsor button, linking to GitHub Sponsors.

## [0.9.0] - 2026-10-30

### Added

- Cherry-pick of files and lines from another open repository, chosen in the Cherry-pick Studio.
- Configurable date format. The History date column can show seconds in ISO format.
- Push can target several remotes.
- GitTools has its own icon on the panel tab in VS Code.

## [0.8.0] - 2026-10-29

### Added

- Several repositories open at once, each in its own tab.
- Resolve several conflicts at once.
- Terminal for git commands, integrated with the command log.
- Loading indicator, and a loading overlay on each panel.
- Copy any text from the screens.

### Changed

- Panels are organized by menu, and each screen shows only its own panels.
- Notifications are more flexible, with clearer feedback for errors and for operations that are not possible.
- The conflicts banner shows a limited list of conflicts.

### Fixed

- Cherry-pick of thousands of files no longer overflows the command line.

## [0.7.0] - 2026-10-23

### Added

- Saved layouts.
- Dashboards: a full-screen screen with metrics, charts and a git audit.
- File editor with an inline git assistant.

### Changed

- The branch filter stays fixed in the sidebar.

## [0.6.0] - 2026-10-23

### Added

- Settings for status letters (M, A, D…) and for diff content, as a snippet or the whole file.
- Checkboxes on sidebar branches: History shows only the history of the checked branches.
- "Copy message" submenu in the commit right-click menu.
- Free layout: each screen is an independent panel that can dock to any side of another.
- Tags and Stashes are independent panels, with screen shortcuts in the top bar and a Panels menu.

### Changed

- List and tree selectors show text labels, and action buttons stay fixed in the panel headers.

## [0.5.4] - 2026-10-22

### Added

- Follows the VS Code theme and fonts.
- File icons in lists.
- Changes tab with free panels, a cleaner look and a checkbox view.
- History shows uncommitted changes in a fixed row, and an uncommitted file in the side panel.

### Changed

- The reset in Settings asks for confirmation.

## [0.5.3] - 2026-10-22

### Added

- Recent repositories can be removed from the list and grouped by favorites.

## [0.5.2] - 2026-10-22

### Added

- Push with force: "force with lease" or "force", from the Push menu, the push dialog or a local branch's context menu, with confirmation.
- Commit box: amend, stage all and push can be combined; the button says what will happen.
- Creating a branch can skip the checkout.

### Changed

- Faster refresh: overlapping refreshes become one, and the log is reloaded only when HEAD, branches or tags change.

## [0.5.1] - 2026-10-22

### Fixed

- The open project is recognized when its folder is a symbolic link.

## [0.5.0] - 2026-10-21

### Added

- First release of GitTools inside VS Code.
- Cherry-pick by branch, commit, file or line.
- Conflict editor, compare, blame, file history and interactive rebase.
- Interface in six languages: Brazilian Portuguese, English, Spanish, Simplified Chinese, Hindi and Arabic.
- History in the VS Code style, with columns, tags and remotes, and a side-by-side diff that can open in a window.
- Panels that can be resized, collapsed, maximized and moved, and tabs that can be dragged between areas.
- Clone, git log, and a file list or tree view.
