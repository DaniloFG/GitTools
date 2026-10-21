import type { BranchInfo, CommitInfo, DiffSource, LineKey } from '../../shared/types'
import { currentBranch, useApp } from './context'
import type { DragPayload } from './dnd'
import { git } from './git'
import { shortSha } from './format'
import { t } from './i18n'

/** Ações de alto nível reutilizadas por menus, botões e arrastar-e-soltar. */
export function useActions() {
  const app = useApp()
  const { data, run, confirm, prompt, choose, openStudio } = app
  const head = currentBranch(data)

  async function stash() {
    const message = await prompt({
      title: t('actions.stash.title'),
      label: t('actions.stash.label'),
      initial: 'WIP',
      confirmLabel: t('actions.stash.confirm')
    })
    if (message !== null) await run(t('busy.stash'), () => git.stash(message))
  }

  async function checkout(ref: string) {
    await run(t('busy.checkout', { ref }), () => git.checkout(ref))
  }

  async function createBranch(startPoint?: string) {
    const name = await prompt({
      title: t('actions.newBranch.title'),
      label: startPoint ? t('actions.newBranch.labelFrom', { start: startPoint }) : t('actions.newBranch.label'),
      placeholder: t('actions.newBranch.placeholder'),
      confirmLabel: t('actions.newBranch.confirm')
    })
    if (name) await run(t('busy.creatingBranch', { name }), () => git.createBranch(name, startPoint, true))
  }

  /** Cria uma tag no commit indicado (ou no HEAD); com mensagem, a tag é anotada. */
  async function createTag(ref?: string) {
    let message = ''
    const name = await prompt({
      title: t('actions.newTag.title'),
      label: ref ? t('actions.newTag.labelAt', { ref: ref.length === 40 ? shortSha(ref) : ref }) : t('actions.newTag.label'),
      placeholder: t('actions.newTag.placeholder'),
      confirmLabel: t('actions.newTag.confirm'),
      detail: { label: t('actions.newTag.message'), placeholder: t('actions.newTag.messagePlaceholder'), onDetail: (v) => (message = v) }
    })
    if (name) await run(t('busy.creatingTag', { name }), () => git.createTag(name, ref, message))
  }

  async function deleteTag(name: string) {
    const ok = await confirm({
      title: t('actions.deleteTag.title'),
      message: t('actions.deleteTag.message', { name }),
      confirmLabel: t('actions.deleteTag.confirm'),
      danger: true
    })
    if (ok) await run(t('busy.deletingTag', { name }), () => git.deleteTag(name))
  }

  async function deleteBranch(branch: BranchInfo) {
    const ok = await confirm({
      title: t('actions.deleteBranch.title'),
      message: t('actions.deleteBranch.message', { name: branch.name }),
      confirmLabel: t('actions.deleteBranch.confirm'),
      danger: true
    })
    if (ok) await run(t('busy.deletingBranch', { name: branch.name }), () => git.deleteBranch(branch.name, true))
  }

  async function renameBranch(branch: BranchInfo) {
    const name = await prompt({
      title: t('actions.renameBranch.title'),
      label: t('actions.renameBranch.label'),
      initial: branch.name,
      confirmLabel: t('actions.renameBranch.confirm')
    })
    if (name && name !== branch.name) await run(t('busy.renamingBranch'), () => git.renameBranch(branch.name, name))
  }

  /** Pergunta como aplicar commits numa branch. `subject` descreve o commit quando é só um. */
  async function cherryPickCommits(target: string, shas: string[], subject?: string) {
    const what = shas.length === 1 && subject ? t('actions.cherryPick.oneCommit', { subject }) : t('actions.cherryPick.commits', { count: shas.length })
    const choice = await choose({
      title: t('actions.cherryPick.title', { target }),
      message: `${t('actions.cherryPick.message', { what, target })}${target !== head ? ` ${t('actions.cherryPick.willCheckout')}` : ''}`,
      options: [
        { id: 'commit', label: t('actions.cherryPick.commitOption'), description: t('actions.cherryPick.commitHelp') },
        { id: 'no-commit', label: t('actions.cherryPick.noCommitOption'), description: t('actions.cherryPick.noCommitHelp') }
      ],
      checks: [{ id: 'x', label: t('actions.cherryPick.recordOrigin'), checked: true }]
    })
    if (!choice) return
    await run(t('busy.cherryPick'), () =>
      git.cherryPickCommits(target, shas, { recordOrigin: choice.checks.x, noCommit: choice.id === 'no-commit' })
    )
  }

  async function branchOntoBranch(source: string, target: string, sourceIsRemote: boolean) {
    const choice = await choose({
      title: `${source} → ${target}`,
      message: t('actions.branchDrop.question'),
      options: [
        { id: 'merge', label: t('actions.branchDrop.merge', { source, target }), description: t('actions.branchDrop.mergeHelp') },
        ...(sourceIsRemote
          ? []
          : [{ id: 'rebase', label: t('actions.branchDrop.rebase', { source, target }), description: t('actions.branchDrop.rebaseHelp', { source, target }) }]),
        { id: 'cherry-all', label: t('actions.branchDrop.cherryAll', { source, target }), description: t('actions.branchDrop.cherryAllHelp') },
        { id: 'studio', label: t('actions.branchDrop.studio'), description: t('actions.branchDrop.studioHelp') }
      ],
      checks: [{ id: 'x', label: t('actions.branchDrop.recordOrigin'), checked: true }]
    })
    if (!choice) return
    if (choice.id === 'merge') await run(t('busy.merge', { ref: source }), () => git.merge(source, target))
    else if (choice.id === 'rebase') await run(t('busy.rebase', { ref: source }), () => git.rebase(source, target))
    else if (choice.id === 'cherry-all')
      await run(t('busy.cherryPickFrom', { ref: source }), () => git.cherryPickBranch(source, target, { recordOrigin: choice.checks.x }))
    else openStudio({ source, target })
  }

  async function filesOntoBranch(sha: string, paths: string[], target: string) {
    const choice = await choose({
      title: t('actions.files.title', { count: paths.length, target }),
      message: `${paths.join('\n')}\n\n${t('actions.files.fromCommit', { sha: shortSha(sha) })}`,
      options: [
        { id: 'changes', label: t('actions.files.changes'), description: t('actions.files.changesHelp') },
        { id: 'version', label: t('actions.files.version'), description: t('actions.files.versionHelp') }
      ],
      checks: [{ id: 'commit', label: t('actions.files.autoCommit'), checked: false }]
    })
    if (!choice) return
    const details = await git.commitDetails(sha)
    const message = choice.checks.commit
      ? `${details.subject}\n\n${t('messages.filesFrom', { files: paths.join(', '), sha })}`
      : undefined
    await run(t('busy.applyingFiles'), () =>
      git.cherryPickFiles(target, [sha], paths, choice.id as 'changes' | 'version', { commitMessage: message })
    )
  }

  /**
   * Pergunta se as linhas escolhidas ficam no stage ou viram um commit, e as aplica em `target`.
   * Retorna true quando a operação foi disparada.
   */
  async function applyLines(target: string, source: DiffSource, path: string, lines: LineKey[], context: string, commitMessage: string) {
    const choice = await choose({
      title: t('actions.applyLines.title', { count: lines.length, target }),
      message: context,
      options: [
        { id: 'stage', label: t('actions.applyLines.stage'), description: t('actions.applyLines.stageHelp') },
        { id: 'commit', label: t('actions.applyLines.commit'), description: t('actions.applyLines.commitHelp') }
      ]
    })
    if (!choice) return false
    await run(t('busy.applyingLines'), () =>
      git.cherryPickLines(target, source, path, lines, { commitMessage: choice.id === 'commit' ? commitMessage : undefined })
    )
    return true
  }

  /** Trata algo solto sobre uma branch local. */
  async function dropOnBranch(payload: DragPayload, target: string) {
    if (payload.type === 'branch') {
      if (payload.name !== target) await branchOntoBranch(payload.name, target, payload.remote)
    } else if (payload.type === 'commits') await cherryPickCommits(target, payload.shas, payload.subject)
    else if (payload.type === 'commit-files') await filesOntoBranch(payload.sha, payload.paths, target)
  }

  async function revert(commit: CommitInfo) {
    const ok = await confirm({
      title: t('actions.revert.title'),
      message: t('actions.revert.message', { subject: commit.subject, sha: shortSha(commit.sha) }),
      confirmLabel: t('actions.revert.confirm')
    })
    if (ok) await run(t('busy.reverting'), () => git.revertCommit(commit.sha))
  }

  async function reset(commit: CommitInfo) {
    const choice = await choose({
      title: t('actions.reset.title', { branch: head ?? 'HEAD', sha: shortSha(commit.sha) }),
      message: `"${commit.subject}"`,
      options: [
        { id: 'soft', label: 'Soft', description: t('actions.reset.softHelp') },
        { id: 'mixed', label: 'Mixed', description: t('actions.reset.mixedHelp') },
        { id: 'hard', label: 'Hard', description: t('actions.reset.hardHelp'), danger: true }
      ]
    })
    if (!choice) return
    if (choice.id === 'hard') {
      const ok = await confirm({
        title: t('actions.reset.hardTitle'),
        message: t('actions.reset.hardMessage'),
        confirmLabel: t('actions.reset.hardConfirm'),
        danger: true
      })
      if (!ok) return
    }
    await run(t('busy.reset'), () => git.resetTo(commit.sha, choice.id as 'soft' | 'mixed' | 'hard'))
  }

  return {
    head,
    stash,
    checkout,
    createBranch,
    createTag,
    deleteTag,
    deleteBranch,
    renameBranch,
    cherryPickCommits,
    branchOntoBranch,
    filesOntoBranch,
    applyLines,
    dropOnBranch,
    revert,
    reset
  }
}
