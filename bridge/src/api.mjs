import { requestScheduler, retryAfterMs } from './request-scheduler.mjs';
const protocols = new Set(['openai', 'anthropic', 'ollama']);

export function validateProfile(profile) {
  if (!profile || !protocols.has(profile.protocol)) throw new Error('请选择 OpenAI 兼容、Anthropic 或 Ollama 协议。');
  let url;
  try { url = new URL(profile.baseUrl); } catch { throw new Error('API 地址必须是完整的 http:// 或 https:// 地址。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址不应含账号、查询参数或片段。');
  if (!profile.model?.trim()) throw new Error('请填写模型名称。');
  let headers = {};
  try { headers = JSON.parse(profile.headersJson || '{}'); } catch { throw new Error('自定义请求头必须是 JSON 对象。'); }
  if (!headers || Array.isArray(headers) || typeof headers !== 'object' || Object.values(headers).some(v => typeof v !== 'string')) throw new Error('自定义请求头的键和值都必须为字符串。');
  if (!Number.isInteger(profile.maxTokens) || profile.maxTokens < 256 || profile.maxTokens > 32768) throw new Error('最大输出 token 需在 256–32768 之间。');
  if (!Number.isFinite(profile.temperature) || profile.temperature < 0 || profile.temperature > 2) throw new Error('温度需在 0–2 之间。');
  if (profile.requestIntervalSeconds !== undefined && (!Number.isFinite(profile.requestIntervalSeconds) || profile.requestIntervalSeconds < 0 || profile.requestIntervalSeconds > 120)) throw new Error('API 请求间隔需在 0–120 秒之间。');
  return headers;
}

export function endpoint(profile, suffix) {
  const base = profile.baseUrl.replace(/\/+$/, '');
  // Accept both a base URL and a fully specified generation endpoint.
  const root = base.replace(/\/(?:chat\/completions|messages|api\/chat|api\/tags|models)$/, '');
  return `${root}/${suffix}`;
}

export async function complete(profile, messages, signal, options = {}) {
  const custom = validateProfile(profile);
  const headers = { 'Content-Type': 'application/json' };
  let body, url;
  if (profile.protocol === 'anthropic') {
    url = endpoint(profile, 'messages');
    headers['anthropic-version'] = '2023-06-01';
    if (profile.apiKey) headers['x-api-key'] = profile.apiKey;
    body = { model: profile.model, max_tokens: profile.maxTokens, temperature: profile.temperature, system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n'), messages: messages.filter(m => m.role !== 'system') };
  } else if (profile.protocol === 'ollama') {
    url = endpoint(profile, 'api/chat');
    if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`;
    body = { model: profile.model, messages, stream: false, ...(options.output === 'text' ? {} : { format: 'json' }), options: { temperature: profile.temperature, num_predict: profile.maxTokens } };
  } else {
    url = endpoint(profile, 'chat/completions');
    if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`;
    // JSON prompting works with providers that do not implement tools or response_format.
    body = { model: profile.model, messages, stream: false, max_tokens: profile.maxTokens, temperature: profile.temperature };
  }
  Object.assign(headers, custom);
  const started = Date.now();
  const scheduler = options.scheduler || requestScheduler;
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    let failure, retryMs = 0;
    try {
      await scheduler.run(profile, signal, options.onWait, async () => {
        // Queue/cooldown time is separate from the timeout of an actual HTTP attempt.
        const combined = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(90000)]);
        try {
          const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: combined });
          if (!response.ok) {
            const status = response.status, retryAfter = retryAfterMs(response.headers.get('retry-after'));
            await response.body?.cancel();
            failure = new Error(`API 请求失败：HTTP ${status}。请检查地址、模型、密钥及额度。`);
            failure.status = status;
            failure.retryable = status === 408 || status === 429 || (status >= 500 && status < 600);
            if (failure.retryable) retryMs = scheduler.failed(profile, status, retryAfter);
          } else {
            data = await response.json(); scheduler.succeeded(profile);
          }
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof SyntaxError) throw new Error('API 响应不是有效 JSON，请检查接口是否兼容所选协议。');
          const code = error.cause?.code || error.cause?.errors?.[0]?.code || error.code;
          const labels = { ENOTFOUND: '域名解析失败', EAI_AGAIN: '域名解析暂时失败', ECONNREFUSED: '服务拒绝连接', ECONNRESET: '连接被中断', ETIMEDOUT: '连接超时', UND_ERR_CONNECT_TIMEOUT: '连接超时', UND_ERR_HEADERS_TIMEOUT: '等待响应超时', UND_ERR_SOCKET: '连接被中断', CERT_HAS_EXPIRED: '服务证书已过期', UNABLE_TO_VERIFY_LEAF_SIGNATURE: '服务证书无法验证' };
          failure = new Error(combined.aborted ? '模型请求超过 90 秒，请检查服务响应速度或减少输入。' : `API 网络请求失败：${labels[code] || '连接失败'}${labels[code] ? `（${code}）` : ''}。请检查网络、代理及 API 服务状态。`);
          // Some proxies reject fetch without exposing a transport code. Treat
          // that as temporary too, with the same bounded, shared backoff.
          failure.retryable = combined.aborted || !['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'EACCES', 'EPERM'].includes(code);
          if (failure.retryable) retryMs = scheduler.failed(profile, 0);
        }
      });
    } catch (error) {
      signal?.throwIfAborted(); throw error;
    }
    if (!failure) break;
    failure.retryAfterMs = retryMs;
    if (!failure.retryable || attempt === 2) throw failure;
    options.onRetry?.({ message: failure.message, delayMs: retryMs, attempt: attempt + 1 });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('API 响应缺少协议要求的对象，请检查接口兼容性。');
  let content;
  if (profile.protocol === 'anthropic') content = data.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
  else if (profile.protocol === 'ollama') content = data.message?.content;
  else content = data.choices?.[0]?.message?.content;
  const finish = data.stop_reason || data.choices?.[0]?.finish_reason || data.done_reason;
  if (finish === 'length' || finish === 'max_tokens') throw new Error('模型输出达到 token 上限，回复可能被截断。请增加最大输出 token，或使用非思考模式。');
  if (typeof content !== 'string' || !content.trim()) throw new Error('API 没有返回文本。请确认模型支持文本对话，或增加输出 token。');
  return { text: content, latencyMs: Date.now() - started, usage: data.usage || (profile.protocol === 'ollama' ? { prompt_tokens: data.prompt_eval_count || 0, completion_tokens: data.eval_count || 0 } : null) };
}

