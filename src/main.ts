import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatOpenAI } from '@langchain/openai';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { loadConfig } from './config.js';
import { createAgentRuntime } from './agent/runtime.js';
import { buildApp } from './http/app.js';

export function composeApplication(
  environment: Record<string, string | undefined> = process.env,
  logger?: FastifyServerOptions['logger'],
) {
  const implicitTracing = ['LANGCHAIN_VERBOSE', 'LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2',
    'LANGSMITH_TRACING', 'LANGSMITH_TRACING_V2'];
  if (implicitTracing.some((key) => {
    const value = process.env[key]?.trim().toLowerCase();
    return value && value !== 'false' && value !== '0';
  })) {
    throw new Error('Tracing externo ou verbose não é permitido neste runtime.');
  }
  const config = loadConfig(environment);
  const model = new ChatOpenAI({
    apiKey: config.LLM_API_KEY,
    model: config.LLM_MODEL,
    configuration: { baseURL: config.LLM_BASE_URL },
    maxRetries: 0,
    streaming: false,
    streamUsage: false,
    useResponsesApi: false,
  });
  const runtime = createAgentRuntime({
    model,
    modelMetadata: { provider: config.LLM_PROVIDER, configuredModel: config.LLM_MODEL },
    agent: { id: config.AGENT_ID, instructions: config.AGENT_INSTRUCTIONS },
    timeoutMs: config.LLM_TIMEOUT_MS,
    logger: { info: (event) => app.log.info(event) },
  });
  const app = buildApp({ runtime, ...(logger !== undefined ? { logger } : {}) });
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let app: FastifyInstance | undefined;
  try {
    const config = loadConfig(process.env);
    app = composeApplication(process.env);
    await app.listen({ host: '127.0.0.1', port: config.PORT });
    const shutdown = () => {
      void app?.close().catch(() => { process.exitCode = 1; });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    await app?.close();
    process.stderr.write('Não foi possível iniciar o Alaric. Verifique a configuração e a porta local.\n');
    process.exitCode = 1;
  }
}
