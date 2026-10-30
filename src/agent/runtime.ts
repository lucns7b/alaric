import { randomUUID } from 'node:crypto';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, type AIMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

export interface InferenceLogger {
  info(fields: Record<string, unknown>): void;
}

export interface AgentRunResult {
  runId: string;
  agentId: string;
  output: string;
}

export class AgentRunError extends Error {
  constructor(
    readonly code: 'MODEL_ERROR' | 'MODEL_TIMEOUT' | 'INTERNAL_ERROR',
    readonly runId: string,
  ) {
    super(code === 'MODEL_TIMEOUT' ? 'Prazo da inferência esgotado.' : 'Não foi possível executar o agente.');
    this.name = 'AgentRunError';
  }
}

const State = Annotation.Root({
  message: Annotation<string>(),
  requestId: Annotation<string>(),
  runId: Annotation<string>(),
  output: Annotation<string>(),
});

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function usageCounts(value: unknown, responseUsage: unknown) {
  const usage = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const raw = typeof responseUsage === 'object' && responseUsage !== null
    ? responseUsage as Record<string, unknown> : {};
  // ChatOpenAI 1.8 omits zero counts from usage_metadata, but preserves them here.
  return {
    inputTokens: tokenCount(usage.input_tokens ?? raw.prompt_tokens),
    outputTokens: tokenCount(usage.output_tokens ?? raw.completion_tokens),
    totalTokens: tokenCount(usage.total_tokens ?? raw.total_tokens),
  };
}

export function createAgentRuntime(options: {
  model: BaseChatModel;
  modelMetadata: { provider: string; configuredModel: string };
  agent: { id: string; instructions: string };
  timeoutMs: number;
  logger: InferenceLogger;
}) {
  const { model, modelMetadata, agent, timeoutMs, logger } = options;
  const graph = new StateGraph(State)
    .addNode('inference', async (state) => {
      const controller = new AbortController();
      const start = performance.now();
      let response: AIMessage | undefined;
      let failure: AgentRunError | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new AgentRunError('MODEL_TIMEOUT', state.runId));
          }, timeoutMs);
        });
        response = await Promise.race([
          model.invoke([
            new SystemMessage(agent.instructions),
            new HumanMessage(state.message),
          ], { signal: controller.signal }),
          deadline,
        ]);
        const content = response.content;
        const output = (typeof content === 'string' ? content : content
          .filter((block) => block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text).join('')).trim();
        if (!output) throw new AgentRunError('MODEL_ERROR', state.runId);
        return { output };
      } catch {
        failure = new AgentRunError(controller.signal.aborted ? 'MODEL_TIMEOUT' : 'MODEL_ERROR', state.runId);
        throw failure;
      } finally {
        clearTimeout(timer);
        const responseModel = response?.response_metadata.model_name ?? response?.response_metadata.model;
        logger.info({
          event: 'agent.inference', timestamp: new Date().toISOString(),
          requestId: state.requestId, runId: state.runId, agentId: agent.id,
          provider: modelMetadata.provider, configuredModel: modelMetadata.configuredModel,
          responseModel: typeof responseModel === 'string' ? responseModel : null,
          durationMs: performance.now() - start,
          status: failure ? (failure.code === 'MODEL_TIMEOUT' ? 'timeout' : 'error') : 'success',
          usage: usageCounts(response?.usage_metadata, response?.response_metadata.usage),
          ...(failure ? { errorCode: failure.code } : {}),
        });
      }
    })
    .addEdge(START, 'inference')
    .addEdge('inference', END)
    .compile();

  return {
    async run(input: { message: string; requestId: string }): Promise<AgentRunResult> {
      const runId = randomUUID();
      try {
        const result = await graph.invoke({ ...input, runId });
        return { runId, agentId: agent.id, output: result.output };
      } catch (error) {
        if (error instanceof AgentRunError) throw error;
        throw new AgentRunError('INTERNAL_ERROR', runId);
      }
    },
  };
}
