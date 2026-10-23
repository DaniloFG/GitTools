import { launch } from './harness.mjs'
const out = process.argv[2]
const app = await launch({ repo: process.env.BIG, language: 'en', host: 'electron', viewport: { width: 1600, height: 1000 } })
const { page } = app
const log = (...a) => console.log(...a)
await page.waitForTimeout(1000)
await page.locator('.dashboards-tab').click()
await page.waitForSelector('.dash-grid')
await page.waitForTimeout(1200)

// tooltip na área de commits
const area = page.locator('[data-widget="commits-over-time"] svg rect[fill="transparent"]').first()
const box = await area.boundingBox()
await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5, { steps: 8 })
await page.waitForTimeout(300)
log('tooltip área:', await page.locator('.chart-tip').innerText().catch(() => '(nenhum)'))
await page.screenshot({ path: `${out}/i-tooltip.png` })

// trocar o tipo de gráfico e ver a tabela
await page.locator('[data-widget="commits-over-time"] .dash-views button').nth(2).click()
await page.waitForTimeout(400)
log('views ok; barras:', await page.locator('[data-widget="commits-over-time"] path[fill]').count())
await page.locator('[data-widget="commits-over-time"] .dash-views button').last().click()
await page.waitForTimeout(300)
log('tabela linhas:', await page.locator('[data-widget="commits-over-time"] tbody tr').count())
await page.locator('[data-widget="commits-over-time"] .dash-views button').last().click()

// filtros: período 30 dias e uma pessoa
await page.getByRole('button', { name: '30 days' }).click()
await page.waitForTimeout(500)
log('resumo 30d:', await page.locator('.dash-summary').innerText())
await page.locator('.dash-people > button').click()
await page.locator('.dash-popover li').first().locator('input').check()
await page.waitForTimeout(500)
log('resumo pessoa:', await page.locator('.dash-summary').innerText())
await page.screenshot({ path: `${out}/i-filtros.png` })
await page.keyboard.press('Escape')
await page.getByRole('button', { name: 'Clear filters' }).click()

// galeria: adicionar widgets
await page.getByRole('button', { name: /Add chart/ }).click()
await page.waitForSelector('.dash-gallery')
log('itens na galeria:', await page.locator('.dash-gallery-item').count())
await page.locator('.dash-gallery-item', { hasText: 'Bus factor' }).click()
await page.locator('.dash-gallery-item', { hasText: 'Risk hotspots' }).click()
await page.screenshot({ path: `${out}/i-galeria.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
log('cards agora:', await page.locator('.dash-card').count())

// dashboard personalizado
await page.locator('.dash-tab.add').click()
await page.locator('.modal input').fill('Weekly review')
await page.locator('.modal button.primary').click()
await page.waitForTimeout(400)
log('custom vazio:', await page.locator('.dash-loading').innerText())
await page.getByRole('button', { name: /Add chart/ }).last().click()
await page.locator('.dash-gallery-item', { hasText: 'Commit types' }).click()
await page.locator('.dash-gallery-item', { hasText: 'Activity calendar' }).click()
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
log('custom cards:', await page.locator('.dash-card').count())
await page.screenshot({ path: `${out}/i-custom.png` })

// voltar para os painéis normais
await page.locator('.screen-tab', { hasText: 'History' }).click()
await page.waitForTimeout(500)
log('dock visível:', await page.locator('.dock').isVisible(), '| dashboards presente:', await page.locator('.dashboards').count())
await page.keyboard.press('Control+5')
await page.waitForTimeout(500)
log('Ctrl+5 abre dashboards:', await page.locator('.dashboards').count())
log('erros:', app.errors.filter((e) => !/404/.test(e)))
await app.close()
