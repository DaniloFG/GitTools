## O que muda
<!-- Resumo curto da mudança e o motivo. -->

## Etapa do fluxo
<!-- Marque a etapa que este PR representa. O check "Validar fluxo de branches" confere a mesma regra. -->
- [ ] branch de trabalho → `develop`
- [ ] branch de trabalho → `homolog` (já validada na develop; nunca develop → homolog)
- [ ] `homolog` → `main` (validada na homolog; merge só do dono)

## Checklist
- [ ] Testado localmente (`npm run typecheck` e `npm test`)
- [ ] Para PR → `main`: a mudança foi validada na `homolog`
- [ ] Documentação e README atualizados, se necessário
- [ ] Nenhum segredo, `.env` ou arquivo gerado no diff

## Observações para revisão
