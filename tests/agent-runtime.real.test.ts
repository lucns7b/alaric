import { expect, it } from 'vitest';
import { composeApplication } from '../src/main.js';
import { loadConfig } from '../src/config.js';
import { captureLogs } from './helpers.js';

const configuredTimeout = Number(process.env.LLM_TIMEOUT_MS ?? 30000);
const testTimeout = Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0
  && configuredTimeout <= 2147478647 ? configuredTimeout + 5000 : 35000;

it('executes HTTP → LangGraph → Groq with correlated tracing (no mocks)', async () => {
  const config = loadConfig(process.env);
  if (config.LLM_PROVIDER !== 'groq' || config.LLM_BASE_URL.replace(/\/$/, '') !== 'https://api.groq.com/openai/v1') {
    throw new Error('O primeiro aceite real exige Groq e sua URL oficial.');
  }
  const logs = captureLogs();
  const app = composeApplication(process.env, logs.logger);
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${address}/v1/agent-runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Responda com uma saudação curta em português.' }),
      signal: AbortSignal.timeout(config.LLM_TIMEOUT_MS + 1000),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.output).toEqual(expect.any(String));
    expect(body.output.trim().length).toBeGreaterThan(0);
    const events = logs.events.filter((event) => event.event === 'agent.inference');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ requestId: body.requestId, runId: body.runId,
      provider: 'groq', configuredModel: config.LLM_MODEL, status: 'success' });
    expect(events[0]?.durationMs).toEqual(expect.any(Number));
    const usage = events[0]?.usage as Record<string, unknown>;
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) {
      expect(usage[key] === null || (Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0)).toBe(true);
    }
    // Evidence contains metadata only; no credentials, request text or response text.
    console.info(JSON.stringify(events[0]));
  } finally { await app.close(); }
}, testTimeout);
