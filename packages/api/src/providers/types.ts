import type { DocumentSummary, FileType, ModelHealth, VectorStoreHealth } from '@lexica/shared';

/**
 * Provider interfaces: the seam between the RAG pipeline and the outside world.
 *
 * Production wires in Ollama and Qdrant; tests wire in in-memory fakes; a cloud
 * provider could be swapped in without touching the pipeline. Each interface
 * only grows the methods a ticket actually needs.
 */

export type ProviderHealth = ModelHealth;

/** Turns texts into fixed-size vectors (e.g. Ollama `nomic-embed-text`, 768 dims). */
export interface Embedder {
  readonly model: string;
  /** Length of every vector this embedder returns; the vector store is sized to match. */
  readonly dimensions: number;
  checkHealth(): Promise<ModelHealth>;
  /** Embeds passages that will be stored and searched (one vector per text, same order). */
  embedDocuments(texts: string[]): Promise<number[][]>;
  /** Embeds a question, to be compared against the stored passages. */
  embedQuery(text: string): Promise<number[]>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatInput {
  system: string;
  messages: ChatMessage[];
  /** Aborted when the client stops the answer; generation should stop too. */
  signal?: AbortSignal;
}

/** Generates a streamed answer from a system prompt and messages (e.g. Ollama `qwen2.5:3b`). */
export interface ChatModel {
  readonly model: string;
  checkHealth(): Promise<ModelHealth>;
  /** Streams the answer as text deltas (tokens or small groups of them). */
  stream(input: ChatInput): AsyncIterable<string>;
}

/** Everything stored with a chunk besides its vector; this is what citations are built from. */
export interface ChunkPayload {
  documentId: string;
  documentName: string;
  fileType: FileType;
  /** Citation label, e.g. "Art. 7.2 — Termination for convenience". */
  section: string;
  /** Page the passage starts on, or null when the format has no pages. */
  page: number | null;
  /** Position of the chunk within its document, starting at 0. */
  chunkIndex: number;
  text: string;
  /** ISO 8601 timestamp of when the document was indexed. */
  createdAt: string;
}

export interface ChunkRecord extends ChunkPayload {
  vector: number[];
}

/** A stored chunk returned by a similarity search. */
export interface SearchHit extends ChunkPayload {
  /** Stable id of the stored chunk. */
  id: string;
  /** Cosine similarity to the query vector, from -1 to 1 (higher is closer). */
  score: number;
}

/** Stores chunk vectors with payload and searches them by similarity (e.g. Qdrant). */
export interface VectorStore {
  checkHealth(): Promise<VectorStoreHealth>;
  /** Prepares storage (e.g. creates the Qdrant collection if missing). Safe to call repeatedly. */
  init(): Promise<void>;
  upsert(chunks: ChunkRecord[]): Promise<void>;
  /** Removes every chunk of a document. */
  deleteDocument(documentId: string): Promise<void>;
  /** One summary per document, derived from the stored chunks (there is no documents table). */
  listDocuments(): Promise<DocumentSummary[]>;
  /** The `limit` chunks closest to `vector` by cosine similarity, most similar first. */
  search(vector: number[], options: { limit: number }): Promise<SearchHit[]>;
}

export interface Providers {
  embedder: Embedder;
  chatModel: ChatModel;
  vectorStore: VectorStore;
}
