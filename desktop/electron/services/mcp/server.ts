import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Socket } from 'node:net';
import { executeTool } from './tools.ts';
import type { ToolProvider } from './tools.ts';
export const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export interface MCPOptions {
  port: number;
  token: string;
  tools: ToolProvider;
}
export const newMCPToken = () => randomBytes(32).toString('hex');
const maxBody = 1_048_576;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function error(code: number, message: string, id: unknown = null) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
/** Stateless JSON-only Streamable HTTP; unsupported capabilities are never advertised. */
export async function rpcResponse(
  input: unknown,
  tools: ToolProvider,
  active: () => boolean = () => true,
): Promise<unknown | undefined> {
  if (!object(input) || input.jsonrpc !== '2.0' || typeof input.method !== 'string')
    return error(-32600, 'Invalid Request');
  const id = input.id;
  if (
    id !== undefined &&
    typeof id !== 'string' &&
    !(typeof id === 'number' && Number.isSafeInteger(id))
  )
    return error(-32600, 'Invalid request ID');
  // Notifications must neither execute a tool nor receive a JSON-RPC response.
  if (id === undefined) return undefined;
  if (input.params !== undefined && !object(input.params))
    return error(-32602, 'params must be an object', id);
  const params = (input.params ?? {}) as Record<string, unknown>;
  let result: unknown;
  switch (input.method) {
    case 'initialize':
      if (
        typeof params.protocolVersion !== 'string' ||
        !object(params.capabilities) ||
        !object(params.clientInfo)
      )
        return error(-32602, 'Invalid initialize parameters', id);
      result = {
        protocolVersion: protocolVersions.includes(
          params.protocolVersion as (typeof protocolVersions)[number],
        )
          ? params.protocolVersion
          : protocolVersions[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'teachshelf', version: '0.1.0' },
        instructions:
          '先查询当前资料库与对象版本；课程资料写入需最新 library_revision。只提供 tools/list 中已实现的工具。不读取资料正文。',
      };
      break;
    case 'ping':
      result = {};
      break;
    case 'tools/list':
      if (params.cursor !== undefined) return error(-32602, 'This tool list has no cursor', id);
      result = { tools: tools.definitions };
      break;
    case 'tools/call': {
      if (
        typeof params.name !== 'string' ||
        !tools.definitions.some((t) => t.name === params.name) ||
        (params.arguments !== undefined && !object(params.arguments))
      )
        return error(-32602, 'Unknown tool or invalid arguments', id);
      try {
        if (!active()) throw new Error('MCP 已停止，请重新连接');
        const content = await executeTool(tools, params.name, params.arguments ?? {});
        const serialized = JSON.stringify(content ?? null);
        if (Buffer.byteLength(serialized) > 1_000_000)
          throw new Error('工具结果过大，请缩小查询范围');
        result = {
          content: [{ type: 'text', text: serialized }],
          ...(object(content) ? { structuredContent: content } : {}),
          isError: false,
        };
      } catch (failure) {
        result = {
          content: [
            { type: 'text', text: failure instanceof Error ? failure.message : '工具执行失败' },
          ],
          isError: true,
        };
      }
      break;
    }
    default:
      return error(-32601, 'Method not found', id);
  }
  return { jsonrpc: '2.0', id, result };
}
export class MCPServer {
  private defaults?: MCPOptions;
  constructor(options?: MCPOptions) {
    this.defaults = options;
  }
  private server?: http.Server;
  private sockets = new Set<Socket>();
  private requests = new Set<Promise<void>>();
  private accepting = false;
  get port(): number | undefined {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : undefined;
  }
  async start(input?: MCPOptions): Promise<number> {
    const options = input ?? this.defaults;
    if (!options) throw new Error('缺少 MCP 配置');
    if (this.server) throw new Error('MCP 服务已启动');
    if (
      !Number.isInteger(options.port) ||
      options.port < 0 ||
      options.port > 65535 ||
      (options.port !== 0 && options.port < 1024)
    )
      throw new Error('MCP 端口须在 1024–65535 之间');
    if (!/^[a-f0-9]{64}$/i.test(options.token)) throw new Error('MCP token 必须是 32 字节随机值');
    if (
      new Set(options.tools.definitions.map((t) => t.name)).size !==
      options.tools.definitions.length
    )
      throw new Error('MCP 工具名称重复');
    this.accepting = true;
    const server = http.createServer(
      { maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 15000 },
      (req, res) => {
        const work = this.handle(req, res, options);
        this.requests.add(work);
        void work.finally(() => this.requests.delete(work));
      },
    );
    this.server = server;
    server.maxRequestsPerSocket = 1;
    server.maxHeadersCount = 100;
    server.setTimeout(15000, (socket) => socket.destroy());
    server.on('connection', (socket) => {
      if (!this.accepting || this.sockets.size >= 32) {
        socket.destroy();
        return;
      }
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    server.on('checkContinue', (_req, res) => {
      res.writeHead(417, { Connection: 'close' });
      res.end();
    });
    server.on('checkExpectation', (_req, res) => {
      res.writeHead(417, { Connection: 'close' });
      res.end();
    });
    server.on('clientError', (_error, socket) => {
      if (socket.writable)
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      else socket.destroy();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (e: Error) => {
          server.off('listening', ready);
          reject(e);
        };
        const ready = () => {
          server.off('error', failed);
          resolve();
        };
        server.once('error', failed);
        server.once('listening', ready);
        server.listen(options.port, '127.0.0.1');
      });
      return this.port!;
    } catch (e) {
      this.accepting = false;
      this.server = undefined;
      server.close();
      throw e;
    }
  }
  async stop(): Promise<void> {
    this.accepting = false;
    const server = this.server;
    if (!server) return;
    const closed = new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    for (const socket of this.sockets) socket.destroy();
    await closed;
    await Promise.allSettled([...this.requests]);
    this.server = undefined;
    this.sockets.clear();
  }
  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: MCPOptions,
  ): Promise<void> {
    const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      if (res.destroyed || res.writableEnded) return;
      const data = body === undefined ? '' : JSON.stringify(body);
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(data)),
        'Cache-Control': 'no-store',
        Connection: 'close',
        ...headers,
      });
      res.end(data);
    };
    try {
      const port = this.port;
      if (!this.accepting || port === undefined) {
        reply(503);
        return;
      }
      const rawNames = req.rawHeaders.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase());
      if (new Set(rawNames).size !== rawNames.length) {
        reply(400);
        return;
      }
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes((req.headers.host ?? '').toLowerCase())) {
        reply(403);
        return;
      }
      if (
        req.headers.origin &&
        !hosts.map((host) => `http://${host}`).includes(req.headers.origin)
      ) {
        reply(403);
        return;
      }
      const supplied = Buffer.from(req.headers.authorization ?? ''),
        expected = Buffer.from(`Bearer ${options.token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        reply(401, undefined, { 'WWW-Authenticate': 'Bearer realm="Teachshelf"' });
        return;
      }
      if (req.url !== '/mcp') {
        reply(404);
        return;
      }
      if (req.method !== 'POST') {
        reply(405, undefined, { Allow: 'POST' });
        return;
      }
      if (
        (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !==
        'application/json'
      ) {
        reply(415);
        return;
      }
      if (req.headers['transfer-encoding'] !== undefined) {
        reply(400);
        return;
      }
      const length = req.headers['content-length'] ?? '0';
      if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) {
        reply(400);
        return;
      }
      if (Number(length) > maxBody) {
        reply(413);
        return;
      }
      const version = req.headers['mcp-protocol-version'];
      if (
        version !== undefined &&
        (typeof version !== 'string' ||
          !protocolVersions.includes(version as (typeof protocolVersions)[number]))
      ) {
        reply(400);
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of req) {
        received += chunk.length;
        if (received > maxBody) {
          reply(413);
          return;
        }
        chunks.push(chunk);
      }
      if (received !== Number(length)) {
        reply(400);
        return;
      }
      let input: unknown;
      try {
        input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        reply(200, error(-32700, 'Parse error'));
        return;
      }
      if (!this.accepting || res.destroyed) return;
      const output = await rpcResponse(
        input,
        options.tools,
        () => this.accepting && !res.destroyed,
      );
      reply(output === undefined ? 202 : 200, output);
    } catch {
      reply(400, error(-32600, 'Request interrupted'));
    }
  }
}
