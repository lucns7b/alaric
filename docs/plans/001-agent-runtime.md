# 001 — Plano de implementação do primeiro runtime

> Execução futura: usar `superpowers:executing-plans`, se disponível, tarefa por tarefa e sem delegação automática. As caixas abaixo acompanham a implementação, não a criação desta documentação.

**Estado:** implementação e verificações locais concluídas; configuração Groq do `.env` carregada e validada em 2026-10-30. Aceite externo pendente: o sandbox continua impedindo abertura de porta local. Commits ficam para o terminal WSL, conforme instrução do usuário.

**Objetivo:** enviar uma mensagem HTTP, executar um agente com um LLM real, receber texto e registrar tracing básico correlacionado.

**Arquitetura:** Fastify valida o pedido e chama um grafo LangGraph com um único nó de inferência. A composição injeta um modelo de chat LangChain e o logger JSON; cada requisição possui estado isolado, sem checkpointer.

**Stack:** TypeScript, Node.js LTS, Fastify, Zod, LangGraph.js, LangChain.js e Vitest. Especificação: [arquitetura](../architecture.md), [ADR 0001](../decisions/0001-base-do-agentic-core.md) e [ADR 0002](../decisions/0002-provedores-de-ia.md).

## Escopo, escolhas propostas e dependências

- Uma rota síncrona `POST /v1/agent-runs`, um agente configurado na inicialização e uma inferência por pedido válido, sem streaming.
- Primeiro teste real com **Groq**, usando `ChatOpenAI` de `@langchain/openai` pela interface de chat de `@langchain/core`. Configurar Chat Completions sem streaming e sem ativar Responses API ou recursos exclusivos de OpenAI. Uma integração específica só será considerada se houver benefício necessário ou incompatibilidade comprovada.
- Configuração de chat validada com Zod: `LLM_PROVIDER` (`groq`, `openrouter` ou `openai-compatible`), `LLM_BASE_URL` (URL base HTTP(S) explícita, sem credenciais embutidas), `LLM_API_KEY` (segredo não vazio do endpoint escolhido) e `LLM_MODEL` (identificador não vazio e específico daquele endpoint). Todos obrigatórios, sem fallback para o serviço OpenAI ou suas variáveis de ambiente. A composição passa explicitamente `apiKey`, `model` e `configuration.baseURL` ao cliente LangChain; o runtime recebe a mesma interface em todos os casos.
- Demais configurações: `AGENT_ID` (padrão `default`), `AGENT_INSTRUCTIONS` (padrão `Responda de forma clara e objetiva.`), `PORT` (padrão `3000`), `LLM_TIMEOUT_MS` (inteiro positivo, padrão `30000`). Segredos vêm do ambiente e não do corpo HTTP; não incluir valores reais no `.env.example`, código ou logs.
- Servidor escuta apenas `127.0.0.1`. Acesso remoto, autenticação e multitenancy não fazem parte deste objetivo; não apresentar a entrega como pronta para uso público.
- npm e lockfile para instalação reproduzível. Selecionar Node.js LTS e versões compatíveis ao iniciar a implementação e registrar a seleção. Não instalar o pacote agregador `langchain` se as integrações utilizadas só exigirem `@langchain/core`.
- Credenciais de Groq e OpenRouter estão disponíveis conforme informado pelo responsável do projeto, sem consulta ou exposição de seus valores nesta etapa. Para comprovar conclusão: rede, credencial Groq válida, quota e modelo textual acessível. Sem isso, testes automatizados podem passar, mas a integração real permanece pendente.

Seleção somente na inicialização, alterando a combinação de variáveis abaixo; nenhuma mudança na lógica do agente, descoberta de modelos ou seleção automática por pedido:

| `LLM_PROVIDER` | `LLM_BASE_URL` | `LLM_API_KEY` e `LLM_MODEL` |
| --- | --- | --- |
| `groq` | `https://api.groq.com/openai/v1` | Chave Groq e identificador de modelo habilitado na Groq |
| `openrouter` | `https://openrouter.ai/api/v1` | Chave OpenRouter e identificador de modelo aceito no OpenRouter |
| `openai-compatible` | URL base do endpoint escolhido, fornecida na configuração | Chave e identificador de modelo desse endpoint |

