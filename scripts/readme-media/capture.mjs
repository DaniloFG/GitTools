// Gera os prints dos READMEs (README.md e extension/README.md) a partir da interface real, com repositórios de exemplo.
//   npm run build:extension && node scripts/readme-media/capture.mjs [local|extension] [nome ...]
// Precisa do `playwright` (npm i -g playwright; PLAYWRIGHT_MODULE e CHROMIUM se não estiverem nos caminhos padrão) e do ffmpeg para os GIFs.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dragHtml5, ensureDir, newApp } from './lib.mjs'
import { FILES_DOCK } from './presets.mjs'

const root = resolve(new URL('../..', import.meta.url).pathname)
const LOCAL = ensureDir(join(root, 'docs/screenshots'))
const EXT = ensureDir(join(root, 'extension/media/readme'))
const OUT = process.env.OUT

const target = process.argv[2] === 'extension' || process.argv[2] === 'local' ? process.argv[2] : 'local'
const only = process.argv.slice(process.argv[2] === 'extension' || process.argv[2] === 'local' ? 3 : 2)

const shots = []
const shot = (name, run, opts) => shots.push({ name, run, opts })

/** Tira o print e confere que a página não deu erro. */
async function snap(app, dir, name) {
  await app.page.waitForTimeout(400)
  await app.page.screenshot({ path: join(OUT ?? dir, `${name}.png`) })
  console.log('  ✓', name)
}

// ---------------------------------------------------------------------------------------------------- roteiros

const filesLayout = { dock: FILES_DOCK }

const tab = (app, name) => app.page.locator('.dock-tab', { hasText: name }).first()
const screenTab = (app, name) => app.page.locator('.screen-tab', { hasText: name })
const T = {
  en: { classic: 'Classic', columns: 'Columns', cherryAll: /Cherry-pick every commit/, resolve: /Resolve side by side/i, compareWith: /Compare with main/, rebase: /Interactive rebase/, clone: /Clone repository/, remotes: /Identity and remotes|Identity & remotes/, notifications: /Notifications/, shake: /Show sample/, panels: 'Panels', saveLayout: /Save current layout/, myLayouts: 'My layouts', versionDiff: 'Version diff', saveBtn: 'Save' },
  'pt-BR': { classic: 'Clássica', columns: 'Colunas', cherryAll: /Cherry-pick de todos os commits/, resolve: /Resolver lado a lado/i, compareWith: /Comparar com main/, rebase: /Rebase interativo/, clone: /Clonar repositório/, remotes: /Identidade e remotes/, notifications: /Notificações/, shake: /Mostrar exemplo/, panels: 'Painéis', saveLayout: /Salvar layout atual/, myLayouts: 'Meus layouts', versionDiff: 'Diff da versão', saveBtn: 'Salvar' }
}
const tx = (app) => T[app.lang]

const commitRow = (app, sha) => app.page.getByText(sha.slice(0, 7)).first()

shot('historico', async (app, dir) => {
  await commitRow(app, app.ids.discount).click()
  await app.page.waitForTimeout(800)
  await snap(app, dir, target === 'local' ? 'historico' : 'hero')
})

shot('arrastar-branch', async (app, dir) => {
  const { page } = app
  await dragHtml5(page, page.locator('.branch-item', { hasText: 'feature/login' }), page.locator('.branch-item', { hasText: 'main' }), { hold: 200 })
  await page.waitForSelector('.modal')
  await snap(app, dir, 'arrastar-branch')
})

