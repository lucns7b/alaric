# Alaric

**AI-Native Headless Helpdesk Platform**

Alaric é uma plataforma de atendimento omnichannel orientada por agentes de inteligência artificial, projetada para evoluir para um sistema completo de Helpdesk, inspirado em soluções como Intercom.

O projeto prioriza um backend modular, extensível, seguro e independente de fornecedores específicos de IA.

## Objetivos

- Suportar agentes e subagentes configuráveis.
- Permitir orquestração, delegação e execução de ferramentas.
- Integrar modelos generativos e modelos especializados em decisões.
- Oferecer roteamento determinístico, fallback e controles de execução.
- Disponibilizar APIs para integração com canais e sistemas externos.
- Suportar futuramente conversas, contatos, Inbox, automações e atendimento humano.
- Permitir administração headless por API e CLI.

## Arquitetura proposta

- **Runtime:** Node.js e TypeScript.
- **API:** Fastify.
- **AI Runtime:** LangGraph.js e LangChain.js.
- **Persistência:** PostgreSQL.
- **Validação:** Zod.
- **Testes:** Vitest.
- **Integrações:** contratos independentes, incluindo ferramentas HTTP e n8n opcional.

As tecnologias poderão ser revisadas mediante justificativa técnica. Uma tecnologia planejada não implica que já esteja implementada.

## Desenvolvimento

O desenvolvimento é incremental e orientado por objetivos verificáveis.

O primeiro bloco é o **Agentic Core**, responsável pela execução de agentes, subagentes, decisões configuráveis, persistência e observabilidade básica.

Componentes como Inbox, canais, workflows empresariais e interface gráfica serão desenvolvidos posteriormente.

## Estado atual

**Em desenvolvimento inicial.**

O Plano 001 implementa uma API HTTP síncrona e um grafo LangGraph de uma inferência via LangChain, com configuração de provedor, erros sanitizados e tracing JSON. Testes automatizados, typecheck e build foram validados. A integração real com Groq e a abertura da porta HTTP no terminal WSL permanecem pendentes de validação; o executor utilizado não permite abrir sockets locais.

## Execução local

Requer Node.js 24 (versão usada: `24.22.2`) e npm. Se estiver usando nvm e os comandos não estiverem no PATH, carregue `~/.nvm/nvm.sh` antes de executar os comandos abaixo.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

A instalação pelo lockfile também foi verificada offline a partir de cache local. Uma instalação sem cache precisa de acesso ao registro npm.

Preencha o arquivo local `.env` conforme `.env.example`, ou exporte as variáveis no ambiente. Os scripts npm não carregam `.env` automaticamente; os comandos abaixo usam o carregador nativo `--env-file` do Node.js. Nunca inclua chaves reais no código, nos logs ou no histórico de comandos.

| Variável | Configuração |
| --- | --- |
| `LLM_PROVIDER` | `groq`, `openrouter` ou `openai-compatible` |
| `LLM_BASE_URL` | Groq: `https://api.groq.com/openai/v1`; OpenRouter: `https://openrouter.ai/api/v1`; ou URL base HTTP(S) do endpoint compatível, sem credenciais embutidas |
| `LLM_API_KEY` | Chave do endpoint selecionado, fornecida de forma segura pelo ambiente |
| `LLM_MODEL` | Identificador de modelo textual habilitado nesse endpoint |
| `AGENT_ID` | Opcional; padrão `default` |
| `AGENT_INSTRUCTIONS` | Opcional; padrão `Responda de forma clara e objetiva.` |
| `PORT` | Opcional; padrão `3000` |
| `LLM_TIMEOUT_MS` | Opcional; padrão `30000` |

As quatro variáveis `LLM_*` de provedor, URL, chave e modelo são obrigatórias. Não há fallback para variáveis OpenAI ou seleção de provedor por requisição.

O entrypoint implementado é `npm start`, após o build. Ele escuta somente em `127.0.0.1`; não há autenticação ou suporte para exposição pública nesta entrega. A inicialização com configuração ausente foi verificada: termina com código 1 e mensagem sanitizada.

