import type { ChunkResolution } from '../../shared/conflicts'

/**
 * Escolhas por trecho que o usuário fez num arquivo em conflito e ainda não salvou. Ficam na memória da janela
 * (não vão para o disco) para sobreviver a trocar de arquivo na tela Conflitos, que remonta o editor.
 *
 * A entrada guarda também o texto do arquivo com os marcadores (`working`) no momento da escolha: as escolhas
 * só valem para esse mesmo texto. Se o arquivo mudou (outra ferramenta, outro comando git), os índices dos trechos
 * já não correspondem e a entrada é descartada.
 */
export interface ConflictDrafts {
  /** Guarda as escolhas do arquivo; sem nenhuma escolha, apaga a entrada. */
  save(path: string, working: string, resolutions: readonly (ChunkResolution | undefined)[]): void
  /** Devolve as escolhas salvas, se o texto atual do arquivo for idêntico ao salvo; senão descarta e devolve `undefined`. */
  take(path: string, working: string): (ChunkResolution | undefined)[] | undefined
  /** Apaga a entrada do arquivo (ele foi salvo ou resolvido e não deve voltar). */
  clear(path: string): void
}

interface Draft {
  working: string
  resolutions: (ChunkResolution | undefined)[]
}

/**
 * Mapa em memória com teto. A ordem de inserção do `Map` é a ordem de uso: `save` reinsere a entrada no fim (a mais
 * recente) e, passado o teto, sai a mais antiga. Sem relógio nem temporizador, para o comportamento não depender do tempo.
 */
export function createConflictDrafts(limit = 50): ConflictDrafts {
  const drafts = new Map<string, Draft>()

  return {
    save(path, working, resolutions) {
      drafts.delete(path)
      // Sem nenhuma escolha (lista vazia ou só `undefined`), não há o que guardar.
      if (resolutions.every((r) => r === undefined)) return
      drafts.set(path, { working, resolutions: resolutions.slice() })
      while (drafts.size > limit) {
        for (const oldest of drafts.keys()) {
          drafts.delete(oldest)
          break
        }
      }
    },
    take(path, working) {
      const draft = drafts.get(path)
      if (!draft) return undefined
      // Texto diferente: o arquivo mudou desde a escolha, então a entrada não serve mais.
      if (draft.working !== working) {
        drafts.delete(path)
        return undefined
      }
      return draft.resolutions.slice()
    },
    clear(path) {
      drafts.delete(path)
    }
  }
}
