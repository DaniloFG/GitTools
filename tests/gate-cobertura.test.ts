import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { avaliarPR, lerIdsDeTelas, lerTelasDosCenarios, TELA_POR_ID, telasSemCenario } from '../scripts/validacao/cobertura.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const SCREEN_VISIBILITY = join(RAIZ, 'src', 'renderer', 'src', 'screenVisibility.ts')
const GATE = join(RAIZ, 'scripts', 'validacao', 'gate-cobertura.mjs')
const TODAS_AS_TELAS = ['history', 'changes', 'files', 'compare', 'branches', 'gitlog', 'dashboards']

describe('lerIdsDeTelas', () => {
  it('lê os ids de TOP_SCREEN_IDS do screenVisibility.ts real, na ordem da barra', () => {
    expect(lerIdsDeTelas(readFileSync(SCREEN_VISIBILITY, 'utf8'))).toEqual(TODAS_AS_TELAS)
  })

  it('ignora menção ao nome no comentário antes da declaração', () => {
    const texto = "// TOP_SCREEN_IDS guarda as telas\nexport const TOP_SCREEN_IDS: readonly TopScreenId[] = ['a', \"b\"]\n"
    expect(lerIdsDeTelas(texto)).toEqual(['a', 'b'])
  })

  it('lança quando o array não existe ou está vazio (gate que lê lista vazia passaria em silêncio)', () => {
    expect(() => lerIdsDeTelas('export const OUTRA = []')).toThrow(/TOP_SCREEN_IDS não encontrado/)
    expect(() => lerIdsDeTelas('export const TOP_SCREEN_IDS: readonly TopScreenId[] = []')).toThrow(/sem nenhum id/)
  })
})

describe('telasSemCenario', () => {
  it('todas as telas reais do repositório têm cenário', async () => {
    const telas = await lerTelasDosCenarios()
    expect(telasSemCenario(lerIdsDeTelas(readFileSync(SCREEN_VISIBILITY, 'utf8')), telas)).toEqual([])
  })

  it('tela sem cenário reprova, e a tela com cenário passa', () => {
    expect(telasSemCenario(['history', 'changes'], ['History'])).toEqual(['changes'])
    expect(telasSemCenario(['history'], new Set(['History']))).toEqual([])
  })

  it('tela inventada, fora de TELA_POR_ID, conta como sem cenário mesmo que um cenário tenha o nome', () => {
    expect(telasSemCenario(['history', 'relatorios'], ['History', 'relatorios'])).toEqual(['relatorios'])
    expect(telasSemCenario(['nova'], ['nova'])).toEqual(['nova'])
  })

  it('id herdado de Object.prototype não passa por mapeado', () => {
    expect(telasSemCenario(['constructor'], ['constructor'])).toEqual(['constructor'])
  })

  it('o mapa cobre cada id de TOP_SCREEN_IDS com o valor de tela dos cenários', () => {
    expect(Object.keys(TELA_POR_ID).sort()).toEqual([...TODAS_AS_TELAS].sort())
    expect(TELA_POR_ID.gitlog).toBe('Git log')
    expect(TELA_POR_ID.dashboards).toBe('Dashboard')
  })
})