`LLM_PROVIDER` identifica a integração nos metadados; a URL é explícita, não descoberta por esse nome. Os endereços acima são referências de configuração, não chamadas a executar nesta etapa. Não presumir que os mesmos identificadores de modelo ou capacidades funcionem entre endpoints. No 001, validar texto, mensagens de sistema, cancelamento e uso quando disponível; ferramentas, respostas estruturadas e streaming terão verificações nos objetivos que os utilizarem. Jev e Bedrock não são opções de chat deste plano.

**Exclusões:** supervisor, subagentes, delegação, motor de roteamento, regex, Decision Models (incluindo Jev e implementação de `DecisionProvider`), Bedrock, fallback, ferramentas, histórico entre pedidos, PostgreSQL/checkpointer, RAG, Inbox, canais, CLI, workflows duráveis e plataformas externas de tracing. Não criar flags ou stubs para esses recursos.

## Arquivos previstos — criar somente durante a execução aprovada

| Arquivo | Responsabilidade |
| --- | --- |
| `package.json`, `package-lock.json`, `tsconfig.json`, `.node-version` | Scripts, dependências e compilação ESM estrita para a linha LTS escolhida |
| `.gitignore`, `.env.example` | Ignorar artefatos/segredos locais e documentar variáveis sem credenciais reais |
| `src/config.ts` | Validação da configuração na inicialização, incluindo provedor, URL, chave e modelo |
| `src/main.ts` | Composição de modelo, runtime, logger e servidor; encerramento do servidor |
| `src/http/app.ts` | Fábrica Fastify, schema HTTP, rota e tradução de erros |
| `src/agent/runtime.ts` | Grafo de um nó, chamada do modelo, normalização e tracing da inferência |
| `tests/config.test.ts` | Configuração válida e inválida dos três caminhos de chat |
| `tests/composition.test.ts` | Mesma composição para Groq, OpenRouter e endpoint compatível, sem rede, verificando argumentos do cliente e metadados |
| `tests/agent-runtime.test.ts` | Grafo real com modelo controlado, metadados, limites e falhas |
| `tests/http.test.ts` | Fastify real via `inject`, validação e mapeamento HTTP |
| `tests/agent-runtime.real.test.ts` | HTTP com servidor em porta efêmera e provedor real, somente por comando explícito |
| `README.md` | Acrescentar comandos e instruções apenas após serem implementados e verificados, preservando o conteúdo existente |

Não criar repositórios genéricos, classes base de provedores, catálogo de agentes ou arquivos de observabilidade separados sem necessidade. Os contratos do runtime podem residir em `runtime.ts`; schemas HTTP pertencem a `app.ts`.

## Contratos mínimos propostos

### HTTP

Pedido JSON estrito: `{ "message": "Olá" }`. `message` deve ser string, aparada, não vazia, com até 8.000 unidades UTF-16 após aparar. Corpo limitado a 64 KiB; propriedades extras são rejeitadas. Nenhum `agentId`, modelo, instrução de sistema ou identificador de conversa vindo do cliente nesta entrega.

Sucesso `200`:

```json
{
  "requestId": "identificador-gerado-no-servidor",
  "runId": "uuid-da-execucao",
  "agentId": "default",
  "output": "Olá!"
}
```

`requestId` é gerado pelo Fastify, sem confiar em cabeçalho enviado pelo cliente. `runId` é um UUID novo por execução aceita; não é identificador de conversa. Retornar ambos permite localizar a inferência nos logs.

Erro: `{ "requestId": "...", "error": { "code": "...", "message": "..." }, "runId": "..." }`. Omitir `runId` quando o runtime não tiver sido iniciado. Mensagens públicas são sanitizadas, sem stack, configuração ou resposta bruta do provedor.

| Condição | Status | Código |
| --- | --- | --- |
| JSON inválido ou schema inválido | 400 | `INVALID_REQUEST` |
| Corpo maior que 64 KiB | 413 | `PAYLOAD_TOO_LARGE` |
| Tipo de conteúdo não suportado | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Provedor recusa/falha ou não retorna texto utilizável | 502 | `MODEL_ERROR` |
| Prazo da inferência esgotado | 504 | `MODEL_TIMEOUT` |
| Erro interno inesperado | 500 | `INTERNAL_ERROR` |

