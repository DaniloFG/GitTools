import type { BranchInfo, CommitInfo } from '../../shared/types'
import { currentBranch, useApp } from './context'
import type { DragPayload } from './dnd'
import { git } from './git'
import { plural, shortSha } from './format'

/** Ações de alto nível reutilizadas por menus, botões e arrastar-e-soltar. */
export function useActions() {
  const app = useApp()
  const { data, run, confirm, prompt, choose, openStudio } = app
  const head = currentBranch(data)

  async function stash() {
    const message = await prompt({ title: 'Guardar alterações (stash)', label: 'Descrição (opcional)', initial: 'WIP', confirmLabel: 'Guardar' })
    if (message !== null) await run('Stash', () => git.stash(message))
  }

  async function checkout(ref: string) {
    await run(`Checkout de ${ref}`, () => git.checkout(ref))
  }

  async function createBranch(startPoint?: string) {
    const name = await prompt({
      title: 'Nova branch',
      label: startPoint ? `Nome da branch (a partir de ${startPoint})` : 'Nome da branch',
      placeholder: 'feature/minha-alteracao',
      confirmLabel: 'Criar e fazer checkout'
    })
    if (name) await run(`Criando ${name}`, () => git.createBranch(name, startPoint, true))
  }

  async function deleteBranch(branch: BranchInfo) {
    const ok = await confirm({
      title: 'Excluir branch',
      message: `Excluir a branch local "${branch.name}"?\nCommits que não estiverem em outra branch ficarão inacessíveis.`,
      confirmLabel: 'Excluir',
      danger: true
    })
    if (ok) await run(`Excluindo ${branch.name}`, () => git.deleteBranch(branch.name, true))
  }

  async function renameBranch(branch: BranchInfo) {
    const name = await prompt({ title: 'Renomear branch', label: 'Novo nome', initial: branch.name, confirmLabel: 'Renomear' })
    if (name && name !== branch.name) await run('Renomeando branch', () => git.renameBranch(branch.name, name))
  }

  async function cherryPickCommits(target: string, shas: string[], label?: string) {
    const choice = await choose({
      title: `Cherry-pick em ${target}`,
      message: `${label ?? plural(shas.length, 'commit', 'commits')} será(ão) aplicado(s) em "${target}"${
        target !== head ? ' (será feito checkout dela)' : ''
      }.`,
      options: [
        { id: 'commit', label: 'Cherry-pick', description: 'Cria um commit para cada commit escolhido.' },
        { id: 'no-commit', label: 'Só aplicar as alterações', description: 'Deixa tudo no stage para você revisar e fazer um único commit.' }
      ],
      checks: [{ id: 'x', label: 'Registrar origem na mensagem (-x)', checked: true }]
    })
    if (!choice) return
    await run('Cherry-pick', () =>
      git.cherryPickCommits(target, shas, { recordOrigin: choice.checks.x, noCommit: choice.id === 'no-commit' })
    )
  }

  async function branchOntoBranch(source: string, target: string, sourceIsRemote: boolean) {
    const choice = await choose({
      title: `${source} → ${target}`,
      message: 'O que você quer fazer?',
      options: [
        { id: 'merge', label: `Merge de ${source} em ${target}`, description: 'Une o histórico das duas branches com um commit de merge (quando necessário).' },
        ...(sourceIsRemote
          ? []
          : [{ id: 'rebase', label: `Rebase de ${source} sobre ${target}`, description: `Reescreve os commits de ${source} para ficarem depois de ${target}.` }]),
        { id: 'cherry-all', label: `Cherry-pick de todos os commits de ${source} em ${target}`, description: 'Copia os commits que faltam, um a um, pulando os que já existem.' },
        { id: 'studio', label: 'Escolher commits, arquivos ou linhas…', description: 'Abre o Cherry-pick Studio para uma seleção detalhada.' }
      ],
      checks: [{ id: 'x', label: 'Cherry-pick: registrar origem na mensagem (-x)', checked: true }]
    })
    if (!choice) return
    if (choice.id === 'merge') await run(`Merge de ${source}`, () => git.merge(source, target))
    else if (choice.id === 'rebase') await run(`Rebase de ${source}`, () => git.rebase(source, target))
    else if (choice.id === 'cherry-all')
      await run(`Cherry-pick de ${source}`, () => git.cherryPickBranch(source, target, { recordOrigin: choice.checks.x }))
    else openStudio({ source, target })
  }

  async function filesOntoBranch(sha: string, paths: string[], target: string) {
    const choice = await choose({
      title: `Levar ${plural(paths.length, 'arquivo', 'arquivos')} para ${target}`,
      message: `${paths.join('\n')}\n\ndo commit ${shortSha(sha)}`,
      options: [
        { id: 'changes', label: 'Aplicar as alterações', description: 'Aplica apenas o que mudou nesse commit (como um cherry-pick só destes arquivos).' },
        { id: 'version', label: 'Copiar a versão do arquivo', description: 'Substitui o arquivo pelo conteúdo que ele tem nesse commit.' }
      ],
      checks: [{ id: 'commit', label: 'Criar commit automaticamente', checked: false }]
    })
    if (!choice) return
    const details = await git.commitDetails(sha)
    const message = choice.checks.commit
      ? `${details.subject}\n\n(arquivos ${paths.join(', ')} trazidos do commit ${sha})`
      : undefined
    await run('Aplicando arquivos', () =>
      git.cherryPickFiles(target, [sha], paths, choice.id as 'changes' | 'version', { commitMessage: message })
    )
  }

  /** Trata algo solto sobre uma branch local. */
  async function dropOnBranch(payload: DragPayload, target: string) {
    if (payload.type === 'branch') {
      if (payload.name !== target) await branchOntoBranch(payload.name, target, payload.remote)
    } else if (payload.type === 'commits') await cherryPickCommits(target, payload.shas, payload.label)
    else if (payload.type === 'commit-files') await filesOntoBranch(payload.sha, payload.paths, target)
  }

  async function revert(commit: CommitInfo) {
    const ok = await confirm({
      title: 'Reverter commit',
      message: `Criar um novo commit que desfaz "${commit.subject}" (${shortSha(commit.sha)})?`,
      confirmLabel: 'Reverter'
    })
    if (ok) await run('Revertendo', () => git.revertCommit(commit.sha))
  }

  async function reset(commit: CommitInfo) {
    const choice = await choose({
      title: `Mover ${head ?? 'HEAD'} para ${shortSha(commit.sha)}`,
      message: `"${commit.subject}"`,
      options: [
        { id: 'soft', label: 'Soft', description: 'Mantém as alterações dos commits desfeitos no stage.' },
        { id: 'mixed', label: 'Mixed', description: 'Mantém as alterações na pasta, fora do stage.' },
        { id: 'hard', label: 'Hard', description: 'Descarta tudo: commits desfeitos e alterações locais.', danger: true }
      ]
    })
    if (!choice) return
    if (choice.id === 'hard') {
      const ok = await confirm({
        title: 'Reset hard',
        message: 'Todas as alterações não commitadas serão perdidas. Continuar?',
        confirmLabel: 'Descartar e mover',
        danger: true
      })
      if (!ok) return
    }
    await run('Reset', () => git.resetTo(commit.sha, choice.id as 'soft' | 'mixed' | 'hard'))
  }

  return {
    head,
    stash,
    checkout,
    createBranch,
    deleteBranch,
    renameBranch,
    cherryPickCommits,
    branchOntoBranch,
    filesOntoBranch,
    dropOnBranch,
    revert,
    reset
  }
}
