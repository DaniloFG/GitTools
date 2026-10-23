// Utilidades dos roteiros de captura.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDemoRepo } from './demo-repo.mjs'
import { launch } from './harness.mjs'

/** Textos da interface usados pelos roteiros, por idioma. */
export const TEXT = {
  en: {
    studio: /Cherry-pick Studio/,
    lines: 'Lines',
    files: 'Files',
    history: 'History',
    changes: 'Changes',
    compare: 'Compare',
    blame: 'Blame',
    editor: 'Editor'
  },
  'pt-BR': {
    studio: /Cherry-pick Studio/,
    lines: 'Linhas',
    files: 'Arquivos',
    history: 'Histórico',
    changes: 'Alterações',
    compare: 'Comparar',
    blame: 'Blame',
    editor: 'Editor'
  }
}

export async function newApp({ lang = 'en', host = 'electron', viewport, wip = true, video, layout, settings, repoName = 'acme-shop', setup } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'media-'))
  const dir = join(base, repoName)
  const ids = createDemoRepo(dir, lang === 'pt-BR' ? 'pt' : 'en', { wip })
  setup?.(dir)
  const app = await launch({ repo: dir, host, language: lang, viewport, video, layout, settings })
  await app.page.waitForTimeout(1200)
  return { ...app, dir, ids, t: TEXT[lang] ?? TEXT.en }
}

/** Move o mouse até o centro do elemento, aos poucos (para o vídeo mostrar o caminho). */
export async function glide(page, locator, { steps = 18, dx = 0, dy = 0 } = {}) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('elemento sem caixa: ' + locator)
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps })
}

export async function clickSlow(page, locator, pause = 350) {
  await glide(page, locator)
  await page.waitForTimeout(120)
  await locator.click()
  await page.waitForTimeout(pause)
}

/** Arrasta um item HTML5 (branch, commit) para outro, aos poucos. */
export async function dragHtml5(page, from, to, { hold = 400 } = {}) {
  await glide(page, from, { steps: 12 })
  await page.mouse.down()
  const box = await to.boundingBox()
  await page.mouse.move(box.x + box.width / 2 - 6, box.y + box.height / 2 - 6, { steps: 6 })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 })
  await page.waitForTimeout(hold)
  await page.mouse.up()
}

/** Converte a gravação do Playwright (webm) num GIF leve de 800 px de largura. */
export function toGif(webm, gif, { fps = 10, colors = 96, width = 800, start = 0, trimEnd = 0 } = {}) {
  const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${colors}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
  const args = ['-y', '-loglevel', 'error', ...(start ? ['-ss', String(start)] : []), '-i', webm, ...(trimEnd ? ['-t', String(trimEnd)] : []), '-vf', filter, '-loop', '0', gif]
  execFileSync('ffmpeg', args, { stdio: 'inherit' })
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

export const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix))
