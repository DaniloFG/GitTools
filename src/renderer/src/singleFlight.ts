/**
 * Marca devolvida quando uma chamada entra enquanto outra execução ainda está ativa: a função nem é chamada.
 * Um símbolo, e não `undefined`, porque uma operação pode legitimamente devolver `undefined`.
 */
export const SKIPPED: unique symbol = Symbol('skipped')

export interface SingleFlightOptions {
  /**
   * Com `true`, a chamada não é descartada: espera a execução ativa (com ou sem fila) e as já enfileiradas
   * terminarem, nesta ordem, e então executa. Usada para ações que não podem se perder (um stage seguido de outro),
   * não para clique duplo.
   */
  queue?: boolean
}

export interface SingleFlight {
  /**
   * Sem `queue`: executa `fn` se nenhuma execução estiver ativa; senão devolve `SKIPPED` sem chamá-la. Com `queue`:
   * espera a fila e executa `fn`. O erro de `fn` sai para quem chamou e não trava a fila. A execução só é liberada
   * quando `fn` termina, com sucesso, com erro ou lançando na hora.
   * Não chame `run` de dentro do callback de outro `run`: sem `queue`, a chamada interna é ignorada em silêncio;
   * com `queue`, trava (a interna espera a externa, que espera a interna).
   */
  run<T>(fn: () => Promise<T>, options?: SingleFlightOptions): Promise<T | typeof SKIPPED>
  /** Há uma execução em andamento, ou alguma esperando na fila. */
  readonly active: boolean
}

/**
 * Bloqueio de uma execução por vez, para ações assíncronas que não podem ser disparadas duas vezes (clique duplo
 * em Commit, Enviar ou Aplicar). A marca é trocada de forma síncrona, antes de qualquer `await`, então duas chamadas
 * no mesmo tick também não passam as duas.
 */
export function createSingleFlight(): SingleFlight {
  /** Execuções ativas ou esperando na fila: enquanto for maior que zero, a entrada sem fila fica fechada. */
  let pending = 0
  /**
   * Liberação da última execução que entrou (com ou sem fila). Cada uma espera a anterior, então a ordem de entrada
   * é a ordem de execução, e uma chamada com fila espera também a execução ativa sem fila. A promessa nunca rejeita:
   * o erro de `fn` não passa por ela.
   */
  let tail: Promise<void> = Promise.resolve()
  return {
    get active() {
      return pending > 0
    },
    async run<T>(fn: () => Promise<T>, options?: SingleFlightOptions): Promise<T | typeof SKIPPED> {
      if (!options?.queue && pending > 0) return SKIPPED
      // Sem nada ativo, a anterior já foi liberada: não há o que esperar, e `fn` começa na mesma chamada.
      const ahead = pending > 0 ? tail : null
      pending++
      let release!: () => void
      tail = new Promise<void>((resolve) => {
        release = resolve
      })
      try {
        if (ahead) await ahead
        // `await` dentro do `try`: a liberação espera a operação terminar, não só o início dela.
        return await fn()
      } finally {
        pending--
        release()
      }
    },
  }
}
