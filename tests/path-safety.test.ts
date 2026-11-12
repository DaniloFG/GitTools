import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest'
import { readRegularFile } from '../src/core/paths'
import { GitRepository } from '../src/core/repository'
import { createRepo, lines, linkOrSkip } from './helpers'

// Auditoria (issue #91): caminho que sai do repositório por "../", por caminho absoluto ou por link de pasta/arquivo.
// Cada teste tenta o ataque. O conteúdo "SEGREDO FORA" nunca pode sair pela leitura nem ser alterado pela escrita.

// Janela entre a checagem (`lstat`) e a abertura: o espião de `open` roda `swapBeforeOpen` logo antes da abertura real
// do caminho combinado, para trocar o arquivo por link nesse instante. Só `readRegularFile` abre o arquivo de trabalho
// assim; sem `O_NOFOLLOW` na abertura, o segredo de fora sairia. Repassa tudo ao módulo real.
const swap = vi.hoisted(() => ({ path: null as string | null, run: null as (() => void) | null }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const open = (...args: Parameters<typeof actual.open>) => {
    if (swap.run && String(args[0]) === swap.path) {
      const run = swap.run
      swap.run = null
      run()
    }
    return actual.open(...args)
  }
  return { ...actual, open }
})

const outDirs: string[] = []
afterEach(() => {
  swap.path = null
  swap.run = null
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
  it('untrackedDiff de link não rastreado para fora devolve o diff de link, sem o conteúdo de fora', async (ctx) => {
    const t = await createRepo()
    const o = outside()
    linkOrSkip(ctx, o.file, join(t.dir, 'atalho.txt'), 'file')
    const diff = (await untrackedDiff.call(t.repo, 'atalho.txt')) as { binary: boolean; headerLines: string[] }
    expect(diff).toMatchObject({ path: 'atalho.txt', changeType: 'added', binary: true })
    expect(diff.headerLines.join('\n')).toContain('120000')
    expect(JSON.stringify(diff)).not.toContain('SEGREDO FORA')
  })

  it('untrackedDiff de link quebrado não rastreado devolve o diff de link', async (ctx) => {
    const t = await createRepo()
    const o = outside()
    linkOrSkip(ctx, join(o.dir, 'nao-existe.txt'), join(t.dir, 'quebrado.txt'), 'file')
    const diff = (await untrackedDiff.call(t.repo, 'quebrado.txt')) as { binary: boolean; headerLines: string[] }
    expect(diff).toMatchObject({ path: 'quebrado.txt', changeType: 'added', binary: true })
    expect(diff.headerLines.join('\n')).toContain('120000')
    expect(JSON.stringify(diff)).not.toContain('SEGREDO FORA')
  })

  it('untrackedDiff recusa "pasta-link/arquivo" para fora, porque a pasta é que sai do repositório', async (ctx) => {
    const t = await createRepo()
    const o = outside()
    linkOrSkip(ctx, o.dir, join(t.dir, 'pasta-link'), 'junction')
    await expect(untrackedDiff.call(t.repo, 'pasta-link/fora.txt')).rejects.toThrow()
  })

  // Link em loop (a -> b -> a) e link para si mesmo: o lstat não segue o link do próprio arquivo, então o diff
  // sai como link (120000) sem travar nem ler nada de fora.
  it('untrackedDiff de links em loop e de link para si mesmo devolve o diff de link, sem travar', async (ctx) => {
    const t = await createRepo()
    linkOrSkip(ctx, join(t.dir, 'b.txt'), join(t.dir, 'a.txt'), 'file')
    linkOrSkip(ctx, join(t.dir, 'a.txt'), join(t.dir, 'b.txt'), 'file')
    linkOrSkip(ctx, join(t.dir, 'self.txt'), join(t.dir, 'self.txt'), 'file')
    for (const path of ['a.txt', 'b.txt', 'self.txt']) {
      const diff = (await untrackedDiff.call(t.repo, path)) as { binary: boolean; headerLines: string[] }
      expect(diff).toMatchObject({ path, changeType: 'added', binary: true })
      expect(diff.headerLines.join('\n')).toContain('120000')
    }
  })
})

