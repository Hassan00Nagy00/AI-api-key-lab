export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
  reasoningContent?: string;
  model?: string;
  latencyMs?: number;
  tokensUsed?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  keyId: string;
  providerId: string;
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  createdAt: string;
  updatedAt: string;
}
