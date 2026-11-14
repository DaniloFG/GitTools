import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// O workflow é lido como texto (sem parser de YAML no projeto), como em tests/workflows-validacao.test.ts: o teste
// confere a ordem e a forma dos passos que o GitHub e o shell vão executar.
const yml = readFileSync(fileURLToPath(new URL('../.github/workflows/publish-extension.yml', import.meta.url)), 'utf8')

// Posição de um trecho no arquivo; falha com nome claro se ele não existe (-1 enganaria as comparações de ordem).
const pos = (trecho: string) => {
  const i = yml.indexOf(trecho)
  expect(i, `não achei "${trecho}" no workflow`).toBeGreaterThan(-1)
  return i
}

// Cada passo começa em "      - " (seis espaços e o traço): devolve o texto de todos os passos, um por item.
// Linhas de comentário saem antes: elas podem citar `run:` ou `${{` ao explicar e não são código.
const semComentarios = yml
  .split('\n')
  .filter((linha) => !/^\s*#/.test(linha))
  .join('\n')
const passos = semComentarios.split(/\n(?= {6}- )/)

describe('publish-extension.yml: o portão do changelog fecha a publicação', () => {
  it('as notas do release saem do CHANGELOG antes do check, e o check antes de tudo que publica', () => {
    const notas = pos('changelog-gate.mjs notes')
    const check = pos('changelog-gate.mjs check')
    expect(notas).toBeLessThan(check)
    for (const depois of ['npm run package:extension', 'vsce publish', 'ovsx publish', 'softprops/action-gh-release']) {
      expect(check, `o check deve vir antes de ${depois}`).toBeLessThan(pos(depois))
    }
  })

  it('o portão roda sobre extension/CHANGELOG.md e o mesmo arquivo de notas que o release usa', () => {
    expect(yml).toMatch(
      /changelog-gate\.mjs notes extension\/CHANGELOG\.md "\$VERSION" "\$RUNNER_TEMP\/release-notes\.md"/,
    )
    expect(yml).toMatch(
      /changelog-gate\.mjs check extension\/CHANGELOG\.md "\$VERSION" "\$RUNNER_TEMP\/release-notes\.md"/,
    )
    expect(yml).toMatch(/body_path:\s*\$\{\{ runner\.temp \}\}\/release-notes\.md/)
  })

  it('o corpo do release não é gerado de PR e commit', () => {
    expect(yml).toMatch(/^\s+generate_release_notes:\s*false\s*$/m)
    expect(yml).not.toMatch(/generate_release_notes:\s*true/)
  })

  it('nenhum passo ignora falha: sem continue-on-error, a falha do portão para os passos seguintes', () => {
    expect(semComentarios).not.toContain('continue-on-error')
  })
})

describe('publish-extension.yml: entrada do evento só por env', () => {
  it('nenhum bloco run: contém ${{ (senão a entrada vira código do shell)', () => {
    const comRun = passos.filter((p) => /^ {8}run:/m.test(p) || /^ {6}- run:/m.test(p))
    expect(comRun.length).toBeGreaterThan(3)
    for (const passo of comRun) {
      // O bloco run: vai da linha "run:" até o fim do passo (a chave run é a última de cada passo deste arquivo).
      const inicio = passo.search(/run:/)
      expect(passo.slice(inicio), `run com \${{ no passo:\n${passo}`).not.toContain('${{')
    }
  })

  it('a versão digitada e o tipo da ref chegam por env e a versão é validada', () => {
    expect(yml).toMatch(/INPUT_VERSION:\s*\$\{\{ github\.event\.inputs\.version \}\}/)
    expect(yml).toMatch(/REF_TYPE:\s*\$\{\{ github\.ref_type \}\}/)
    expect(yml).toContain('/^\\d+\\.\\d+\\.\\d+$/')
  })

  it('os segredos continuam só nos passos que os usam', () => {
    for (const segredo of ['VSCE_PAT', 'OVSX_PAT']) {
      const usos = passos.filter((p) => p.includes(`secrets.${segredo}`))
      expect(usos).toHaveLength(1)
    }
    const portao = passos.filter((p) => p.includes('changelog-gate.mjs'))
    expect(portao).toHaveLength(2)
    for (const passo of portao) expect(passo).not.toContain('secrets.')
  })
})
