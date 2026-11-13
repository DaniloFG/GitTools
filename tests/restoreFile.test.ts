import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { onGitCommand } from '../src/core/exec'
import { REPO_METHODS } from '../src/shared/api'
import { createRepo, linkOrSkip, type TestRepo } from './helpers'

// "Revert this file" / "Revert before this file": o arquivo volta, na pasta de trabalho E no stage, para a versão
// do commit (ou do pai dele). Os testes rodam num repositório git de verdade.

const read = (t: TestRepo, p: string) => readFileSync(join(t.dir, p), 'utf8')
/** Linhas do `git status --porcelain` (stage na 1ª coluna, pasta de trabalho na 2ª). */
const porcelain = async (t: TestRepo) => (await t.git('status', '--porcelain=v1')).split('\n').filter(Boolean)

/** Repositório com três commits: cria, altera, e um commit seguinte para o "HEAD" ficar à frente do commit testado. */
async function history() {
  const t = await createRepo()
  const c1 = await t.commit('cria', { 'a.txt': 'v1\n', 'outro.txt': 'x\n' })
  const c2 = await t.commit('altera', { 'a.txt': 'v2\n' })
  const c3 = await t.commit('altera de novo', { 'a.txt': 'v3\n' })
  return { t, c1, c2, c3 }
}

