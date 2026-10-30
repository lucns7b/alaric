import { AIMessage } from '@langchain/core/messages';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentRuntime } from '../src/agent/runtime.js';
import { ControlledChatModel } from './helpers.js';


function setup(model = new ControlledChatModel(), timeoutMs = 30000) {
  const logger = { info: vi.fn() };
  const runtime = createAgentRuntime({
    model,
    modelMetadata: { provider: 'groq', configuredModel: 'test-model' },
    agent: { id: 'default', instructions: 'test-system-instructions' },
    timeoutMs,
    logger,
  });
  return { model, logger, runtime };
}

afterEach(() => vi.useRealTimers());

describe('createAgentRuntime', () => {
  it('executes one inference with system instructions and the user message', async () => {
    const { model, runtime } = setup();
    const result = await runtime.run({ message: 'test-user-message', requestId: 'req-1' });

    expect(result).toMatchObject({ agentId: 'default', output: 'Olá!' });
    expect(result.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    expect(model.inputs).toHaveLength(1);
    expect(model.inputs[0]?.map((message) => message.content)).toEqual([
      'test-system-instructions', 'test-user-message',
    ]);
    expect(model.inputs[0]?.map((message) => message.getType())).toEqual(['system', 'human']);
  });

  it('emits a correlated event with actual usage and response model', async () => {
    const { runtime, logger } = setup(new ControlledChatModel(new AIMessage({
      content: 'Olá!',
      response_metadata: { model_name: 'reported-model' },
      usage_metadata: { input_tokens: 5, output_tokens: 0, total_tokens: 5 },
    })));
    const result = await runtime.run({ message: 'test-user-message', requestId: 'req-2' });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({
      event: 'agent.inference', requestId: 'req-2', runId: result.runId,
      agentId: 'default', provider: 'groq', configuredModel: 'test-model',
      responseModel: 'reported-model', status: 'success',
      usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      timestamp: expect.any(String), durationMs: expect.any(Number),
    });
    expect(logger.info.mock.calls[0]?.[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/test-user-message|test-system-instructions/);
  });

  it('records missing usage and response model as null rather than fabricated zeros', async () => {
    const { runtime, logger } = setup();
    await runtime.run({ message: 'hello', requestId: 'req-3' });
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({
      responseModel: null,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    });
  });

  it('normalizes text blocks without including non-text blocks', async () => {
    const { runtime } = setup(new ControlledChatModel(new AIMessage({
      content: [
        { type: 'text', text: 'Olá' },
        { type: 'image_url', image_url: 'https://example.invalid/image.png' },
        { type: 'text', text: ' mundo!' },
      ],
    })));
    await expect(runtime.run({ message: 'hello', requestId: 'req-4' }))
      .resolves.toMatchObject({ output: 'Olá mundo!' });
  });

  it.each([
    new AIMessage('   '),
    new AIMessage({ content: [{ type: 'image_url', image_url: 'https://example.invalid/image.png' }] }),
    new Error('test-provider-secret test-user-message'),
  ])('returns sanitized, correlated MODEL_ERROR on unusable output or provider failure', async (response) => {
    const { runtime, logger, model } = setup(new ControlledChatModel(response));
    const failure = await runtime.run({ message: 'test-user-message', requestId: 'req-5' })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'MODEL_ERROR', runId: expect.any(String) });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({
      runId: (failure as { runId: string }).runId,
      status: 'error', errorCode: 'MODEL_ERROR',
    });
    expect(model.inputs).toHaveLength(1);
    expect(String(failure)).not.toContain('test-provider-secret');
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/test-provider-secret|test-user-message/);
  });

  it('aborts the inference on deadline and emits exactly one timeout event', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { runtime, model, logger } = setup(new ControlledChatModel(new AIMessage('late'), true), 100);
    const result = runtime.run({ message: 'hello', requestId: 'req-timeout' })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    const failure = await result;

    expect(failure).toMatchObject({ code: 'MODEL_TIMEOUT', runId: expect.any(String) });
    expect(model.observedSignal?.aborted).toBe(true);
    expect(model.inputs).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({
      status: 'timeout', errorCode: 'MODEL_TIMEOUT', durationMs: 100,
    });
  });

  it('isolates state and execution identifiers across sequential and concurrent runs', async () => {
    const { runtime, model } = setup();
    const first = await runtime.run({ message: 'first', requestId: 'a' });
    const rest = await Promise.all([
      runtime.run({ message: 'second', requestId: 'b' }),
      runtime.run({ message: 'third', requestId: 'c' }),
    ]);
    expect(new Set([first, ...rest].map((result) => result.runId)).size).toBe(3);
    expect(model.inputs.map((messages) => messages.map((message) => message.content)))
      .toEqual([
        ['test-system-instructions', 'first'],
        ['test-system-instructions', 'second'],
        ['test-system-instructions', 'third'],
      ]);
  });
});
