import { useState } from 'react'

export interface TableData {
  columns: { key: string; label: string; numeric?: boolean }[]
  rows: (string | number)[][]
}

/** Equivalente em tabela de qualquer gráfico (o jeito acessível de ler os mesmos valores); ordena pela coluna clicada. */
export function DataTable({ data, format }: { data: TableData; format?: (v: string | number, col: number) => string }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const rows = sort ? [...data.rows].sort((a, b) => (a[sort.col] > b[sort.col] ? 1 : a[sort.col] < b[sort.col] ? -1 : 0) * sort.dir) : data.rows
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {data.columns.map((c, i) => (
              <th key={c.key} className={c.numeric ? 'num' : ''} aria-sort={sort?.col === i ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => setSort((s) => (s?.col === i ? { col: i, dir: s.dir === 1 ? -1 : 1 } : { col: i, dir: c.numeric ? -1 : 1 }))}>
                  {c.label}
                  {sort?.col === i ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r, ri) => (
            <tr key={ri}>
              {r.map((v, ci) => (
                <td key={ci} className={data.columns[ci].numeric ? 'num' : ''}>
                  {format ? format(v, ci) : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** CSV de uma tabela (separador `;` não: vírgula, com aspas quando preciso). */
export function toCsv(data: TableData): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [data.columns.map((c) => esc(c.label)).join(','), ...data.rows.map((r) => r.map(esc).join(','))].join('\n')
}
