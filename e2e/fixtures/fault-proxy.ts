import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";

export type FaultProxyRequest = {
  id: number;
  method: string;
  url: string;
  pathname: string;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
  receivedAt: number;
  fault?: string;
};

export type FaultMatcher = {
  method?: string;
  pathname?: string | RegExp;
  header?: { name: string; value?: string | RegExp };
  body?: string | RegExp;
  predicate?: (request: FaultProxyRequest) => boolean;
};

type RuleOptions = {
  name?: string;
  times?: number;
};

type HeldRequest = {
  request: FaultProxyRequest;
  response: ServerResponse;
  timer?: ReturnType<typeof setTimeout>;
};

type CounterWaiter = {
  expected: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type RuleAction =
  | { kind: "hold"; autoReleaseMs?: number }
  | { kind: "status"; status: number; headers: Record<string, string>; body: string }
  | { kind: "interrupt"; delayMs: number };

type RuleState = {
  name: string;
  matcher: FaultMatcher;
  action: RuleAction;
  remaining: number;
  hits: number;
  completions: number;
  pending: Map<number, HeldRequest>;
  hitWaiters: CounterWaiter[];
  completionWaiters: CounterWaiter[];
};

export type FaultProxyOptions = {
  upstream: string;
  hostname?: string;
  port?: number;
};

export class FaultRule {
  constructor(
    private readonly proxy: FaultProxy,
    private readonly state: RuleState,
  ) {}

  get name(): string {
    return this.state.name;
  }

  get hitCount(): number {
    return this.state.hits;
  }

  get completionCount(): number {
    return this.state.completions;
  }

  get pendingCount(): number {
    return this.state.pending.size;
  }

  waitForHits(expected = 1, timeoutMs = 10_000): Promise<void> {
    return waitForCounter(this.state, "hits", expected, timeoutMs);
  }

  waitForCompletions(expected = 1, timeoutMs = 20_000): Promise<void> {
    return waitForCounter(this.state, "completions", expected, timeoutMs);
  }

  release(): void {
    for (const held of this.state.pending.values()) {
      this.proxy.releaseHeld(this.state, held);
    }
  }

  interrupt(): void {
    for (const held of this.state.pending.values()) {
      this.proxy.interruptHeld(this.state, held);
    }
  }

  disable(): void {
    this.state.remaining = 0;
  }
}

export class FaultProxy {
  readonly upstream: URL;
  readonly hostname: string;
  readonly requestedPort: number;

  private server: Server | undefined;
  private rules: RuleState[] = [];
  private requestSequence = 0;
  private ruleSequence = 0;
  private capturedRequests: FaultProxyRequest[] = [];
  private listeningPort: number | undefined;

  constructor(options: FaultProxyOptions) {
    this.upstream = new URL(options.upstream);
    if (this.upstream.protocol !== "http:" && this.upstream.protocol !== "https:") {
      throw new Error(`Unsupported upstream protocol: ${this.upstream.protocol}`);
    }
    this.hostname = options.hostname ?? "127.0.0.1";
    this.requestedPort = options.port ?? 0;
  }

  get origin(): string {
    if (this.listeningPort == null) throw new Error("The fault proxy has not started.");
    const browserHostname = this.hostname === "127.0.0.1" ? "localhost" : this.hostname;
    return `http://${browserHostname}:${this.listeningPort}`;
  }

  get requests(): readonly FaultProxyRequest[] {
    return this.capturedRequests;
  }

  async start(): Promise<this> {
    if (this.server) return this;

    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(this.requestedPort, this.hostname, () => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("The fault proxy did not receive a TCP port."));
          return;
        }
        this.listeningPort = address.port;
        resolve();
      });
    });

    return this;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    this.reset();
    this.server.closeAllConnections();
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  reset(): void {
    for (const rule of this.rules) {
      for (const held of rule.pending.values()) this.interruptHeld(rule, held);
      rejectWaiters(rule.hitWaiters, new Error(`Fault rule "${rule.name}" was reset.`));
      rejectWaiters(rule.completionWaiters, new Error(`Fault rule "${rule.name}" was reset.`));
    }
    this.rules = [];
    this.capturedRequests = [];
  }

  hold(matcher: FaultMatcher, options: RuleOptions & { autoReleaseMs?: number } = {}): FaultRule {
    return this.addRule(matcher, { kind: "hold", autoReleaseMs: options.autoReleaseMs }, options);
  }

  respond(
    matcher: FaultMatcher,
    options: RuleOptions & {
      status: number;
      headers?: Record<string, string>;
      body?: string;
    },
  ): FaultRule {
    const headers = { "content-type": "text/plain; charset=utf-8", ...options.headers };
    return this.addRule(
      matcher,
      {
        kind: "status",
        status: options.status,
        headers,
        body: options.body ?? `Injected HTTP ${options.status}`,
      },
      options,
    );
  }

  interrupt(matcher: FaultMatcher, options: RuleOptions & { delayMs?: number } = {}): FaultRule {
    return this.addRule(matcher, { kind: "interrupt", delayMs: options.delayMs ?? 0 }, options);
  }

  releaseHeld(rule: RuleState, held: HeldRequest): void {
    if (!rule.pending.delete(held.request.id)) return;
    if (held.timer) clearTimeout(held.timer);
    if (held.response.destroyed) {
      completeRule(rule);
      return;
    }
    this.forward(held.request, held.response, () => completeRule(rule));
  }

  interruptHeld(rule: RuleState, held: HeldRequest): void {
    if (!rule.pending.delete(held.request.id)) return;
    if (held.timer) clearTimeout(held.timer);
    held.response.destroy();
    completeRule(rule);
  }

  private addRule(matcher: FaultMatcher, action: RuleAction, options: RuleOptions): FaultRule {
    const times = options.times ?? Number.POSITIVE_INFINITY;
    if (!Number.isInteger(times) && times !== Number.POSITIVE_INFINITY) {
      throw new Error("Fault rule times must be an integer or Infinity.");
    }
    if (times < 1) throw new Error("Fault rule times must be at least one.");

    const state: RuleState = {
      name: options.name ?? `fault-${++this.ruleSequence}`,
      matcher,
      action,
      remaining: times,
      hits: 0,
      completions: 0,
      pending: new Map(),
      hitWaiters: [],
      completionWaiters: [],
    };
    this.rules.push(state);
    return new FaultRule(this, state);
  }

  private async handle(incoming: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const rawUrl = incoming.url ?? "/";
      const parsedUrl = new URL(rawUrl, this.origin);
      const request: FaultProxyRequest = {
        id: ++this.requestSequence,
        method: incoming.method ?? "GET",
        url: rawUrl,
        pathname: parsedUrl.pathname,
        headers: normalizeHeaders(incoming.headers),
        body: Buffer.concat(chunks),
        receivedAt: Date.now(),
      };
      this.capturedRequests.push(request);

      const rule = this.rules.find(
        (candidate) => candidate.remaining > 0 && matches(candidate.matcher, request),
      );
      if (!rule) {
        this.forward(request, response);
        return;
      }

      request.fault = rule.name;
      rule.hits += 1;
      if (Number.isFinite(rule.remaining)) rule.remaining -= 1;
      resolveWaiters(rule.hitWaiters, rule.hits);

      if (rule.action.kind === "status") {
        const body = Buffer.from(rule.action.body);
        response.writeHead(rule.action.status, {
          ...(request.headers["x-tsr-serverfn"] === "true" ? { "x-tss-raw": "true" } : {}),
          ...rule.action.headers,
          "content-length": String(body.byteLength),
        });
        response.end(body, () => completeRule(rule));
        return;
      }

      if (rule.action.kind === "interrupt") {
        const held: HeldRequest = { request, response };
        rule.pending.set(request.id, held);
        held.timer = setTimeout(() => this.interruptHeld(rule, held), rule.action.delayMs);
        return;
      }

      const held: HeldRequest = { request, response };
      rule.pending.set(request.id, held);
      if (rule.action.autoReleaseMs != null) {
        held.timer = setTimeout(() => this.releaseHeld(rule, held), rule.action.autoReleaseMs);
      }
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : "Fault proxy failed.");
    }
  }

  private forward(
    request: FaultProxyRequest,
    response: ServerResponse,
    onComplete: () => void = () => {},
  ): void {
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      onComplete();
    };
    const transport = this.upstream.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string> = { ...request.headers };
    for (const name of HOP_BY_HOP_HEADERS) delete headers[name];
    headers.host = this.upstream.host;

    const upstreamRequest = transport(
      {
        protocol: this.upstream.protocol,
        hostname: this.upstream.hostname,
        port: this.upstream.port,
        method: request.method,
        path: request.url,
        headers,
      },
      (upstreamResponse) => {
        const responseHeaders = { ...upstreamResponse.headers };
        for (const name of HOP_BY_HOP_HEADERS) delete responseHeaders[name];
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        upstreamResponse.pipe(response);
        upstreamResponse.once("error", (error) => {
          response.destroy(error);
          complete();
        });
        response.once("finish", complete);
        response.once("close", complete);
      },
    );

    upstreamRequest.once("error", (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        response.end(`Fault proxy could not reach preview: ${error.message}`);
      } else {
        response.destroy(error);
      }
      complete();
    });
    response.once("close", () => {
      if (!upstreamRequest.destroyed) upstreamRequest.destroy();
      complete();
    });
    if (request.body.byteLength > 0) upstreamRequest.write(request.body);
    upstreamRequest.end();
  }
}

