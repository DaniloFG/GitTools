import { describe, expect, it } from 'vitest'
import {
  arvoreDe,
  classificarErros,
  compararArvores,
  FASE_IGUAL,
  FASES,
  fasesDoPlano,
  formatarRelatorio,
  gitInesperado,
  mesmaArvore,
  montarRelatorio,
  parseArgs,
  ultimasLinhas
} from '../scripts/validacao/lib.mjs'
import { createRepo } from './helpers'

describe('mesmaArvore', () => {
  it('é verdadeira para commits diferentes com o mesmo conteúdo', async () => {
    const r = await createRepo()
    await r.commit('um', { 'a.txt': 'a\n' })
    await r.git('commit', '-q', '--allow-empty', '-m', 'vazio')
    expect((await r.git('rev-parse', 'HEAD')).trim()).not.toBe((await r.git('rev-parse', 'HEAD~1')).trim())
    expect(mesmaArvore('HEAD', 'HEAD~1', r.dir)).toBe(true)
  })

  it('é verdadeira para históricos independentes que chegam ao mesmo conteúdo', async () => {
    const r = await createRepo()
    await r.commit('base', { 'a.txt': 'a\n' })
    await r.git('switch', '-q', '-c', 'outra')
    await r.git('commit', '-q', '--allow-empty', '-m', 'reescrito')
    expect(mesmaArvore('main', 'outra', r.dir)).toBe(true)
  })

  it('é falsa quando o conteúdo difere, e devolve as duas árvores', async () => {
    const r = await createRepo()
    await r.commit('um', { 'a.txt': 'a\n' })
    await r.commit('dois', { 'a.txt': 'b\n' })
    expect(mesmaArvore('HEAD', 'HEAD~1', r.dir)).toBe(false)
    const { igual, arvoreA, arvoreB } = compararArvores('HEAD', 'HEAD~1', r.dir)
    expect(igual).toBe(false)
    expect(arvoreA).toBe((await r.git('rev-parse', 'HEAD^{tree}')).trim())
    expect(arvoreB).toBe((await r.git('rev-parse', 'HEAD~1^{tree}')).trim())
    expect(arvoreA).not.toBe(arvoreB)
  })

  it('é falsa quando só um arquivo a mais separa as árvores', async () => {
    const r = await createRepo()
    await r.commit('um', { 'a.txt': 'a\n' })
    await r.commit('dois', { 'b.txt': 'b\n' })
    expect(mesmaArvore('HEAD', 'HEAD~1', r.dir)).toBe(false)
  })

  it('recusa ref inexistente e ref que viraria opção do git', async () => {
    const r = await createRepo()
    await r.commit('um', { 'a.txt': 'a\n' })
    expect(() => arvoreDe('nao-existe', r.dir)).toThrow(/ref não encontrada/)
    expect(() => mesmaArvore('HEAD', 'origin/develop', r.dir)).toThrow(/ref não encontrada/)
    expect(() => arvoreDe('--help', r.dir)).toThrow(/ref inválida/)
    expect(() => arvoreDe('', r.dir)).toThrow(/ref inválida/)
  })
})

describe('relatório', () => {
  const base = { commit: 'c'.repeat(40), arvore: 't'.repeat(40), branch: 'develop', quando: '2026-01-02T03:04:05.000Z' }

  it('é ok quando todas as fases passam', () => {
    const rel = montarRelatorio({ ...base, fases: [{ nome: 'typecheck', ok: true, ms: 10 }, { nome: 'test', ok: true, ms: 20 }] })
    expect(rel.ok).toBe(true)
    expect(rel).toMatchObject(base)
  })

  it('não é ok se uma fase falha, mesmo com as outras verdes', () => {
    const rel = montarRelatorio({ ...base, fases: [{ nome: 'typecheck', ok: true, ms: 10 }, { nome: 'test', ok: false, ms: 20 }, { nome: 'build', ok: true, ms: 5 }] })
    expect(rel.ok).toBe(false)
  })

  it('não é ok sem nenhuma fase rodada', () => {
    expect(montarRelatorio({ ...base, fases: [] }).ok).toBe(false)
  })

  it('o texto traz commit, árvore, branch, fases com tempo e o veredito', () => {
    const rel = montarRelatorio({ ...base, fases: [{ nome: 'typecheck', ok: true, ms: 1234 }, { nome: 'e2e', ok: false, ms: 7 }] })
    const texto = formatarRelatorio(rel)
    expect(texto).toContain('Validação: FALHOU')
    expect(texto).toContain(base.commit)
    expect(texto).toContain(base.arvore)
    expect(texto).toContain('develop')
    expect(texto).toMatch(/OK\s+typecheck\s+1234 ms/)
    expect(texto).toMatch(/FALHA\s+e2e\s+7 ms/)
    expect(formatarRelatorio({ ...rel, ok: true })).toContain('Validação: OK')
  })

  it('ultimasLinhas guarda só o fim e ignora linhas vazias', () => {
    const texto = Array.from({ length: 40 }, (_, i) => `linha ${i + 1}\n\n`).join('')
    const fim = ultimasLinhas(texto, 15).split('\n')
    expect(fim).toHaveLength(15)
    expect(fim[0]).toBe('linha 26')
    expect(fim.at(-1)).toBe('linha 40')
    expect(ultimasLinhas('a\nb', 15)).toBe('a\nb')
    expect(ultimasLinhas('', 15)).toBe('')
  })
})