describe('restoreFileFromCommit', () => {
  it('"this": o arquivo fica como em <sha>, no disco e no stage', async () => {
    const { t, c2 } = await history()
    expect(await t.repo.restoreFileFromCommit(c2, 'a.txt', 'this')).toBe('restored')
    expect(read(t, 'a.txt')).toBe('v2\n')
    // M na 1ª coluna e espaço na 2ª: a diferença para o HEAD está inteira no stage, nada sobra fora dele.
    expect(await porcelain(t)).toEqual(['M  a.txt'])
  })

  it('"before": o arquivo fica como em <sha>^, no disco e no stage', async () => {
    const { t, c2 } = await history()
    expect(await t.repo.restoreFileFromCommit(c2, 'a.txt', 'before')).toBe('restored')
    expect(read(t, 'a.txt')).toBe('v1\n')
    expect(await porcelain(t)).toEqual(['M  a.txt'])
  })

  it('arquivo adicionado pelo commit: "this" restaura e "before" remove do disco e do stage', async () => {
    const t = await createRepo()
    await t.commit('base', { 'base.txt': 'b\n' })
    const add = await t.commit('adiciona', { 'novo.txt': 'novo\n' })
    await t.commit('depois', { 'novo.txt': 'mudou\n' })

    await t.repo.restoreFileFromCommit(add, 'novo.txt', 'this')
    expect(read(t, 'novo.txt')).toBe('novo\n')

    await t.git('reset', '-q', '--hard')
    await t.repo.restoreFileFromCommit(add, 'novo.txt', 'before')
    expect(existsSync(join(t.dir, 'novo.txt'))).toBe(false)
    expect(await porcelain(t)).toEqual(['D  novo.txt'])
  })

  it('arquivo removido pelo commit: "before" recria e "this" remove', async () => {
    const t = await createRepo()
    await t.commit('base', { 'sai.txt': 'conteudo\n', 'fica.txt': 'f\n' })
    await t.git('rm', '-q', 'sai.txt')
    const removed = await t.commit('remove')
    await t.commit('segue', { 'fica.txt': 'g\n' })

    await t.repo.restoreFileFromCommit(removed, 'sai.txt', 'before')
    expect(read(t, 'sai.txt')).toBe('conteudo\n')
    expect(await porcelain(t)).toEqual(['A  sai.txt'])

    // O arquivo recriado é uma alteração local: sobrescrever é pedido de propósito.
    await t.repo.restoreFileFromCommit(removed, 'sai.txt', 'this', undefined, true)
    expect(existsSync(join(t.dir, 'sai.txt'))).toBe(false)
    expect(await porcelain(t)).toEqual([])
  })

  it('renomeado: "before" usa o nome antigo; "this" usa o novo', async () => {
    const t = await createRepo()
    await t.commit('cria', { 'velho.txt': 'um\ndois\ntres\nquatro\ncinco\n' })
    await t.git('mv', 'velho.txt', 'novo.txt')
    const rename = await t.commit('renomeia')
    await t.commit('altera', { 'novo.txt': 'um\ndois\ntres\nquatro\ncinco\nseis\n' })

    await t.repo.restoreFileFromCommit(rename, 'novo.txt', 'before', 'velho.txt', true)
    expect(read(t, 'velho.txt')).toBe('um\ndois\ntres\nquatro\ncinco\n')
    expect(await porcelain(t)).toEqual(expect.arrayContaining(['A  velho.txt']))

    await t.git('reset', '-q', '--hard')
    await t.repo.restoreFileFromCommit(rename, 'novo.txt', 'this')
    expect(read(t, 'novo.txt')).toBe('um\ndois\ntres\nquatro\ncinco\n')
  })

  it('commit raiz: "before" rejeita sem alterar nada; "this" funciona', async () => {
    const t = await createRepo()
    const root = await t.commit('raiz', { 'a.txt': 'r\n' })
    await t.commit('segundo', { 'a.txt': 'r2\n' })
    await expect(t.repo.restoreFileFromCommit(root, 'a.txt', 'before')).rejects.toThrow(/pai|raiz/i)
    expect(read(t, 'a.txt')).toBe('r2\n')
    expect(await porcelain(t)).toEqual([])
    await t.repo.restoreFileFromCommit(root, 'a.txt', 'this')
    expect(read(t, 'a.txt')).toBe('r\n')
  })

  it('caminho fora do repositório é rejeitado antes de qualquer git', async () => {
    const { t, c2 } = await history()
    const started: string[][] = []
    const stop = onGitCommand((e) => e.exitCode === undefined && started.push(e.args))
    try {
      for (const bad of ['../x.txt', 'a/../../x.txt', join(t.dir, 'a.txt'), '/etc/passwd', '', '.', '\0a.txt']) {
        await expect(t.repo.restoreFileFromCommit(c2, bad, 'this'), JSON.stringify(bad)).rejects.toThrow()
      }
      // O lado "antes" também usa `oldPath`, que precisa da mesma validação.
      await expect(t.repo.restoreFileFromCommit(c2, 'a.txt', 'before', '../x.txt')).rejects.toThrow()
    } finally {
      stop()
    }
    expect(started).toEqual([])
    expect(read(t, 'a.txt')).toBe('v3\n')
  })

  it('pasta-link para fora do repositório é rejeitada', async (ctx) => {
    const { t, c2 } = await history()
    const fora = join(t.dir, '..')
    linkOrSkip(ctx, fora, join(t.dir, 'link'), 'dir')
    await expect(t.repo.restoreFileFromCommit(c2, 'link/a.txt', 'this')).rejects.toThrow()
  })

  it('sha inválido ou com "-" inicial é rejeitado, sem tratar como "arquivo inexistente"', async () => {
    const { t } = await history()
    await expect(t.repo.restoreFileFromCommit('--help', 'a.txt', 'this')).rejects.toThrow()
    await expect(t.repo.restoreFileFromCommit('-x', 'a.txt', 'before')).rejects.toThrow()
    await expect(t.repo.restoreFileFromCommit('', 'a.txt', 'this')).rejects.toThrow()
    await expect(t.repo.restoreFileFromCommit('0'.repeat(40), 'a.txt', 'this')).rejects.toThrow()
    await expect(t.repo.restoreFileFromCommit('0'.repeat(40), 'a.txt', 'before')).rejects.toThrow()
    // Nada foi removido por engano.
    expect(read(t, 'a.txt')).toBe('v3\n')
    expect(await porcelain(t)).toEqual([])
  })

  it('alteração local (não staged, staged ou não rastreado): devolve "dirty" sem tocar em nada; overwrite sobrescreve', async () => {
    const { t, c2 } = await history()
    writeFileSync(join(t.dir, 'a.txt'), 'meu trabalho\n')
    expect(await t.repo.restoreFileFromCommit(c2, 'a.txt', 'this')).toBe('dirty')
    expect(read(t, 'a.txt')).toBe('meu trabalho\n')
    expect(await porcelain(t)).toEqual([' M a.txt'])

    // Staged também conta.
    await t.git('add', 'a.txt')
    expect(await t.repo.restoreFileFromCommit(c2, 'a.txt', 'before')).toBe('dirty')
    expect(await porcelain(t)).toEqual(['M  a.txt'])

    expect(await t.repo.restoreFileFromCommit(c2, 'a.txt', 'this', undefined, true)).toBe('restored')
    expect(read(t, 'a.txt')).toBe('v2\n')
    expect(await porcelain(t)).toEqual(['M  a.txt'])

    // Arquivo não rastreado que o "before" ia sobrescrever (o commit o adicionou: aqui ele só existe fora do índice).
    const u = await createRepo()
    await u.commit('base', { 'b.txt': 'b\n' })
    const add = await u.commit('adiciona', { 'n.txt': 'n\n' })
    await u.git('rm', '-q', '--cached', 'n.txt')
    await u.git('commit', '-q', '-m', 'tira do índice')
    writeFileSync(join(u.dir, 'n.txt'), 'solto\n')
    expect(await u.repo.restoreFileFromCommit(add, 'n.txt', 'this')).toBe('dirty')
    expect(read(u, 'n.txt')).toBe('solto\n')
  })

  it('renomeado: alteração local no nome novo também conta como "dirty" no "before"', async () => {
    const t = await createRepo()
    await t.commit('cria', { 'velho.txt': 'um\ndois\ntres\nquatro\ncinco\n' })
    await t.git('mv', 'velho.txt', 'novo.txt')
    const rename = await t.commit('renomeia')
    writeFileSync(join(t.dir, 'novo.txt'), 'mexi\n')
    expect(await t.repo.restoreFileFromCommit(rename, 'novo.txt', 'before', 'velho.txt')).toBe('dirty')
    expect(existsSync(join(t.dir, 'velho.txt'))).toBe(false)
  })

  it('nome com curinga, espaço, acento e "-" inicial é um nome, não um padrão do git', async () => {
    const t = await createRepo()
    // `*` e `:` não são permitidos em nomes de arquivo no Windows.
    const names = process.platform === 'win32' ? ['com espaço ç.txt', '-traco.txt'] : ['*.txt', 'com espaço ç.txt', '-traco.txt', ':(top)x.txt']
    const c1 = await t.commit('cria', Object.fromEntries([...names.map((n) => [n, 'v1\n']), ['sobra.txt', 's\n']]))
    await t.commit('altera', Object.fromEntries([...names.map((n) => [n, 'v2\n']), ['sobra.txt', 's2\n']]))
    for (const n of names) {
      await t.repo.restoreFileFromCommit(c1, n, 'this')
      expect(read(t, n), n).toBe('v1\n')
    }
    // O curinga não pode ter alcançado `sobra.txt`.
    expect(read(t, 'sobra.txt')).toBe('s2\n')
  })

  it('abre no máximo 3 processos git (2 com overwrite)', async () => {
    const { t, c2 } = await history()
    const count = async (overwrite: boolean) => {
      const started: string[][] = []
      const stop = onGitCommand((e) => e.exitCode === undefined && started.push(e.args))
      try {
        await t.repo.restoreFileFromCommit(c2, 'a.txt', 'this', undefined, overwrite)
      } finally {
        stop()
      }
      return started.length
    }
    expect(await count(false)).toBe(3)
    expect(await count(true)).toBe(2)
  })

  it('está na lista de canais da interface', () => {
    expect(REPO_METHODS).toContain('restoreFileFromCommit')
  })
})
