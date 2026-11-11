// Repositório sintético e determinístico para medir o desempenho do GitTools (ver docs/PERFORMANCE.md).
// Tem o que costuma pesar: 20 mil commits com merges, mais de mil branches e tags, 6 mil arquivos (uma pasta
// com 1.200 deles), um commit que mexe em 3 mil arquivos e outro com 5 mil linhas alteradas num arquivo só.
//
//   node scripts/perf/stress-repo.mjs [pasta] [commits] [arquivos]
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_DIR = join(tmpdir(), 'gittools-perf-stress')

const run = (dir, ...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30 }).toString()

/** Cria o repositório (ou reaproveita o que já existe com os mesmos números). Devolve a pasta. */
export function createStressRepo(dir = DEFAULT_DIR, { commits = 20000, files = 6000 } = {}) {
  const stamp = `${commits}:${files}:v1`
  const marker = join(dir, '.git', 'gittools-perf')
  if (existsSync(marker) && readFileSync(marker, 'utf8') === stamp) return dir
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const git = (...args) => run(dir, ...args)
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Perf')
  git('config', 'user.email', 'perf@example.com')

  // Gerador pseudoaleatório fixo: a mesma semente produz sempre o mesmo repositório.
  let seed = 42
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))

  const dirs = Array.from({ length: 120 }, (_, i) => `src/mod${String(i % 40).padStart(2, '0')}/pkg${i}`)
  const paths = Array.from({ length: files }, (_, i) => `${i % 5 === 0 ? 'big/flat' : dirs[i % dirs.length]}/file${i}.${['ts', 'tsx', 'css', 'json', 'md'][i % 5]}`)
  const body = (i, rev) => Array.from({ length: 40 }, (_, l) => `line ${l} of file ${i} rev ${l % 7 === 0 ? rev : 0}`).join('\n') + '\n'

  const out = []
  const data = (text) => `data ${Buffer.byteLength(text)}\n${text}\n`
  let mark = 0
  const t0 = 1700000000
  const commit = (ref, who, when, message, extra) =>
    out.push(`commit ${ref}\nmark :${++mark}\nauthor ${who} ${when} +0000\ncommitter ${who} ${when} +0000\n${data(message)}${extra}`)

  let first = ''
  for (let i = 0; i < files; i++) first += `M 100644 inline ${paths[i]}\n${data(body(i, 0))}`
  const hugeLines = Array.from({ length: 20000 }, (_, l) => `const value${l} = compute(${l}, 'base') // linha ${l}`)
  first += `M 100644 inline big/huge.ts\n${data(hugeLines.join('\n') + '\n')}`
  commit('refs/heads/main', 'Ana <ana@x>', t0, 'initial import', first)
  let main = mark

  const authors = ['Ana <ana@x>', 'Bruno <bruno@x>', 'Carla <carla@x>', 'Diego <diego@x>', 'Elisa <elisa@x>']
  const open = []
  let branchN = 0
  for (let c = 1; c < commits; c++) {
    const when = t0 + c * 600
    const who = authors[c % authors.length]
    let side = open.length > 0 && rnd() < 0.45
    if (!side && rnd() < 0.04 && open.length < 6) open.push({ mark: main, name: `feature/topic-${branchN++}`, n: 0 })
    if (open.length && rnd() < 0.03) {
      const b = open.splice(int(0, open.length - 1), 1)[0]
      if (b.n > 0) {
        commit('refs/heads/main', who, when, `Merge branch '${b.name}'`, `from :${main}\nmerge :${b.mark}\n`)
        main = mark
        if (branchN % 9 === 0) out.push(`reset refs/heads/${b.name}\nfrom :${b.mark}\n`)
        continue
      }
    }
    side = side && open.length > 0
    let ops = ''
    for (let k = int(1, 4); k > 0; k--) {
      const i = int(0, files - 1)
      ops += `M 100644 inline ${paths[i]}\n${data(body(i, c))}`
    }
    if (side) {
      const b = open[int(0, open.length - 1)]
      commit('refs/heads/perf-side', who, when, `feat(${b.name}): change ${c}`, `from :${b.mark}\n${ops}`)
      b.mark = mark
      b.n++
    } else {
      commit('refs/heads/main', who, when, `fix: adjust module ${c} and something else to make the subject long enough`, `from :${main}\n${ops}`)
      main = mark
      if (c % 15 === 0) out.push(`reset refs/tags/v0.${Math.floor(c / 15)}.0\nfrom :${main}\n`)
      if (c % 60 === 0) out.push(`reset refs/remotes/origin/release/r${c}\nfrom :${main}\n`)
      if (c % 250 === 0) out.push(`reset refs/heads/old/branch-${c}\nfrom :${main}\n`)
    }
  }
  for (const b of open) out.push(`reset refs/heads/${b.name}\nfrom :${b.mark}\n`)

  const end = t0 + commits * 600
  let many = ''
  for (let i = 0; i < Math.min(3000, files); i++) many += `M 100644 inline ${paths[i]}\n${data(body(i, 999999))}`
  commit('refs/heads/main', authors[0], end, 'chore: touch 3000 files', `from :${main}\n${many}`)
  main = mark
  const rewritten = hugeLines.map((line, i) => (i % 4 === 0 ? line.replace("'base'", "'changed'") : line))
  commit('refs/heads/main', authors[0], end + 60, 'refactor: huge file rewrite (5000 changed lines)', `from :${main}\nM 100644 inline big/huge.ts\n${data(rewritten.join('\n') + '\n')}`)
  main = mark
  // O commit mais recente é pequeno: é ele que a interface abre sozinha ao carregar.
  commit('refs/heads/main', authors[1], end + 120, 'fix: small tweak on top', `from :${main}\nM 100644 inline ${paths[1]}\n${data(body(1, 1) + '// tweak\n')}`)
  out.push(`reset refs/remotes/origin/main\nfrom :${mark}\n`)

  const result = spawnSync('git', ['fast-import', '--quiet'], { cwd: dir, input: out.join(''), maxBuffer: 1 << 30 })
  if (result.status !== 0) throw new Error(result.stderr.toString())
  try {
    git('update-ref', '-d', 'refs/heads/perf-side')
  } catch {
    // Nenhum commit lateral foi gerado.
  }
  git('reset', '-q', '--hard', 'main')
  git('gc', '-q')
  writeFileSync(marker, stamp)
  return dir
}

