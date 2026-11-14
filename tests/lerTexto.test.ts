import { describe, expect, it } from 'vitest'
import { lerTextoLF, normalizarFimDeLinha } from './support/lerTexto'

describe('lerTexto: CRLF vira LF', () => {
  it('normalizarFimDeLinha troca CRLF por LF e deixa o resto', () => {
    expect(normalizarFimDeLinha('a\r\nb\r\n')).toBe('a\nb\n')
    expect(normalizarFimDeLinha('a\nb\n')).toBe('a\nb\n')
  })

  it('o helper faz as regexes ancoradas em "\\n" valerem num checkout CRLF; sem ele elas reprovam', () => {
    const yml = 'concurrency:\n  cancel-in-progress: false\njobs:\n'
    const crlf = yml.replace(/\n/g, '\r\n')
    const regex = /cancel-in-progress:\s*false\njobs:/
    expect(regex.test(crlf)).toBe(false) // sem normalizar, o "\r" antes do fim de linha quebra o "\n" literal
    expect(regex.test(normalizarFimDeLinha(crlf))).toBe(true)
  })

  it('lerTextoLF devolve os workflows sem "\\r"', () => {
    expect(lerTextoLF('.github/workflows/validacao.yml')).not.toContain('\r')
  })
})
