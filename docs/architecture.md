# Arquitetura do Alaric

Estado: direção arquitetural inicial estabelecida; Plano 001 implementado e validado localmente com transporte externo controlado. Validação real com Groq e abertura da porta HTTP no WSL ainda pendentes.

## Visão e limites

Alaric é uma plataforma Helpdesk AI-Native, headless e modular. O primeiro bloco é o Agentic Core, acessível por HTTP. Canais, Inbox e interfaces administrativas serão consumidores do núcleo, sem determinar suas regras de execução.

A evolução começa com um único processo Node.js e módulos internos. As fronteiras abaixo são responsabilidades lógicas; não exigem serviços, pacotes separados, filas ou uma interface por componente. A organização mínima de código está proposta no [primeiro plano](plans/001-agent-runtime.md); nenhum diretório `src/` precisa existir antes da implementação.

O núcleo pretendido inclui agentes configuráveis, roteamento, delegação, contexto persistido e observabilidade. Isso não constitui escopo de uma única entrega. O objetivo 001 é somente mensagem HTTP → agente → LLM real → resposta e tracing básico, sem continuidade entre requisições.

## Stack e responsabilidades

| Tecnologia estabelecida | Responsabilidade |
| --- | --- |
| TypeScript + Node.js LTS | Tipos e execução do backend |
| Fastify + Zod | Transporte HTTP e validação de entradas, configuração e contratos estruturados |
| LangGraph.js | Estado e fluxo de execução do agente; checkpoints quando introduzidos |
| LangChain.js | Integração com modelos e ferramentas por contratos consolidados |
| PostgreSQL + checkpointer oficial do LangGraph | Persistência de contexto de execução e checkpoints, em objetivo posterior ao 001 |
| Vitest | Testes unitários, HTTP e integração explícita |

Versões compatíveis e a linha LTS concreta serão fixadas no lockfile e na configuração do projeto durante a implementação. Nenhum pacote ou serviço será instalado por esta documentação.

## Componentes e fronteiras

Fluxo mínimo: `HTTP → runtime → modelo`, com metadados de execução enviados ao logger. No núcleo completo, o runtime também consulta decisões, executa ferramentas autorizadas e usa persistência.

| Componente | Responsabilidade e dependências permitidas |
| --- | --- |
| API HTTP | Valida requisições e respostas, cria correlação e traduz erros. Chama o runtime; não constrói prompts nem escolhe rotas ou modelos. |
| Composição e configuração | Valida configuração e conecta API, runtime, modelos, logger e, futuramente, persistência. Concentra credenciais e construção dos clientes. |
| Runtime agêntico | Executa o grafo e aplica limites. Consome configuração validada, modelos e, quando necessários, decisões, ferramentas e checkpointer. Não conhece Fastify, canais ou Inbox. |
| Decisões | Avalia estratégias habilitadas e retorna resultado estruturado validado. Modelos especializados são acessados por `DecisionProvider`, independente da interface de chat. Não executa ferramentas nem escreve checkpoints. |
| Modelos de chat/geração | Integrações LangChain isolam configuração específica de provedor. O runtime usa a interface de chat existente, sem criar um SDK próprio de LLMs. |
| Ferramentas | Operações com contratos de entrada, saída e erro, autorizadas pelo runtime. Adaptadores de integração não controlam o grafo nem a API. |
| Persistência | Checkpointer oficial armazena estado do grafo. Dados de produto terão contratos e esquema próprios quando necessários; não serão escondidos nas tabelas do checkpointer. |
| Observabilidade | Recebe eventos e metadados de execução. Não determina roteamento nem mantém estado de conversa. No 001 usa o logger JSON do Fastify. |

Dependências seguem da composição e dos adaptadores de entrada para o núcleo; o núcleo não importa transporte HTTP nem módulos futuros de produto. Tipos de LangGraph e LangChain podem existir dentro do runtime. Não atravessam o contrato HTTP, que expõe dados simples validados. Não criar um framework de portas, plugins ou barramento de eventos para materializar essas fronteiras antecipadamente.

### Estratégia de provedores de IA

Disponibilidade de credenciais informada pelo responsável do projeto; não significa integração implementada ou acesso validado nesta etapa:

