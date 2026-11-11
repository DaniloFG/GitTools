// Cache do resultado de `analytics` (dashboards), por repositório e escopo.
//
// Por que: `analytics({ scope: 'all' })` custa cerca de 3 s num repositório de 20 mil commits, quase tudo no
// `git log --numstat`. O resultado só muda quando as refs ou o HEAD mudam (o índice e a pasta de trabalho não entram), e a chave
// `analyticsKey` diz isso com um único processo. Assim o aplicativo não relê o histórico após cada reinício nem
// após cada invalidação do cache da interface, se a história não mudou.
//
// Camadas, da mais rápida para a mais lenta:
//  - memória: as últimas `MEMORY_LIMIT` entradas, com a mesma chave → 1 processo git (só a chave);
//  - disco: um arquivo por repositório e escopo, com a chave dentro; lido só quando a chave bate;
//  - cálculo: `analytics` de verdade, com a chave antes e depois. Só é guardado se a chave não mudou no meio
//    (o repositório pode ter mudado durante o `git log`; guardar isso sob a chave antiga serviria dado errado
//    se as refs voltassem àquele estado exato).
//
// Regras:
//  - arquivo ruim no disco (corrompido, de outra versão, de outro repositório) é só um erro de leitura: vira
//    miss e é regravado; nunca lança para quem pediu;
//  - chamadas iguais ao mesmo tempo compartilham um único cálculo;
//  - a gravação em disco não atrasa a resposta: é feita em segundo plano, por arquivo temporário e `rename`
//    (atômica), e erros são ignorados;
//  - a pasta guarda no máximo `DISK_LIMIT` arquivos; os mais antigos (por mtime) saem.
//
// Não é síncrono em lugar nenhum: tudo passa por node:fs/promises.

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitRepository } from '../core/repository'
import { encodeAnalytics, isAnalyticsWire, type AnalyticsWire } from '../shared/analyticsWire'
import type { AnalyticsOptions } from '../shared/types'

/** Quantas entradas ficam na memória. Pouco de propósito: cada uma é um resultado de vários MB. */
const MEMORY_LIMIT = 4
/** Quantos arquivos ficam na pasta do cache em disco. */
const DISK_LIMIT = 16

interface Stored {
  key: string
  wire: AnalyticsWire
}

type Scope = 'all' | 'head'

const scopeOf = (options: AnalyticsOptions): Scope => (options.scope === 'head' ? 'head' : 'all')

export class AnalyticsCache {
  /** Ordem de inserção = ordem de uso: a primeira é a menos usada recentemente. */
  private readonly memory = new Map<string, Stored>()
  /** Cálculos em andamento, pela identidade (repositório + escopo + chave). */
  private readonly inflight = new Map<string, Promise<AnalyticsWire>>()
  /** Gravações em disco ainda não terminadas (os testes esperam por elas com `flush`). */
  private readonly writes = new Set<Promise<void>>()

  /** A pasta é pedida a cada uso: o diretório de dados pode ser definido depois que o cache existe. */
  constructor(private readonly dir: () => string) {}

  /** Resultado de `repo.analytics(options)` no formato colunar, vindo do cache quando a chave ainda vale. */
  async get(repo: GitRepository, options: AnalyticsOptions): Promise<AnalyticsWire> {
    const scope = scopeOf(options)
    const slot = `${repo.root}\n${scope}`
    const { key, hasHead } = await repo.analyticsKey(options)
    const id = `${slot}\n${key}`

    const hit = this.memory.get(slot)
    if (hit && hit.key === key) {
      // Usada agora: vai para o fim da fila de saída.
      this.memory.delete(slot)
      this.memory.set(slot, hit)
      return hit.wire
    }

    // Outro chamador já está calculando esta mesma chave: espera por ele em vez de repetir o `git log`.
    const running = this.inflight.get(id)
    if (running) return running

    const fromDisk = await this.readDisk(repo.root, scope, key)
    if (fromDisk) {
      this.remember(slot, key, fromDisk)
      return fromDisk
    }

    // Repetido: durante a leitura do disco, outro chamador pode ter começado o cálculo.
    const again = this.inflight.get(id)
    if (again) return again

    // Sem `await` antes do registro: o próximo chamador já vê este cálculo na lista.
    const computing = this.compute(repo, options, { slot, key, hasHead, scope })
    this.inflight.set(id, computing)
    // Quem chamou recebe o erro pelo `computing`; aqui só limpa a lista, tendo ou não dado certo.
    const clear = () => {
      if (this.inflight.get(id) === computing) this.inflight.delete(id)
    }
    computing.then(clear, clear)
    return computing
  }