export async function startFaultProxy(options: FaultProxyOptions): Promise<FaultProxy> {
  return new FaultProxy(options).start();
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value == null) continue;
    normalized[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return normalized;
}

function matches(matcher: FaultMatcher, request: FaultProxyRequest): boolean {
  if (matcher.method && request.method !== matcher.method.toUpperCase()) return false;
  if (matcher.pathname && !matchesValue(matcher.pathname, request.pathname)) return false;
  if (matcher.header) {
    const actual = request.headers[matcher.header.name.toLowerCase()];
    if (actual == null) return false;
    if (matcher.header.value && !matchesValue(matcher.header.value, actual)) return false;
  }
  if (matcher.body && !matchesValue(matcher.body, request.body.toString("utf8"))) return false;
  return matcher.predicate?.(request) ?? true;
}

function matchesValue(expected: string | RegExp, actual: string): boolean {
  if (typeof expected === "string") return actual.includes(expected);
  expected.lastIndex = 0;
  return expected.test(actual);
}

function waitForCounter(
  state: RuleState,
  counter: "hits" | "completions",
  expected: number,
  timeoutMs: number,
): Promise<void> {
  if (state[counter] >= expected) return Promise.resolve();
  const waiters = counter === "hits" ? state.hitWaiters : state.completionWaiters;
  return new Promise<void>((resolve, reject) => {
    const waiter: CounterWaiter = {
      expected,
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(
          new Error(
            `Timed out waiting for fault rule "${state.name}" ${counter} to reach ${expected}; observed ${state[counter]}.`,
          ),
        );
      }, timeoutMs),
    };
    waiters.push(waiter);
  });
}

function resolveWaiters(waiters: CounterWaiter[], value: number): void {
  for (let index = waiters.length - 1; index >= 0; index--) {
    const waiter = waiters[index];
    if (value < waiter.expected) continue;
    clearTimeout(waiter.timer);
    waiters.splice(index, 1);
    waiter.resolve();
  }
}

function rejectWaiters(waiters: CounterWaiter[], error: Error): void {
  for (const waiter of waiters.splice(0)) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
}

function completeRule(rule: RuleState): void {
  rule.completions += 1;
  resolveWaiters(rule.completionWaiters, rule.completions);
}
