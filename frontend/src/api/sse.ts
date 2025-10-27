import type {
  AgentLogEvent,
  CitationsEvent,
  FinalEvent,
  RewriteEvent,
  TokensEvent,
  VerificationEvent,
  ChatRequestBody
} from "../../../shared/types";

type AnyEvent =
  | AgentLogEvent
  | CitationsEvent
  | FinalEvent
  | RewriteEvent
  | TokensEvent
  | VerificationEvent;

export function startChatSSE(body: ChatRequestBody, onEvent: (e: AnyEvent) => void) {
  const es = new EventSourcePolyfill("/api/chat", { body: JSON.stringify(body) });
  return es.subscribe(onEvent);
}

/**
 * Lightweight "polyfill" that posts and then reads streaming response.
 * Works with Fastify SSE by using fetch + ReadableStream reader.
 */
class EventSourcePolyfill {
  private controller: AbortController;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(private url: string, private options: { body: string }) {
    this.controller = new AbortController();
  }

  subscribe(onEvent: (e: AnyEvent) => void) {
    (async () => {
      try {
        const res = await fetch(this.url, {
          method: "POST",
          body: this.options.body,
          headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
          signal: this.controller.signal,
          cache: "no-store",
          credentials: "include"
        });
        if (!res.ok) {
          const now = Date.now();
          let msg = "";
          try { msg = await res.text(); } catch {}
          onEvent({ type: "tokens", text: `Request failed (${res.status}): ${msg || res.statusText}`, ts: now } as any);
          onEvent({ type: "final", text: `Request failed (${res.status}).`, citations: [], verified: false, ts: now } as any);
          return;
        }
        if (!res.body) return;
        this.reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // parse SSE lines
          const parts = buf.split("\n\n");
          buf = parts.pop() || "";
          for (const chunk of parts) {
            const lines = chunk.split("\n");
            let eventType = "message";
            let data = "";
            for (const ln of lines) {
              if (ln.startsWith("event:")) eventType = ln.slice(6).trim();
              if (ln.startsWith("data:")) {
                const piece = ln.slice(5);
                data += (data ? "\n" : "") + piece.trim();
              }
            }
            if (data) {
              try {
                const obj = JSON.parse(data);
                (obj.type = eventType), onEvent(obj as AnyEvent);
              } catch {
                // ignore
              }
            }
          }
        }
      } catch (err: any) {
        const now = Date.now();
        try {
          onEvent({ type: "tokens", text: `Connection error: ${err?.message || "unknown"}`, ts: now } as any);
          onEvent({ type: "final", text: "Connection closed unexpectedly.", citations: [], verified: false, ts: now } as any);
        } catch {
          // ignore
        }
      }
    })();

    return {
      close: () => this.controller.abort()
    };
  }
}
