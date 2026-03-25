import { LobsterPotDaemonConfig, PotStatus, SmartDecision, SmartDecisionClient } from './daemon-types.js';

interface OpenAiStyleResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface OllamaResponse {
  message?: {
    content?: string;
  };
}

function extractJson(text: string): SmartDecision {
  try {
    const parsed = JSON.parse(text) as Partial<SmartDecision>;
    if (
      parsed.action &&
      ['done', 'continue', 'needs_human', 'pause'].includes(parsed.action) &&
      typeof parsed.summary === 'string'
    ) {
      return parsed as SmartDecision;
    }
  } catch {
    // Fall through to a safe default.
  }
  return {
    action: 'needs_human',
    summary: text.slice(0, 280) || 'Smart decision provider returned an invalid response.',
  };
}

export class CheapSmartLlmClient implements SmartDecisionClient {
  constructor(private readonly config: LobsterPotDaemonConfig) {}

  async analyzePot(pot: PotStatus, transcript: string, prompt: string): Promise<SmartDecision> {
    if (!this.config.llm.enabled) {
      return {
        action: 'needs_human',
        summary: 'Cheap smart-analysis disabled in daemon config.',
      };
    }

    const provider = this.config.llm.provider;
    const timeoutMs = this.config.llm.timeoutMs ?? 15000;
    const requestPrompt = [
      'Return compact JSON only: {"action":"done|continue|needs_human|pause","summary":"..."}',
      `Pot id: ${pot.id}`,
      `Agent: ${pot.agent}`,
      `Current state: ${pot.state}`,
      `Reason: ${pot.inspectionReason}`,
      `Task: ${pot.task ?? 'unknown'}`,
      `Transcript:\n${transcript.slice(-4000)}`,
      `Question: ${prompt}`,
    ].join('\n\n');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (provider === 'ollama') {
        const response = await fetch(this.config.llm.baseUrl ?? 'http://127.0.0.1:11434/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.config.llm.model,
            stream: false,
            messages: [{ role: 'user', content: requestPrompt }],
          }),
          signal: controller.signal,
        });
        const data = (await response.json()) as OllamaResponse;
        return extractJson(data.message?.content ?? '');
      }

      const baseUrl =
        this.config.llm.baseUrl ??
        (provider === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : 'http://127.0.0.1:1234/v1');
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (provider === 'openrouter' && this.config.llm.apiKeyEnv) {
        const apiKey = process.env[this.config.llm.apiKeyEnv];
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.config.llm.model,
          temperature: 0.1,
          messages: [{ role: 'user', content: requestPrompt }],
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as OpenAiStyleResponse;
      return extractJson(data.choices?.[0]?.message?.content ?? '');
    } finally {
      clearTimeout(timer);
    }
  }
}