Para validar no terminal WSL normal, onde seja permitido abrir portas:

```bash
cd ~/alaric
. "$HOME/.nvm/nvm.sh"
git check-ignore --verbose .env
git ls-files -- .env
npm test
npm run typecheck
npm run build
node --env-file=.env ./node_modules/vitest/vitest.mjs run tests/agent-runtime.real.test.ts
```

`git check-ignore` deve apontar a regra de exclusão e `git ls-files -- .env` não deve retornar nenhum arquivo. Se `.env` aparecer como rastreado, interrompa antes de fazer commits; a regra de ignore sozinha não remove arquivos do índice.

O teste real faz uma requisição HTTP por socket para a aplicação e exige resposta textual do modelo e tracing correlacionado. Ele não utiliza mocks. Para conferir também a aplicação compilada, inicie em um terminal:

```bash
cd ~/alaric
. "$HOME/.nvm/nvm.sh"
node --env-file=.env dist/main.js
```

Em outro terminal WSL:

```bash
cd ~/alaric
. "$HOME/.nvm/nvm.sh"
alaric_port=$(node --env-file=.env -p 'process.env.PORT || 3000')
curl --fail-with-body --silent --show-error \
  "http://127.0.0.1:$alaric_port/v1/agent-runs" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Responda com uma saudação curta em português."}'
```

O contrato verificado via Fastify `inject` retorna `{ requestId, runId, agentId, output }`. Aceita apenas `message`, string aparada com 1 a 8.000 unidades UTF-16, em corpo JSON de até 64 KiB. Pedidos inválidos não chamam o modelo. Erros usam `{ requestId, error: { code, message }, runId? }`, com status 400, 413, 415, 502, 504 ou 500 conforme a falha.

Cada inferência gera um evento `agent.inference` com IDs de requisição/execução, agente, provedor, modelo configurado, modelo informado pelo provedor quando disponível, latência, status e tokens. Valores não informados ficam como `null`; zeros reais são preservados. Mensagens, respostas e credenciais não entram nos logs. Não há histórico entre pedidos, retries, fallback ou checkpointer.

A inicialização rejeita flags globais que habilitem logging verbose ou exportação implícita pela biblioteca (`LANGCHAIN_VERBOSE`, `LANGCHAIN_TRACING`, `LANGCHAIN_TRACING_V2`, `LANGSMITH_TRACING`, `LANGSMITH_TRACING_V2`). Mantenha essas flags ausentes ou desativadas para preservar o tracing local sem conteúdo.

## Testes e limites da validação

- `npm test`: 61 testes automatizados aprovados com Fastify e LangGraph reais, controlando somente o modelo ou o transporte externo. Inclui seleção dos três provedores, cancelamento até o cliente HTTP, ausência de retries, isolamento e sanitização.
- `npm run test:integration:real`: teste opt-in sem mocks, com HTTP em porta efêmera e Groq real. Exige `LLM_PROVIDER=groq`, URL oficial, chave e modelo configurados; falha explicitamente se faltar configuração. Para carregar o `.env`, use o comando Node.js acima. Em 2026-10-30, o `.env` foi carregado e validado, mas o teste falhou com `listen EPERM` em `127.0.0.1`, antes de qualquer inferência. Status HTTP, resposta, latência e tokens de Groq ainda não foram validados.

OpenRouter e endpoints OpenAI-compatible foram verificados com transporte controlado, sem comprovação de conectividade externa. Ferramentas, respostas estruturadas e streaming exigirão validação por modelo/endpoint em objetivos posteriores. O estado detalhado está no [Plano 001](docs/plans/001-agent-runtime.md).

## Contribuição e instruções

As regras de engenharia e desenvolvimento estão definidas no arquivo [AGENTS.md](AGENTS.md).

O código e as decisões arquiteturais devem evoluir de forma incremental, com testes e critérios de aceite explícitos.
