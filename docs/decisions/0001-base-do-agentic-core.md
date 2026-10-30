# ADR 0001 — Base tecnológica e fronteiras do Agentic Core

- Data: 2026-10-29
- Estado: aceita, conforme requisitos explícitos da preparação inicial.

## Contexto

Alaric precisa validar seu Agentic Core por HTTP antes de construir canais e interfaces. O desenvolvimento solo exige baixo custo operacional, integração com múltiplos provedores e evolução por objetivos verificáveis. `README.md` já propõe a stack; a solicitação de preparação a estabelece para o núcleo inicial.

## Decisão

- Usar TypeScript sobre Node.js LTS, Fastify e Zod para a API, LangGraph.js e LangChain.js para execução e integração de modelos, e Vitest para testes.
- Usar PostgreSQL com o checkpointer oficial do LangGraph quando a persistência de contexto for implementada. Não criar um mecanismo próprio de checkpoints.
- Manter runtime, decisões, ferramentas, persistência e observabilidade com responsabilidades distintas, inicialmente como módulos no mesmo processo. Núcleo independente dos canais e do transporte HTTP.
- Agentes serão configuráveis, sem especializações fixas por setor. Multiagente será opcional, assim como estratégias de roteamento e fallback; a arquitetura não impõe execução de supervisor a todo pedido.
- Não incluir Redis, NATS, RabbitMQ ou infraestrutura adicional sem necessidade demonstrada. Restate permanece candidato, não dependência aprovada.

## Consequências

Os contratos HTTP não expõem objetos internos dos frameworks. Integrações específicas de provedor ficam na composição dos modelos. Recursos do núcleo completo serão introduzidos em objetivos separados; esta decisão não exige persistência ou multiagente na primeira entrega.

LangGraph e LangChain passam a ser dependências deliberadas do runtime, com versões compatíveis a validar. O checkpointer não substitui persistência de dados de produto nem resolve sozinho workflows empresariais com efeitos externos.

## Alternativas e limites

Um runtime próprio exigiria manter orquestração e persistência já contempladas pela stack escolhida. Microserviços e mensageria acrescentariam operação sem necessidade atual. Não são a direção inicial.

Não estão decididos aqui: primeiro fornecedor/modelo de LLM, contratos detalhados de roteamento, solução de workflows duráveis, autenticação ou plataforma de observabilidade. As propostas concretas da primeira entrega estão no [plano 001](../plans/001-agent-runtime.md), aguardando aprovação para implementação.

Complemento posterior: a [ADR 0002](0002-provedores-de-ia.md) estabelece a estratégia de provedores e Groq como primeiro teste real, preservando as decisões desta ADR.
