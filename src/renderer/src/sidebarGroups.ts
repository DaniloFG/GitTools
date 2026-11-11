// Agrupamento das branches do painel lateral: locais de um lado, remotas por remoto. Sem React: a tela só desenha.

import type { BranchInfo } from '../../shared/types'

/**
 * Separa as branches locais das remotas numa passagem só.
 *
 * A versão anterior copiava a lista do remoto (`[...lista, b]`) a cada branch: com 1.100 refs isso custava
 * quadrático. Aqui cada branch entra com um `push` na lista do seu remoto. A ordem é a original: `local` mantém
 * a ordem das branches locais; os remotos aparecem na ordem da primeira branch de cada um, e a lista de cada
 * remoto mantém a ordem original.
 */
export function groupBranches(branches: readonly BranchInfo[]): { local: BranchInfo[]; remotes: [string, BranchInfo[]][] } {
  const local: BranchInfo[] = []
  const byRemote = new Map<string, BranchInfo[]>()
  for (const b of branches) {
    if (!b.remote) {
      local.push(b)
      continue
    }
    let list = byRemote.get(b.remote)
    if (!list) {
      list = []
      byRemote.set(b.remote, list)
    }
    list.push(b)
  }
  return { local, remotes: [...byRemote] }
}
