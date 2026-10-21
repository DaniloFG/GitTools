import type { BranchInfo } from '../../shared/types'
import type { HistoryScope } from './App'
import { useActions } from './actions'
import type { MenuItem } from './components/ContextMenu'
import { useApp } from './context'
import { git } from './git'
import { t } from './i18n'

/**
 * Menu de botão direito de uma branch (barra lateral e etiquetas do histórico).
 * O checkout é sempre o primeiro item e leva para a branch clicada — nunca para um HEAD destacado.
 */
export function useBranchMenu(onScope: (scope: HistoryScope) => void) {
  const { run, openStudio, openCompare } = useApp()
  const actions = useActions()
  const head = actions.head

  return (branch: BranchInfo): MenuItem[] => {
    const isRemote = !!branch.remote
    return [
      {
        label: isRemote ? t('sidebar.menu.checkoutRemote', { branch: branch.name }) : t('sidebar.menu.checkoutBranch', { branch: branch.name }),
        onClick: () => actions.checkout(branch.name),
        disabled: branch.current
      },
      { label: t('sidebar.menu.history'), onClick: () => onScope({ kind: 'ref', ref: branch.name }) },
      'separator',
      ...(head && !branch.current
        ? [
            { label: t('actions.branchDrop.merge', { source: branch.name, target: head }), onClick: () => run(t('busy.merge', { ref: branch.name }), () => git.merge(branch.name, head)) },
            ...(isRemote ? [] : [{ label: t('actions.branchDrop.rebase', { source: head, target: branch.name }), onClick: () => run(t('busy.rebase', { ref: head }), () => git.rebase(head, branch.name)) }]),
            {
              label: t('sidebar.menu.cherryAll', { target: head }),
              onClick: () => actions.branchOntoBranch(branch.name, head, isRemote)
            }
          ]
        : []),
      ...(head && !branch.current ? [{ label: t('common.compareWith', { ref: head }), onClick: () => openCompare({ from: head, to: branch.name }) }] : []),
      { label: t('sidebar.menu.studio'), onClick: () => openStudio({ source: branch.name, target: head ?? undefined }) },
      'separator',
      { label: t('sidebar.menu.newBranch'), onClick: () => actions.createBranch(branch.name) },
      ...(isRemote
        ? []
        : [
            { label: t('sidebar.menu.rename'), onClick: () => actions.renameBranch(branch) },
            { label: t('sidebar.menu.delete'), onClick: () => actions.deleteBranch(branch), danger: true, disabled: branch.current }
          ]),
      'separator',
      { label: t('sidebar.menu.copyName'), onClick: () => navigator.clipboard.writeText(branch.name) }
    ]
  }
}
