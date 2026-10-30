# Alaric — Development Instructions

## Projeto

Alaric é uma plataforma Helpdesk AI-Native, headless, modular e extensível.

O desenvolvimento é realizado por um desenvolvedor solo, priorizando qualidade técnica, baixo custo operacional e manutenção de longo prazo.

Consulte `docs/architecture.md` quando a tarefa envolver decisões arquiteturais.

## Fluxo obrigatório

1. Identifique o objetivo ativo e seus critérios de aceite.
2. Inspecione somente o código relevante.
3. Para objetivos não triviais, produza um plano curto com tarefas verificáveis.
4. Implemente uma tarefa por vez.
5. Execute testes proporcionais à mudança.
6. Registre o progresso no plano e faça commits coerentes.
7. Pare quando o objetivo aprovado estiver concluído.

## Restrições

- Não amplie o escopo sem aprovação.
- Não implemente funcionalidades futuras apenas porque estão no roadmap.
- Não crie abstrações ou infraestrutura sem necessidade demonstrada.
- Preserve contratos, responsabilidades e alterações existentes.
- Prefira bibliotecas consolidadas a implementações próprias.
- Não confunda testes simulados com validação real.
- Não altere decisões arquiteturais aprovadas silenciosamente.

## Planejamento

Cada objetivo deve registrar:

- Resultado esperado.
- Escopo e exclusões.
- Tarefas ordenadas.
- Dependências relevantes.
- Critérios de aceite e verificações.
- Estado de conclusão.

Evite tarefas excessivamente fragmentadas. Cada tarefa deve produzir uma alteração coerente e verificável.

## Eficiência

- Não reanalise decisões estabelecidas sem evidência nova.
- Não execute revisões ou agentes paralelos automaticamente.
- Não faça varreduras extensas sem necessidade.
- Não produza relatórios longos para alterações simples.
- Ao concluir uma tarefa, informe brevemente o resultado e a verificação realizada.
