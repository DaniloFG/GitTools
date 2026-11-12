import { describe, expect, it } from 'vitest'
import { MAX_DECISIONS, rememberDecisions, reusePlan, shouldAutoContinue, type AutoContinueInput } from '../src/renderer/src/conflictFlow'

const base: AutoContinueInput = { enabled: true, kind: 'cherry-pick', prevConflicts: 1, conflicts: 0, busy: null }

describe('shouldAutoContinue', () => {
  it('continua quando o último arquivo da parada foi resolvido (1 → 0), em cherry-pick, revert e rebase', () => {
    for (const kind of ['cherry-pick', 'revert', 'rebase'] as const) {
      expect(shouldAutoContinue({ ...base, kind })).toBe(true)
    }
  })

  it('continua também quando vários arquivos foram resolvidos de uma vez (3 → 0)', () => {
    expect(shouldAutoContinue({ ...base, prevConflicts: 3 })).toBe(true)
  })

  it('não continua enquanto ainda sobra conflito (3 → 1)', () => {
    expect(shouldAutoContinue({ ...base, prevConflicts: 3, conflicts: 1 })).toBe(false)
  })

  it('não continua em merge nem sem operação', () => {
    expect(shouldAutoContinue({ ...base, kind: 'merge' })).toBe(false)
    expect(shouldAutoContinue({ ...base, kind: 'none' })).toBe(false)
  })

  it('não continua com a opção desligada', () => {
    expect(shouldAutoContinue({ ...base, enabled: false })).toBe(false)
  })

  it('não continua com outra operação em andamento', () => {
    expect(shouldAutoContinue({ ...base, busy: 'Resolvendo' })).toBe(false)
  })

  it('chegar numa parada que já não tem conflito (0 → 0) não continua sozinho', () => {
    expect(shouldAutoContinue({ ...base, prevConflicts: 0, conflicts: 0 })).toBe(false)
  })

  it('conflito que aparece (0 → 2) não continua', () => {
    expect(shouldAutoContinue({ ...base, prevConflicts: 0, conflicts: 2 })).toBe(false)
  })
})

describe('rememberDecisions', () => {
  it('guarda nosso e deles e devolve um mapa novo, sem alterar o recebido', () => {
    const before = new Map<string, 'ours' | 'theirs'>()
    const after = rememberDecisions(before, [
      { path: 'a.ts', side: 'ours' },
      { path: 'b.ts', side: 'theirs' }
    ])
    expect(Object.fromEntries(after)).toEqual({ 'a.ts': 'ours', 'b.ts': 'theirs' })
    expect(before.size).toBe(0)
    expect(after).not.toBe(before)
  })

  it('"resolvido" (edição manual) não é lembrado', () => {
    const after = rememberDecisions(new Map(), [
      { path: 'a.ts', side: 'resolved' },
      { path: 'b.ts', side: 'ours' }
    ])
    expect([...after.keys()]).toEqual(['b.ts'])
  })

  it('uma nova escolha para o mesmo caminho sobrescreve a anterior', () => {
    const first = rememberDecisions(new Map(), [{ path: 'a.ts', side: 'ours' }])
    const second = rememberDecisions(first, [{ path: 'a.ts', side: 'theirs' }])
    expect(second.get('a.ts')).toBe('theirs')
    expect(second.size).toBe(1)
  })

  it('guarda até o teto e descarta as mais antigas ao passar dele', () => {
    const paths = Array.from({ length: MAX_DECISIONS + 1 }, (_, i) => `f${i}.ts`)
    const atLimit = rememberDecisions(new Map(), paths.slice(0, MAX_DECISIONS).map((path) => ({ path, side: 'ours' as const })))
    expect(atLimit.size).toBe(MAX_DECISIONS)
    expect(atLimit.has('f0.ts')).toBe(true)

    const over = rememberDecisions(atLimit, [{ path: paths[MAX_DECISIONS], side: 'theirs' }])
    expect(over.size).toBe(MAX_DECISIONS)
    expect(over.has('f0.ts')).toBe(false)
    expect(over.has('f1.ts')).toBe(true)
    expect(over.get(paths[MAX_DECISIONS])).toBe('theirs')
  })

  it('um lote maior que o teto fica com os últimos', () => {
    const many = Array.from({ length: MAX_DECISIONS * 3 }, (_, i) => ({ path: `f${i}.ts`, side: 'ours' as const }))
    const after = rememberDecisions(new Map(), many)
    expect(after.size).toBe(MAX_DECISIONS)
    expect(after.has('f0.ts')).toBe(false)
    expect(after.has(`f${MAX_DECISIONS * 3 - 1}.ts`)).toBe(true)
  })

  it('repetir um caminho o torna o mais recente: ele é o último a sair', () => {
    const full = rememberDecisions(new Map(), Array.from({ length: MAX_DECISIONS }, (_, i) => ({ path: `f${i}.ts`, side: 'ours' as const })))
    const refreshed = rememberDecisions(full, [{ path: 'f0.ts', side: 'ours' }])
    const over = rememberDecisions(refreshed, [{ path: 'novo.ts', side: 'ours' }])
    expect(over.has('f0.ts')).toBe(true)
    expect(over.has('f1.ts')).toBe(false)
  })
})

describe('reusePlan', () => {
  it('sem decisões, nada a aplicar', () => {
    expect(reusePlan(['a.ts', 'b.ts'], new Map())).toEqual({ ours: [], theirs: [] })
  })

  it('sem arquivos em conflito, nada a aplicar', () => {
    expect(reusePlan([], new Map([['a.ts', 'ours' as const]]))).toEqual({ ours: [], theirs: [] })
  })

  it('separa por lado os arquivos da parada que já têm decisão', () => {
    const decisions = new Map([
      ['a.ts', 'ours' as const],
      ['b.ts', 'theirs' as const],
      ['c.ts', 'ours' as const]
    ])
    expect(reusePlan(['c.ts', 'b.ts', 'a.ts'], decisions)).toEqual({ ours: ['c.ts', 'a.ts'], theirs: ['b.ts'] })
  })

  it('ignora o caminho sem decisão e a decisão de arquivo que não está em conflito', () => {
    const decisions = new Map([
      ['a.ts', 'ours' as const],
      ['fora.ts', 'theirs' as const]
    ])
    expect(reusePlan(['a.ts', 'novo.ts'], decisions)).toEqual({ ours: ['a.ts'], theirs: [] })
  })

  it('cada caminho aparece uma vez, mesmo repetido na entrada', () => {
    expect(reusePlan(['a.ts', 'a.ts'], new Map([['a.ts', 'theirs' as const]]))).toEqual({ ours: [], theirs: ['a.ts'] })
  })
})
