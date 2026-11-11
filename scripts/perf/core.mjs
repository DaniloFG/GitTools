// Mede as leituras do git (src/core) e algumas funções puras da interface, fora do navegador.
// Para cada leitura: tempo (mediana), quantos processos git ela abre e o tamanho do que vai para a interface.
//
//   node scripts/perf/core.mjs [clean|moderate|heavy] [pasta-do-repositório]
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyScenario, createStressRepo, DEFAULT_DIR } from './stress-repo.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const require = createRequire(import.meta.url)
const scenario = process.argv[2] ?? 'moderate'
const dir = createStressRepo(process.argv[3] ?? DEFAULT_DIR)

// O código é TypeScript: compila o que será medido para um arquivo temporário.
const work = mkdtempSync(join(tmpdir(), 'gittools-perf-'))
const src = (path) => JSON.stringify(join(root, path))
writeFileSync(
  join(work, 'entry.ts'),
  [
    `export { GitRepository } from ${src('src/core/repository')}`,
    `export { onGitCommand, runGit } from ${src('src/core/exec')}`,
    `export { buildTree } from ${src('src/renderer/src/fileTree')}`,
    `export { sameDiff } from ${src('src/renderer/src/diffIdentity')}`,
    `export { mergeData } from ${src('src/renderer/src/stable')}`,
    `export { groupBranches } from ${src('src/renderer/src/sidebarGroups')}`,
    `export { computeGraph } from ${src('src/renderer/src/graph')}`,
    `export { formatShortDateTime, formatRelative, setDateFormat, setLocale, t } from ${src('src/shared/i18n')}`
  ].join('\n')
)
await build({ entryPoints: [join(work, 'entry.ts')], outfile: join(work, 'perf.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'error' })
const m = require(join(work, 'perf.cjs'))

const git = (...args) => execFileSync('git', args, { cwd: dir, maxBuffer: 1 << 30 }).toString()
let spawns = 0
m.onGitCommand((entry) => {
  if (entry.durationMs === undefined) spawns++
})

/** Roda `fn` algumas vezes e mostra a mediana, os processos git de uma rodada e o tamanho do resultado em JSON. */
async function read(label, fn, runs = 3) {
  const times = []
  let processes = 0
  let size = 0
  for (let i = 0; i < runs; i++) {
    spawns = 0
    const start = performance.now()
    const result = await fn()
    times.push(performance.now() - start)
    processes = spawns
    if (i === 0) size = Buffer.byteLength(JSON.stringify(result) ?? '')
  }
  times.sort((a, b) => a - b)
  console.log(`${label.padEnd(56)} ${times[Math.floor(times.length / 2)].toFixed(0).padStart(6)} ms   git ×${String(processes).padStart(2)}   ${(size / 1024).toFixed(0).padStart(6)} KB`)
}

/** Tempo de uma função síncrona (média de `n` chamadas). */
function pure(label, fn, n = 1) {
  const start = performance.now()
  for (let i = 0; i < n; i++) fn()
  console.log(`${label.padEnd(56)} ${((performance.now() - start) / n).toFixed(n > 1 ? 3 : 1).padStart(9)} ms`)
}

applyScenario(dir, scenario)
const repo = await m.GitRepository.open(dir)
console.log(`\n== leituras do git — cenário ${scenario} (${dir}) ==`)
{
  const start = performance.now()
  for (let i = 0; i < 20; i++) await m.runGit(dir, ['--version'], { silent: true })
  console.log(`${'custo de abrir 1 processo git (média de 20)'.padEnd(56)} ${((performance.now() - start) / 20).toFixed(1).padStart(6)} ms`)
}
const [small, huge, many] = git('rev-list', '-n', '3', 'main').trim().split('\n')
const recent = git('rev-list', '--no-merges', '-n', '30', 'main~5').trim().split('\n')
let next = 0
await read('status()', () => repo.status())
await read('status(true)  ← em toda atualização da tela', () => repo.status(true))
await read('refs()', () => repo.refs())
await read('operationState()', () => repo.operationState())
await read('stashes()', () => repo.stashes())
await read('log({ all: true })  [500 commits]', () => repo.log({ all: true }))
await read('commitDetails  [commit de 1 arquivo]', () => repo.commitDetails(small))
await read('commitDetails  [commit de 3000 arquivos]', () => repo.commitDetails(many))
await read('diff de 1 arquivo  [5000 linhas alteradas]', () => repo.diff({ kind: 'commit', sha: huge, path: 'big/huge.ts' }))
await read('diff do commit inteiro  [3000 arquivos]', () => repo.diff({ kind: 'commit', sha: many }))
await read('listFiles()', () => repo.listFiles())
await read('blame  [arquivo de 20 mil linhas]', () => repo.blame('big/huge.ts'), 1)
await read('analytics({ scope: "all" })  [dashboards]', () => repo.analytics({ scope: 'all' }), 1)
await read('compare(main~500, main)', () => repo.compare('main~500', 'main'), 1)
await read('ATUALIZAÇÃO: dados da aba + resumo da aba', () => Promise.all([repo.status(true), repo.refs(), repo.operationState(), repo.status(), repo.operationState()]))
await read('SELECIONAR 1 COMMIT: detalhes + diff do 1º arquivo', async () => {
  const details = await repo.commitDetails(recent[next++ % recent.length])
  return repo.diff({ kind: 'commit', sha: details.sha, path: details.files[0].path })
}, 5)

console.log('\n== funções puras da interface ==')
for (const n of [2000, 10000, 30000]) {
  const flat = Array.from({ length: n }, (_, i) => `big/flat/sub${i % (n / 10)}/file${i}.ts`)
  pure(`buildTree: ${n} arquivos em ${n / 10} subpastas`, () => m.buildTree(flat, (p) => p))
}
m.setLocale('pt-BR')
m.setDateFormat('24h')
const now = Date.now()
const dateFormat = new Intl.DateTimeFormat('pt-BR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const relativeFormat = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
pure('formatShortDateTime (como está)', () => m.formatShortDateTime(now - 5e9), 2000)
pure('  o mesmo texto com o formatador guardado', () => dateFormat.format(now - 5e9), 2000)
pure('formatRelative (como está)', () => m.formatRelative(now - 3600e3 * 5), 2000)
pure('  o mesmo texto com o formatador guardado', () => relativeFormat.format(-5, 'hour'), 2000)
pure("t('history.count', { count })", () => m.t('history.count', { count: 42 }), 20000)
const status = { staged: [], conflicted: [], unstaged: Array.from({ length: 2300 }, (_, i) => ({ path: `generated/out/new${i}.js`, index: '?', worktree: '?', untracked: true, conflicted: false, additions: 200, deletions: 0 })) }
const branches = Array.from({ length: 1100 }, (_, i) => ({ name: `feature/x-${i}`, fullRef: `refs/heads/feature/x-${i}`, remote: null, sha: 'a'.repeat(40), upstream: null, ahead: 0, behind: 0, current: false, date: 1, subject: 'some subject here' }))
const before = { status, branches }
const after = JSON.parse(JSON.stringify(before))
pure('mergeData: status de 2300 arquivos + 1100 branches', () => m.mergeData(before, after), 50)
// Agrupamento do painel lateral: 300 locais e 800 remotas em 2 remotos. A versão antiga (copia a lista do remoto a cada item) fica aqui para comparar.
const remoteBranches = Array.from({ length: 1100 }, (_, i) => {
  if (i < 300) return { ...branches[i], name: `feature/x-${i}`, remote: null }
  const remote = i % 2 ? 'origin' : 'upstream'
  return { ...branches[i], name: `${remote}/feature/x-${i}`, fullRef: `refs/remotes/${remote}/feature/x-${i}`, remote }
})
const oldGroup = (list) => {
  const local = list.filter((b) => !b.remote)
  const groups = new Map()
  for (const b of list.filter((b) => b.remote)) groups.set(b.remote, [...(groups.get(b.remote) ?? []), b])
  return { local, remotes: [...groups.entries()] }
}
pure('agrupar 1100 branches (como estava)', () => oldGroup(remoteBranches), 200)
pure('agrupar 1100 branches: groupBranches', () => m.groupBranches(remoteBranches), 200)
const commits = Array.from({ length: 5000 }, (_, i) => ({ sha: `c${i}`, parents: i % 9 === 0 ? [`c${i + 1}`, `c${i + 13}`] : [`c${i + 1}`] }))
pure('computeGraph: 5000 commits', () => m.computeGraph(commits, 'c0'))
// Diff de 1 arquivo com 5.000 linhas alteradas, montado igual ao que a leitura devolve (objetos distintos e iguais).
// Com `index` (arquivo rastreado) e sem (não rastreado, como em `untrackedDiff`).
const bigDiff = (withIndex) => ({
  oldPath: 'big/huge.ts',
  newPath: 'big/huge.ts',
  path: 'big/huge.ts',
  changeType: 'modified',
  binary: false,
  headerLines: withIndex
    ? ['diff --git a/big/huge.ts b/big/huge.ts', 'index 3f2a1b0..9c8d7e6 100644', '--- a/big/huge.ts', '+++ b/big/huge.ts']
    : ['diff --git a/big/huge.ts b/big/huge.ts', 'new file mode 100644', '--- /dev/null', '+++ b/big/huge.ts'],
  hunks: [
    {
      oldStart: 1,
      oldCount: 5000,
      newStart: 1,
      newCount: 5000,
      section: 'main()',
      lines: Array.from({ length: 5000 }, (_, i) => ({ kind: i % 2 ? 'add' : 'del', content: `  const value${i} = compute(${i}) // alterado`, oldLine: i + 1, newLine: i + 1 }))
    }
  ],
  additions: 2500,
  deletions: 2500
})
const [withIndexA, withIndexB] = [bigDiff(true), bigDiff(true)]
const [noIndexA, noIndexB] = [bigDiff(false), bigDiff(false)]
pure('comparar diff de 5000 linhas: JSON.stringify', () => JSON.stringify(withIndexA) === JSON.stringify(withIndexB), 20)
pure('comparar diff de 5000 linhas: sameDiff (com index)', () => m.sameDiff(withIndexA, withIndexB), 200)
pure('comparar diff de 5000 linhas: sameDiff (sem index)', () => m.sameDiff(noIndexA, noIndexB), 200)
applyScenario(dir, 'clean')