| Provedor | Papel e prioridade |
| --- | --- |
| Groq | LLMs generativos; escolha do primeiro teste real do Plano 001, sem dependência permanente |
| OpenRouter | Acesso a modelos generativos; selecionável por configuração sem alterar o Agent Runtime |
| APIs OpenAI-compatible | Endpoints de chat com URL base, chave e identificador de modelo configuráveis; disponibilidade depende do endpoint escolhido |
| Jev (TypeSafe AI) | Modelos especializados em decisões; contrato `DecisionProvider`, com implementação no futuro objetivo de Decision Routing |
| AWS Bedrock | Credenciais disponíveis, mas integração fora das prioridades iniciais |

Não há credencial Grok/xAI disponível. A utilização de `ChatOpenAI` não exige adotar o serviço OpenAI nem pressupõe uma credencial desse serviço.

Para chat, reutilizar inicialmente `ChatOpenAI` (`@langchain/openai`) com `configuration.baseURL`, chave e modelo explícitos na composição. Groq, OpenRouter e endpoints OpenAI-compatible usam a mesma interface LangChain injetada no runtime. A seleção ocorre na configuração de inicialização; não altera o grafo nem implementa roteamento dinâmico entre provedores. Integrações específicas só se justificam por benefício necessário ou incompatibilidade comprovada. Não criar SDK próprio, descoberta de modelos, registry ou hierarquia de adaptadores.

Compatibilidade com Chat Completions não garante equivalência de capacidades. Validar, para cada endpoint/modelo utilizado, mensagens de sistema, parâmetros aceitos, cancelamento e metadados de uso; ferramentas, respostas estruturadas e streaming exigem validações próprias quando entrarem em escopo. Não ativar recursos específicos da OpenAI automaticamente. O 001 valida geração textual sem streaming e preserva metadados disponíveis; não certifica as demais capacidades nem todos os provedores por um único teste com Groq.

`DecisionProvider` será o contrato de inferência especializada consumido pelo componente de decisões, sem herdar da interface de chat. Receberá entrada estruturada e retornará decisão validada ou erro explícito; esquema e implementação serão definidos no objetivo de Decision Routing. Jev não será tratado como chat model, não executará o roteamento por conta própria e não gera código, dependência ou stub no 001.

Credenciais são segredos fornecidos pelo ambiente, nunca pelo pedido HTTP nem incluídos em documentação, código ou logs. Logs devem identificar o provedor configurado sem serializar o cliente, a chave ou URLs que possam carregar dados sensíveis. O modelo servido pelo endpoint só será registrado como confirmado quando houver metadado correspondente.

## Capacidades do núcleo pretendido

### Agentes e delegação

Um agente é definido por configuração: identidade, instruções, referência de modelo e, em objetivos posteriores, ferramentas e limites. Não haverá classes fixas por setor. O primeiro objetivo usa uma única definição em configuração de inicialização, sem CRUD ou catálogo persistido.

Supervisor e subagentes serão opcionais. Com multiagente desabilitado, a execução segue diretamente para o agente selecionado, sem instanciar supervisor nem permitir delegações. Quando habilitado, a configuração deverá delimitar destinos autorizados, profundidade, número de delegações, passos e prazo total. Limites esgotados produzem término explícito; não acionam fallback oculto. O formato dessas configurações será definido no objetivo correspondente.

### Decisões e roteamento

Os modos preservados são direto, regras determinísticas (incluindo regex), rejects (rejeição explícita), decisões por modelos e híbrido (combinação ordenada das estratégias habilitadas). Cada estratégia deve poder ser habilitada ou desabilitada independentemente; habilitar multiagente não deve habilitar roteamento por modelo implicitamente. Rejeição explícita é terminal e não deve ser desfeita por fallback.

Uma política explícita definirá ordem e precedência entre estratégias ativas. Resultados distinguirão destino selecionado, rejeição explícita, ausência de correspondência e erro. Destinos devem ser validados contra os autorizados; saída livre do modelo não é comando de execução. Contratos de decisão serão estruturados e validados com Zod, com identificação da estratégia e motivo rastreável.

