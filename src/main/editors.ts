// Editores de código instalados no computador, para o "Abrir no editor".
// Procura cada editor conhecido no PATH e nas pastas de instalação comuns de cada sistema.

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { EditorInfo } from '../shared/api'

interface Candidate {
  id: string
  name: string
  /** Comandos procurados no PATH. */
  commands: string[]
  /** Caminhos completos onde o editor costuma ser instalado (variáveis de ambiente como %LOCALAPPDATA%). */
  paths?: Partial<Record<NodeJS.Platform, string[]>>
}

const CANDIDATES: Candidate[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    commands: ['code'],
    paths: {
      win32: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code.cmd', '%ProgramFiles%\\Microsoft VS Code\\bin\\code.cmd'],
      darwin: ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
      linux: ['/usr/share/code/bin/code', '/snap/bin/code']
    }
  },
  {
    id: 'vscode-insiders',
    name: 'Visual Studio Code Insiders',
    commands: ['code-insiders'],
    paths: {
      win32: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\bin\\code-insiders.cmd'],
      darwin: ['/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code']
    }
  },
  {
    id: 'vscodium',
    name: 'VSCodium',
    commands: ['codium'],
    paths: {
      win32: ['%LOCALAPPDATA%\\Programs\\VSCodium\\bin\\codium.cmd', '%ProgramFiles%\\VSCodium\\bin\\codium.cmd'],
      darwin: ['/Applications/VSCodium.app/Contents/Resources/app/bin/codium']
    }
  },
  {
    id: 'cursor',
    name: 'Cursor',
    commands: ['cursor'],
    paths: {
      win32: ['%LOCALAPPDATA%\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd', '%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe'],
      darwin: ['/Applications/Cursor.app/Contents/Resources/app/bin/cursor']
    }
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    commands: ['windsurf'],
    paths: {
      win32: ['%LOCALAPPDATA%\\Programs\\Windsurf\\bin\\windsurf.cmd'],
      darwin: ['/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf']
    }
  },
  {
    id: 'zed',
    name: 'Zed',
    commands: ['zed', 'zeditor'],
    paths: { win32: ['%LOCALAPPDATA%\\Programs\\Zed\\Zed.exe'], darwin: ['/Applications/Zed.app/Contents/MacOS/cli'] }
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    commands: ['subl'],
    paths: {
      win32: ['%ProgramFiles%\\Sublime Text\\subl.exe', '%ProgramFiles%\\Sublime Text 3\\subl.exe'],
      darwin: ['/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl']
    }
  },
  {
    id: 'notepadpp',
    name: 'Notepad++',
    commands: ['notepad++'],
    paths: { win32: ['%ProgramFiles%\\Notepad++\\notepad++.exe', '%ProgramFiles(x86)%\\Notepad++\\notepad++.exe'] }
  },
  {
    id: 'idea',
    name: 'IntelliJ IDEA',
    commands: ['idea', 'idea64.exe'],
    paths: { darwin: ['/Applications/IntelliJ IDEA.app/Contents/MacOS/idea', '/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea'] }
  },
  { id: 'webstorm', name: 'WebStorm', commands: ['webstorm', 'webstorm64.exe'], paths: { darwin: ['/Applications/WebStorm.app/Contents/MacOS/webstorm'] } },
  { id: 'pycharm', name: 'PyCharm', commands: ['pycharm', 'pycharm64.exe'], paths: { darwin: ['/Applications/PyCharm.app/Contents/MacOS/pycharm'] } },
  { id: 'rider', name: 'Rider', commands: ['rider', 'rider64.exe'], paths: { darwin: ['/Applications/Rider.app/Contents/MacOS/rider'] } },
  { id: 'fleet', name: 'Fleet', commands: ['fleet'] },
  { id: 'pulsar', name: 'Pulsar', commands: ['pulsar'] },
  { id: 'atom', name: 'Atom', commands: ['atom'] },
  { id: 'textmate', name: 'TextMate', commands: ['mate'] },
  { id: 'bbedit', name: 'BBEdit', commands: ['bbedit'] },
  { id: 'kate', name: 'Kate', commands: ['kate'] },
  { id: 'gnome-text-editor', name: 'GNOME Text Editor', commands: ['gnome-text-editor'] },
  { id: 'gedit', name: 'gedit', commands: ['gedit'] },
  { id: 'mousepad', name: 'Mousepad', commands: ['mousepad'] },
  { id: 'gvim', name: 'gVim', commands: ['gvim'] },
  { id: 'emacs', name: 'Emacs', commands: ['emacs'] }
]

/** Pastas extras onde programas costumam ficar mas que nem sempre estão no PATH de apps gráficos. */
const EXTRA_DIRS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['/usr/local/bin', '/opt/homebrew/bin'],
  linux: ['/usr/local/bin', '/usr/bin', '/snap/bin', '/var/lib/flatpak/exports/bin']
}

const expand = (path: string) => path.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? '')

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

/** Caminho completo de um comando no PATH (com as extensões do Windows), ou null. */
function which(command: string): string | null {
  if (isAbsolute(command)) return isFile(command) ? command : null
  const dirs = [...(process.env.PATH ?? '').split(delimiter), ...(EXTRA_DIRS[process.platform] ?? [])].filter(Boolean)
  const exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())] : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = join(dir, command + ext)
      if (isFile(full)) return full
    }
  }
  return null
}

/** Editores encontrados neste computador. */
export function detectEditors(): EditorInfo[] {
  const found: EditorInfo[] = []
  for (const candidate of CANDIDATES) {
    const fromPath = candidate.commands.map(which).find(Boolean)
    const installed = (candidate.paths?.[process.platform] ?? []).map(expand).find(isFile)
    const command = fromPath ?? installed
    if (command) found.push({ id: candidate.id, name: candidate.name, command })
  }
  return found
}

/** Resolve a configuração (id de editor detectado ou caminho de um executável) para o executável. */
export function resolveEditor(setting: string): string | null {
  if (!setting) return null
  const detected = detectEditors().find((e) => e.id === setting)
  if (detected) return detected.command
  return which(setting)
}

/** Abre `target` (arquivo ou pasta) no editor, sem esperar o editor fechar. */
export function launchEditor(command: string, target: string, cwd: string): Promise<void> {
  // Scripts .cmd/.bat do Windows (ex.: code.cmd) só rodam pelo shell; aí os argumentos vão entre aspas.
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`
  return new Promise((resolve, reject) => {
    const child = viaShell
      ? spawn(quote(command), [quote(target)], { cwd, detached: true, stdio: 'ignore', shell: true, windowsHide: true })
      : spawn(command, [target], { cwd, detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