/** Quantos arquivos alterados e não rastreados cada cenário deixa na pasta de trabalho. */
export const SCENARIOS = { clean: [0, 0], moderate: [30, 10], heavy: [300, 2000] }

/** Deixa a pasta de trabalho no cenário pedido (sempre a partir do estado limpo). */
export function applyScenario(dir, scenario = 'moderate') {
  const [modified, untracked] = SCENARIOS[scenario] ?? SCENARIOS.moderate
  run(dir, 'reset', '-q', '--hard', 'main')
  run(dir, 'clean', '-fdq')
  const tracked = run(dir, 'ls-files').split('\n').filter(Boolean)
  for (let i = 0; i < modified; i++) appendFileSync(join(dir, tracked[i * 7]), `changed ${i}\n`)
  if (untracked > 0) mkdirSync(join(dir, 'generated/out'), { recursive: true })
  for (let i = 0; i < untracked; i++) writeFileSync(join(dir, `generated/out/new${i}.js`), `export const x${i} = ${i}\n`.repeat(200))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, commits, files] = process.argv.slice(2)
  const made = createStressRepo(dir ?? DEFAULT_DIR, { commits: Number(commits ?? 20000), files: Number(files ?? 6000) })
  console.log(made)
  console.log('commits', run(made, 'rev-list', '--all', '--count').trim(), '| refs', run(made, 'for-each-ref').split('\n').length - 1, '| arquivos', run(made, 'ls-files').split('\n').length - 1)
}