Fallback é configuração separada, podendo estar desabilitado. Sem correspondência e sem fallback, a execução termina com resultado explícito. Erro de estratégia não será convertido silenciosamente em ausência de correspondência. Política concreta, proteção de regex e esquema final de decisões serão definidos quando essas capacidades entrarem em escopo. O 001 não cria motor de roteamento: a configuração já identifica o único agente.

### Contexto e persistência

O checkpointer oficial PostgreSQL será responsável pelos snapshots do grafo associados a uma thread. Identificadores de requisição, execução e thread têm propósitos distintos; um `runId` não promete continuidade de conversa. Checkpoint não equivale a cadastro de contatos, auditoria completa ou memória de longo prazo.

Persistência será um objetivo próprio, com testes reais de continuidade após reinício, isolamento entre threads e tratamento de concorrência. Retenção, acesso e migrações também precisarão ser definidos antes de armazenar conversas reais. O 001 não instala PostgreSQL, não usa checkpointer em memória para simular persistência e não aceita `threadId`.

### Observabilidade

No núcleo completo, correlacionar inferências, uso de tokens, latência, ferramentas, decisões, delegações e erros. Incluir relações entre execuções quando houver delegação, sem registrar raciocínio interno do modelo.

No 001, um evento terminal de inferência identifica requisição, execução, agente, provedor, modelo, resultado, latência e tokens quando informados. Campos indisponíveis ficam explícitos; não estimar tokens como se fossem medidos. Mensagens, respostas e credenciais não são incluídas nos logs por padrão. Logs locais não garantem retenção durável nem substituem checkpoints. Não exigir LangSmith, OpenTelemetry, backend de traces ou banco para esse primeiro tracing.

## Decisões e pontos em aberto

A [ADR 0001](decisions/0001-base-do-agentic-core.md) registra a stack e as fronteiras estabelecidas; a [ADR 0002](decisions/0002-provedores-de-ia.md) consolida a estratégia de provedores. A primeira entrega limitada está implementada conforme o plano aprovado, com aceite externo ainda pendente.

Propostas mantidas do plano: endpoint síncrono, um grafo com um nó de inferência e logs JSON. Groq está confirmado como primeiro provedor de teste; OpenRouter e endpoints OpenAI-compatible serão selecionáveis pela configuração de chat, sem modificar o runtime. Disponibilidade das credenciais não comprova modelo habilitado, quota ou compatibilidade. O modelo concreto permanece configurável e será validado na implementação; Bedrock e Jev não integram o Plano 001.

Restate permanece candidato a workflows duráveis. Sua adoção depende de uma necessidade demonstrada e da definição de qual sistema controla retomada, efeitos externos e retries, evitando duplicar responsabilidades do LangGraph. Não está aprovado para instalação. Também permanecem abertas as escolhas de autenticação, multitenancy, deploy, memória de longo prazo e exportação de observabilidade; o objetivo 001 é local, não um serviço pronto para exposição pública.

Redis, NATS, RabbitMQ, serviços separados e infraestrutura adicional não integram a base aprovada. Sua inclusão exigiria justificativa e nova decisão.

## Evolução sem implementação antecipada

Inbox, contatos, canais, ferramentas HTTP/n8n, integrações empresariais, CLI administrativa, RAG e workflows duráveis terão objetivos próprios. n8n será um possível adaptador de ferramentas, não dependência de execução do núcleo. Esses componentes não geram agora diretórios, dependências ou contratos fictícios.

## Referências técnicas

- [LangGraph: persistência e distinção entre checkpointer e store](https://docs.langchain.com/oss/javascript/langgraph/persistence).
- [LangChain: interface comum de modelos](https://docs.langchain.com/oss/javascript/langchain/models).
- [LangChain: mensagens e metadados](https://docs.langchain.com/oss/javascript/langchain/messages).
- [LangChain: integração ChatOpenAI](https://docs.langchain.com/oss/javascript/integrations/chat/openai).
- [Groq: compatibilidade OpenAI e URL base](https://console.groq.com/docs/openai).
- [OpenRouter: API de chat](https://openrouter.ai/docs/quickstart).

Referências consultadas na preparação. Não substituem a verificação de compatibilidade das versões na implementação nem constituem teste real de integração.
