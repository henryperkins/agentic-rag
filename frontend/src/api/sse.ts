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
  private reconnectAttempts = 0;

  constructor(private url: string, private options: { body: string }) {
    this.controller = new AbortController();
  }

  subscribe(onEvent: (e: AnyEvent) => void) {
    const connect = async () => {
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
          throw new Error(`Request failed (${res.status})`);
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
                this.reconnectAttempts = 0; // Reset on successful event
              } catch {
                // ignore
              }
            }
          }
        }
      } catch (err: any) {
        if (this.controller.signal.aborted) return;
        const delay = Math.pow(2, this.reconnectAttempts) * 1000;
        setTimeout(connect, delay);
        this.reconnectAttempts++;
      }
    };

    connect();

    return {
      close: () => this.controller.abort()
    };
  }
}
