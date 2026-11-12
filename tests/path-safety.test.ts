import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRepository } from '../src/core/repository'
import { createRepo, lines } from './helpers'

// Auditoria (issue #91): caminho que sai do repositório por "../", por caminho absoluto ou por link de pasta/arquivo.
// Cada teste tenta o ataque. O conteúdo "SEGREDO FORA" nunca pode sair pela leitura nem ser alterado pela escrita.

const outDirs: string[] = []
afterEach(() => {
  while (outDirs.length) rmSync(outDirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** Pasta fora do repositório, com um arquivo de três linhas ("SEGREDO FORA"). */
function outside() {
  const dir = mkdtempSync(join(tmpdir(), 'gittools-out-'))
  outDirs.push(dir)
  const file = join(dir, 'fora.txt')
  writeFileSync(file, 'SEGREDO FORA\nlinha 2\nlinha 3\n')
  return { dir, file }
}

/**
 * Métodos privados que contam linhas e montam o diff de arquivo novo. São chamados pelo protótipo para testar a
 * barreira direto: a entrada real nunca traz "../" (o git só lista arquivos da pasta), então sem isto o teste não
 * chegaria ao método.
 */
const untrackedStats = Reflect.get(GitRepository.prototype, 'untrackedStats') as (this: GitRepository, path: string) => Promise<unknown>
const untrackedDiff = Reflect.get(GitRepository.prototype, 'untrackedDiff') as (this: GitRepository, path: string) => Promise<unknown>

describe('arquivos novos: contagem e diff recusam caminho fora do repositório', () => {
  it('untrackedStats não conta as linhas de arquivo fora, por "../" nem por caminho absoluto', async () => {
    const t = await createRepo()
    const o = outside()
    expect(await untrackedStats.call(t.repo, relative(t.dir, o.file))).toEqual({})
    expect(await untrackedStats.call(t.repo, o.file)).toEqual({})
  })

  it('untrackedDiff recusa "../" e caminho absoluto em vez de montar o diff com o conteúdo de fora', async () => {
    const t = await createRepo()
    const o = outside()
    await expect(untrackedDiff.call(t.repo, relative(t.dir, o.file))).rejects.toThrow()
    await expect(untrackedDiff.call(t.repo, o.file)).rejects.toThrow()
  })

  it('untrackedDiff continua montando o diff de arquivo novo dentro do repositório', async () => {
    const t = await createRepo()
    t.write('novo.txt', 'a\nb\n')
    await expect(untrackedDiff.call(t.repo, 'novo.txt')).resolves.toMatchObject({ path: 'novo.txt', changeType: 'added', additions: 2 })
  })

  // Link não rastreado não é seguido: o diff sintético é de link (120000), sem o conteúdo do alvo.
  it('untrackedDiff de link não rastreado para fora devolve o diff de link, sem o conteúdo de fora', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.file, join(t.dir, 'atalho.txt'), 'file')
    const diff = (await untrackedDiff.call(t.repo, 'atalho.txt')) as { binary: boolean; headerLines: string[] }
    expect(diff).toMatchObject({ path: 'atalho.txt', changeType: 'added', binary: true })
    expect(diff.headerLines.join('\n')).toContain('120000')
    expect(JSON.stringify(diff)).not.toContain('SEGREDO FORA')
  })

  it('untrackedDiff de link quebrado não rastreado devolve o diff de link', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(join(o.dir, 'nao-existe.txt'), join(t.dir, 'quebrado.txt'), 'file')
    const diff = (await untrackedDiff.call(t.repo, 'quebrado.txt')) as { binary: boolean; headerLines: string[] }
    expect(diff).toMatchObject({ path: 'quebrado.txt', changeType: 'added', binary: true })
    expect(diff.headerLines.join('\n')).toContain('120000')
    expect(JSON.stringify(diff)).not.toContain('SEGREDO FORA')
  })

  it('untrackedDiff recusa "pasta-link/arquivo" para fora, porque a pasta é que sai do repositório', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.dir, join(t.dir, 'pasta-link'), 'junction')
    await expect(untrackedDiff.call(t.repo, 'pasta-link/fora.txt')).rejects.toThrow()
  })
})

