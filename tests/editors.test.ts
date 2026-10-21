import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectEditors, launchEditor, resolveEditor } from '../src/main/editors'

const PATH = process.env.PATH
const dirs: string[] = []
afterEach(() => {
  process.env.PATH = PATH
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('editores instalados', () => {
  it('encontra o editor no PATH, resolve pela configuração e abre o arquivo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gittools-editor-'))
    dirs.push(dir)
    const marker = join(dir, 'aberto.txt')
    const script = join(dir, 'code')
    writeFileSync(script, `#!/bin/sh\necho "$1" > "${marker}"\n`)
    chmodSync(script, 0o755)
    process.env.PATH = dir

    expect(detectEditors()).toContainEqual({ id: 'vscode', name: 'Visual Studio Code', command: script })
    expect(resolveEditor('vscode')).toBe(script)
    expect(resolveEditor(script)).toBe(script)
    expect(resolveEditor('editor-que-nao-existe')).toBeNull()

    await launchEditor(script, join(dir, 'arquivo.ts'), dir)
    for (let i = 0; i < 50 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 20))
    expect(readFileSync(marker, 'utf8').trim()).toBe(join(dir, 'arquivo.ts'))
  })
})
