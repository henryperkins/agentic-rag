import { useEffect, useRef, useState } from "react";
import type {
  AgentLogEvent,
  CitationsEvent,
  FinalEvent,
  RewriteEvent,
  TokensEvent,
  VerificationEvent
} from "../../../shared/types";
import { startChatSSE } from "../api/sse";

export function useChat() {
  const [logs, setLogs] = useState<AgentLogEvent[]>([]);
  const [rewrite, setRewrite] = useState<RewriteEvent | null>(null);
  const [text, setText] = useState("");
  const [citations, setCitations] = useState<CitationsEvent["citations"]>([]);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const subRef = useRef<{ close: () => void } | null>(null);

  function reset() {
    setLogs([]);
    setRewrite(null);
    setText("");
    setCitations([]);
    setVerified(null);
  }

  async function send(message: string, useRag: boolean, useHybrid: boolean, useWeb: boolean) {
    reset();
    setBusy(true);
    const sub = startChatSSE({ message, useRag, useHybrid, useWeb }, (e: any) => {
      if (e.type === "agent_log") setLogs((prev) => [...prev, e as AgentLogEvent]);
      if (e.type === "rewrite") setRewrite(e as RewriteEvent);
      if (e.type === "tokens") setText((prev) => prev + (e as TokensEvent).text);
      if (e.type === "citations") setCitations((e as CitationsEvent).citations);
      if (e.type === "verification") setVerified((e as VerificationEvent).isValid);
      if (e.type === "final") setBusy(false);
    });
    subRef.current = sub;
  }

  useEffect(() => {
    return () => {
      subRef.current?.close();
    };
  }, []);

  return { logs, rewrite, text, citations, verified, busy, send };
}