describe('leitura, escrita e editor de conflitos pelo link', () => {
  it('readFile não lê arquivo de fora por pasta-link e não segue arquivo-link para fora', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.dir, join(t.dir, 'pasta-link'), 'junction')
    symlinkSync(o.file, join(t.dir, 'arquivo-link.txt'), 'file')
    await expect(t.repo.readFile('pasta-link/fora.txt')).rejects.toThrow()
    await expect(t.repo.readFile('arquivo-link.txt')).rejects.toThrow()
  })

  it('readFile aceita pasta-link que aponta para dentro do repositório', async () => {
    const t = await createRepo()
    t.write('src/a.txt', 'dentro\n')
    symlinkSync(join(t.dir, 'src'), join(t.dir, 'alias'), 'junction')
    expect(await t.repo.readFile('alias/a.txt')).toMatchObject({ content: 'dentro\n', binary: false })
  })

  it('conflictDetails recusa pasta-link para fora, sem devolver o conteúdo', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.dir, join(t.dir, 'pasta-link'), 'junction')
    await expect(t.repo.conflictDetails('pasta-link/fora.txt')).rejects.toThrow()
  })

  it('conflictDetails de arquivo-link para fora (não rastreado) devolve working null, sem o conteúdo de fora', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.file, join(t.dir, 'arquivo-link.txt'), 'file')
    const d = await t.repo.conflictDetails('arquivo-link.txt')
    expect(d.working).toBeNull()
    expect(JSON.stringify(d)).not.toContain('SEGREDO FORA')
  })

  it('conflictDetails de link quebrado (não rastreado) devolve working null', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(join(o.dir, 'nao-existe.txt'), join(t.dir, 'quebrado.txt'), 'file')
    const d = await t.repo.conflictDetails('quebrado.txt')
    expect(d.working).toBeNull()
  })

  // Arquivo realmente em conflito: depois do cherry-pick, o arquivo vira link para fora (ou quebrado) no disco.
  // As três versões continuam no índice; só o arquivo de trabalho muda, e não pode trazer o conteúdo de fora.
  async function conflitoComLink(apontaPara: (o: { dir: string; file: string }) => string) {
    const t = await createRepo()
    await t.commit('init', { 'f.txt': lines('a', 'b', 'c') })
    await t.git('checkout', '-q', '-b', 'feature')
    const c = await t.commit('feature', { 'f.txt': lines('a', 'B feature', 'c') })
    await t.git('checkout', '-q', 'main')
    await t.commit('main', { 'f.txt': lines('a', 'B main', 'c') })
    await t.repo.cherryPickCommits('main', [c])
    const o = outside()
    unlinkSync(join(t.dir, 'f.txt'))
    symlinkSync(apontaPara(o), join(t.dir, 'f.txt'), 'file')
    return t
  }

  it('conflictDetails de arquivo em conflito que virou link para fora devolve working null, sem o segredo', async () => {
    const t = await conflitoComLink((o) => o.file)
    const d = await t.repo.conflictDetails('f.txt')
    expect(d.working).toBeNull()
    expect(d.ours).toContain('B main')
    expect(d.theirs).toContain('B feature')
    expect(JSON.stringify(d)).not.toContain('SEGREDO FORA')
  })

  it('conflictDetails de arquivo em conflito que virou link quebrado devolve working null', async () => {
    const t = await conflitoComLink((o) => join(o.dir, 'nao-existe.txt'))
    const d = await t.repo.conflictDetails('f.txt')
    expect(d.working).toBeNull()
    expect(d.ours).toContain('B main')
  })

  it('writeFile não grava fora do repositório por pasta-link', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.dir, join(t.dir, 'pasta-link'), 'junction')
    await expect(t.repo.writeFile('pasta-link/fora.txt', 'PWNED\n')).rejects.toThrow()
    expect(readFileSync(o.file, 'utf8')).toBe('SEGREDO FORA\nlinha 2\nlinha 3\n')
  })

  it('saveConflictResolution não grava fora do repositório por pasta-link nem por arquivo-link', async () => {
    const t = await createRepo()
    const o = outside()
    symlinkSync(o.dir, join(t.dir, 'pasta-link'), 'junction')
    symlinkSync(o.file, join(t.dir, 'arquivo-link.txt'), 'file')
    await expect(t.repo.saveConflictResolution('pasta-link/fora.txt', 'PWNED\n')).rejects.toThrow()
    await expect(t.repo.saveConflictResolution('arquivo-link.txt', 'PWNED\n')).rejects.toThrow()
    expect(readFileSync(o.file, 'utf8')).toBe('SEGREDO FORA\nlinha 2\nlinha 3\n')
  })
})
