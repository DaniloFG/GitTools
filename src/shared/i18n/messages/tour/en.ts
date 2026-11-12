import type { TourMessages } from './types'

export const tourEn: TourMessages = {
  step: {
    open: 'Opens a repository that is already on your computer.',
    clone: 'Copies a remote repository into a local folder.',
    branch: 'Shows the current branch, where new commits go.',
    fetch: 'Fetches what changed on the remote, without changing your files.',
    pull: 'Brings the changes from the remote and integrates them into the current branch.',
    push: 'Sends your commits to the remote.',
    new: 'Creates a branch or a tag, or stashes your changes.',
    studio: 'Opens the Studio to copy commits into the current branch.',
    conflicts: 'Shows conflicts or an operation in progress; opens the Conflicts screen.',
    settings: 'The gear button opens Settings (8 sections) and, under Appearance, the toolbar, the screens and the panels.',
    screens: 'The screen tabs: History, Changes, Files, Compare, Branches, Git Log and Dashboards.',
    history: 'The list of commits; click one of them to see its details.',
    'history-diff': 'The differences in the chosen commit, file by file.',
    'changes-commit': 'Write the message and commit what is staged.',
    'changes-diff': 'See what changed in the selected file before committing.',
    files: 'The tracked files; open one to see its history and content.',
    compare: 'Choose two references (branches, tags or commits) to compare.',
    branches: 'Branches, tags and stashes: switch branch and see what exists.',
    gitlog: 'The git commands GitTools ran, and each one can be copied.',
    dashboards: 'Charts and numbers for the repository; the tour only shows the tab, it does not open the screen.'
  },
  card: {
    previous: 'Previous',
    next: 'Next',
    exit: 'Exit',
    finish: 'Finish',
    progress: '{current} of {total}',
    skippedTitle: 'Skipped steps:',
    noRepoEnd: 'The rest of the tour shows up when you open a repository.',
    hiddenTitle: 'Hidden screens, no step:',
    title: 'Interface tour'
  }
}
