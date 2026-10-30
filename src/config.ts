import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const configSchema = z.object({
  LLM_PROVIDER: z.enum(['groq', 'openrouter', 'openai-compatible']),
  LLM_BASE_URL: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }),
  LLM_API_KEY: nonEmpty,
  LLM_MODEL: nonEmpty,
  AGENT_ID: nonEmpty.default('default'),
  AGENT_INSTRUCTIONS: nonEmpty.default('Responda de forma clara e objetiva.'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1).max(2147483647).default(30000),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(environment: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Configuração inválida: ${fields.join(', ')}`);
  }
  return result.data;
}
