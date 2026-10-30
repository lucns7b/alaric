import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeApplication } from '../src/main.js';
import { captureLogs } from './helpers.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('provider composition', () => {
  it.each([
    ['groq', 'https://api.groq.com/openai/v1'],
    ['openrouter', 'https://openrouter.ai/api/v1'],
    ['openai-compatible', 'http://127.0.0.1:8080/v1'],
  ])('runs the same runtime through the configured %s transport', async (provider, baseURL) => {
    vi.stubEnv('OPENAI_API_KEY', 'conflicting-test-key');
    vi.stubEnv('OPENAI_BASE_URL', 'https://wrong.invalid/v1');
    const calls: { url: string; body: Record<string, unknown>; key: string | null }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push({ url: request.url, body: await request.json(), key: request.headers.get('authorization') });
      return Response.json({ id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: 'served-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Resposta de teste.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } });
    });
    const logs = captureLogs();
    const app = composeApplication({ LLM_PROVIDER: provider, LLM_BASE_URL: baseURL,
      LLM_API_KEY: 'configured-test-key', LLM_MODEL: 'configured-model' }, logs.logger);
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/agent-runs', payload: { message: 'hello' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().output).toBe('Resposta de teste.');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ url: `${baseURL}/chat/completions`, key: 'Bearer configured-test-key',
        body: { model: 'configured-model', stream: false } });
      expect(logs.events.find((event) => event.event === 'agent.inference')).toMatchObject({
        provider, configuredModel: 'configured-model', responseModel: 'served-model',
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      });
      expect(JSON.stringify(logs.events)).not.toContain('configured-test-key');
    } finally { await app.close(); }
  });

  it('does not retry or fall back on upstream failure', async () => {
    let count = 0;
    vi.stubGlobal('fetch', async () => { count++; return Response.json({ error: { message: 'upstream-secret' } }, { status: 500 }); });
    const logs = captureLogs();
    const app = composeApplication({ LLM_PROVIDER: 'groq', LLM_BASE_URL: 'https://api.groq.com/openai/v1',
      LLM_API_KEY: 'configured-test-key', LLM_MODEL: 'test-model' }, logs.logger);
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/agent-runs', payload: { message: 'hello' } });
      expect(response.statusCode).toBe(502);
      expect(count).toBe(1);
      expect(JSON.stringify(logs.events) + response.body).not.toContain('upstream-secret');
    } finally { await app.close(); }
  });

  it('fails before server creation when required configuration is absent', () => {
    expect(() => composeApplication({})).toThrow('Configuração inválida');
  });

  it.each(['LANGCHAIN_VERBOSE', 'LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2',
    'LANGSMITH_TRACING', 'LANGSMITH_TRACING_V2'])(
    'rejects implicit logging/export enabled by global %s before building the runtime', (flag) => {
      vi.stubEnv(flag, 'true');
      expect(() => composeApplication({ LLM_PROVIDER: 'groq', LLM_BASE_URL: 'https://api.groq.com/openai/v1',
        LLM_API_KEY: 'private-test-key', LLM_MODEL: 'test-model' }, false))
        .toThrow('Tracing externo ou verbose não é permitido neste runtime.');
    });

  it.each([
    [{ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }],
    [{ prompt_tokens: 0, completion_tokens: 2 }, { inputTokens: 0, outputTokens: 2, totalTokens: null }],
    [undefined, { inputTokens: null, outputTokens: null, totalTokens: null }],
  ])('preserves zero and partial upstream usage without estimating missing counts', async (usage, expected) => {
    vi.stubGlobal('fetch', async () => Response.json({ id: 'chatcmpl-test', object: 'chat.completion',
      created: 1, model: 'test-model', usage,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Olá!' }, finish_reason: 'stop' }] }));
    const logs = captureLogs();
    const app = composeApplication({ LLM_PROVIDER: 'groq', LLM_BASE_URL: 'https://api.groq.com/openai/v1',
      LLM_API_KEY: 'test-key', LLM_MODEL: 'test-model' }, logs.logger);
    try {
      const result = await app.inject({ method: 'POST', url: '/v1/agent-runs', payload: { message: 'hello' } });
      expect(result.statusCode).toBe(200);
      expect(logs.events.find((event) => event.event === 'agent.inference')?.usage).toEqual(expected);
    } finally { await app.close(); }
  });

  it('propagates deadline cancellation through ChatOpenAI to the HTTP transport', async () => {
    let signal: AbortSignal | null | undefined;
    let calls = 0;
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) reject(new Error('aborted'));
        else signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const app = composeApplication({ LLM_PROVIDER: 'groq', LLM_BASE_URL: 'https://api.groq.com/openai/v1',
      LLM_API_KEY: 'test-key', LLM_MODEL: 'test-model', LLM_TIMEOUT_MS: '30' }, false);
    try {
      const result = await app.inject({ method: 'POST', url: '/v1/agent-runs', payload: { message: 'hello' } });
      expect(result.statusCode).toBe(504);
      expect(calls).toBe(1);
      expect(signal?.aborted).toBe(true);
    } finally { await app.close(); }
  });
});
