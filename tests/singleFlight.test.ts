import { describe, expect, it } from 'vitest'
import { SKIPPED, createSingleFlight } from '../src/renderer/src/singleFlight'

/** Promessa que só resolve quando o teste mandar: simula uma operação em andamento. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Deixa rodar as continuações pendentes (esperas em cadeia), sem depender de tempo real. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('bloqueio contra execução dupla (singleFlight)', () => {
  it('segunda chamada durante a primeira não chama fn e devolve SKIPPED', async () => {
    const flight = createSingleFlight()
    const first = deferred<string>()
    const firstRun = flight.run(() => first.promise)

    let secondCalled = false
    const second = await flight.run(async () => {
      secondCalled = true
      return 'outra'
    })

    expect(secondCalled).toBe(false)
    expect(second).toBe(SKIPPED)

    first.resolve('primeira')
    await expect(firstRun).resolves.toBe('primeira')
  })

  it('libera depois de sucesso: a chamada seguinte executa', async () => {
    const flight = createSingleFlight()
    await expect(flight.run(async () => 1)).resolves.toBe(1)
    await expect(flight.run(async () => 2)).resolves.toBe(2)
  })

  it('libera depois de rejeição: o erro sai para quem chamou e a chamada seguinte executa', async () => {
    const flight = createSingleFlight()
    const error = new Error('falhou')
    await expect(flight.run(() => Promise.reject(error))).rejects.toBe(error)
    expect(flight.active).toBe(false)
    await expect(flight.run(async () => 'depois')).resolves.toBe('depois')
  })

  it('fn síncrono que lança libera a execução', async () => {
    const flight = createSingleFlight()
    const error = new Error('lançou na hora')
    const failing = (): Promise<never> => {
      throw error
    }
    await expect(flight.run(failing)).rejects.toBe(error)
    expect(flight.active).toBe(false)
    await expect(flight.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('active reflete o estado: falso antes, verdadeiro durante, falso depois', async () => {
    const flight = createSingleFlight()
    expect(flight.active).toBe(false)
    const work = deferred<void>()
    const running = flight.run(() => work.promise)
    expect(flight.active).toBe(true)
    work.resolve()
    await running
    expect(flight.active).toBe(false)
  })

  it('duas chamadas no mesmo tick: a segunda é ignorada e só a primeira executa', async () => {
    const flight = createSingleFlight()
    let secondCalled = false
    const first = flight.run(async () => 'a')
    const second = flight.run(async () => {
      secondCalled = true
      return 'b'
    })

    expect(await second).toBe(SKIPPED)
    expect(await first).toBe('a')
    expect(secondCalled).toBe(false)
  })
})

describe('fila (queue: true) no singleFlight', () => {
  it('três chamadas enfileiradas executam em ordem, mesmo com a última terminando primeiro', async () => {
    const flight = createSingleFlight()
    const order: number[] = []
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
    const calls = [1, 2, 3].map((n, i) =>
      flight.run(
        async () => {
          order.push(n)
          await gates[i].promise
          return n
        },
        { queue: true }
      )
    )

    await flush()
    // Só a primeira começa; as outras esperam a anterior terminar.
    expect(order).toEqual([1])

    gates[0].resolve()
    await flush()
    expect(order).toEqual([1, 2])

    // A terceira termina antes da segunda: a ordem de execução continua a mesma.
    gates[2].resolve()
    gates[1].resolve()
    await flush()
    expect(order).toEqual([1, 2, 3])

    await expect(Promise.all(calls)).resolves.toEqual([1, 2, 3])
    expect(flight.active).toBe(false)
  })

  it('erro de uma chamada enfileirada não impede a seguinte: o erro sai só para quem chamou', async () => {
    const flight = createSingleFlight()
    const error = new Error('primeira falhou')
    const failing = flight.run(() => Promise.reject(error), { queue: true })
    const following = flight.run(async () => 'segunda', { queue: true })

    await expect(failing).rejects.toBe(error)
    await expect(following).resolves.toBe('segunda')
    expect(flight.active).toBe(false)
  })

  it('erro síncrono de uma chamada enfileirada também não impede a seguinte', async () => {
    const flight = createSingleFlight()
    const error = new Error('lançou na hora')
    const failing = flight.run((): Promise<never> => {
      throw error
    }, { queue: true })
    const following = flight.run(async () => 'depois', { queue: true })

    await expect(failing).rejects.toBe(error)
    await expect(following).resolves.toBe('depois')
  })

  it('chamada sem fila durante fila ativa continua SKIPPED e não executa fn', async () => {
    const flight = createSingleFlight()
    const work = deferred<void>()
    const queued = flight.run(() => work.promise, { queue: true })
    const queuedNext = flight.run(async () => 'na fila', { queue: true })

    let directCalled = false
    const direct = await flight.run(async () => {
      directCalled = true
      return 'direta'
    })

    expect(direct).toBe(SKIPPED)
    expect(directCalled).toBe(false)
    expect(flight.active).toBe(true)

    work.resolve()
    await queued
    await expect(queuedNext).resolves.toBe('na fila')
  })

  it('depois que a fila esvazia, a chamada sem fila volta a executar', async () => {
    const flight = createSingleFlight()
    await flight.run(async () => 'x', { queue: true })
    await expect(flight.run(async () => 'livre')).resolves.toBe('livre')
  })

  it('chamada com fila espera também a execução ativa sem fila: só começa quando ela termina', async () => {
    const flight = createSingleFlight()
    const work = deferred<void>()
    const direct = flight.run(() => work.promise)

    let queuedStarted = false
    const queued = flight.run(
      async () => {
        queuedStarted = true
        return 'fila'
      },
      { queue: true }
    )

    await flush()
    expect(queuedStarted).toBe(false)

    work.resolve()
    await direct
    await expect(queued).resolves.toBe('fila')
    expect(queuedStarted).toBe(true)
  })
})
