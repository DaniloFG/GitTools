import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// O workflow é lido como texto (sem parser de YAML no projeto), como em tests/workflows-validacao.test.ts: o teste
// confere a ordem e a forma dos passos que o GitHub e o shell vão executar.
// No Windows o checkout pode trazer CRLF; as regexes abaixo comparam com "\n", então a leitura normaliza o fim de linha
// (a asserção continua a mesma: só o texto lido deixa de depender de como o git fez o checkout).
const ler = (caminho: string) =>
  readFileSync(fileURLToPath(new URL(`../${caminho}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const yml = ler('.github/workflows/publish-extension.yml')

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
    const arquivos = pos('changelog-gate.mjs files')
    expect(check).toBeLessThan(arquivos)
    for (const depois of ['npm run package:extension', 'vsce publish', 'ovsx publish', 'softprops/action-gh-release']) {
      expect(check, `o check deve vir antes de ${depois}`).toBeLessThan(pos(depois))
      expect(arquivos, `o gate dos textos da extensão deve vir antes de ${depois}`).toBeLessThan(pos(depois))
    }
  })

  it('o gate dos textos confere README, package.json, todos os package.nls*.json e o nome do release', () => {
    expect(yml).toMatch(
      /changelog-gate\.mjs files "\$VERSION" extension\/README\.md extension\/package\.json extension\/package\.nls\*\.json/,
    )
  })

  it('a nota neutra só vale em push na branch, por env, e o modo vai ao script sem ${{ no run', () => {
    expect(yml).toContain(
      "ALLOW_NEUTRAL: ${{ github.event_name == 'push' && github.ref_type == 'branch' && 'true' || 'false' }}",
    )
    expect(yml).toContain('if [ "$ALLOW_NEUTRAL" = "true" ]; then MODO=neutro; else MODO=estrito; fi')
    expect(yml).toMatch(/changelog-gate\.mjs notes extension\/CHANGELOG\.md "\$VERSION" "\$RUNNER_TEMP\/release-notes\.md" "\$MODO"/)
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

describe('publish-extension.yml: permissões mínimas', () => {
  it('o topo só lê; a escrita no conteúdo (anexar ao release) é só do job publish', () => {
    expect(yml).toMatch(/^permissions:\n {2}contents: read\n/m)
    expect(yml).not.toMatch(/^permissions:\n {2}contents: write/m)
    const job = yml.slice(pos('\njobs:'))
    expect(job).toMatch(/^ {4}permissions:\n {6}contents: write/m)
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
    expect(portao).toHaveLength(3)
    for (const passo of portao) expect(passo).not.toContain('secrets.')
  })
})
