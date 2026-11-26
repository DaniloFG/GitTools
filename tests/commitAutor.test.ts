import { describe, expect, it } from 'vitest'
import { createRepo, type TestRepo } from './helpers'

/** Repositório com um commit de autor e data do autor conhecidos, diferentes dos do committer (`Test`, agora). */
async function repoComAutor(): Promise<TestRepo> {
  const t = await createRepo()
  await t.commit('primeiro', { 'a.txt': 'a\n' })
  await t.git('commit', '-q', '--amend', '--no-edit', '--author=Original <original@example.com>', '--date=2020-01-02T03:04:05 +0200')
  return t
}

const autor = async (t: TestRepo) => (await t.git('log', '-1', '--format=%an <%ae>')).trim()
/** Data do autor na hora em que foi gravada (sem depender do fuso da máquina). */
const dataDoAutor = async (t: TestRepo) => (await t.git('log', '-1', '--date=format:%Y-%m-%dT%H:%M:%S', '--format=%ad')).trim()
const instanteDoAutor = async (t: TestRepo) => (await t.git('log', '-1', '--format=%at')).trim()
const head = async (t: TestRepo) => (await t.git('rev-parse', 'HEAD')).trim()
const contagem = async (t: TestRepo) => (await t.git('rev-list', '--count', 'HEAD')).trim()

describe('amend com autor e data do autor', () => {
  it('só a data: troca a data do autor e mantém o autor', async () => {
    const t = await repoComAutor()
    await t.repo.commit('primeiro', true, { date: '2026-05-01T10:30' })
    expect(await dataDoAutor(t)).toBe('2026-05-01T10:30:00')
    expect(await autor(t)).toBe('Original <original@example.com>')
    expect(await contagem(t)).toBe('1')
  })

  it('aceita a data com segundos', async () => {
    const t = await repoComAutor()
    await t.repo.commit('primeiro', true, { date: '2026-05-01T10:30:15' })
    expect(await dataDoAutor(t)).toBe('2026-05-01T10:30:15')
  })

  it('só o autor: troca o autor e mantém a data do autor original', async () => {
    const t = await repoComAutor()
    const antes = await instanteDoAutor(t)
    await t.repo.commit('primeiro', true, { author: 'Maria Souza <maria@example.com>' })
    expect(await autor(t)).toBe('Maria Souza <maria@example.com>')
    expect(await instanteDoAutor(t)).toBe(antes)
    expect(await dataDoAutor(t)).toBe('2020-01-02T03:04:05')
    expect(await contagem(t)).toBe('1')
  })

  it('autor e data juntos', async () => {
    const t = await repoComAutor()
    await t.repo.commit('primeiro', true, { author: 'Maria Souza <maria@example.com>', date: '2026-05-01T10:30' })
    expect(await autor(t)).toBe('Maria Souza <maria@example.com>')
    expect(await dataDoAutor(t)).toBe('2026-05-01T10:30:00')
  })

  it('a data do committer não é a do autor: --date mexe só na do autor', async () => {
    const t = await repoComAutor()
    await t.repo.commit('primeiro', true, { date: '2001-02-03T04:05' })
    const committer = Number((await t.git('log', '-1', '--format=%ct')).trim())
    expect(committer).toBeGreaterThan(Date.parse('2024-01-01') / 1000)
  })

  it('amend sem opções mantém autor e data do autor', async () => {
    const t = await repoComAutor()
    const antes = await instanteDoAutor(t)
    await t.repo.commit('primeiro de novo', true)
    expect(await autor(t)).toBe('Original <original@example.com>')
    expect(await instanteDoAutor(t)).toBe(antes)
    expect(await t.git('log', '-1', '--format=%s')).toBe('primeiro de novo\n')
  })

  it('opções vazias do canal da extensão (null) valem como ausentes', async () => {
    const t = await repoComAutor()
    await t.repo.commit('primeiro', true, null)
    expect(await autor(t)).toBe('Original <original@example.com>')
  })

  it('nome com acento e e-mail com +', async () => {
    const t = await repoComAutor()
    await t.repo.commit('primeiro', true, { author: 'José d\'Ávila <jose+git@exemplo.com.br>' })
    expect(await autor(t)).toBe('José d\'Ávila <jose+git@exemplo.com.br>')
  })
})

describe('entrada inválida não toca no HEAD', () => {
  const autoresInvalidos = [
    ['sem e-mail', 'sem-email'],
    ['e-mail sem arroba', 'A <b>'],
    ['vazio', ''],
    ['sem nome', '<a@b.c>'],
    ['nome em branco', '   <a@b.c>'],
    ['sem espaço antes do <', 'A<a@b.c>'],
    ['quebra de linha', 'A <a@b.c>\nB <c@d.e>'],
    ['dois colchetes', 'A <a@b.c> <d@e.f>'],
    ['espaço no e-mail', 'A <a b@c.d>']
  ]
  it.each(autoresInvalidos)('autor %s', async (_nome, valor) => {
    const t = await repoComAutor()
    const antes = await head(t)
    await expect(t.repo.commit('primeiro', true, { author: valor })).rejects.toThrow('O autor deve estar no formato')
    expect(await head(t)).toBe(antes)
  })

  const datasInvalidas = [
    ['mês e dia impossíveis', '2026-13-45T99:99'],
    ['30 de fevereiro', '2026-02-30T10:00'],
    ['vazia', ''],
    ['sem hora', '2026-05-01'],
    ['texto livre', 'ontem'],
    ['hora 24', '2026-05-01T24:00'],
    ['antes de 1970', '1960-01-01T00:00'],
    ['com fuso', '2026-05-01T10:30Z']
  ]
  it.each(datasInvalidas)('data %s', async (_nome, valor) => {
    const t = await repoComAutor()
    const antes = await head(t)
    await expect(t.repo.commit('primeiro', true, { date: valor })).rejects.toThrow('A data do autor não é válida')
    expect(await head(t)).toBe(antes)
  })

  it('autor válido com data inválida também não refaz o commit', async () => {
    const t = await repoComAutor()
    const antes = await head(t)
    await expect(t.repo.commit('primeiro', true, { author: 'A <a@b.c>', date: '2026-13-45T99:99' })).rejects.toThrow('A data do autor não é válida')
    expect(await head(t)).toBe(antes)
  })

  it('opções sem amend são recusadas e nada é commitado', async () => {
    const t = await repoComAutor()
    t.write('b.txt', 'b\n')
    await t.git('add', 'b.txt')
    const antes = await head(t)
    await expect(t.repo.commit('segundo', false, { author: 'A <a@b.c>' })).rejects.toThrow('só podem ser trocados ao corrigir')
    await expect(t.repo.commit('segundo', false, { date: '2026-05-01T10:30' })).rejects.toThrow('só podem ser trocados ao corrigir')
    expect(await head(t)).toBe(antes)
    expect(await contagem(t)).toBe('1')
  })
})

describe('commit comum continua igual', () => {
  it('sem amend nem opções cria um commit novo com a identidade configurada', async () => {
    const t = await repoComAutor()
    t.write('b.txt', 'b\n')
    await t.git('add', 'b.txt')
    await t.repo.commit('segundo')
    expect(await contagem(t)).toBe('2')
    expect(await autor(t)).toBe('Test <test@example.com>')
  })
})
