import { describe, expect, it } from 'vitest'
import { lerTextoLF } from './support/lerTexto'

// Os arquivos do veredito por commit são lidos como texto: o teste confere a forma que o GitHub e o shell vão
// interpretar. Não há parser de YAML no projeto, e não se acrescenta dependência só para isto.
// A leitura normaliza CRLF (checkout no Windows) para LF: as asserções seguem as mesmas.
const ler = lerTextoLF

// Bloco `concurrency:` de um workflow: do cabeçalho até o próximo bloco de topo (`jobs:`).
const concorrencia = (yml: string) => {
  const inicio = yml.indexOf('\nconcurrency:')
  const fim = yml.indexOf('\njobs:')
  expect(inicio).toBeGreaterThan(-1)
  expect(fim).toBeGreaterThan(inicio)
  return yml.slice(inicio, fim)
}

describe('validacao.yml: uma validação por commit de merge', () => {
  const yml = ler('.github/workflows/validacao.yml')

  it('o grupo de concorrência leva o SHA e nunca cancela a execução anterior', () => {
    const bloco = concorrencia(yml)
    expect(bloco).toMatch(/group:\s*validacao-\$\{\{ github\.ref \}\}-\$\{\{ github\.sha \}\}/)
    expect(bloco).toMatch(/cancel-in-progress:\s*false/)
  })

  it('o artefato leva o SHA, para cada commit ter o seu relatório', () => {
    expect(yml).toMatch(/^ {10}name: validacao-\$\{\{ github\.ref_name \}\}-\$\{\{ github\.sha \}\}$/m)
  })

  it('o nome do job continua Validação (<ref>)', () => {
    expect(yml).toMatch(/^ {4}name: Validação \(\$\{\{ github\.ref_name \}\}\)$/m)
  })
})

describe('qa.yml: o check QA por commit em push, por ref em PR', () => {
  const yml = ler('.github/workflows/qa.yml')

  it('o grupo usa a ref em PR e a ref com o SHA em push', () => {
    const bloco = concorrencia(yml)
    expect(bloco).toMatch(/group:\s*qa-\$\{\{ github\.workflow \}\}-/)
    expect(bloco).toContain(
      "${{ github.event_name == 'pull_request' && github.ref || format('{0}-{1}', github.ref, github.sha) }}"
    )
  })

  it('cancela a execução anterior só em pull_request', () => {
    expect(concorrencia(yml)).toMatch(/cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/)
  })

  it('o job continua se chamando QA (o check obrigatório depende do nome)', () => {
    expect(yml).toMatch(/^ {4}name: QA$/m)
  })
})

describe('apply-branch-protection.sh: branch atualizada só na main', () => {
  const sh = ler('scripts/apply-branch-protection.sh')

  it('o parâmetro strict vai para strict_required_status_checks_policy', () => {
    expect(sh).toMatch(/--argjson strict "\$strict"/)
    expect(sh).toMatch(/strict_required_status_checks_policy: \$strict,/)
  })

  it('main exige a branch atualizada; develop e homolog não', () => {
    expect(sh.match(/^aplicar "/gm)).toHaveLength(3)
    expect(sh).toMatch(/^aplicar "Fluxo: main" main '\["merge"\]' true$/m)
    expect(sh).toMatch(/^aplicar "Fluxo: homolog" homolog '\["merge"\]' false$/m)
    expect(sh).toMatch(/^aplicar "Fluxo: develop" develop '\["merge","squash"\]' false$/m)
  })
})