describe('leitura, escrita e editor de conflitos pelo link', () => {
  it('readFile não lê arquivo de fora por pasta-link e não segue arquivo-link para fora', async (ctx) => {
    const t = await createRepo()
    const o = outside()
    linkOrSkip(ctx, o.dir, join(t.dir, 'pasta-link'), 'junction')
    linkOrSkip(ctx, o.file, join(t.dir, 'arquivo-link.txt'), 'file')
    await expect(t.repo.readFile('pasta-link/fora.txt')).rejects.toThrow()
    await expect(t.repo.readFile('arquivo-link.txt')).rejects.toThrow()
  })

  it('readFile aceita pasta-link que aponta para dentro do repositório', async (ctx) => {
    const t = await createRepo()
    t.write('src/a.txt', 'dentro\n')
    linkOrSkip(ctx, join(t.dir, 'src'), join(t.dir, 'alias'), 'junction')
    expect(await t.repo.readFile('alias/a.txt')).toMatchObject({ content: 'dentro\n', binary: false })
  })

  it('conflictDetails recusa pasta-link para fora, sem devolver o conteúdo', async (ctx) => {
    const t = await createRepo()
    const o = outside()
    linkOrSkip(ctx, o.dir, join(t.dir, 'pasta-link'), 'junction')
    await expect(t.repo.conflictDetails('pasta-link/fora.txt')).rejects.toThrow()
  })

  it('conflictDetails de arquivo-link para fora (não rastreado) devolve working null, sem o conteúdo de fora', async (ctx) => {
    const t = await createRepo()
    const o = outside()
    linkOrSkip(ctx, o.file, join(t.dir, 'arquivo-link.txt'), 'file')
    const d = await t.repo.conflictDetails('arquivo-link.txt')
    expect(d.working).toBeNull()
    expect(JSON.stringify(d)).not.toContain('SEGREDO FORA')
  })

  it('conflictDetails de link quebrado (não rastreado) devolve working null', async (ctx) => {
    const t = await createRepo()
    const o = outside()
    linkOrSkip(ctx, join(o.dir, 'nao-existe.txt'), join(t.dir, 'quebrado.txt'), 'file')
    const d = await t.repo.conflictDetails('quebrado.txt')
    expect(d.working).toBeNull()
  })

  // Links em loop e link para si mesmo não rastreados: o conflictDetails não segue o link do arquivo, então
  // `working` fica null e a chamada termina.
  it('conflictDetails de links em loop e de link para si mesmo devolve working null, sem travar', async (ctx) => {
    const t = await createRepo()
    linkOrSkip(ctx, join(t.dir, 'b.txt'), join(t.dir, 'a.txt'), 'file')
    linkOrSkip(ctx, join(t.dir, 'a.txt'), join(t.dir, 'b.txt'), 'file')
    linkOrSkip(ctx, join(t.dir, 'self.txt'), join(t.dir, 'self.txt'), 'file')
    for (const path of ['a.txt', 'b.txt', 'self.txt']) {
      const d = await t.repo.conflictDetails(path)
      expect(d.working).toBeNull()
    }
  })

  // Arquivo realmente em conflito: depois do cherry-pick, o arquivo vira link para fora (ou quebrado) no disco.
  // As três versões continuam no índice; só o arquivo de trabalho muda, e não pode trazer o conteúdo de fora.
  async function conflitoComLink(ctx: TestContext, apontaPara: (o: { dir: string; file: string }) => string) {
    const t = await createRepo()
    await t.commit('init', { 'f.txt': lines('a', 'b', 'c') })
    await t.git('checkout', '-q', '-b', 'feature')
    const c = await t.commit('feature', { 'f.txt': lines('a', 'B feature', 'c') })
    await t.git('checkout', '-q', 'main')
    await t.commit('main', { 'f.txt': lines('a', 'B main', 'c') })
    await t.repo.cherryPickCommits('main', [c])
    const o = outside()
    unlinkSync(join(t.dir, 'f.txt'))
    linkOrSkip(ctx, apontaPara(o), join(t.dir, 'f.txt'), 'file')
    return t
  }

  it('conflictDetails de arquivo em conflito que virou link para fora devolve working null, sem o segredo', async (ctx) => {
    const t = await conflitoComLink(ctx, (o) => o.file)
    const d = await t.repo.conflictDetails('f.txt')
    expect(d.working).toBeNull()
    expect(d.ours).toContain('B main')
    expect(d.theirs).toContain('B feature')
    expect(JSON.stringify(d)).not.toContain('SEGREDO FORA')
  })

  it('conflictDetails de arquivo em conflito que virou link quebrado devolve working null', async (ctx) => {
    const t = await conflitoComLink(ctx, (o) => join(o.dir, 'nao-existe.txt'))
    const d = await t.repo.conflictDetails('f.txt')
    expect(d.working).toBeNull()
    expect(d.ours).toContain('B main')
  })

  it('writeFile não grava fora do repositório por pasta-link', async (ctx) => {
    const t = await createRepo()
    const o = outside()
    linkOrSkip(ctx, o.dir, join(t.dir, 'pasta-link'), 'junction')
    await expect(t.repo.writeFile('pasta-link/fora.txt', 'PWNED\n')).rejects.toThrow()
    expect(readFileSync(o.file, 'utf8')).toBe('SEGREDO FORA\nlinha 2\nlinha 3\n')
  })

  it('saveConflictResolution não grava fora do repositório por pasta-link nem por arquivo-link', async (ctx) => {
    const t = await createRepo()
    const o = outside()
    linkOrSkip(ctx, o.dir, join(t.dir, 'pasta-link'), 'junction')
    linkOrSkip(ctx, o.file, join(t.dir, 'arquivo-link.txt'), 'file')
    await expect(t.repo.saveConflictResolution('pasta-link/fora.txt', 'PWNED\n')).rejects.toThrow()
    await expect(t.repo.saveConflictResolution('arquivo-link.txt', 'PWNED\n')).rejects.toThrow()
    expect(readFileSync(o.file, 'utf8')).toBe('SEGREDO FORA\nlinha 2\nlinha 3\n')
  })
})

