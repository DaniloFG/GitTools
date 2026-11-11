import { describe, expect, it } from 'vitest'
import { matchesSetting } from '../src/renderer/src/components/settings/settingsSearch'

const tema = { category: 'Aparência', title: 'Tema', description: 'Claro ou escuro' }

describe('pesquisa da Central de Configurações', () => {
  it('sem texto (vazio ou só espaços), toda linha aparece', () => {
    expect(matchesSetting('', tema)).toBe(true)
    expect(matchesSetting('   ', tema)).toBe(true)
  })

  it('não diferencia maiúsculas nem espaços nas pontas', () => {
    expect(matchesSetting('TEMA', tema)).toBe(true)
    expect(matchesSetting('  tema  ', tema)).toBe(true)
  })

  it('casa com a categoria, o título e a descrição', () => {
    expect(matchesSetting('aparência', tema)).toBe(true)
    expect(matchesSetting('tem', tema)).toBe(true)
    expect(matchesSetting('escuro', tema)).toBe(true)
  })

  it('sem categoria nem descrição, casa só pelo título e não quebra', () => {
    expect(matchesSetting('interface', { title: 'Zoom da interface' })).toBe(true)
    expect(matchesSetting('zoom', { title: 'Zoom' })).toBe(true)
    expect(matchesSetting('escuro', { title: 'Zoom' })).toBe(false)
  })

  it('texto que não está em nenhum dos três campos não casa', () => {
    expect(matchesSetting('atalho', tema)).toBe(false)
  })
})