### Runtime e tracing

`createAgentRuntime({ model, modelMetadata, agent, timeoutMs, logger })` produz `run({ message, requestId }): Promise<AgentRunResult>`, com resultado `{ runId, agentId, output }`. `model` utiliza a interface de chat LangChain existente; `modelMetadata` contém `{ provider, configuredModel }` derivados da configuração apenas para tracing; `agent` contém `{ id, instructions }`. URL e chave ficam na composição do cliente; o runtime não faz seleção condicional de provedor. Erros tipados preservam `runId` e código para tradução HTTP, sem dependência de Fastify.

Fluxo: `START → inferência → END`. O nó envia instrução de sistema e mensagem do usuário ao modelo uma vez, sem ferramentas ou loop. Aceitar texto simples e blocos textuais suportados pela integração; saída vazia ou composta apenas por conteúdo não textual é `MODEL_ERROR`.

Usar prazo e cancelamento efetivo por `AbortSignal` até o cliente do provedor. Desabilitar retries automáticos no adaptador: este objetivo não define política de repetição nem fallback. Não basta devolver 504 e deixar a chamada continuar sem cancelamento.

Cada inferência iniciada emite exatamente um evento terminal `agent.inference`, com:

- `timestamp`, `requestId`, `runId`, `agentId`, `provider`, `configuredModel`;
- `responseModel` quando informado pelo provedor; caso contrário `null`, preservando o modelo configurado sem fingir confirmação do modelo efetivo;
- `status` (`success`, `error` ou `timeout`), `durationMs` medido por relógio monotônico apenas ao redor da inferência;
- `usage`: `inputTokens`, `outputTokens`, `totalTokens`, cada um como inteiro não negativo ou `null` quando não informado;
- `errorCode` em falha, sem texto bruto da exceção ou dados da mensagem.

Preservar zeros reais de tokens, sem substituir ausência por zero e sem estimar valores. A duração total HTTP pode usar os logs nativos do Fastify, sem ser confundida com latência de inferência. Logger recebe somente campos permitidos; não serializar corpo, cabeçalhos de autorização, mensagens LangChain ou objetos de erro brutos. Pedidos rejeitados antes do runtime não geram evento de inferência.

## Foco da revisão e verificações

1. Entrada inválida ou excessiva não aciona o modelo — tarefa 2.
2. Prazo limita a chamada externa e não duplica inferências — tarefa 1, confirmação real de cancelamento se o provedor permitir observá-lo.
3. Metadados ausentes, tokens zero e resposta sem texto têm tratamento explícito — tarefa 1.
4. Falhas mantêm correlação e não vazam credenciais ou conteúdo — tarefas 1 e 2.
5. Requisições consecutivas e concorrentes não compartilham estado — tarefa 2.

## Tarefas ordenadas

### 1. Runtime mínimo e tracing testáveis

Arquivos: configuração de projeto, `.gitignore`, `.env.example`, `src/config.ts`, `src/agent/runtime.ts`, `tests/config.test.ts`, `tests/agent-runtime.test.ts`.

- [x] Fixar versões compatíveis e scripts: `typecheck` (`tsc --noEmit`), `build` (`tsc`), `start` (`node dist/main.js`), `test` (`vitest run --exclude '**/*.real.test.ts'`) e `test:integration:real` (`vitest run tests/agent-runtime.real.test.ts`). A compilação deve gerar `dist/main.js` e excluir testes do build.
- [x] Escrever testes de configuração e runtime antes da implementação e observar falhas. Usar o grafo real com um modelo controlado pela interface LangChain; não mockar o grafo inteiro.
- [x] Implementar configuração e `createAgentRuntime` conforme os contratos. Testar instruções + mensagem, uma chamada, texto/blocos, falta de texto, erro, timeout com sinal abortado e estado novo por execução.
- [x] Capturar o logger: verificar evento único, IDs, modelos, duração não negativa, uso parcial/ausente, zeros e ausência de conteúdo/segredos tanto em sucesso quanto em falha. Usar relógio controlado nos testes de duração e prazo.
- [x] Executar `npm run typecheck` e `npm test -- tests/config.test.ts tests/agent-runtime.test.ts`; exigir saída sem erros. Registrar progresso e commit coerente quando Git estiver disponível.

