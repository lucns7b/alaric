import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import { AgentRunError, type AgentRunResult } from '../agent/runtime.js';

const inputSchema = z.strictObject({ message: z.string().trim().min(1).max(8000) });
const outputSchema = z.strictObject({
  requestId: z.string().min(1), runId: z.uuid(), agentId: z.string().min(1), output: z.string().min(1),
});
const errorSchema = z.strictObject({
  requestId: z.string().min(1),
  error: z.strictObject({ code: z.string(), message: z.string() }),
  runId: z.uuid().optional(),
});

const transportErrors: Record<string, [number, string, string]> = {
  FST_ERR_CTP_INVALID_JSON_BODY: [400, 'INVALID_REQUEST', 'JSON inválido.'],
  FST_ERR_CTP_EMPTY_JSON_BODY: [400, 'INVALID_REQUEST', 'Corpo JSON obrigatório.'],
  FST_ERR_CTP_BODY_TOO_LARGE: [413, 'PAYLOAD_TOO_LARGE', 'Corpo excede 64 KiB.'],
  FST_ERR_CTP_INVALID_MEDIA_TYPE: [415, 'UNSUPPORTED_MEDIA_TYPE', 'Tipo de conteúdo não suportado.'],
};

export function buildApp(options: {
  runtime: { run(input: { message: string; requestId: string }): Promise<AgentRunResult> };
  logger?: FastifyServerOptions['logger'];
}) {
  const app = Fastify({
    bodyLimit: 65536,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: true }),
    logger: options.logger === false ? false : {
      ...(typeof options.logger === 'object' ? options.logger : {}),
      serializers: {
        req: (request) => ({ method: request.method }),
        res: (reply) => ({ statusCode: reply.statusCode }),
        err: () => ({ type: 'Error', message: 'Erro interno.', stack: '' }),
      },
    },
  });

  app.addHook('onResponse', async (request, reply) => {
    app.log.info({ event: 'http.request', requestId: request.id,
      method: request.method, statusCode: reply.statusCode, durationMs: reply.elapsedTime });
  });

  app.setErrorHandler((error, request, reply) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Não foi possível processar a requisição.';
    let runId: string | undefined;
    if (error instanceof AgentRunError) {
      status = error.code === 'MODEL_TIMEOUT' ? 504 : error.code === 'MODEL_ERROR' ? 502 : 500;
      code = error.code;
      message = error.message;
      runId = error.runId;
    } else if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
      const mapped = transportErrors[error.code];
      if (mapped) [status, code, message] = mapped;
    }
    void reply.code(status).send(errorSchema.parse({ requestId: request.id,
      error: { code, message }, ...(runId ? { runId } : {}) }));
  });

  app.post('/v1/agent-runs', async (request, reply) => {
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorSchema.parse({ requestId: request.id,
        error: { code: 'INVALID_REQUEST', message: 'Informe apenas message, com 1 a 8.000 caracteres.' } }));
    }
    const result = await options.runtime.run({ message: parsed.data.message, requestId: request.id });
    return outputSchema.parse({ requestId: request.id, ...result });
  });
  return app;
}