async function openStudioLines(app) {
  const { page } = app
  await page.getByRole('button', { name: /Cherry-pick Studio/ }).click()
  await page.waitForTimeout(600)
  await page.locator('.modal nav.tabs button', { hasText: app.t.lines }).click()
  await page.waitForTimeout(500)
  await page.locator('.modal select').last().selectOption('src/ui/Button.tsx')
  await page.waitForTimeout(600)
  // Seleciona só as linhas adicionadas (arrastando sobre elas).
  const added = page.locator('.modal tr.line-add td.code')
  const first = await added.first().boundingBox()
  const last = await added.last().boundingBox()
  await page.mouse.move(first.x + 40, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(last.x + 40, last.y + last.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}

shot('studio-linhas', async (app, dir) => {
  await openStudioLines(app)
  await snap(app, dir, target === 'local' ? 'studio-linhas' : 'studio')
})

/** Repositório sem alterações pendentes, com o cherry-pick de um commit que entra em conflito. */
const conflicted = async (app) => {
  await app.backend.repo.cherryPickCommits('main', [app.ids.memberPrice])
  await app.page.waitForTimeout(1500)
}

shot('conflito', async (app, dir) => {
  await conflicted(app)
  await screenTab(app, app.t.changes).click()
  await app.page.waitForTimeout(900)
  await snap(app, dir, 'conflito')
}, { wip: false })

async function openConflictEditor(app) {
  await conflicted(app)
  await screenTab(app, app.t.changes).click()
  await app.page.waitForTimeout(800)
  await app.page.getByRole('button', { name: tx(app).resolve }).first().click()
  await app.page.waitForSelector('.modal')
  await app.page.waitForTimeout(800)
}

shot('editor-de-conflitos', async (app, dir) => {
  await openConflictEditor(app)
  await snap(app, dir, 'editor-de-conflitos')
}, { wip: false })

shot('editor-de-conflitos-classico', async (app, dir) => {
  await openConflictEditor(app)
  await app.page.locator('.modal button', { hasText: tx(app).classic }).click()
  await app.page.waitForTimeout(700)
  await snap(app, dir, 'editor-de-conflitos-classico')
}, { wip: false })


const settingsOpen = async (app, name) => {
  await app.page.locator('.settings-button').click()
  await app.page.waitForSelector('.modal')
  await app.page.waitForTimeout(400)
  if (name) await app.page.locator('.modal').getByText(name).first().click()
  await app.page.waitForTimeout(600)
}

shot('comparar', async (app, dir) => {
  const { page } = app
  await page.locator('.branch-item', { hasText: 'feature/login' }).click({ button: 'right' })
  await page.locator('.context-menu').getByText(tx(app).compareWith).click()
  await page.waitForTimeout(1200)
  await page.locator('.file-item, .file-row, .dock-slot li').filter({ hasText: 'LoginForm.tsx' }).first().click().catch(() => undefined)
  await page.waitForTimeout(800)
  await snap(app, dir, target === 'local' ? 'comparar' : 'compare')
})

shot('blame', async (app, dir) => {
  const { page } = app
  await screenTab(app, app.t.files).click()
  await page.locator('.file-item', { hasText: 'cart.js' }).click()
  await tab(app, app.t.blame).click()
  await page.waitForTimeout(1200)
  await snap(app, dir, 'blame')
}, { layout: filesLayout })

shot('historico-do-arquivo', async (app, dir) => {
  const { page } = app
  await screenTab(app, app.t.files).click()
  await page.locator('.file-item', { hasText: 'cart.js' }).click()
  await page.waitForTimeout(500)
  await page.locator('.dock-tab[data-view="files.diff"]').click()
  await page.waitForTimeout(1200)
  await snap(app, dir, 'historico-do-arquivo')
}, { layout: filesLayout })

shot('editor-inline', async (app, dir) => {
  const { page } = app
  await screenTab(app, app.t.files).click()
  await page.locator('.file-item', { hasText: 'cart.js' }).click()
  await page.waitForSelector('.editor-area')
  await page.waitForTimeout(900)
  await page.locator('.editor-area').click({ position: { x: 330, y: 8 + 19 * 6 + 9 } })
  await page.waitForTimeout(600)
  await snap(app, dir, 'editor-inline')
}, { layout: filesLayout })

/** Alguns commits seguidos no topo da main (sem merge no meio), para o rebase interativo. */
const addRecent = (dir) => {
  const names = lang === 'pt-BR' ? ['Carrinho: estado vazio', 'wip', 'Carrinho: ajusta estilos', 'Corrige texto do botão'] : ['Cart: empty state', 'wip', 'Cart: tweak styles', 'Fix button label']
  names.forEach((message, i) => {
    writeFileSync(join(dir, 'src/ui/Cart.tsx'), `export function Cart({ items, code }) {\n  // revision ${i + 1}\n  return <ul>{items.map((i) => <li key={i.id}>{i.name}</li>)}</ul>\n}\n`)
    execFileSync('git', ['add', '-A'], { cwd: dir })
    const when = new Date(Date.UTC(2026, 9, 17 + i, 10)).toISOString()
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 'Bruno Lima', GIT_AUTHOR_EMAIL: 'bruno@example.com', GIT_COMMITTER_NAME: 'Bruno Lima', GIT_COMMITTER_EMAIL: 'bruno@example.com', GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } })
  })
}
let lang = 'en'

shot('rebase-interativo', async (app, dir) => {
  const { page } = app
  const log = (await app.backend.repo.log({ limit: 5 })).map((c) => c.sha)
  await commitRow({ page, ids: { x: log[3] } }, log[3]).click({ button: 'right' })
  await page.locator('.context-menu').getByText(tx(app).rebase).first().click()
  await page.waitForSelector('.modal')
  await page.waitForTimeout(900)
  await snap(app, dir, 'rebase-interativo')
}, { wip: false, setup: (dir) => addRecent(dir) })

shot('clonar', async (app, dir) => {
  const { page } = app
  await page.locator('.repo-button').click()
  await page.locator('.context-menu').getByText(tx(app).clone).click()
  await page.waitForSelector('.modal')
  await page.locator('.modal input').first().fill('https://github.com/acme/acme-shop.git')
  await page.waitForTimeout(500)
  await snap(app, dir, 'clonar')
})