export async function listModels(profile, signal) {
  const custom = validateProfile({ ...profile, model: profile.model || 'list' });
  const headers = { ...custom };
  if (profile.protocol === 'anthropic') { headers['x-api-key'] ??= profile.apiKey; headers['anthropic-version'] ??= '2023-06-01'; }
  else if (profile.apiKey) headers.Authorization ??= `Bearer ${profile.apiKey}`;
  const data = await requestScheduler.run(profile, signal, null, async () => {
    const response = await fetch(endpoint(profile, profile.protocol === 'ollama' ? 'api/tags' : 'models'), { headers, signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(20000)]) });
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) requestScheduler.failed(profile, response.status, retryAfterMs(response.headers.get('retry-after')));
      await response.body?.cancel(); throw new Error(`读取模型列表失败：HTTP ${response.status}。可直接手动填写模型名称。`);
    }
    return response.json();
  });
  return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean).sort();
}

export function answerText(text) {
  if (typeof text !== 'string') throw new Error('模型没有返回文本回复。');
  let answer = text.trim().replace(/^\uFEFF/, '');
  while (/^<think>/i.test(answer)) {
    const end = answer.toLowerCase().indexOf('</think>');
    if (end < 0) throw new Error('模型只返回了未结束的思考内容，请增加输出 token 或使用非思考模式。');
    answer = answer.slice(end + 8).trim();
  }
  return answer.replace(/^```(?:json|text)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export function parseModelObject(text) {
  const stripped = answerText(text);
  try { return JSON.parse(stripped); } catch { /* Allow prose/fences around exactly one complete object. */ }
  const candidates = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (start < 0) { if (c === '{' || c === '[') { start = i; depth = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (--depth === 0) { candidates.push(stripped.slice(start, i + 1)); start = -1; }
    }
  }
  if (start >= 0 || candidates.length !== 1) throw new Error('模型输出不是单个完整 JSON 对象，请严格返回一个 JSON 动作。');
  try { return JSON.parse(candidates[0]); } catch { throw new Error('模型输出不是有效 JSON，请严格返回一个 JSON 对象。'); }
}

export function parseDecision(text) {
  return decisionObject(parseModelObject(text));
}

function decisionObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.action !== 'string') throw new Error('模型输出缺少 action 字段。');
  if (value.args !== undefined && (!value.args || typeof value.args !== 'object' || Array.isArray(value.args))) throw new Error('args 必须为 JSON 对象。');
  return { action: value.action, args: value.args || {}, reason: String(value.reason || '').slice(0, 800) };
}

export function parsePlan(text, maxActions = 4) {
  const value = parseModelObject(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型输出必须是 JSON 动作或动作计划。');
  if (!Object.hasOwn(value, 'actions')) return [decisionObject(value)];
  if (Object.hasOwn(value, 'action') || !Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > maxActions) throw new Error(`动作计划需包含 1–${maxActions} 个动作，不能同时指定 action。`);
  const decisions = value.actions.map(decisionObject);
  if (decisions.slice(0, -1).some(d => d.action === 'done')) throw new Error('done 只能是计划的最后一个动作。');
  return decisions.map(d => ({ ...d, reason: d.reason || String(value.reason || '').slice(0, 800) }));
}
