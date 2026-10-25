export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface AssistantReply {
  role: 'assistant';
  content: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
}
const maxResponse = 2_000_000;
export function completionURL(baseURL: string): string {
  let url: URL;
  try {
    url = new URL(baseURL.trim());
  } catch {
    throw new Error('请输入有效的 HTTP 或 HTTPS API 地址');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('API 地址不能包含密钥、查询参数或用户密码');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.href;
}
function validateReply(value: unknown): AssistantReply {
  if (!value || typeof value !== 'object') throw new Error('模型返回格式无效');
  const raw = value as Record<string, unknown>;
  if (
    raw.role !== 'assistant' ||
    (raw.content !== undefined && raw.content !== null && typeof raw.content !== 'string')
  )
    throw new Error('模型返回格式无效');
  const reply: AssistantReply = {
    role: 'assistant',
    content: typeof raw.content === 'string' ? raw.content : null,
  };
  if (typeof raw.reasoning_content === 'string') reply.reasoning_content = raw.reasoning_content;
  if (raw.tool_calls !== undefined && raw.tool_calls !== null) {
    if (!Array.isArray(raw.tool_calls) || raw.tool_calls.length > 8)
      throw new Error('模型请求了过多工具');
    const seen = new Set<string>();
    reply.tool_calls = raw.tool_calls.map((value) => {
      if (!value || typeof value !== 'object') throw new Error('工具调用格式无效');
      const call = value as Record<string, unknown>,
        f = call.function as Record<string, unknown> | undefined;
      if (
        call.type !== 'function' ||
        typeof call.id !== 'string' ||
        !call.id ||
        call.id.length > 200 ||
        seen.has(call.id) ||
        !f ||
        typeof f.name !== 'string' ||
        !f.name ||
        typeof f.arguments !== 'string' ||
        Buffer.byteLength(f.arguments) > 200000
      )
        throw new Error('工具调用格式无效或重复');
      seen.add(call.id);
      return { id: call.id, type: 'function', function: { name: f.name, arguments: f.arguments } };
    });
  }
  if (!reply.content && !reply.tool_calls?.length) throw new Error('模型返回了空回答');
  return reply;
}
/** Reads complete records across arbitrary UTF-8, line and tool-argument chunk boundaries. */
export async function readCompletion(
  response: Response,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<AssistantReply> {
  if (!response.body) throw new Error('模型服务没有返回内容');
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0,
    buffer = '',
    dataLines: string[] = [],
    done = false,
    finished = false,
    text = '',
    reasoning = '',
    isSSE = (response.headers.get('content-type') ?? '')
      .toLowerCase()
      .includes('text/event-stream');
  const calls = new Map<
    number,
    { id: string; type?: string; function: { name: string; arguments: string } }
  >();
  const consume = (data: string) => {
    if (done || !data) return;
    if (data === '[DONE]') {
      done = true;
      return;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error('模型流式响应格式无效');
    }
    if (event.error) throw new Error('模型服务返回流式错误');
    if (!Array.isArray(event.choices)) throw new Error('模型流式响应缺少 choices');
    if (event.choices.length === 0) return;
    const choice =
      event.choices.find((item: Record<string, unknown>) => item.index === 0) ?? event.choices[0];
    if (!choice || typeof choice !== 'object') throw new Error('模型流式响应格式无效');
    const finish = choice.finish_reason;
    if (finish !== undefined && finish !== null) {
      if (!['stop', 'tool_calls', 'function_call'].includes(finish))
        throw new Error('模型回答未完成，没有执行其中的操作');
      finished = true;
    }
    const delta = choice.delta;
    if (!delta || typeof delta !== 'object') throw new Error('模型流式响应缺少 delta');
    if (delta.role !== undefined && delta.role !== 'assistant') throw new Error('模型角色无效');
    if (delta.content !== undefined && delta.content !== null) {
      if (typeof delta.content !== 'string') throw new Error('模型内容格式无效');
      text += delta.content;
      onDelta(delta.content);
    }
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
    if (delta.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > 8)
        throw new Error('模型工具格式无效');
      for (const part of delta.tool_calls) {
        if (!part || !Number.isInteger(part.index) || part.index < 0 || part.index > 7)
          throw new Error('模型工具索引无效');
        const call = calls.get(part.index) ?? { id: '', function: { name: '', arguments: '' } };
        if (part.type !== undefined) {
          if (part.type !== 'function') throw new Error('模型工具类型无效');
          call.type = part.type;
        }
        if (part.id !== undefined) {
          if (typeof part.id !== 'string') throw new Error('模型工具编号无效');
          call.id += part.id;
        }
        if (part.function !== undefined) {
          if (!part.function || typeof part.function !== 'object')
            throw new Error('模型工具参数无效');
          for (const key of ['name', 'arguments'] as const)
            if (part.function[key] !== undefined) {
              if (typeof part.function[key] !== 'string') throw new Error('模型工具参数无效');
              call.function[key] += part.function[key];
            }
        }
        if (
          call.id.length > 200 ||
          call.function.name.length > 200 ||
          Buffer.byteLength(call.function.arguments) > 200000
        )
          throw new Error('模型工具参数过大');
        calls.set(part.index, call);
      }
    }
  };
  const flushEvent = () => {
    if (dataLines.length) consume(dataLines.join('\n'));
    dataLines = [];
  };
  const line = (value: string) => {
    if (value === '') {
      flushEvent();
      return;
    }
    if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /, ''));
  };
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxResponse) throw new Error('模型响应超过 2 MB');
      buffer += decoder.decode(chunk.value, { stream: true });
      if (isSSE) {
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const current = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          line(current);
          if (done) break;
        }
        if (done) break;
      }
    }
    buffer += decoder.decode();
    if (isSSE) {
      if (!done) {
        if (buffer) line(buffer.replace(/\r$/, ''));
        flushEvent();
      }
      if (!finished) throw new Error('流式回答提前中断，没有执行工具');
      const raw: Record<string, unknown> = { role: 'assistant', content: text };
      if (reasoning) raw.reasoning_content = reasoning;
      if (calls.size)
        raw.tool_calls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
      return validateReply(raw);
    }
    const object = JSON.parse(buffer),
      choice = object?.choices?.[0];
    if (!choice || ['length', 'content_filter'].includes(choice.finish_reason))
      throw new Error('模型回答未完成');
    const reply = validateReply(choice.message);
    if (reply.content) onDelta(reply.content);
    return reply;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
