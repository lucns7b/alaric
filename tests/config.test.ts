import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const environment = {
  LLM_PROVIDER: 'groq',
  LLM_BASE_URL: 'https://api.groq.com/openai/v1',
  LLM_API_KEY: 'test-only-secret',
  LLM_MODEL: 'test-model',
};

describe('loadConfig', () => {
  it.each([
    ['groq', 'https://api.groq.com/openai/v1'],
    ['openrouter', 'https://openrouter.ai/api/v1'],
    ['openai-compatible', 'http://127.0.0.1:8080/v1'],
  ])('accepts explicit configuration for %s', (provider, baseURL) => {
    const config = loadConfig({
      ...environment,
      LLM_PROVIDER: provider,
      LLM_BASE_URL: baseURL,
    });

    expect(config).toMatchObject({
      LLM_PROVIDER: provider,
      LLM_BASE_URL: baseURL,
      LLM_API_KEY: 'test-only-secret',
      LLM_MODEL: 'test-model',
      AGENT_ID: 'default',
      AGENT_INSTRUCTIONS: 'Responda de forma clara e objetiva.',
      PORT: 3000,
      LLM_TIMEOUT_MS: 30000,
    });
  });

  it.each(['LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'])(
    'rejects missing %s without falling back to OpenAI environment variables',
    (name) => {
      const input: Record<string, string | undefined> = {
        ...environment,
        OPENAI_API_KEY: 'another-test-only-secret',
        OPENAI_BASE_URL: 'https://example.invalid/v1',
        [name]: undefined,
      };
      expect(() => loadConfig(input)).toThrow();
    },
  );

  it.each([
    { LLM_PROVIDER: 'unknown' },
    { LLM_API_KEY: '' },
    { LLM_MODEL: '   ' },
    { LLM_BASE_URL: 'not-a-url' },
    { LLM_BASE_URL: 'ftp://example.invalid/v1' },
    { LLM_BASE_URL: 'https://user:secret@example.invalid/v1' },
    { PORT: '0' },
    { PORT: '65536' },
    { LLM_TIMEOUT_MS: '0' },
    { LLM_TIMEOUT_MS: '1.5' },
    { AGENT_ID: '' },
    { AGENT_INSTRUCTIONS: '   ' },
  ])('rejects invalid configuration: %j', (override) => {
    expect(() => loadConfig({ ...environment, ...override })).toThrow();
  });

  it('converts numeric environment variables', () => {
    expect(loadConfig({ ...environment, PORT: '4321', LLM_TIMEOUT_MS: '1500' }))
      .toMatchObject({ PORT: 4321, LLM_TIMEOUT_MS: 1500 });
  });

  it('does not expose configuration values in validation errors', () => {
    let failure: unknown;
    try {
      loadConfig({ ...environment, LLM_BASE_URL: 'test-only-secret' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain('test-only-secret');
    expect(JSON.stringify(failure)).not.toContain('test-only-secret');
  });
});
