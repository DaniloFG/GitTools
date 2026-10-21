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
    expect(resolveEditor('vscode')).toEqual({ command: script, args: [] })
    expect(resolveEditor(script)).toEqual({ command: script, args: [] })
    expect(resolveEditor('editor-que-nao-existe')).toBeNull()

    await launchEditor(script, join(dir, 'arquivo.ts'), dir)
    for (let i = 0; i < 50 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 20))
    expect(readFileSync(marker, 'utf8').trim()).toBe(join(dir, 'arquivo.ts'))
  })
})

describe('linha de comando do editor', () => {
  it('separa programa e argumentos, respeitando aspas', async () => {
    const { splitCommandLine } = await import('../src/main/editors')
    expect(splitCommandLine('code --reuse-window')).toEqual(['code', '--reuse-window'])
    expect(splitCommandLine('"C:\\Program Files\\Ed\\ed.exe" -n')).toEqual(['C:\\Program Files\\Ed\\ed.exe', '-n'])
    expect(splitCommandLine("  'meu editor'  ")).toEqual(['meu editor'])
    expect(splitCommandLine('')).toEqual([])
  })

  it('remove variáveis do Electron que impedem editores Electron de abrir', async () => {
    const { editorEnvironment } = await import('../src/main/editors')
    const env = editorEnvironment({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1', VSCODE_PID: '9', HOME: '/h' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' })
  })
})

describe.skipIf(process.platform === 'win32')('editor digitado à mão', () => {
  it('aceita caminho com argumentos e informa quando o editor falha ao abrir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gittools-editor-'))
    dirs.push(dir)
    const marker = join(dir, 'args.txt')
    const script = join(dir, 'meu editor')
    writeFileSync(script, `#!/bin/sh\necho "$@" > "${marker}"\n`)
    chmodSync(script, 0o755)
    const resolved = resolveEditor(`"${script}" --novo`)
    expect(resolved).toEqual({ command: script, args: ['--novo'] })
    // Caminho com espaço, sem aspas, também é aceito.
    expect(resolveEditor(script)).toEqual({ command: script, args: [] })
    await launchEditor(resolved!, join(dir, 'x.ts'), dir)
    for (let i = 0; i < 50 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 20))
    expect(readFileSync(marker, 'utf8').trim()).toBe(`--novo ${join(dir, 'x.ts')}`)

    const broken = join(dir, 'quebrado')
    writeFileSync(broken, '#!/bin/sh\necho "não abriu" >&2\nexit 3\n')
    chmodSync(broken, 0o755)
    await expect(launchEditor({ command: broken, args: [] }, dir, dir)).rejects.toThrow('não abriu')
  })
})
