import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { Writable } from 'node:stream';

// Only the external inference is controlled: LangChain messages and the
// LangGraph execution must remain real in these tests.
export class ControlledChatModel extends BaseChatModel {
  readonly inputs: BaseMessage[][] = [];
  observedSignal: AbortSignal | undefined;

  constructor(
    readonly response: AIMessage | Error = new AIMessage('Olá!'),
    readonly waitForAbort = false,
  ) {
    super({});
  }

  _llmType(): string {
    return 'controlled-test-model';
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): Promise<ChatResult> {
    this.inputs.push(messages);
    this.observedSignal = options.signal;

    if (this.waitForAbort) {
      await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(new Error('cancelled-test-inference'));
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
      });
    }

    if (this.response instanceof Error) throw this.response;
    return { generations: [{ text: this.response.text, message: this.response }] };
  }
}


export function captureLogs() {
  const events: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of chunk.toString().trim().split('\n')) events.push(JSON.parse(line));
      done();
    },
  });
  return { events, logger: { stream } };
}