  /** Espera as gravações em disco em andamento (para os testes e para a medição). */
  async flush(): Promise<void> {
    while (this.writes.size > 0) await Promise.all([...this.writes])
  }

  private async compute(
    repo: GitRepository,
    options: AnalyticsOptions,
    at: { slot: string; key: string; hasHead: boolean; scope: Scope }
  ): Promise<AnalyticsWire> {
    const wire = encodeAnalytics(await repo.analytics(options, { hasHead: at.hasHead }))
    // Se as refs mudaram durante o `git log`, o resultado pode misturar dois estados: entrega, mas não guarda.
    const after = await repo.analyticsKey(options)
    if (after.key === at.key) {
      this.remember(at.slot, at.key, wire)
      this.persist(repo.root, at.scope, at.key, wire)
    }
    return wire
  }

  private remember(slot: string, key: string, wire: AnalyticsWire): void {
    this.memory.delete(slot)
    this.memory.set(slot, { key, wire })
    while (this.memory.size > MEMORY_LIMIT) {
      const oldest = this.memory.keys().next().value
      if (oldest === undefined) break
      this.memory.delete(oldest)
    }
  }

  /** Arquivo do repositório e escopo. O hash do caminho deixa o nome curto e sem caracteres estranhos. */
  private fileName(root: string, scope: Scope): string {
    return `${createHash('sha1').update(root).digest('hex')}-${scope}.json`
  }

  /** Lê o disco. Qualquer problema (sem arquivo, JSON ruim, chave ou raiz diferente) vira `null`: miss. */
  private async readDisk(root: string, scope: Scope, key: string): Promise<AnalyticsWire | null> {
    try {
      const file = join(this.dir(), this.fileName(root, scope))
      const parsed = JSON.parse(await readFile(file, 'utf8')) as { key?: unknown; root?: unknown; wire?: unknown }
      if (parsed.key !== key || parsed.root !== root || !isAnalyticsWire(parsed.wire)) return null
      return parsed.wire
    } catch {
      return null
    }
  }

  /** Grava em segundo plano: quem pediu não espera pelo disco. */
  private persist(root: string, scope: Scope, key: string, wire: AnalyticsWire): void {
    const job = this.writeDisk(root, scope, key, wire).catch(() => undefined)
    this.writes.add(job)
    void job.then(() => this.writes.delete(job))
  }

  private async writeDisk(root: string, scope: Scope, key: string, wire: AnalyticsWire): Promise<void> {
    const dir = this.dir()
    await mkdir(dir, { recursive: true })
    const file = join(dir, this.fileName(root, scope))
    // Temporário na mesma pasta (o rename só é atômico no mesmo volume) e com outra extensão, para a poda não contá-lo.
    const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await writeFile(temp, JSON.stringify({ key, root, wire }))
      await rename(temp, file)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
    await this.prune(dir)
  }

  /** Mantém só os `DISK_LIMIT` arquivos mais recentes da pasta. Erros são ignorados: a poda é só limpeza. */
  private async prune(dir: string): Promise<void> {
    try {
      const names = (await readdir(dir)).filter((name) => name.endsWith('.json'))
      if (names.length <= DISK_LIMIT) return
      // Um arquivo por vez: a poda roda em segundo plano e não deve disputar o disco com o `git log`.
      const entries: { path: string; mtime: number }[] = []
      for (const name of names) {
        const path = join(dir, name)
        const mtime = await stat(path).then((s) => s.mtimeMs, () => -Infinity)
        entries.push({ path, mtime })
      }
      entries.sort((a, b) => b.mtime - a.mtime)
      for (const old of entries.slice(DISK_LIMIT)) await rm(old.path, { force: true }).catch(() => undefined)
    } catch {
      // Sem poda, a pasta só cresce até o próximo ciclo.
    }
  }
}