shot('remotes', async (app, dir) => {
  await settingsOpen(app, tx(app).remotes)
  await snap(app, dir, 'remotes')
}, { setup: (dir) => { execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/acme-shop.git'], { cwd: dir }); execFileSync('git', ['remote', 'add', 'upstream', 'https://github.com/acme-inc/acme-shop.git'], { cwd: dir }) } })

shot('notificacoes', async (app, dir) => {
  await settingsOpen(app, tx(app).notifications)
  await app.page.getByRole('button', { name: tx(app).shake }).click()
  await app.page.waitForTimeout(600)
  await snap(app, dir, 'notificacoes')
})

shot('configuracoes', async (app, dir) => {
  await settingsOpen(app)
  await snap(app, dir, 'configuracoes')
})

shot('arquivos-lista', async (app, dir) => {
  const { page } = app
  await commitRow(app, app.ids.discount).click()
  await page.waitForTimeout(800)
  await snap(app, dir, 'arquivos-lista')
})

shot('arquivos-arvore', async (app, dir) => {
  const { page } = app
  await commitRow(app, app.ids.discount).click()
  await page.waitForTimeout(600)
  await page.locator('.file-view-toggle button').filter({ hasText: app.lang === 'en' ? 'Tree' : 'Árvore' }).first().click()
  await page.waitForTimeout(600)
  await snap(app, dir, 'arquivos-arvore')
})


const dockTab = (app, view) => app.page.locator(`.dock-tab[data-view="${view}"]`)

/** Arrasta uma aba até um ponto do painel de destino e deixa o destaque à vista antes de soltar. */
async function dragTabTo(app, view, targetGroupBody, fx, fy, { drop = true, hold = 600 } = {}) {
  const { page } = app
  const from = await dockTab(app, view).boundingBox()
  const body = await page.locator(`[data-group="${targetGroupBody}"]`).boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 8 })
  await page.mouse.down()
  await page.mouse.move(body.x + body.width * fx, body.y + body.height * fy, { steps: 22 })
  await page.waitForTimeout(hold)
  return {
    done: async () => {
      if (drop) await page.mouse.up()
      else {
        await page.keyboard.press('Escape')
        await page.mouse.up()
      }
      await page.waitForTimeout(500)
    }
  }
}

shot('layout-arrastar-aba', async (app, dir) => {
  const drag = await dragTabTo(app, 'commit.diff', 'g-main', 0.5, 0.55, { drop: false })
  await snap(app, dir, 'layout-arrastar-aba')
  await drag.done()
}, { viewport: { width: 1440, height: 860 } })

shot('layout-arrastar-painel', async (app, dir) => {
  const drag = await dragTabTo(app, 'commit.diff', 'g-main', 0.93, 0.5, { drop: false })
  await snap(app, dir, 'layout-arrastar-painel')
  await drag.done()
}, { viewport: { width: 1440, height: 860 } })

shot('layout-aba-na-direita', async (app, dir) => {
  const drag = await dragTabTo(app, 'changes.unstaged', 'g-main', 0.95, 0.5)
  await drag.done()
  await screenTab(app, app.t.changes).click()
  await app.page.waitForTimeout(800)
  await snap(app, dir, 'layout-aba-na-direita')
}, { viewport: { width: 1440, height: 860 } })

shot('layouts-salvos', async (app, dir) => {
  const { page } = app
  const drag = await dragTabTo(app, 'changes.unstaged', 'g-main', 0.95, 0.5)
  await drag.done()
  await page.locator('.panels-button').click()
  await page.locator('.context-menu').getByText(tx(app).saveLayout).click()
  await page.locator('.modal input').fill(app.lang === 'en' ? 'Review: history + changes' : 'Revisão: histórico + alterações')
  await page.locator('.modal button.primary').click()
  await page.waitForTimeout(500)
  await page.locator('.panels-button').click()
  await page.locator('.context-menu .menu-parent', { hasText: tx(app).myLayouts }).hover()
  await page.waitForTimeout(500)
  await snap(app, dir, 'layouts-salvos')
})

shot('filtro-branches', async (app, dir) => {
  const { page } = app
  for (const name of ['feature/login', 'hotfix/readme']) await page.locator('.branch-item', { hasText: name }).locator('input.branch-check').check()
  await page.waitForTimeout(1200)
  await snap(app, dir, 'filtro-branches')
})

shot('idioma-arabe-rtl', async (app, dir) => {
  await commitRow(app, app.ids.loginForm).click()
  await app.page.waitForTimeout(800)
  await snap(app, dir, 'idioma-arabe-rtl')
}, { lang: 'ar' })

shot('idioma-chines', async (app, dir) => {
  await commitRow(app, app.ids.loginForm).click()
  await app.page.waitForTimeout(800)
  await snap(app, dir, 'idioma-chines')
}, { lang: 'zh-CN' })

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = target === 'local' ? { lang: 'pt-BR', viewport: { width: 1440, height: 900 }, dir: LOCAL } : { lang: 'en', host: 'vscode', viewport: { width: 1440, height: 856 }, dir: EXT }
  for (const s of shots) {
    if (only.length && !only.includes(s.name)) continue
    console.log(s.name)
    lang = s.opts?.lang ?? config.lang
    const app = await newApp({ ...config, ...s.opts })
    app.lang = lang
    try {
      await s.run(app, config.dir)
    } finally {
      if (app.errors.some((e) => !/404/.test(e))) console.log('  erros:', app.errors.filter((e) => !/404/.test(e)))
      await app.close()
    }
  }
}