describe('parseArgs', () => {
  it('sem argumentos: tudo padrão', () => {
    expect(parseArgs([])).toEqual({ keepGoing: false, so: null, igualA: null, erro: null })
  })

  it('lê --keep-going, --so e --igual-a, com valor separado ou com "="', () => {
    expect(parseArgs(['--keep-going', '--so', 'typecheck'])).toMatchObject({ keepGoing: true, so: 'typecheck', erro: null })
    expect(parseArgs(['--so=build'])).toMatchObject({ so: 'build', erro: null })
    expect(parseArgs(['--igual-a', 'origin/develop'])).toMatchObject({ igualA: 'origin/develop', erro: null })
    expect(parseArgs(['--igual-a=origin/develop'])).toMatchObject({ igualA: 'origin/develop', erro: null })
  })

  it('reprova opção sem valor, argumento desconhecido e fase inexistente', () => {
    expect(parseArgs(['--so']).erro).toMatch(/pede um valor/)
    expect(parseArgs(['--igual-a', '--keep-going']).erro).toMatch(/pede um valor/)
    expect(parseArgs(['--rapido']).erro).toMatch(/desconhecido/)
    expect(parseArgs(['solto']).erro).toMatch(/desconhecido/)
    expect(parseArgs(['--so', 'nada']).erro).toMatch(/fase desconhecida/)
  })

  it('a fase de árvore só existe com --igual-a', () => {
    expect(parseArgs(['--so', FASE_IGUAL]).erro).toMatch(/--igual-a/)
    expect(parseArgs(['--so', FASE_IGUAL, '--igual-a', 'origin/develop']).erro).toBeNull()
  })
})

describe('fasesDoPlano', () => {
  it('roda as seis fases na ordem pedida', () => {
    expect(fasesDoPlano({ so: null, igualA: null }).map((f) => f.nome)).toEqual(['typecheck', 'test', 'build', 'build-extension', 'perf-bundle', 'e2e'])
    expect(FASES.find((f) => f.nome === 'e2e')?.comando).toEqual(['node', 'scripts/validacao/e2e.mjs'])
  })

  it('com --igual-a a conferência de árvore vem primeiro', () => {
    const nomes = fasesDoPlano({ so: null, igualA: 'origin/develop' }).map((f) => f.nome)
    expect(nomes[0]).toBe(FASE_IGUAL)
    expect(nomes).toHaveLength(7)
  })

  it('--so reduz a uma fase', () => {
    expect(fasesDoPlano({ so: 'build', igualA: null }).map((f) => f.nome)).toEqual(['build'])
    expect(fasesDoPlano({ so: FASE_IGUAL, igualA: 'x' }).map((f) => f.nome)).toEqual([FASE_IGUAL])
  })
})

describe('verificações do ponta a ponta', () => {
  it('aceita um único 404 (favicon) e reprova o segundo ou qualquer outro erro', () => {
    const f404 = 'Failed to load resource: the server responded with a status of 404 (Not Found)'
    expect(classificarErros([]).ok).toBe(true)
    expect(classificarErros([`console: ${f404}`]).ok).toBe(true)
    expect(classificarErros([`console: ${f404}`, `console: ${f404}`]).ok).toBe(false)
    const outro = classificarErros([`console: ${f404}`, 'pageerror: x is not defined'])
    expect(outro.ok).toBe(false)
    expect(outro.reais).toEqual(['pageerror: x is not defined'])
  })

  it('aponta git que saiu com erro ou que altera o repositório, e deixa a leitura passar', () => {
    const leitura = [
      { args: ['status', '--porcelain=v2', '-z'], exitCode: 0 },
      { args: ['stash', 'list', '--format=%gd'], exitCode: 0 },
      { args: ['branch', '--list'], exitCode: 0 },
      { args: ['log', '--topo-order'], exitCode: 0 },
      { args: ['-c', 'core.quotepath=off', 'diff', '--numstat'], exitCode: 0 },
      { args: ['show-ref', '--head'] }
    ]
    expect(gitInesperado(leitura)).toEqual([])
    const ruins = gitInesperado([{ args: ['rev-parse', '--verify', 'x'], exitCode: 128 }, { args: ['checkout', 'main'], exitCode: 0 }, { args: ['-c', 'a=b', 'commit', '-m', 'x'], exitCode: 0 }, { args: ['stash', 'push'], exitCode: 0 }])
    expect(ruins).toHaveLength(4)
    expect(ruins[0]).toContain('saiu com 128')
    expect(ruins[1]).toContain('altera o repositório')
  })
})
