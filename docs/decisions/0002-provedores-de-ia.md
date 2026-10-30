# ADR 0002 — Provedores de chat configuráveis e decisões especializadas separadas

- Data: 2026-10-29
- Estado: aceita, conforme revisão explícita da estratégia de provedores.
- Complementa: [ADR 0001](0001-base-do-agentic-core.md).

## Contexto

O responsável do projeto confirmou credenciais para Groq, OpenRouter, Jev (TypeSafe AI) e AWS Bedrock. Não há credencial Grok/xAI. A proposta anterior de começar pelo serviço OpenAI não refletia as prioridades disponíveis. O núcleo deve permitir trocar provedores de geração sem alterar a lógica do agente e distinguir chat de decisões especializadas.

## Decisão

- Usar Groq no primeiro teste real do Plano 001. Permitir selecionar Groq, OpenRouter ou endpoint OpenAI-compatible por configuração de provedor, URL base, chave e modelo na composição, mantendo o runtime independente dessa seleção.
- Reutilizar inicialmente `ChatOpenAI` com `configuration.baseURL` para chat compatível com Chat Completions. O nome da integração não implica uso do serviço ou credencial OpenAI. Considerar integrações específicas somente para benefícios necessários ou incompatibilidades comprovadas, sem SDK próprio, registry ou descoberta de modelos.
- Separar modelos especializados em decisões pelo contrato `DecisionProvider`, independente da interface de chat. Jev será implementado no objetivo futuro de Decision Routing, sem dependência ou stub no 001.
- Manter Bedrock como possibilidade futura fora das prioridades iniciais; sua disponibilidade não implica compatibilidade com o mesmo cliente de chat.
- Validar capacidades por endpoint e modelo: compatibilidade nominal não comprova ferramentas, respostas estruturadas, streaming ou metadados de uso. Credenciais são segredos e não serão registradas em documentação, código ou logs.

## Consequências

Groq é uma escolha inicial de validação, não dependência permanente. Configurar outro endpoint compatível não deve exigir alteração no Agent Runtime, mas comprovar integração externa exige teste real separado. O aceite do 001 exige esse teste com Groq; configuração e composição dos demais caminhos serão verificadas por testes automatizados, sem alegar integração real já validada.

Roteamento e inferência especializada permanecem responsabilidades distintas: preservam-se modos direto, regras, rejects, decisões e híbrido, estratégias independentes e fallback opcional. Nenhum desses mecanismos adicionais será implementado no 001.

## Alternativas

Um adaptador próprio para cada provedor duplicaria a interface de chat já existente. Instalar todas as integrações específicas antecipadamente ampliaria dependências sem benefício comprovado. Tratar Jev como chat model misturaria contratos de geração textual e decisões estruturadas. Essas alternativas não são adotadas.
