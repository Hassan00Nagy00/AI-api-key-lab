import { ApiKeyRecord } from '../types/key';
import { ProviderConfig } from '../types/provider';

export interface GeneratedConfig {
  id: string;
  title: string;
  language: string;
  code: string;
}

export class ConfigGenerator {
  /**
   * Generate configuration snippets for various developer tools
   */
  static generateAll(
    key: ApiKeyRecord,
    provider: ProviderConfig,
    modelId: string,
    rawKey?: string
  ): GeneratedConfig[] {
    const keyVal = rawKey || 'YOUR_API_KEY_HERE';
    const baseUrl = key.customBaseUrl || provider.baseUrl || 'https://api.openai.com/v1';
    const configs: GeneratedConfig[] = [];

    // 1. Python OpenAI SDK
    configs.push({
      id: 'python-openai',
      title: 'Python (openai)',
      language: 'python',
      code: `from openai import OpenAI

client = OpenAI(
    api_key="${keyVal}",
    base_url="${baseUrl}"
)

response = client.chat.completions.create(
    model="${modelId}",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)`,
    });

    // 2. TypeScript / JavaScript OpenAI SDK
    configs.push({
      id: 'js-openai',
      title: 'JavaScript / TypeScript (openai)',
      language: 'typescript',
      code: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${keyVal}",
  baseURL: "${baseUrl}",
});

async function main() {
  const response = await client.chat.completions.create({
    model: "${modelId}",
    messages: [{ role: "user", content: "Hello!" }],
  });

  console.log(response.choices[0].message.content);
}

main();`,
    });

    // 3. cURL
    let curlHeaders = `-H "Content-Type: application/json"`;
    if (provider.protocol === 'anthropic-compatible') {
      curlHeaders += ` \\\n  -H "x-api-key: ${keyVal}" \\\n  -H "anthropic-version: 2023-06-01"`;
    } else if (provider.protocol === 'google-gemini') {
      curlHeaders += ` \\\n  -H "x-goog-api-key: ${keyVal}"`;
    } else {
      curlHeaders += ` \\\n  -H "Authorization: Bearer ${keyVal}"`;
    }

    const endpoint = provider.protocol === 'anthropic-compatible'
      ? `${baseUrl}/v1/messages`
      : provider.protocol === 'google-gemini'
      ? `${baseUrl}/models/${modelId}:generateContent`
      : `${baseUrl}/chat/completions`;

    configs.push({
      id: 'curl',
      title: 'cURL',
      language: 'bash',
      code: `curl -X POST "${endpoint}" \\
  ${curlHeaders} \\
  -d '{
    "model": "${modelId}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
    });

    // 4. .env file
    const envVarName = provider.id.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY';
    configs.push({
      id: 'dotenv',
      title: '.env',
      language: 'bash',
      code: `# AI API Key Lab configuration
${envVarName}="${keyVal}"
${provider.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL="${baseUrl}"
${provider.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_MODEL="${modelId}"`,
    });

    // 5. Cursor AI / Claude Code configuration if compatible
    if (provider.protocol === 'openai-compatible') {
      configs.push({
        id: 'cursor',
        title: 'Cursor AI (.cursorrules / Settings)',
        language: 'json',
        code: JSON.stringify(
          {
            "cursor.ai.customModels": [
              {
                "modelName": modelId,
                "baseURL": baseUrl,
                "apiKey": keyVal
              }
            ]
          },
          null,
          2
        ),
      });
    }

    if (provider.protocol === 'anthropic-compatible') {
      configs.push({
        id: 'claude-code',
        title: 'Claude Code CLI',
        language: 'bash',
        code: `export ANTHROPIC_API_KEY="${keyVal}"
export ANTHROPIC_BASE_URL="${baseUrl}"
claude --model "${modelId}"`,
      });
    }

    return configs;
  }
}
