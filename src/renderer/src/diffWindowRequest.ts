import type { DiffWindowRequest } from '../../shared/api'

/**
 * Lê o pedido que a janela principal passou na URL de uma janela de diff.
 * Fica fora de `components/DiffWindow.tsx` de propósito: o `main.tsx` precisa dele logo no início, e um import
 * estático daquele arquivo manteria a janela de diff inteira no pacote inicial (ver `lazyScreens.ts`).
 */
export function diffWindowRequest(search: string): DiffWindowRequest | null {
  const params = new URLSearchParams(search)
  if (params.get('window') !== 'diff') return null
  try {
    const request = JSON.parse(params.get('request') ?? '') as DiffWindowRequest
    return request && typeof request.path === 'string' && request.source ? request : null
  } catch {
    return null
  }
}
