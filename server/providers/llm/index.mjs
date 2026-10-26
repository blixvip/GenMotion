// Text models that act as the "director": they turn a one-line idea into a storyboard. Most
// speak the OpenAI chat format, so one adapter covers OpenAI, DeepSeek, Qwen, Kimi, GLM, Grok,
// MiniMax and OpenRouter. Claude and Gemini get their own small adapters. Every default model
// can be overridden with <PROVIDER>_DIRECTOR_MODEL in .env.
import { request, ProviderError } from '../util.mjs';

const compat = (id, name, maker, region, key, base, models, signup, baseEnv) => ({
  id, name, maker, region, keys: [key], signup, models, defaultModel: models[0],
  async chat({ system, user, model, signal, fetch }, { key: k }) {
    const url = `${(baseEnv && process.env[baseEnv]) || base}/chat/completions`;
    const json = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.8 };
    if (id !== 'minimax') json.response_format = { type: 'json_object' };
    const data = await request(name, url, { method: 'POST', signal, fetch, timeout: 180_000, headers: { authorization: `Bearer ${k(key)}` }, json });
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError(name, 'empty reply');
    return text;
  }
});

const anthropic = {
  id: 'anthropic', name: 'Claude', maker: 'Anthropic', region: 'global',
  keys: ['ANTHROPIC_API_KEY'], signup: 'https://console.anthropic.com/settings/keys',
  models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], defaultModel: 'claude-sonnet-5-5',
  async chat({ system, user, model, signal, fetch }, { key }) {
    const data = await request(this.name, 'https://api.anthropic.com/v1/messages', {
      method: 'POST', signal, fetch, timeout: 180_000,
      headers: { 'x-api-key': key('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
      json: { model, max_tokens: 8000, system, messages: [{ role: 'user', content: user }] }
    });
    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text) throw new ProviderError(this.name, 'empty reply');
    return text;
  }
};

const gemini = {
  id: 'gemini', name: 'Gemini', maker: 'Google', region: 'global',
  keys: ['GEMINI_API_KEY'], signup: 'https://aistudio.google.com/apikey',
  models: ['gemini-2.5-flash', 'gemini-2.5-pro'], defaultModel: 'gemini-2.5-flash',
  async chat({ system, user, model, signal, fetch }, { key }) {
    const data = await request(this.name, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal, fetch, timeout: 180_000, headers: { 'x-goog-api-key': key('GEMINI_API_KEY') },
      json: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.8 }
      }
    });
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
    if (!text) throw new ProviderError(this.name, 'empty reply');
    return text;
  }
};

export const LLMS = [
  anthropic,
  compat('openai', 'GPT', 'OpenAI', 'global', 'OPENAI_API_KEY', 'https://api.openai.com/v1', ['gpt-5-mini', 'gpt-5', 'gpt-4.1'], 'https://platform.openai.com/api-keys', 'OPENAI_BASE_URL'),
  gemini,
  compat('deepseek', 'DeepSeek', 'DeepSeek', 'china', 'DEEPSEEK_API_KEY', 'https://api.deepseek.com', ['deepseek-chat', 'deepseek-reasoner'], 'https://platform.deepseek.com/api_keys'),
  compat('qwen', 'Qwen', 'Alibaba', 'china', 'DASHSCOPE_API_KEY', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', ['qwen-plus', 'qwen-max', 'qwen-flash'], 'https://modelstudio.console.alibabacloud.com/', 'DASHSCOPE_COMPAT_URL'),
  compat('kimi', 'Kimi', 'Moonshot AI', 'china', 'MOONSHOT_API_KEY', 'https://api.moonshot.ai/v1', ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview'], 'https://platform.moonshot.ai/console/api-keys', 'MOONSHOT_BASE_URL'),
  compat('glm', 'GLM', 'Zhipu AI', 'china', 'ZHIPU_API_KEY', 'https://open.bigmodel.cn/api/paas/v4', ['glm-4.6', 'glm-4.5-air'], 'https://open.bigmodel.cn/usercenter/apikeys', 'ZHIPU_BASE_URL'),
  compat('minimax', 'MiniMax', 'MiniMax', 'china', 'MINIMAX_API_KEY', 'https://api.minimax.io/v1', ['MiniMax-M2'], 'https://www.minimax.io/platform', 'MINIMAX_CHAT_URL'),
  compat('xai', 'Grok', 'xAI', 'global', 'XAI_API_KEY', 'https://api.x.ai/v1', ['grok-4', 'grok-3-mini'], 'https://console.x.ai/'),
  compat('openrouter', 'OpenRouter (any model)', 'OpenRouter', 'global', 'OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1', ['anthropic/claude-sonnet-5.5', 'deepseek/deepseek-chat', 'qwen/qwen3-max'], 'https://openrouter.ai/keys')
];

export const llm = id => LLMS.find(p => p.id === id);

export function directorModel(p) {
  return process.env[`${p.id.toUpperCase()}_DIRECTOR_MODEL`] || p.defaultModel;
}
