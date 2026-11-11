import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchInfo } from '../../src/shared/types'
import { setLocale, t } from '../../src/shared/i18n'

// O hook só junta ações já prontas: aqui elas são simuladas e o teste olha apenas os itens que saem.
vi.mock('../../src/renderer/src/actions', () => ({ useActions: () => ({ head: 'main' }) }))
vi.mock('../../src/renderer/src/context', () => ({
  useAppActions: () => ({ run: vi.fn(), openStudio: vi.fn(), openCompare: vi.fn() })
}))
vi.mock('../../src/renderer/src/git', () => ({ git: {} }))

const { useBranchMenu } = await import('../../src/renderer/src/branchMenu')

const local = { name: 'feature/x', current: false } as BranchInfo
const remote = { name: 'origin/feature/x', remote: 'origin', current: false } as BranchInfo

const labels = (items: ReturnType<ReturnType<typeof useBranchMenu>>) => items.map((i) => (i === 'separator' ? i : i.label))

describe('useBranchMenu: Force push', () => {
  beforeEach(() => void setLocale('pt-BR'))

  const force = () => t('sidebar.menu.pushForce')
  const push = () => t('sidebar.menu.push')

  it('por padrão (barra lateral) a branch local tem o Force push', () => {
    expect(labels(useBranchMenu(() => {})(local))).toContain(force())
  })

  it('com forcePush: false (etiqueta do histórico) o Force push some e o Push comum fica', () => {
    const items = labels(useBranchMenu(() => {}, { forcePush: false })(local))
    expect(items).not.toContain(force())
    expect(items).toContain(push())
  })

  it('com forcePush: true explícito o Force push continua', () => {
    expect(labels(useBranchMenu(() => {}, { forcePush: true })(local))).toContain(force())
  })

  it('branch remota não tem Push nem Force push, com ou sem a opção', () => {
    for (const options of [undefined, { forcePush: false }]) {
      const items = labels(useBranchMenu(() => {}, options)(remote))
      expect(items).not.toContain(force())
      expect(items).not.toContain(push())
    }
  })

  it('os demais itens da branch local não mudam com a opção', () => {
    const withForce = labels(useBranchMenu(() => {})(local)).filter((l) => l !== force())
    const without = labels(useBranchMenu(() => {}, { forcePush: false })(local))
    expect(without).toEqual(withForce)
  })
})
