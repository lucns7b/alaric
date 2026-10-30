# Decisões arquiteturais

ADRs registram decisões estabelecidas e suas consequências. Hipóteses e alternativas ainda não aprovadas ficam em `docs/architecture.md` ou no plano do objetivo, sem receber estado de aceitas.

## Índice

| ADR | Estado | Decisão |
| --- | --- | --- |
| [0001](0001-base-do-agentic-core.md) | Aceita | Base tecnológica e fronteiras do Agentic Core |
| [0002](0002-provedores-de-ia.md) | Aceita | Provedores de chat configuráveis e decisões especializadas separadas |

## Formato para novas decisões

Usar numeração sequencial e nome descritivo: `NNNN-titulo.md`. Registrar título, data, estado, contexto, decisão, consequências e alternativas relevantes. Estados: proposta, aceita, rejeitada ou substituída. Uma substituição referencia a ADR anterior; preservar o histórico da decisão.

Criar nova ADR quando houver decisão arquitetural relevante, não para cada biblioteca auxiliar, arquivo ou tarefa. Nenhum template vazio é necessário.
