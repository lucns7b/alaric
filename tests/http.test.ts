import { AIMessage } from '@langchain/core/messages';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AgentRunError, createAgentRuntime } from '../src/agent/runtime.js';
import { buildApp } from '../src/http/app.js';
import { captureLogs, ControlledChatModel } from './helpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function setup(model = new ControlledChatModel(), timeoutMs = 30000) {
  const logs = captureLogs();
  const inference: Record<string, unknown>[] = [];
  const runtime = createAgentRuntime({ model,
    modelMetadata: { provider: 'groq', configuredModel: 'test-model' },
    agent: { id: 'default', instructions: 'private-instructions' }, timeoutMs,
    logger: { info: (event) => { inference.push(event); } },
  });
  const app = buildApp({ runtime, logger: logs.logger });
  apps.push(app);
  return { app, model, inference, logs };
}

describe('POST /v1/agent-runs', () => {
  it('validates the request and returns correlated output, ignoring client request IDs', async () => {
    const { app, model, inference } = setup();
    const response = await app.inject({ method: 'POST', url: '/v1/agent-runs',
      headers: { 'x-request-id': 'untrusted-id' }, payload: { message: '  hello  ' } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ requestId: expect.any(String), runId: expect.any(String),
      agentId: 'default', output: 'Olá!' });
    expect(body.requestId).not.toBe('untrusted-id');
    expect(inference).toHaveLength(1);
    expect(inference[0]).toMatchObject({ requestId: body.requestId, runId: body.runId });
    expect(model.inputs[0]?.at(-1)?.content).toBe('hello');
  });

  it.each([{}, { message: '' }, { message: '   ' }, { message: 1 },
    { message: 'x', model: 'unauthorized' }, { message: 'x'.repeat(8001) }])(
    'rejects invalid input without inference: %j', async (payload) => {
      const { app, model, inference } = setup();
      const response = await app.inject({ method: 'POST', url: '/v1/agent-runs', payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ requestId: expect.any(String),
        error: { code: 'INVALID_REQUEST', message: expect.any(String) } });
      expect(model.inputs).toHaveLength(0);
      expect(inference).toHaveLength(0);
    });

  it('accepts the maximum trimmed message length', async () => {
    const { app } = setup();
    const result = await app.inject({ method: 'POST', url: '/v1/agent-runs',
      payload: { message: ` ${'x'.repeat(8000)} ` } });
    expect(result.statusCode).toBe(200);
  });

  it.each([
    ['application/json', '{', 400, 'INVALID_REQUEST'],
    ['application/json', '', 400, 'INVALID_REQUEST'],
    ['application/json', JSON.stringify({ message: 'x'.repeat(65536) }), 413, 'PAYLOAD_TOO_LARGE'],
    ['application/xml', '<message>hello</message>', 415, 'UNSUPPORTED_MEDIA_TYPE'],
  ])('maps transport errors for %s', async (type, payload, status, code) => {
    const { app, model } = setup();
    const response = await app.inject({ method: 'POST', url: '/v1/agent-runs',
      headers: { 'content-type': type }, payload });
    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
    expect(response.json().runId).toBeUndefined();
    expect(model.inputs).toHaveLength(0);
  });

  it('sanitizes provider errors in HTTP and all logs', async () => {
    const { app, inference, logs } = setup(new ControlledChatModel(new Error('provider-secret')));
    const response = await app.inject({ method: 'POST', url: '/v1/agent-runs?secret=query-secret',
      headers: { authorization: 'Bearer header-secret' }, payload: { message: 'message-secret' } });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('MODEL_ERROR');
    expect(inference[0]).toMatchObject({ runId: response.json().runId, status: 'error' });
    expect(response.body + JSON.stringify(logs.events) + JSON.stringify(inference))
      .not.toMatch(/provider-secret|header-secret|message-secret|query-secret|private-instructions/);
  });

  it('returns 504 and aborts the model call on timeout', async () => {
    const { app, model, inference } = setup(new ControlledChatModel(new AIMessage('late'), true), 20);
    const response = await app.inject({ method: 'POST', url: '/v1/agent-runs', payload: { message: 'hello' } });
    expect(response.statusCode).toBe(504);
    expect(response.json().error.code).toBe('MODEL_TIMEOUT');
    expect(model.observedSignal?.aborted).toBe(true);
    expect(inference).toHaveLength(1);
  });

  it('isolates sequential and concurrent HTTP requests', async () => {
    const { app, model } = setup();
    const send = (message: string) => app.inject({ method: 'POST', url: '/v1/agent-runs', payload: { message } });
    const first = await send('first');
    const rest = await Promise.all([send('second'), send('third')]);
    const bodies = [first, ...rest].map((response) => response.json());
    expect(new Set(bodies.map((body) => body.runId)).size).toBe(3);
    expect(new Set(bodies.map((body) => body.requestId)).size).toBe(3);
    expect(model.inputs.map((input) => input.map((message) => message.content)))
      .toEqual([['private-instructions', 'first'], ['private-instructions', 'second'], ['private-instructions', 'third']]);
  });

  it.each([new Error('internal-secret'), new AgentRunError('INTERNAL_ERROR', '00000000-0000-4000-8000-000000000000')])(
    'sanitizes unexpected errors', async (error) => {
      const logs = captureLogs();
      const app = buildApp({ runtime: { run: vi.fn().mockRejectedValue(error) }, logger: logs.logger });
      apps.push(app);
      const result = await app.inject({ method: 'POST', url: '/v1/agent-runs', payload: { message: 'hello' } });
      expect(result.statusCode).toBe(500);
      expect(result.json().error.code).toBe('INTERNAL_ERROR');
      expect(result.body + JSON.stringify(logs.events)).not.toContain('internal-secret');
    });
});