Entrega verificável: grafo de uma inferência, sem transporte, testado deterministicamente. Não comprova conectividade com LLM real.

### 2. Caminho HTTP completo

Depende da tarefa 1. Arquivos: `src/http/app.ts`, `src/main.ts`, `tests/http.test.ts`, `tests/composition.test.ts`.

- [x] Escrever e observar falhar testes de `buildApp({ runtime, logger })`, usando Fastify `inject` e o runtime real com modelo controlado. Não abrir porta nos testes automatizados comuns.
- [x] Implementar schemas Zod estritos de entrada e saída, correlação e a rota. Validar erros de parsing/limite do Fastify e erros do runtime conforme a tabela.
- [x] Testar sucesso, mensagem ausente/vazia/não textual, limites, propriedades extras, JSON malformado, conteúdo não suportado, erros e timeout. Em pedidos inválidos exigir zero chamadas ao modelo; em falhas exigir sanitização e correlação com o evento terminal.
- [x] Testar dois pedidos sequenciais e dois concorrentes: IDs de execução distintos e cada chamada recebe somente sua própria mensagem. Testar que cabeçalho de correlação do cliente não substitui o ID gerado pelo servidor.
- [x] Exportar de `main.ts` uma função de composição, sem escutar no import, que constrói `ChatOpenAI` com a configuração explícita e injeta modelo e metadados no runtime. Iniciar o servidor local apenas no entrypoint, sem exportação externa de tracing. Configuração obrigatória ausente ou inválida deve impedir inicialização antes de escutar, sem revelar valores.
- [x] Em `tests/config.test.ts`, cobrir os três valores de provedor, campos obrigatórios, URL inválida/com credenciais e provedor desconhecido. Em `tests/composition.test.ts`, testar a composição com três configurações e cliente controlado: exigir repasse de `apiKey`, `model`, `configuration.baseURL`, retries desativados e metadados corretos, sem alterar o runtime nem fazer rede. Configurar variáveis OpenAI conflitantes no teste e comprovar que não substituem a configuração explícita. Esses testes não comprovam integração externa.
- [x] Executar `npm run typecheck`, `npm test` e `npm run build`; exigir sucesso. Registrar progresso e commit coerente quando possível.

Entrega verificável: contrato HTTP e grafo integrados localmente com dependência de modelo controlada. Ainda não comprova integração externa.

### 3. Validação real e instruções reproduzíveis

Depende da tarefa 2 e de credencial, rede e modelo disponíveis. Arquivos: `tests/agent-runtime.real.test.ts`, `README.md` e atualização deste plano.

- [x] Criar teste opt-in que usa a função de composição real de `main.ts` (mesmo adaptador, grafo e API), inicia Fastify em `127.0.0.1` com porta `0`, envia HTTP real e fecha o servidor em `finally`. Para o primeiro aceite, exigir `LLM_PROVIDER=groq` e URL oficial Groq da tabela, com modelo e chave Groq configurados; não registrar valores sensíveis.
- [x] O comando explícito deve falhar se faltar configuração; não passar silenciosamente por teste pulado. Limitar a chamada ao prazo configurado e o teste a esse prazo mais uma margem de 5 segundos.
- [ ] Enviar `Responda com uma saudação curta em português.` e exigir HTTP 200, texto não vazio, IDs e evento terminal correspondente. Não exigir texto exato nem contagem fixa de tokens. Conferir provedor/modelo e tokens disponíveis; registrar ausência como tal.
- [ ] Executar o comando real abaixo com Groq, sem mocks, e registrar data, comando, provedor, modelo configurado, resultado e referência ao `runId` no registro de verificação, sem segredos ou conteúdo sensível. Se houver bloqueio externo, manter objetivo aberto. Testes reais adicionais com OpenRouter ou outro endpoint são opcionais e separados; não substituem o primeiro aceite com Groq nem exigem mudanças no runtime.
- [x] Acrescentar ao README somente instruções verificadas de configuração, build, execução, curl e diferença entre testes comuns e reais. Registrar progresso e commit coerente quando possível.

### 4. Aceite e encerramento do objetivo

