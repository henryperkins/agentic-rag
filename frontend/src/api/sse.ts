import type {
  AgentLogEvent,
  CitationsEvent,
  FinalEvent,
  RewriteEvent,
  TokensEvent,
  VerificationEvent,
  ChatRequestBody,
  WebSearchMetadataEvent
} from "../../../shared/types";

export type AnyEvent =
  | AgentLogEvent
  | CitationsEvent
  | FinalEvent
  | RewriteEvent
  | TokensEvent
  | VerificationEvent
  | WebSearchMetadataEvent;

export function startChatSSE(
  body: ChatRequestBody,
  onEvent: (e: AnyEvent) => void,
  onError?: (error: Error) => void
) {
  const es = new EventSourcePolyfill("/api/chat", { body: JSON.stringify(body) }, onEvent, onError);
  return es.subscribe();
}

/**
 * Lightweight "polyfill" that posts and then reads streaming response.
 * Works with Fastify SSE by using fetch + ReadableStream reader.
 */
class EventSourcePolyfill {
  private controller: AbortController;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private reconnectAttempts = 0;

  constructor(
    private url: string,
    private options: { body: string },
    private onEvent: (event: AnyEvent) => void,
    private onError?: (error: Error) => void
  ) {
    this.controller = new AbortController();
  }

  subscribe() {
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
          // parse SSE lines, supporting both \n\n and \r\n\r\n boundaries
          const parts = buf.split(/\r?\n\r?\n/);
          buf = parts.pop() || "";
          for (const chunk of parts) {
            const lines = chunk.split(/\r?\n/);
            let eventType = "message";
            let data = "";
            for (const ln of lines) {
              const trimmed = ln.trim();
              if (trimmed.startsWith("event:")) eventType = trimmed.slice(6).trim();
              if (trimmed.startsWith("data:")) {
                const piece = trimmed.slice(5);
                data += (data ? "\n" : "") + piece.trim();
              }
            }
            if (data) {
              try {
                const obj = JSON.parse(data);
                (obj.type = eventType), this.onEvent(obj as AnyEvent);
                this.reconnectAttempts = 0; // Reset on successful event
              } catch {
                // ignore
              }
            }
          }
        }
        if (!this.controller.signal.aborted) {
          this.onError?.(new Error("Stream closed"));
        }
      } catch (err: any) {
        if (this.controller.signal.aborted) return;
        if (this.onError && err instanceof Error) {
          this.onError(err);
        }
        const baseDelay = Math.min(30_000, Math.pow(2, this.reconnectAttempts) * 1000);
        const jitter = Math.random() * 1000;
        setTimeout(connect, baseDelay + jitter);
        this.reconnectAttempts++;
      }
    };

    connect();

    return {
      close: () => {
        this.controller.abort();
        if (this.reader) {
          this.reader.cancel().catch(() => {
            /* no-op */
          });
          this.reader = null;
        }
      }
    };
  }
}
