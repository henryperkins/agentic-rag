// Shared types for SSE and records

export type AgentRole = "planner" | "researcher" | "critic" | "writer";

export interface AgentLogEvent {
  type: "agent_log";
  role: AgentRole;
  message: string;
  ts: number;
}

export interface RewriteEvent {
  type: "rewrite";
  original: string;
  rewritten: string;
  ts: number;
}

export interface TokensEvent {
  type: "tokens";
  text: string; // incremental
  ts: number;
}

export interface CitationItem {
  document_id: string;
  source: string | null;
  chunk_index: number;
  isWebSource?: boolean;
  citationStart?: number;
  citationEnd?: number;
}

export interface CitationsEvent {
  type: "citations";
  citations: CitationItem[];
  ts: number;
}

export interface WebSearchMetadataEvent {
  type: "web_search_metadata";
  searchQuery: string;
  domainsSearched?: string[];
  allSources?: string[];
  ts: number;
}

export type Grade = "high" | "medium" | "low";

export interface VerificationEvent {
  type: "verification";
  isValid: boolean;
  gradeSummary?: Record<string, Grade>; // chunk_id -> grade
  feedback?: string;
  ts: number;
}

export interface FinalEvent {
  type: "final";
  text: string;
  citations: CitationItem[];
  rewrittenQuery?: string;
  verified: boolean;
  ts: number;
}

export type SSEOutEvent =
  | AgentLogEvent
  | RewriteEvent
  | TokensEvent
  | CitationsEvent
  | WebSearchMetadataEvent
  | VerificationEvent
  | FinalEvent;

// Records

export interface DocumentRecord {
  id: string;
  title: string | null;
  source: string | null;
  created_at: string; // ISO
}
export type DocumentWithChunks = DocumentRecord & {
  chunks: Array<{ chunk_index: number; content: string }>;
};


export interface ChunkRecord {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  grade: Grade | null;
  created_at: string;
}

export interface ChatRequestBody {
  message: string;
  useRag?: boolean;
  useHybrid?: boolean;
  useWeb?: boolean;
  allowedDomains?: string[];
}

// Layer 14: Feedback
export interface FeedbackRequest {
  rating: "up" | "down";
  comment?: string;
  traceId?: string;
  question?: string;
}

// Batch Upload
export interface BatchUploadResult {
  success: boolean;
  results: Array<{
    filename: string;
    success: boolean;
    documentId?: string;
    chunksInserted?: number;
    error?: string;
  }>;
  totalFiles: number;
  successCount: number;
  failureCount: number;
}

// GitHub Ingestion
export interface GitHubIngestRequest {
  repoUrl: string; // e.g., "https://github.com/owner/repo"
  branch?: string; // default: main
  path?: string; // optional subdirectory
  fileExtensions?: string[]; // e.g., [".md", ".txt", ".js"]
  maxFiles?: number; // limit number of files to ingest
}

export interface GitHubIngestResult {
  success: boolean;
  repoUrl: string;
  filesProcessed: number;
  documentsCreated: number;
  errors: Array<{
    file: string;
    error: string;
  }>;
}