- [x] Em ambiente limpo com dependências do lockfile, executar as verificações locais e conferir os resultados; integração real permanece na tarefa 3.
- [x] Revisar as alterações contra exclusões e contratos: nenhuma infraestrutura ou capacidade futura introduzida, nenhum segredo incluído nos arquivos, nenhuma promessa de persistência. Sem Git acessível, a revisão foi feita pela leitura dos arquivos e dos testes.
- [ ] Marcar concluído somente com teste HTTP real bem-sucedido e tracing correspondente, além das verificações automatizadas. Registrar evidências e parar; não iniciar o próximo objetivo.

## Comandos previstos

Os scripts abaixo estão implementados. Testes automatizados, typecheck e build passaram; o teste real permanece pendente e a abertura da porta foi bloqueada pelo executor. Para o primeiro teste real, configurar `LLM_PROVIDER=groq`, `LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_MODEL` com um modelo habilitado e `LLM_API_KEY` com a chave Groq exportada de forma segura, sem incluí-la em comandos registrados ou documentação. `.env.example` documenta o formato, sem pressupor carregamento automático de `.env`.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:integration:real
npm start
```

Com o servidor iniciado, em outro terminal:

```bash
curl --fail-with-body --silent --show-error \
  http://127.0.0.1:3000/v1/agent-runs \
  -H 'Content-Type: application/json' \
  -d '{"message":"Responda com uma saudação curta em português."}'
```

## Critérios de aceite e condição de conclusão

- Pedido válido percorre HTTP e LangGraph, realiza uma inferência externa real na Groq e retorna texto e identificadores.
- Groq, OpenRouter e endpoint OpenAI-compatible são configuráveis na mesma composição, com URL/chave/modelo explícitos e sem alteração no runtime. Testes de configuração e composição passam; somente caminhos efetivamente testados com rede podem ser declarados integrações reais validadas.
- Tracing contém correlação, modelo configurado, modelo informado quando disponível, latência e tokens efetivamente fornecidos; erros também têm evento terminal sanitizado.
- Pedidos inválidos não acionam LLM; erros e prazo seguem o contrato; execuções não compartilham contexto.
- Typecheck, build, testes automatizados e teste HTTP com LLM real passam. Testes controlados não substituem o último.
- Nenhuma dependência ou funcionalidade excluída foi antecipada. README contém instruções executáveis verificadas.

**Registro de execução — 2026-10-29:**

- Diretório confirmado: `/home/lucns/alaric`. `git status --short` retorna `fatal: not a git repository`; não é possível criar worktree ou commits neste ambiente. Não inicializar outro repositório sobre os metadados indisponíveis.
- Documentação oficial consultada: [Node.js LTS](https://nodejs.org/en/about/previous-releases), [LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api), [ChatOpenAI](https://docs.langchain.com/oss/javascript/integrations/chat/openai), [Fastify](https://fastify.dev/docs/latest/Reference/Server/), [Zod](https://zod.dev/basics), [Vitest](https://vitest.dev/guide/) e [Groq](https://console.groq.com/docs/openai). Versões e compatibilidade ainda não fixadas nem verificadas por instalação.
- Interfaces entre tarefas revisadas: tarefa 2 consome `createAgentRuntime` da tarefa 1; tarefa 3 consome a composição exportada por `main.ts` na tarefa 2; tarefa 4 exige as evidências anteriores. Não foi identificado conflito que exija alterar a arquitetura.
- Escritos `tests/config.test.ts` e `tests/agent-runtime.test.ts` para os contratos da tarefa 1, incluindo validação, isolamento de estado, tracing, sanitização e cancelamento. Esses testes ainda não foram executados; não são evidência de comportamento implementado.
- Tentativa: `npm test -- tests/config.test.ts tests/agent-runtime.test.ts` → `/bin/bash: npm: command not found` (saída 127). `node --version` também indisponível. `curl -I --max-time 15 https://nodejs.org/dist/index.json` → falha de resolução DNS. Não foi possível instalar ferramentas ou dependências, gerar lockfile, executar a fase vermelha, typecheck ou build.
- `LLM_API_KEY`, `GROQ_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` e `LLM_PROVIDER` não estavam definidos no ambiente da execução; somente sua presença foi consultada. Nenhuma credencial foi lida de arquivos ou exposta. Integração real Groq não executada.
- Não foi criado código de aplicação, manifesto com versões não verificadas ou lockfile fictício. README preservado, sem anunciar comandos ou funcionalidades ainda não implementados.

