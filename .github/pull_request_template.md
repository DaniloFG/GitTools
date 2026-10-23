## O que muda
<!-- Resumo curto da mudança e o motivo. -->

## Etapa do fluxo
<!-- Marque a etapa que este PR representa. O check "Validar fluxo de branches" confere a mesma regra. -->
- [ ] `feature/*` (ou `fix/`, `docs/`, `chore/`, `refactor/`, `claude/`) → `develop`
- [ ] `develop` → `homolog` (promoção para homologação)
- [ ] `homolog` → `main` (publicação em produção)

## Checklist
- [ ] Testado localmente (`npm run typecheck` e `npm test`)
- [ ] Para PR → `main`: a mudança foi validada na `homolog`
- [ ] Documentação e README atualizados, se necessário
- [ ] Nenhum segredo, `.env` ou arquivo gerado no diff

## Observações para revisão
