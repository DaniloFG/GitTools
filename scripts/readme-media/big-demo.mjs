// Repositório de exemplo grande e realista (um ano e meio de histórico, 9 pessoas, releases, PRs, branches antigas)
// para os prints dos dashboards. Gerado com `git fast-import`, de forma determinística (mesma semente, mesmo resultado).
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Gerador pseudoaleatório simples (mulberry32): o mesmo número sempre produz a mesma sequência. */
function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0)
      let r = next() * total
      for (const [v, w] of items) if ((r -= w) <= 0) return v
      return items[items.length - 1][0]
    }
  }
}

const PEOPLE = [
  // nome, e-mail, peso (quanto commita), horário típico [média, desvio], fins de semana?, entra / sai (fração do período)
  { name: 'Ana Costa', email: 'ana.costa@acme.dev', weight: 26, hour: [11, 2.6], weekend: 0.04, from: 0, to: 1, area: ['src/api', 'src/core'] },
  { name: 'Bruno Lima', email: 'bruno.lima@acme.dev', weight: 21, hour: [15, 3], weekend: 0.07, from: 0, to: 1, area: ['src/ui', 'src/styles'] },
  { name: 'Carla Souza', email: 'carla.souza@acme.dev', weight: 18, hour: [10, 2.2], weekend: 0.02, from: 0.05, to: 1, area: ['src/auth', 'src/api'] },
  { name: 'Diego Martins', email: 'diego.martins@acme.dev', weight: 14, hour: [21, 3.2], weekend: 0.22, from: 0.1, to: 0.93, area: ['infra', 'src/core'] },
  { name: 'Elisa Prado', email: 'elisa.prado@acme.dev', weight: 11, hour: [14, 2.5], weekend: 0.03, from: 0.3, to: 1, area: ['src/payments', 'tests'] },
  { name: 'Felipe Rocha', email: 'felipe.rocha@acme.dev', weight: 8, hour: [9, 1.8], weekend: 0.01, from: 0.42, to: 1, area: ['docs', 'src/ui'] },
  { name: 'Gabi Nunes', email: 'gabi.nunes@acme.dev', weight: 6, hour: [16, 2.8], weekend: 0.05, from: 0.62, to: 1, area: ['tests', 'src/ui'] },
  { name: 'Hugo Alves', email: 'hugo.alves@acme.dev', weight: 4, hour: [13, 3.5], weekend: 0.1, from: 0.76, to: 1, area: ['src/payments'] },
  { name: 'dependabot[bot]', email: 'support@github.com', weight: 5, hour: [5, 1], weekend: 0.3, from: 0.04, to: 1, area: ['package.json'], bot: true }
]

