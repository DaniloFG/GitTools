// Operações do git que não dependem de um repositório aberto: identidade (user.name/user.email)
// e clonagem.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GitConfigScope, GitIdentities, GitIdentity } from '../shared/types'
import { t } from '../shared/i18n'
import { runGit } from './exec'

async function getConfig(cwd: string, scope: '--global' | '--local' | null, key: string): Promise<string> {
  // Código 1 = chave não definida (não é erro).
  const { stdout } = await runGit(cwd, ['config', ...(scope ? [scope] : []), '--get', key], { okExitCodes: [0, 1] })
  return stdout.trim()
}

async function readIdentity(cwd: string, scope: '--global' | '--local' | null): Promise<GitIdentity> {
  const [name, email] = await Promise.all([getConfig(cwd, scope, 'user.name'), getConfig(cwd, scope, 'user.email')])
  return { name, email }
}

/**
 * Identidade global e a do repositório. `home` é qualquer pasta fora de repositórios (para ler o
 * global sem depender de onde o aplicativo foi aberto).
 */
export async function getIdentities(home: string, repoRoot: string | null): Promise<GitIdentities> {
  const global = await readIdentity(home, '--global')
  if (!repoRoot) return { global, local: null, effective: null }
  const [local, effective] = await Promise.all([readIdentity(repoRoot, '--local'), readIdentity(repoRoot, null)])
  return { global, local, effective }
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+$/

/** Grava (ou apaga, com texto vazio) user.name e user.email no escopo escolhido. */
export async function setIdentity(home: string, repoRoot: string | null, scope: GitConfigScope, identity: GitIdentity): Promise<void> {
  if (scope === 'local' && !repoRoot) throw new Error(t('main.noRepository'))
  const name = identity.name.trim()
  const email = identity.email.trim()
  if (email && !EMAIL.test(email)) throw new Error(t('identity.invalidEmail', { email }))
  const cwd = scope === 'local' ? repoRoot! : home
  const flag = scope === 'local' ? '--local' : '--global'
  for (const [key, value] of [
    ['user.name', name],
    ['user.email', email]
  ] as const) {
    // Código 5 ao apagar = a chave já não existia.
    if (value) await runGit(cwd, ['config', flag, key, value])
    else await runGit(cwd, ['config', flag, '--unset', key], { okExitCodes: [0, 5] })
  }
}

/** Nome de pasta sugerido a partir da URL (ex.: "https://x/org/projeto.git" → "projeto"). */
export function repoNameFromUrl(url: string): string {
  const clean = url.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '')
  const last = clean.split(/[\\/:]/).pop() ?? ''
  return last.replace(/[^\w.-]/g, '') || 'repo'
}

/** Clona `url` em `parent/name` e devolve o caminho da pasta criada. */
export async function cloneRepository(url: string, parent: string, name: string): Promise<string> {
  const source = url.trim()
  const folder = name.trim()
  if (!source) throw new Error(t('clone.urlRequired'))
  if (!folder || /[\\/]/.test(folder) || folder === '.' || folder === '..') throw new Error(t('clone.invalidName', { name: folder }))
  const target = join(parent, folder)
  if (existsSync(target)) throw new Error(t('clone.targetExists', { path: target }))
  // "--" impede que uma URL começando com "-" seja lida como opção.
  await runGit(parent, ['clone', '--progress', '--', source, folder])
  return target
}
