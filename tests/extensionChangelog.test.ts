import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Formato Keep a Changelog. Cada `## ` abre uma seção: `## [x.y.z] - data` é uma versão e `## [Unreleased]` é o que
// ainda não saiu. Bullet é linha que começa com "- " dentro da seção; `### Added` não conta.
interface SecaoChangelog {
  titulo: string
  bullets: number
}

const VERSAO = /^\d+\.\d+\.\d+$/

export function lerSecoes(texto: string): SecaoChangelog[] {
  const secoes: SecaoChangelog[] = []
  for (const linha of texto.split(/\r?\n/)) {
    if (linha.startsWith('## ')) {
      const entre = /^## \[([^\]]+)\]/.exec(linha)
      secoes.push({ titulo: entre ? entre[1] : linha.slice(3).trim(), bullets: 0 })
    } else if (secoes.length > 0 && /^\s*- /.test(linha)) {
      secoes[secoes.length - 1].bullets++
    }
  }
  return secoes
}

// Compara x.y.z parte a parte como número: 0.10.0 é maior que 0.9.0.
function comparaVersoes(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

// Lista o que impede o CHANGELOG de conferir com a versão do pacote. Lista vazia é o estado bom.
export function problemasDoChangelog(versaoPacote: string, texto: string): string[] {
  const secoes = lerSecoes(texto)
  const problemas: string[] = []
  if (!secoes.some((s) => s.titulo === versaoPacote)) {
    problemas.push(`falta a seção ## [${versaoPacote}] (versão do package.json)`)
  }
  const naoPublicado = secoes.find((s) => s.titulo === 'Unreleased')
  if (!naoPublicado || naoPublicado.bullets === 0) {
    problemas.push('falta ## [Unreleased] com ao menos um bullet')
  }
  const versoes = secoes.filter((s) => VERSAO.test(s.titulo))
  for (let i = 1; i < versoes.length; i++) {
    if (comparaVersoes(versoes[i - 1].titulo, versoes[i].titulo) <= 0) {
      problemas.push(`## [${versoes[i].titulo}] está fora de ordem decrescente (ou repetida)`)
    }
  }
  for (const s of secoes) {
    if ((VERSAO.test(s.titulo) || s.titulo === 'Unreleased') && s.bullets === 0) {
      problemas.push(`## [${s.titulo}] não tem bullets`)
    }
  }
  return problemas
}

const EXEMPLO_OK = `# Changelog

## [Unreleased]

- Nothing yet.

## [0.10.0] - 2026-10-31

### Added

- Sponsor button.

## [0.9.0] - 2026-10-30

### Changed

- Date format.
`

describe('lerSecoes', () => {
  it('lê o título entre colchetes, com ou sem data, e conta os bullets de cada seção', () => {
    expect(lerSecoes(EXEMPLO_OK)).toEqual([
      { titulo: 'Unreleased', bullets: 1 },
      { titulo: '0.10.0', bullets: 1 },
      { titulo: '0.9.0', bullets: 1 },
    ])
  })

  it('bullet antes da primeira seção não conta, e cabeçalho ### não conta como bullet', () => {
    const texto = '- solto\n## [Unreleased]\n### Added\n- um\n'
    expect(lerSecoes(texto)).toEqual([{ titulo: 'Unreleased', bullets: 1 }])
  })
})

describe('problemasDoChangelog', () => {
  it('aceita um CHANGELOG em que a versão do pacote e o Unreleased estão completos', () => {
    expect(problemasDoChangelog('0.10.0', EXEMPLO_OK)).toEqual([])
  })

  it('(a) reprova quando falta a seção da versão do package.json', () => {
    expect(problemasDoChangelog('0.11.0', EXEMPLO_OK)).toEqual([
      'falta a seção ## [0.11.0] (versão do package.json)',
    ])
  })

  it('(a) reprova quando falta ## [Unreleased]', () => {
    const semUnreleased = EXEMPLO_OK.replace('## [Unreleased]\n\n- Nothing yet.\n\n', '')
    expect(problemasDoChangelog('0.10.0', semUnreleased)).toEqual([
      'falta ## [Unreleased] com ao menos um bullet',
    ])
  })

  it('(a) reprova quando o Unreleased existe mas não tem bullet', () => {
    const vazio = EXEMPLO_OK.replace('- Nothing yet.', '### Added')
    expect(problemasDoChangelog('0.10.0', vazio)).toEqual([
      'falta ## [Unreleased] com ao menos um bullet',
      '## [Unreleased] não tem bullets',
    ])
  })

  it('(b) reprova versão fora de ordem decrescente, comparando número por número', () => {
    const fora = EXEMPLO_OK.replace('## [0.10.0]', '## [0.9.5]').replace('## [0.9.0]', '## [0.10.0]')
    expect(problemasDoChangelog('0.9.5', fora)).toEqual([
      '## [0.10.0] está fora de ordem decrescente (ou repetida)',
    ])
  })

  it('(b) reprova versão repetida', () => {
    const repetida = EXEMPLO_OK.replace('## [0.9.0]', '## [0.10.0]')
    expect(problemasDoChangelog('0.10.0', repetida)).toEqual([
      '## [0.10.0] está fora de ordem decrescente (ou repetida)',
    ])
  })

  it('(c) reprova seção de versão que tem só o cabeçalho ### e nenhum bullet', () => {
    const semBullet = EXEMPLO_OK.replace('- Date format.', '')
    expect(problemasDoChangelog('0.10.0', semBullet)).toEqual(['## [0.9.0] não tem bullets'])
  })
})

describe('extension/CHANGELOG.md', () => {
  it('confere com a versão de extension/package.json', () => {
    const pacote = JSON.parse(
      readFileSync(fileURLToPath(new URL('../extension/package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    const texto = readFileSync(fileURLToPath(new URL('../extension/CHANGELOG.md', import.meta.url)), 'utf8')
    expect(problemasDoChangelog(pacote.version, texto)).toEqual([])
  })
})