// Issue #125: o `lstat` e a leitura são duas chamadas. Se o arquivo virar link entre elas, a abertura é que precisa
// barrar. A troca não se provoca de forma determinística; o teste põe o disco no estado em que ela termina (o caminho
// já é um link) e chama a leitura que vem depois do `lstat`.
describe('leitura do arquivo de trabalho não segue link na abertura (TOCTOU)', () => {
  it('readRegularFile lê arquivo comum', async () => {
    const t = await createRepo()
    writeFileSync(join(t.dir, 'ok.txt'), 'dentro\n')
    expect((await readRegularFile(join(t.dir, 'ok.txt'))).toString()).toBe('dentro\n')
  })

  it('readRegularFile recusa arquivo trocado por link para fora, sem devolver o segredo', async (ctx) => {
    if (process.platform === 'win32') ctx.skip('sem O_NOFOLLOW no Windows')
    const t = await createRepo()
    const o = outside()
    writeFileSync(join(t.dir, 'troca.txt'), 'antes\n')
    unlinkSync(join(t.dir, 'troca.txt'))
    linkOrSkip(ctx, o.file, join(t.dir, 'troca.txt'), 'file')
    await expect(readRegularFile(join(t.dir, 'troca.txt'))).rejects.toThrow()
  })

  it('readRegularFile recusa diretório', async () => {
    const t = await createRepo()
    await expect(readRegularFile(t.dir)).rejects.toThrow()
  })
})

describe('cada chamador de readRegularFile recusa o arquivo trocado por link entre a checagem e a abertura', () => {
  /** Arquivo comum no repositório que vira link para o segredo de fora justo antes da abertura. */
  async function armar(ctx: TestContext, nome: string) {
    if (process.platform === 'win32') ctx.skip('sem O_NOFOLLOW no Windows')
    const t = await createRepo()
    const o = outside()
    const full = join(t.dir, nome)
    writeFileSync(full, 'antes\n')
    swap.path = full
    swap.run = () => {
      unlinkSync(full)
      linkOrSkip(ctx, o.file, full, 'file')
    }
    return t
  }

  it('readFile não devolve o segredo de fora', async (ctx) => {
    const t = await armar(ctx, 'troca.txt')
    await expect(t.repo.readFile('troca.txt')).rejects.toThrow()
    expect(swap.run).toBeNull() // a troca aconteceu: o teste passou pela janela
  })

  it('conflictDetails devolve working null, sem o segredo', async (ctx) => {
    const t = await armar(ctx, 'troca.txt')
    const d = await t.repo.conflictDetails('troca.txt')
    expect(swap.run).toBeNull()
    expect(d.working).toBeNull()
    expect(JSON.stringify(d)).not.toContain('SEGREDO FORA')
  })

  it('untrackedDiff não monta o diff com o segredo', async (ctx) => {
    const t = await armar(ctx, 'troca.txt')
    await expect(untrackedDiff.call(t.repo, 'troca.txt')).rejects.toThrow()
    expect(swap.run).toBeNull()
  })

  it('untrackedStats não conta as linhas do segredo', async (ctx) => {
    const t = await armar(ctx, 'troca.txt')
    expect(await untrackedStats.call(t.repo, 'troca.txt')).toEqual({})
    expect(swap.run).toBeNull()
  })
})