const TYPES = [['feat', 31], ['fix', 27], ['refactor', 9], ['docs', 6], ['test', 9], ['chore', 12], ['perf', 2], ['build', 4]]
const SUBJECTS = {
  feat: ['add export to CSV', 'support multiple currencies', 'new onboarding checklist', 'add dark mode toggle', 'email notifications for invoices', 'bulk edit for products', 'search with filters', 'add audit trail endpoint', 'rate limiting per API key', 'webhook retries with backoff', 'two-factor authentication', 'wishlist page', 'shipping estimates', 'coupon engine', 'order timeline'],
  fix: ['rounding error in totals', 'null pointer on empty cart', 'race condition in checkout', 'wrong timezone on reports', 'broken pagination on last page', 'duplicate emails on retry', 'memory leak in worker', 'login redirect loop', 'currency symbol alignment', 'stale cache after update', 'typo in error message', 'flaky payment test'],
  refactor: ['extract pricing module', 'simplify order state machine', 'split large controller', 'rename helpers', 'replace callbacks with async/await', 'move validators to core'],
  docs: ['update API reference', 'explain deployment steps', 'add architecture diagram', 'fix README typos', 'document env variables'],
  test: ['cover checkout edge cases', 'add e2e for login', 'stabilize payment mocks', 'snapshot tests for invoices'],
  chore: ['bump dependencies', 'update lockfile', 'clean unused imports', 'tweak CI cache', 'format code', 'update license year'],
  perf: ['cache product queries', 'lazy load images'],
  build: ['upgrade to node 22', 'speed up docker build', 'split bundle by route']
}
const WEAK = ['wip', 'fix', 'update', 'changes', 'asdf', 'tmp', 'more work', 'final', 'misc']
const AREAS = {
  'src/api': ['orders', 'products', 'customers', 'invoices', 'webhooks', 'search', 'reports', 'shipping', 'coupons', 'audit', 'health', 'router'],
  'src/core': ['pricing', 'orders', 'inventory', 'money', 'taxes', 'events', 'queue', 'config', 'logger', 'errors'],
  'src/ui': ['Button', 'Cart', 'Checkout', 'ProductCard', 'Header', 'Footer', 'OrderList', 'Filters', 'Modal', 'Toast', 'Table', 'Onboarding', 'Wishlist', 'Search'],
  'src/styles': ['theme', 'layout', 'forms', 'tables', 'utilities'],
  'src/auth': ['login', 'session', 'tokens', 'twofactor', 'roles', 'passwords'],
  'src/payments': ['gateway', 'refunds', 'invoices', 'currencies', 'retries', 'webhooks', 'fraud'],
  infra: ['docker', 'terraform', 'ci', 'k8s', 'monitoring', 'backup'],
  tests: ['checkout', 'orders', 'login', 'payments', 'search', 'invoices', 'api', 'ui'],
  docs: ['api', 'deploy', 'architecture', 'onboarding', 'faq', 'changelog'],
  'package.json': ['']
}
const EXT = { 'src/ui': 'tsx', 'src/styles': 'css', infra: 'tf', docs: 'md', tests: 'test.ts', 'package.json': '' }

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** Num projeto real as branches de PRs já integrados somem: deixa só as últimas e as que nunca foram integradas. */
function tidyBranches(dir) {
  const merged = git(dir, 'branch', '--merged', 'main', '--format=%(refname:short)')
    .split('\n')
    .filter((b) => b.startsWith('feature/'))
  const cutoff = Date.now() / 1000 - 45 * 86400
  for (const b of merged) if (Number(git(dir, 'log', '-1', '--format=%ct', b)) < cutoff) git(dir, 'branch', '-D', b)
}