describe('avaliarPR', () => {
  const CENARIO = 'scripts/validacao/e2e/cenarios/history.mjs'
  const COMPONENTE = 'src/renderer/src/components/Screens.tsx'
  const JUSTIFICADO = 'sem-e2e: a mudança só troca o texto de um rótulo'

  it('mudança fora de components passa sem cenário, com ou sem rótulo', () => {
    expect(avaliarPR({ arquivos: ['src/core/exec.ts', 'scripts/x.mjs'], rotulos: [], corpo: null }).ok).toBe(true)
    expect(avaliarPR({ arquivos: [], rotulos: ['sem-e2e'], corpo: null }).ok).toBe(true)
  })

  it('mudança em components sem cenário reprova', () => {
    const r = avaliarPR({ arquivos: [COMPONENTE], rotulos: [], corpo: null })
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/sem cenário de ponta a ponta/)
  })

  it('mudança em components com cenário no mesmo PR aprova', () => {
    expect(avaliarPR({ arquivos: [COMPONENTE, CENARIO], rotulos: [], corpo: null }).ok).toBe(true)
  })

  it('sem-e2e com justificativa de uma linha aprova', () => {
    expect(avaliarPR({ arquivos: [COMPONENTE], rotulos: ['sem-e2e'], corpo: `Descrição\n${JUSTIFICADO}\n` }).ok).toBe(true)
  })

  it('sem-e2e sem justificativa reprova com motivo próprio', () => {
    const r = avaliarPR({ arquivos: [COMPONENTE], rotulos: ['sem-e2e'], corpo: 'Só a descrição, sem a linha.' })
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/rótulo sem-e2e sem justificativa/)
    expect(avaliarPR({ arquivos: [COMPONENTE], rotulos: ['sem-e2e'], corpo: null }).ok).toBe(false)
  })

  it('justificativa precisa de pelo menos 10 caracteres úteis', () => {
    expect(avaliarPR({ arquivos: [COMPONENTE], rotulos: ['sem-e2e'], corpo: 'sem-e2e: 123456789' }).ok).toBe(false)
    expect(avaliarPR({ arquivos: [COMPONENTE], rotulos: ['sem-e2e'], corpo: 'sem-e2e: 1234567890' }).ok).toBe(true)
  })

  it('justificativa sem o rótulo não basta', () => {
    const r = avaliarPR({ arquivos: [COMPONENTE], rotulos: [], corpo: JUSTIFICADO })
    expect(r.ok).toBe(false)
  })

  it('justificativa tem de ser uma linha que começa com sem-e2e: (não quebra a linha depois dos dois pontos)', () => {
    expect(avaliarPR({ arquivos: [COMPONENTE], rotulos: ['sem-e2e'], corpo: `obs ${JUSTIFICADO}` }).ok).toBe(false)
    expect(avaliarPR({ arquivos: [COMPONENTE], rotulos: ['sem-e2e'], corpo: 'sem-e2e:\na mudança só troca o texto' }).ok).toBe(false)
  })

  it('com cenário presente, o rótulo sem-e2e não é preciso', () => {
    expect(avaliarPR({ arquivos: [COMPONENTE, CENARIO], rotulos: ['sem-e2e'], corpo: null }).ok).toBe(true)
  })

  it('caminho com barra invertida (Windows) conta como components', () => {
    expect(avaliarPR({ arquivos: ['src\\renderer\\src\\components\\Screens.tsx'], rotulos: [], corpo: null }).ok).toBe(false)
    expect(avaliarPR({ arquivos: ['scripts\\validacao\\e2e\\cenarios\\history.mjs', 'src\\renderer\\src\\components\\Screens.tsx'], rotulos: [], corpo: null }).ok).toBe(true)
  })
})

describe('lerTelasDosCenarios', () => {
  it('lê o campo tela dos cenários reais', async () => {
    const telas = await lerTelasDosCenarios()
    for (const tela of ['History', 'Changes', 'Files', 'Compare', 'Branches', 'Git log', 'Dashboard']) {
      expect(telas.has(tela)).toBe(true)
    }
  })

  it('ignora arquivo sem default com tela textual e arquivo que não é .mjs', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'cenarios-'))
    try {
      writeFileSync(join(pasta, 'a.mjs'), "export default { id: 'a', tela: 'Fake' }\n")
      writeFileSync(join(pasta, 'b.mjs'), 'export const outra = 1\n')
      writeFileSync(join(pasta, 'c.txt'), 'não é cenário')
      expect([...(await lerTelasDosCenarios(pasta))]).toEqual(['Fake'])
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})

// Processo assíncrono (spawn), nunca spawnSync: no Git Bash do Windows a chamada síncrona segura o worker do vitest.
function rodarGate(ambiente: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolver) => {
    const filho = spawn(process.execPath, [GATE], { cwd: RAIZ, env: ambiente, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    filho.stdout.setEncoding('utf8')
    filho.stderr.setEncoding('utf8')
    filho.stdout.on('data', (pedaco: string) => {
      stdout += pedaco
    })
    filho.stderr.on('data', (pedaco: string) => {
      stderr += pedaco
    })
    filho.on('error', (erro) => resolver({ status: null, stdout, stderr: stderr + erro.message }))
    filho.on('close', (status) => resolver({ status, stdout, stderr }))
  })
}

/** Ambiente do processo sem as variáveis de evento: o CI do próprio teste pode estar num pull_request. */
function ambienteSemEvento(): NodeJS.ProcessEnv {
  const ambiente = { ...process.env }
  delete ambiente.GITHUB_EVENT_NAME
  delete ambiente.GITHUB_EVENT_PATH
  return ambiente
}

describe('gate-cobertura.mjs (CLI)', () => {
  it('sem evento de PR confere só as telas e passa neste repositório', async () => {
    const r = await rodarGate(ambienteSemEvento())
    expect(r.stderr).toBe('')
    expect(r.stdout).toContain('telas: as 7 telas do topo têm cenário')
    expect(r.status).toBe(0)
  })

  it('evento de PR com sha inválido sai com 2 antes de qualquer comando git', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'gate-evento-'))
    try {
      const caminho = join(pasta, 'evento.json')
      writeFileSync(caminho, JSON.stringify({ pull_request: { base: { sha: 'abc' }, head: { sha: 'd'.repeat(40) }, labels: [], body: null } }))
      const r = await rodarGate({ ...ambienteSemEvento(), GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: caminho })
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('sha de base ou de head ausente ou inválido')
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })

  it('evento de PR sem o objeto pull_request sai com 2', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'gate-evento-'))
    try {
      const caminho = join(pasta, 'evento.json')
      writeFileSync(caminho, '{}')
      const r = await rodarGate({ ...ambienteSemEvento(), GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: caminho })
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('o evento não traz pull_request')
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})