**Diagnóstico complementar do ambiente — 2026-10-29:** usuário `lucns` (UID 1000), diretório canônico `/home/lucns/alaric`, Linux/WSL2. O diretório do projeto é uma montagem direta da mesma localização no filesystem ext4, não uma cópia em `/tmp`. Entretanto, `/proc/self/mountinfo` mostra `.git` encoberto por `tmpfs` vazio e somente leitura; por isso não é possível confirmar raiz Git, branch ou origem neste namespace. `/usr/bin/git` está instalado e executa (`2.53.0`); não está ausente. Não há variáveis `GIT_DIR`/`GIT_WORK_TREE` interferindo. Node.js/npm não aparecem nos diretórios existentes do PATH, nos caminhos usuais examinados ou como pacotes instalados pelo dpkg; o resultado é o mesmo sem shell de login. Isso não comprova sua ausência no host fora do sandbox. DNS falha com errno `-3` para `nodejs.org`, `registry.npmjs.org` e `api.groq.com`; curl confirma falha de resolução para Node.js e npm. Não foi possível avaliar HTTPS após essa falha de DNS. Configuração Groq continua ausente no ambiente, consultada somente por presença. Nenhuma ferramenta instalada, configuração de rede alterada ou repositório inicializado; testes existentes preservados.

**Retomada após preparação do WSL — 2026-10-29:**

- Carregado `~/.nvm/nvm.sh`: Node.js `24.22.2` e npm `11.19.1` disponíveis. Git continua sem acesso a um checkout reconhecido; sem commits.
- Preparados `package.json`, `tsconfig.json`, `.node-version`, `.gitignore` e `.env.example`, sem recriar os testes existentes. Node.js fixado na versão observada; faixas iniciais das dependências estão no manifesto, mas sua resolução e compatibilidade ainda dependem de instalação. Não há lockfile fabricado.
- `npm install --cache /tmp/alaric-npm-cache --fetch-retries=0 --fetch-timeout=10000 --ignore-scripts --no-audit --no-fund` falhou com `EAI_AGAIN` ao resolver `registry.npmjs.org`. Não havia cache local das dependências. Uma solicitação de consulta npm com permissões elevadas foi rejeitada pela política do executor (`sandbox_approval: false`); nenhuma autorização foi apresentada ao usuário por esse mecanismo.
- `npm test -- tests/config.test.ts tests/agent-runtime.test.ts` → saída 127, `vitest: not found`. `npm run typecheck` e `npm run build` → saída 127, `tsc: not found`. São falhas de pré-requisito, não evidências da fase vermelha funcional ou de comportamento do runtime. Nenhum teste passou ou foi efetivamente executado.
- Código de aplicação ainda não iniciado: os passos de implementação dependem de instalar as bibliotecas e executar os testes existentes. A ausência de chave Groq não é o bloqueio desta etapa.

**Resultado da retomada com dependências instaladas — 2026-10-29:**