/** Um "origin" com um pouco de diferença: a main local está à frente, algumas branches atrás ou à frente do servidor. */
function addRemote(dir, r) {
  const origin = join(dirname(dir), 'origin.git')
  git(dirname(dir), 'clone', '-q', '--bare', dir, origin)
  const tipOf = (cwd, ref) => git(cwd, 'rev-parse', ref)
  git(origin, 'update-ref', 'refs/heads/main', git(origin, 'rev-parse', 'main~6'))
  const local = git(dir, 'branch', '--format=%(refname:short)').split('\n')
  const recent = local.filter((b) => b.startsWith('feature/') && !['feature/legacy-import', 'feature/new-checkout-v2'].includes(b)).slice(-3)
  for (const b of recent) git(origin, 'update-ref', `refs/heads/${b}`, git(origin, 'rev-parse', `${b}~1`))
  for (const b of ['spike/graphql', 'hotfix/old-tax-rule']) {
    if (!local.includes(b)) continue
    const tip = tipOf(origin, b)
    let parent = tip
    for (let i = 0; i < r.int(1, 3); i++) {
      parent = execFileSync('git', ['commit-tree', `${parent}^{tree}`, '-p', parent, '-m', `chore: sync ${i}`], { cwd: origin, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Ana Costa', GIT_AUTHOR_EMAIL: 'ana.costa@acme.dev', GIT_COMMITTER_NAME: 'Ana Costa', GIT_COMMITTER_EMAIL: 'ana.costa@acme.dev' } }).trim()
    }
    git(origin, 'update-ref', `refs/heads/${b}`, parent)
  }
  git(dir, 'remote', 'add', 'origin', origin)
  git(dir, 'fetch', '-q', 'origin')
  for (const b of ['main', ...recent, 'spike/graphql', 'hotfix/old-tax-rule']) if (local.includes(b)) git(dir, 'branch', '-q', `--set-upstream-to=origin/${b}`, b)
}

export function createBigDemo(dir, { seed = 7, end = new Date('2026-10-22T18:00:00Z'), months = 18 } = {}) {
  const r = rng(seed)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Ana Costa'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'ana.costa@acme.dev'], { cwd: dir })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })

  const startMs = end.getTime() - months * 30.4 * 86400000
  const span = end.getTime() - startMs
  const lines = []
  let mark = 0
  const out = (s) => lines.push(s)
  const files = new Map() // caminho -> linhas
  const fileOwners = new Map()

  const pathFor = (area) => {
    const names = AREAS[area]
    const name = r.pick(names)
    const ext = EXT[area] ?? 'ts'
    if (area === 'package.json') return 'package.json'
    return `${area}/${name}${ext ? '.' + ext : ''}`
  }
  const fileLine = (path) => `${path.includes('.css') ? '.rule' : 'const'} v${r.int(100, 99999)} = ${r.int(0, 9999)} // ${r.pick(['todo', 'note', 'calc', 'map', 'read', 'send'])}`

  function ensureFile(path) {
    if (!files.has(path)) files.set(path, Array.from({ length: r.int(20, 120) }, () => fileLine(path)))
    return files.get(path)
  }
  function edit(path, big) {
    const content = ensureFile(path)
    const del = Math.min(content.length - 1, r.int(0, big ? 60 : 8))
    const add = r.int(1, big ? 140 : 24)
    const at = r.int(0, Math.max(0, content.length - del))
    content.splice(at, del, ...Array.from({ length: add }, () => fileLine(path)))
  }

  const marks = []
  function commit({ ref, who, when, message, paths, parents = [], big = false, merge = null, body = '', tag = null }) {
    mark++
    const ts = Math.floor(when / 1000)
    out(`commit refs/heads/${ref}`)
    out(`mark :${mark}`)
    out(`author ${who.name} <${who.email}> ${ts} +0000`)
    out(`committer ${who.committer?.name ?? who.name} <${who.committer?.email ?? who.email}> ${ts} +0000`)
    const text = body ? `${message}\n\n${body}` : message
    out(`data ${Buffer.byteLength(text)}`)
    out(text)
    if (parents[0]) out(`from :${parents[0]}`)
    if (merge) out(`merge :${merge}`)
    if (!merge) {
      for (const p of paths) {
        edit(p, big)
        const body = files.get(p).join('\n') + '\n'
        out('M 100644 inline ' + p)
        out(`data ${Buffer.byteLength(body)}`)
        out(body)
      }
    }
    out('')
    if (tag) {
      out(`reset refs/tags/${tag}`)
      out(`from :${mark}`)
      out('')
    }
    marks.push(mark)
    return mark
  }

  const dayWeight = (d) => {
    const dow = d.getUTCDay()
    return dow === 0 || dow === 6 ? 0.12 : dow === 5 ? 0.85 : 1
  }
  const person = (frac, weekend) => {
    const present = PEOPLE.filter((p) => frac >= p.from && frac <= p.to)
    const wanted = present.filter((p) => !weekend || r.chance(Math.min(1, p.weekend * 6)))
    const active = wanted.length ? wanted : present
    return r.weighted(active.map((p) => [p, p.weight * (1 + 0.6 * Math.sin(frac * 9 + p.weight))]))
  }
  const gauss = (m, s) => {
    const u = 1 - r.next()
    const v = r.next()
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  // Calendário de commits: mais atividade ao longo do tempo (equipe crescendo), picos antes dos releases, pausas (feriados).
  const total = 1900
  const slots = []
  for (let d = 0; d < months * 30.4; d++) {
    const date = new Date(startMs + d * 86400000)
    const frac = d / (months * 30.4)
    const holiday = (date.getUTCMonth() === 11 && date.getUTCDate() > 22) || (date.getUTCMonth() === 0 && date.getUTCDate() < 5) ? 0.15 : 1
    const sprint = 1 + 0.35 * Math.sin((d / 14) * Math.PI)
    const growth = 0.55 + frac * 1.1
    slots.push({ date, w: dayWeight(date) * holiday * sprint * growth })
  }
  const slotTotal = slots.reduce((s, x) => s + x.w, 0)

  let nextPr = 1
  let mainHead = null
  const releases = []
  slots.forEach((slot, idx) => {
    const frac = idx / slots.length
    let count = Math.round((slot.w / slotTotal) * total + (r.next() - 0.5) * 0.9)
    count = Math.max(0, count)
    for (let k = 0; k < count; k++) {
      const weekend = slot.date.getUTCDay() === 0 || slot.date.getUTCDay() === 6
      const who = person(frac, weekend)
      const hour = Math.max(0, Math.min(23.9, gauss(who.hour[0], who.hour[1])))
      const when = Date.UTC(slot.date.getUTCFullYear(), slot.date.getUTCMonth(), slot.date.getUTCDate(), 0, 0) + hour * 3600000
      const type = who.bot ? 'chore' : r.weighted(TYPES)
      const weak = !who.bot && r.chance(0.07)
      const conventional = who.bot || r.chance(0.78)
      const subject = who.bot ? r.pick(['bump lodash from 4.17.20 to 4.17.21', 'bump axios from 1.6.0 to 1.7.2', 'bump vite from 5.2.0 to 5.4.1', 'bump typescript from 5.4.5 to 5.5.4']) : r.pick(SUBJECTS[type])
      const scope = r.pick(who.area).replace('src/', '')
      let message = weak ? r.pick(WEAK) : conventional ? `${type}(${scope}): ${subject}` : subject[0].toUpperCase() + subject.slice(1)
      const body = !weak && !who.bot && r.chance(0.55) ? r.pick(['Explains why the change was needed and links the ticket.', 'Keeps the behavior backwards compatible and adds a migration note.', 'Reported by support; reproduced locally and covered by a test.']) : ''
      const nfiles = type === 'chore' && who.bot ? 2 : r.weighted([[1, 34], [2, 28], [3, 16], [4, 9], [6, 7], [9, 4], [14, 2]])
      const big = r.chance(0.04)
      const paths = [...new Set(Array.from({ length: nfiles }, () => pathFor(r.chance(0.85) ? r.pick(who.area) : r.pick(Object.keys(AREAS)))))]
      const committer = r.chance(0.06) ? { name: 'GitHub', email: 'noreply@github.com' } : null
      const trailers = r.chance(0.18) ? `Signed-off-by: ${who.name} <${who.email}>` : ''
      const withBody = [body, trailers].filter(Boolean).join('\n\n')
      const tag = null
      const who2 = committer ? { ...who, committer } : who
      // Parte vira PR: 2 a 4 commits em uma branch e um merge na main.
      if (!who.bot && r.chance(0.13)) {
        const n = r.int(2, 4)
        const branch = `feature/${scope}-${nextPr}`
        let prev = mainHead
        for (let i = 0; i < n; i++) {
          prev = commit({ ref: branch, who: who2, when: when - (n - i) * r.int(900000, 7200000), message: i ? `${type}(${scope}): ${r.pick(SUBJECTS[type])}` : message, paths: [...new Set(Array.from({ length: r.int(1, 3) }, () => pathFor(r.pick(who.area))))], parents: [prev], big, body: withBody })
        }
        const reviewer = r.pick(PEOPLE.filter((p) => !p.bot && frac >= p.from && frac <= p.to))
        mainHead = commit({ ref: 'main', who: { ...reviewer, committer: { name: 'GitHub', email: 'noreply@github.com' } }, when: when + 600000, message: `Merge pull request #${nextPr} from acme/${branch}`, paths: [], parents: [mainHead], merge: prev, body: message })
        nextPr++
        continue
      }
      mainHead = commit({ ref: 'main', who: who2, when, message, paths, parents: [mainHead], big, body: withBody })
    }
    // Releases quinzenais (marcados no último commit do dia, a cada ~21 dias).
    if (idx > 20 && idx % 21 === 0 && mainHead) {
      const v = releases.length + 1
      const tag = `v${1 + Math.floor(v / 8)}.${v % 8}.0`
      out(`reset refs/tags/${tag}`)
      out(`from :${mainHead}`)
      out('')
      releases.push(tag)
    }
  })

  // Branches antigas, nunca integradas (para o painel de saúde do repositório).
  const stale = [['feature/legacy-import', 0.35, 3], ['spike/graphql', 0.5, 5], ['hotfix/old-tax-rule', 0.66, 2], ['feature/new-checkout-v2', 0.8, 7]]
  for (const [name, frac, n] of stale) {
    const who = PEOPLE[r.int(1, 4)]
    let prev = marks[Math.floor(marks.length * frac)]
    for (let i = 0; i < n; i++) prev = commit({ ref: name, who, when: startMs + span * frac + i * 3600000 * 20, message: `${r.pick(['feat', 'fix', 'chore'])}(${name.split('/')[1]}): ${r.pick(SUBJECTS.feat)}`, paths: [pathFor(r.pick(who.area))], parents: [prev] })
  }

  out('done')
  const res = spawnSync('git', ['fast-import', '--quiet', '--force'], { cwd: dir, input: lines.join('\n') + '\n', maxBuffer: 1 << 30, encoding: 'utf8' })
  if (res.status !== 0) throw new Error('fast-import falhou: ' + res.stderr)
  execFileSync('git', ['checkout', '-q', '-f', 'main'], { cwd: dir })
  tidyBranches(dir)
  addRemote(dir, r)
  return { commits: mark, releases }
}
