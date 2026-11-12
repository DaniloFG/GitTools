# HANDOFF — <trabalho>

Memória do trabalho entre sessões. Existe só na branch `<branch>`: o check "Validar fluxo de branches" reprova o PR
que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas; o detalhe de etapa fechada está na
mensagem do commit dela.

## 1. Pedido e regras do dono

- **Pedido**, nas palavras do dono: …
- **Fora do escopo**: …
- **Regras deste trabalho** (além do `CLAUDE.md`): …
- **Metas**: <métrica> de <hoje> para <meta>, medida com <comando>.

## 2. Estado

**A seguir:** `<etapa>` — ou `ENCERRAMENTO`, ou `PARADO: <motivo e o que o dono precisa decidir>`

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| 1 | #N | … | fechada | `abc1234` | stage de 1 arquivo: 9 → 7 processos |
| 2 | #N | … | a fazer | | |

### Última etapa fechada: `<etapa>`

- **Feito**: …
- **Medido** (comando → número): …
- **Não conferido**: …
- **Ficou para depois**: … (vira etapa nova na seção 4, ou item do encerramento)

## 3. Base de medição

Números de partida, com o commit e o comando que os gerou. Sem trabalho de desempenho, esta seção diz só "não se
aplica".

```
<commit> | node scripts/perf/ui.mjs 4 moderate | <linha da saída>
```

## 4. Plano

Etapa fechada sai daqui (fica a linha na tabela da seção 2).

### Etapa `<id>` — <objetivo em uma linha>

- **Orquestra**: topo | sonnet
- **Arquivos prováveis**: …
- **Ler antes**: `<arquivo>` (seção ou linhas) — só o necessário
- **Aceite**: `<comando>` → <resultado esperado, com número quando houver>
- **Testes**: unidade | integração | tela | medição
- **Segurança**: sim | não
- **Depende de**: …

## 5. Decisões e armadilhas

Uma linha cada: o que foi tentado e não serviu (e por quê), decisão do dono (com a data), cuidado que custou caro
descobrir.

## 6. Encerramento

Só com a palavra do dono de que o trabalho acabou.

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação que o trabalho tornou falsa foi corrigida (`docs/PERFORMANCE.md`, README, `CLAUDE.md`, `.claude/`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] Worktree usado removido, depois do último push (`git worktree remove <caminho>` e `git worktree prune`)
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Resumo para o PR: o que mudou, antes e depois medidos, o que não foi conferido
- [ ] Issues das etapas validadas (evidência comentada, `status:validada`, fechadas); issue-mãe fechada por último
- [ ] PR branch → `develop` mergeado e validado; `git rm docs/HANDOFF.md` em commit; PR da mesma branch → `homolog`
  (rótulo `validada-develop`) mergeado e validado; PR `homolog` → `main` aberto e deixado ao dono (`.claude/rules/github.md`)