- Tarefa 1 concluída: configuração Zod e runtime LangGraph de um nó, estados isolados, instruções + mensagem, texto/blocos, prazo com AbortSignal, erros sanitizados e evento terminal correlacionado. Os testes existentes foram reaproveitados; a execução vermelha registrou 13 falhas pela implementação ausente, seguida de 30 testes aprovados após implementar.
- Tarefa 2 concluída: Fastify, schemas HTTP estritos, IDs gerados no servidor, respostas e códigos de erro, limite de corpo, logs sem conteúdo/headers/URL e composição com ChatOpenAI. Groq, OpenRouter e endpoints compatíveis usam os mesmos runtime e cliente, por configuração explícita. Testes de transporte controlado comprovam endpoint, chave/modelo configurados, cancelamento até o cliente HTTP e ausência de retries; não comprovam serviço externo.
- Pacotes fixados no manifesto e lockfile: Node.js 24.22.2; @langchain/core 1.3.2, @langchain/langgraph 1.5.3, @langchain/openai 1.8.0, Fastify 5.12.7, Zod 4.6.7, TypeScript 5.9.3, Vitest 4.1.12 e @types/node 24.19.2. Nenhuma dependência de persistência ou capacidade futura.
- Correção comprovada por teste vermelho→verde: ChatOpenAI 1.8.0 omite zeros em `usage_metadata`; o tracing complementa contagens com `response_metadata.usage` preservado pela própria integração. Testes cobrem zeros, ausência e uso parcial, sem estimar campos ausentes.
- Verificações locais: `npm test` → 56 testes aprovados em quatro arquivos; `npm run typecheck` e `npm run build` → sucesso. Reinstalação offline pelo lockfile em diretório temporário limpo (`npm ci --offline --ignore-scripts --no-audit --no-fund`, usando cache existente), seguida dos mesmos 56 testes, typecheck e build → sucesso.
- Revisão técnica final independente identificou um vazamento por flags globais de verbosity/tracing do LangChain, fora do logger sanitizado. Corrigido com rejeição sanitizada na composição antes de criar o runtime; cinco testes reproduziram a falha antes da correção e passaram depois. Verificação final: `npm test` → **61 testes aprovados**, `npm run typecheck` e `npm run build` → sucesso. Não restaram achados relevantes da revisão sem tratamento.
- Entrypoint compilado sem configuração → saída 1 e mensagem sanitizada. Tentativa de HTTP real local com aplicação compilada e upstream controlado → `listen EPERM` em `127.0.0.1`. Nenhuma elevação solicitada; o contrato HTTP foi validado com Fastify `inject`, não por socket neste executor.
- Tarefa 3 parcialmente concluída: teste real opt-in implementado, sem mocks e sem skip silencioso. `npm run test:integration:real` foi executado e falhou explicitamente por ausência de `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY` e `LLM_MODEL`; nenhuma chamada Groq validada e nenhum runId real produzido. README atualizado com implementação, comandos e limites efetivamente observados.
- O `.git` permanece inacessível neste executor; não foi recriado e não há commits desta execução. Git não bloqueou a implementação e os testes locais.

**Tentativa de aceite externo — 2026-10-30:**

- `.env` presente; regra literal `.env` confirmada no `.gitignore`. `git check-ignore .env` e consulta ao índice falharam porque o Git não reconhece os metadados acessíveis neste executor; não foi possível comprovar que o arquivo não está rastreado. README inclui a verificação exata no terminal WSL. Nenhum valor de credencial foi exibido ou incluído em arquivos de documentação.
- Carregamento com o mecanismo nativo do Node.js verificado: `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY` e `LLM_MODEL` definidos; `loadConfig` aceitou a configuração e confirmou Groq com URL oficial. Isso valida configuração, não autenticação ou disponibilidade do modelo no provedor.
- Executado `node --env-file=.env ./node_modules/vitest/vitest.mjs run tests/agent-runtime.real.test.ts`, sem mocks. Resultado: saída 1, `listen EPERM: operation not permitted 127.0.0.1`. A falha acontece antes da requisição HTTP e da chamada ao modelo; não houve resposta, runId de inferência, latência ou uso de tokens reais a registrar.
- Nenhum defeito de aplicação comprovado; nenhum código alterado, nenhuma elevação solicitada e nenhuma tentativa de contornar o bloqueio. A requisição HTTP por socket permanece impedida pela mesma restrição; os comandos exatos para o teste de integração e para aplicação compilada + curl estão no README.
- Verificação local repetida nesta tentativa: `npm test` → 61 testes aprovados; `npm run typecheck` e `npm run build` → sucesso. Esses resultados não substituem o aceite externo bloqueado.

**Pendências para o aceite externo:** no terminal WSL normal, confirmar que `.env` está ignorado e não rastreado, executar o teste real com carregamento explícito do `.env`, iniciar a aplicação compilada e enviar a requisição HTTP conforme README. Confirmar HTTP 200, conteúdo não vazio e evento `agent.inference` com requestId/runId correspondentes, status `success`, modelo, latência não negativa e tokens disponibilizados; registrar a evidência sem segredos. As etapas de integração das tarefas 3 e 4 continuam abertas. Nenhum trabalho do Plano 002 foi iniciado.
