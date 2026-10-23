// Arranjos de painéis prontos para os prints.

/** Arranjo com a lista de arquivos estreita e um painel largo para o editor, o blame e o diff do arquivo. */
export const FILES_DOCK = {
  hidden: [],
  root: {
    kind: 'split', id: 'd1', dir: 'row', sizes: [0.17, 0.83],
    children: [
      { kind: 'split', id: 'd0', dir: 'column', sizes: [0.64, 0.36], children: [{ kind: 'group', id: 'g-branches', views: ['branches'] }, { kind: 'group', id: 'g-more', views: ['tags', 'stashes'] }] },
      {
        kind: 'split', id: 'd2', dir: 'column', sizes: [0.78, 0.22],
        children: [
          {
            kind: 'split', id: 'd3', dir: 'row', sizes: [0.3, 0.7],
            children: [
              { kind: 'group', id: 'g-main', views: ['history', 'changes.unstaged', 'changes.files', 'files.list', 'compare.setup'], active: 'files.list' },
              {
                kind: 'split', id: 'd4', dir: 'column', sizes: [0.3, 0.7],
                children: [
                  { kind: 'group', id: 'g-hist', views: ['files.history', 'commit.message', 'commit.files', 'changes.staged', 'changes.commit', 'compare.files'], active: 'files.history' },
                  { kind: 'group', id: 'g-wide', views: ['files.editor', 'files.blame', 'files.diff', 'commit.diff', 'changes.diff', 'compare.diff'], active: 'files.editor' }
                ]
              }
            ]
          },
          { kind: 'group', id: 'g-log', views: ['gitlog'] }
        ]
      }
    ]
  }
}
