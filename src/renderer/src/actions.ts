import type { BranchInfo, CommitInfo, DiffSource, LineKey, PushForce } from '../../shared/types'
import type { MenuItem } from './components/ContextMenu'
import { currentBranch, useApp } from './context'
import type { DragPayload } from './dnd'
import { git } from './git'
import { shortSha } from './format'
import { t } from './i18n'
import { useLayout } from './layout'

/** Ações de alto nível reutilizadas por menus, botões e arrastar-e-soltar. */
export function useActions() {
  const app = useApp()
  const { data, run, confirm, prompt, choose, openStudio, askPush, toast } = app
  const head = currentBranch(data)
  /** Última escolha de "fazer checkout da nova branch" (começa ligada, como era antes). */
  const [checkoutNew, setCheckoutNew] = useLayout<boolean>('pref.checkoutNewBranch', (v) => v !== false)

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
    let checkout = checkoutNew
    const name = await prompt({
      title: t('actions.newBranch.title'),
      label: startPoint ? t('actions.newBranch.labelFrom', { start: startPoint }) : t('actions.newBranch.label'),
      placeholder: t('actions.newBranch.placeholder'),
      confirmLabel: t('actions.newBranch.confirm'),
      check: {
        label: t('actions.newBranch.checkout'),
        checked: checkoutNew,
        onCheck: (value) => {
          checkout = value
          setCheckoutNew(value)
        }
      }
    })
    if (!name) return
    await run(t('busy.creatingBranch', { name }), async () => {
      await git.createBranch(name, startPoint, checkout)
      return t(checkout ? 'actions.newBranch.createdCheckout' : 'actions.newBranch.created', { name })
    })
  }

  /** Confirma um push com force (o `lease` é o mais seguro; o `force` sobrescreve sem verificar). */
  function confirmForce(force: PushForce, branch: string | null = head) {
    return confirm({
      title: t('push.forceTitle'),
      message: t(force === 'lease' ? 'push.forceMessageLease' : 'push.forceMessageForce', { branch: branch ?? 'HEAD' }),
      confirmLabel: t('push.forceConfirm'),
      danger: true
    })
  }

  /**
   * Envia a branch atual (ou `branch`, sem checkout). `remote` vazio usa o upstream. Com `force`, pede
   * confirmação — a menos que `confirmed` diga que o usuário já escolheu isso de forma explícita.
   */
  async function push(options: { remote?: string; branch?: string; force?: PushForce; confirmed?: boolean } = {}) {
    const { remote, branch, force, confirmed } = options
    if (force && !confirmed && !(await confirmForce(force, branch ?? head))) return
    return run(t('busy.push'), () => git.push(remote, { force, branch: branch === head ? undefined : branch }))
  }

  /** Diálogo de push: escolher o remote e o modo (normal, force com lease ou force). */
  async function pushDialog(branch?: string) {
    const name = branch ?? head
    if (!name) {
      toast('warning', t('core.pushNeedsBranch'))
      return
    }
    const remotes = (await git.remotes().catch(() => [])).map((r) => r.name)
    if (!remotes.length) {
      toast('warning', t('core.noRemotes'))
      return
    }
    const upstream = data.branches.find((b) => !b.remote && b.name === name)?.upstream
    const upstreamRemote = upstream ? remotes.find((r) => upstream.startsWith(`${r}/`)) : undefined
    const choice = await askPush({ branch: name, remotes, remote: upstreamRemote ?? (remotes.includes('origin') ? 'origin' : remotes[0]) })
    if (!choice) return
    // Para o remote do upstream, não informar o remote: o git envia para a branch que ela acompanha.
    await push({ remote: choice.remote === upstreamRemote ? undefined : choice.remote, branch: name, force: choice.force, confirmed: true })
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

  /** Copia a mensagem dos commits (completa, só o título ou só a descrição) para a área de transferência. */
  async function copyMessage(shas: string[], part: 'full' | 'subject' | 'body') {
    try {
      const all = await Promise.all(shas.map((sha) => git.commitDetails(sha)))
      const texts = all.map((c) => (part === 'subject' ? c.subject : part === 'body' ? c.body.trim() : c.body.trim() ? `${c.subject}\n\n${c.body.trim()}` : c.subject))
      const kept = texts.filter(Boolean)
      if (kept.length === 0) return toast('warning', t('history.menu.noBody'))
      await navigator.clipboard.writeText(kept.join(part === 'subject' ? '\n' : '\n\n'))
      toast('info', t('history.menu.messageCopied', { count: kept.length }))
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error))
    }
  }

  /** Item "Copiar mensagem" dos menus de commit, com o submenu das três formas de copiar. */
  function copyMessageMenu(shas: string[]): MenuItem {
    return {
      label: t('history.menu.copyMessage'),
      submenu: [
        { label: t('history.menu.copyMessageFull'), onClick: () => void copyMessage(shas, 'full') },
        { label: t('history.menu.copyMessageSubject'), onClick: () => void copyMessage(shas, 'subject') },
        { label: t('history.menu.copyMessageBody'), onClick: () => void copyMessage(shas, 'body') }
      ]
    }
  }

  return {
    head,
    copyMessage,
    copyMessageMenu,
    stash,
    checkout,
    createBranch,
    confirmForce,
    push,
    pushDialog,
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
