// Abre a interface do GitTools num Chromium (Playwright) ligada ao Backend de verdade, para conferir a tela e
// gerar os prints dos READMEs. Precisa do `playwright` instalado (npm i -g playwright) e do app compilado:
//   npm run build:extension   (gera extension/dist/webview, que é a interface empacotada)
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(new URL('../..', import.meta.url).pathname)
const require = createRequire(import.meta.url)

async function loadPlaywright() {
  for (const base of [process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright', 'playwright'].filter(Boolean)) {
    try {
      return require(base)
    } catch {}
  }
  throw new Error('playwright não encontrado (defina PLAYWRIGHT_MODULE)')
}

/** Compila o Backend (TypeScript) para um arquivo CommonJS temporário e o carrega. */
async function loadBackend(work) {
  const out = join(work, 'backend.cjs')
  await build({ entryPoints: [join(root, 'src/backend/backend.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'error' })
  return require(out)
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }

function serve(dir) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const file = join(dir, url.pathname === '/' ? 'index.html' : url.pathname)
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })))
}

const BRIDGE = String.raw`
(() => {
  const listeners = { cmd: new Set(), changed: new Set() }
  const call = (channel, ...args) => window.__gt(channel, args)
  window.__emit = (channel, payload) => (channel === 'git:command' ? listeners.cmd : listeners.changed).forEach((l) => l(payload))
  const bridge = {
    openRepository: (p) => call('app:openRepository', p), currentRepository: () => call('app:currentRepository'), initRepository: () => call('app:initRepository'),
    recentRepositories: () => call('app:recentRepositories'), removeRecentRepository: (p) => call('app:removeRecentRepository', p),
    setRepositoryFavorite: (p, f) => call('app:setRepositoryFavorite', p, f), openFile: (p) => call('app:openFile', p),
    detectEditors: () => call('app:detectEditors'), chooseEditor: () => call('app:chooseEditor'), openInEditor: (p) => call('app:openInEditor', p),
    testEditor: (s) => call('app:testEditor', s), getSettings: () => call('app:getSettings'), saveSettings: (s) => call('app:saveSettings', s),
    appInfo: () => call('app:info'), gitLog: () => call('app:gitLog'),
    onGitCommand: (l) => { listeners.cmd.add(l); return () => listeners.cmd.delete(l) },
    openDiffWindow: (r) => call('app:openDiffWindow', r), chooseFolder: (t) => call('app:chooseFolder', t), defaultCloneFolder: () => call('app:defaultCloneFolder'),
    cloneRepository: (u, p, n) => call('app:cloneRepository', u, p, n), gitIdentity: () => call('app:gitIdentity'), setGitIdentity: (s, i) => call('app:setGitIdentity', s, i),
    setZoom: () => undefined, invoke: (m, ...a) => call('repo:invoke', m, a),
    onRepositoryChanged: (l) => { listeners.changed.add(l); return () => listeners.changed.delete(l) }
  }
  window.gittools = bridge
})()
`

/** Ponteiro desenhado na página (a captura de vídeo não mostra o do sistema). */
const CURSOR = String.raw`
window.addEventListener('DOMContentLoaded', () => {
  const dot = document.createElement('div')
  dot.style.cssText = 'position:fixed;left:-30px;top:-30px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,196,0,.55);border:2px solid #ffc400;box-shadow:0 0 6px rgba(0,0,0,.5);pointer-events:none;z-index:2147483647;transition:transform .08s'
  document.body.appendChild(dot)
  window.addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px' }, true)
  window.addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)' }, true)
  window.addEventListener('mouseup', () => { dot.style.transform = 'scale(1)' }, true)
})
`

/**
 * @param {{ repo: string, host?: 'electron' | 'vscode', language?: string, settings?: object, viewport?: {width:number,height:number}, theme?: 'dark'|'light', layout?: Record<string, unknown>, video?: string }} options
 */
export async function launch(options) {
  const { chromium } = await loadPlaywright()
  const work = mkdtempSync(join(tmpdir(), 'gittools-media-'))
  // A identidade global do git vem de um arquivo de exemplo (os prints não podem mostrar a de quem os gera).
  writeFileSync(join(work, '.gitconfig'), '[user]\n\tname = Ana Costa\n\temail = ana@example.com\n')
  process.env.GIT_CONFIG_GLOBAL = join(work, '.gitconfig')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  const { Backend } = await loadBackend(work)
  const data = join(work, 'data')
  mkdirSync(data, { recursive: true })
  const language = options.language ?? 'en'
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ language, theme: options.theme ?? 'dark', ...(options.settings ?? {}) }))

  const events = []
  const host = {
    dataDir: () => data,
    homeDir: () => work,
    documentsDir: () => '/home/ana/Projects',
    systemLocales: () => [language],
    versions: () => ({ host: options.host ?? 'electron', version: '0.7.0', electron: '38.0.0', chrome: '140.0.0', node: process.versions.node, platform: 'linux', ...(options.host === 'vscode' ? { vscode: '1.105.0' } : {}) }),
    emit: (channel, payload) => events.push([channel, payload]),
    pickFolder: async () => null,
    openPath: async () => undefined,
    openInEditor: async () => undefined,
    testEditor: async () => undefined,
    detectEditors: () => [],
    chooseEditor: async () => null,
    openDiffWindow: () => undefined,
    settingsChanged: () => undefined
  }
  const backend = new Backend(host)
  await backend.invoke('app:openRepository', [options.repo])

  const { server, port } = await serve(join(root, 'extension/dist/webview'))
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
  const viewport = options.viewport ?? { width: 1440, height: 900 }
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: language, ...(options.video ? { recordVideo: { dir: options.video, size: viewport } } : {}) })
  const page = await context.newPage()
  const t0 = Date.now()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  await page.exposeFunction('__gt', (channel, args) => backend.invoke(channel, args))
  await page.addInitScript(BRIDGE)
  if (options.video) await page.addInitScript(CURSOR)
  if (options.layout) {
    await page.addInitScript((layout) => {
      for (const [key, value] of Object.entries(layout)) localStorage.setItem(`gittools.layout.${key}`, JSON.stringify(value))
    }, options.layout)
  }
  // Repassa à página os eventos do backend (log do git e mudanças no repositório).
  const pump = setInterval(() => {
    for (const [channel, payload] of events.splice(0)) page.evaluate(([c, p]) => window.__emit?.(c, p), [channel, payload]).catch(() => undefined)
  }, 100)
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.waitForSelector('.toolbar', { timeout: 15000 })
  return {
    page,
    backend,
    errors,
    t0,
    async close() {
      clearInterval(pump)
      // Fechar a página e o contexto grava o final do vídeo.
      await page.close().catch(() => undefined)
      await context.close().catch(() => undefined)
      await browser.close()
      server.close()
      backend.dispose()
    }
  }
}
