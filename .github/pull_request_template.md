## O que muda
<!-- Resumo curto da mudança e o motivo. -->

## Etapa do fluxo
<!-- Marque a etapa que este PR representa. O check "Validar fluxo de branches" confere a mesma regra. -->
- [ ] branch de trabalho → `develop`
- [ ] branch de trabalho → `homolog` (já validada na develop; nunca develop → homolog)
- [ ] `homolog` → `main` (validada na homolog; merge só do dono)

## Checklist
- [ ] Testado localmente (`npm run typecheck` e `npm test`)
- [ ] Cenário e2e que reprova sem a mudança em `scripts/validacao/e2e/cenarios/`, ou rótulo `sem-e2e` com a linha `sem-e2e: <motivo>` no corpo
- [ ] Check `QA` verde (gate de cobertura e pipeline)
- [ ] Para PR → `main`: a mudança foi validada na `homolog`
- [ ] Documentação e README atualizados, se necessário
- [ ] Se o PR toca `extension/CHANGELOG.md`: cada bullet descreve o que o usuário do app vê; nada de pipeline, Claude, IA, issue/PR, branch, configuração interna
- [ ] Nenhum segredo, `.env` ou arquivo gerado no diff

## Observações para revisão
