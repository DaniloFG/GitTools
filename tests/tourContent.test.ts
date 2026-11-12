import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tourAr } from '../src/shared/i18n/messages/tour/ar'
import { tourEn } from '../src/shared/i18n/messages/tour/en'
import { tourEs } from '../src/shared/i18n/messages/tour/es'
import { tourHi } from '../src/shared/i18n/messages/tour/hi'
import { tourPtBR } from '../src/shared/i18n/messages/tour/pt-BR'
import type { TourMessages } from '../src/shared/i18n/messages/tour/types'
import { tourZhCN } from '../src/shared/i18n/messages/tour/zh-CN'
import { TOUR_STEPS } from '../src/renderer/src/tour'

/** Os seis idiomas do passeio, cada um com o seu catálogo. */
const IDIOMAS: [string, TourMessages][] = [
  ['pt-BR', tourPtBR],
  ['en', tourEn],
  ['es', tourEs],
  ['hi', tourHi],
  ['ar', tourAr],
  ['zh-CN', tourZhCN]
]

/** Teto de tamanho de um texto do passeio (caracteres): cabe no cartão sem virar parede de texto. */
const MAX_TEXTO = 200

/** Pasta dos componentes da interface, onde os alvos `data-tour` têm de estar. */
const COMPONENTES = fileURLToPath(new URL('../src/renderer/src/components', import.meta.url))

/** Código-fonte de cada componente `.tsx` da pasta (lido uma vez). */
const FONTES = readdirSync(COMPONENTES)
  .filter((arquivo) => arquivo.endsWith('.tsx'))
  .map((arquivo) => readFileSync(join(COMPONENTES, arquivo), 'utf8'))

describe('textos do passeio por idioma', () => {
  for (const [idioma, catalogo] of IDIOMAS) {
    describe(idioma, () => {
      it('todo passo tem texto não vazio e sem chave de interpolação', () => {
        for (const step of TOUR_STEPS) {
          const texto = catalogo.step[step.id]
          expect(texto.trim(), step.id).not.toBe('')
          expect(texto, step.id).not.toContain('{')
        }
      })

      it('todo campo do cartão é não vazio', () => {
        for (const [campo, texto] of Object.entries(catalogo.card)) {
          expect(texto.trim(), campo).not.toBe('')
        }
      })

      it('o progresso do cartão tem {current} e {total}', () => {
        expect(catalogo.card.progress).toContain('{current}')
        expect(catalogo.card.progress).toContain('{total}')
      })

      it(`nenhum texto passa de ${MAX_TEXTO} caracteres`, () => {
        const textos: [string, string][] = [
          ...TOUR_STEPS.map((step): [string, string] => [step.id, catalogo.step[step.id]]),
          ...Object.entries(catalogo.card)
        ]
        for (const [chave, texto] of textos) {
          expect(texto.length, chave).toBeLessThanOrEqual(MAX_TEXTO)
        }
      })

      it('nenhum texto de passo contém < nem > (texto puro)', () => {
        for (const step of TOUR_STEPS) {
          const texto = catalogo.step[step.id]
          expect(texto, step.id).not.toContain('<')
          expect(texto, step.id).not.toContain('>')
        }
      })
    })
  }
})

describe('alvos data-tour do passeio existem nos componentes', () => {
  const alvos = TOUR_STEPS.flatMap((step) => {
    const m = /^\[data-tour="([^"]+)"\]$/.exec(step.target)
    return m ? [{ id: step.id, nome: m[1] }] : []
  })

  it('há alvos data-tour para conferir', () => {
    expect(alvos.length).toBeGreaterThan(0)
  })

  for (const { id, nome } of alvos) {
    it(`o passo ${id} tem data-tour="${nome}" em algum componente`, () => {
      expect(FONTES.some((fonte) => fonte.includes(`data-tour="${nome}"`))).toBe(true)
    })
  }
})
