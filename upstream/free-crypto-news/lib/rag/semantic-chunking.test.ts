/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * This file is part of free-crypto-news.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * For licensing inquiries: nirholas@users.noreply.github.com
 */

/**
 * Unit tests for Semantic Chunking
 *
 * Tests sentence splitting, fixed-overlap chunking, coherence scoring,
 * and the full chunking pipeline with mocked embeddings.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SemanticChunker } from "@/lib/rag/semantic-chunking";

// ═══════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════

let embeddingCounter = 0;

vi.mock("@/lib/rag/embedding-service", () => ({
  generateEmbedding: vi.fn().mockImplementation(async (text: string) => {
    // Produce slightly varied embeddings based on input to make similarity tests meaningful
    embeddingCounter++;
    const base = new Array(384).fill(0.1);
    const seed = simpleHash(text);
    for (let i = 0; i < 384; i++) {
      base[i] =
        Math.sin(seed + i * 0.01 + embeddingCounter * 0.001) * 0.5 + 0.5;
    }
    return base;
  }),
}));

vi.mock("@/lib/rag/observability", () => ({
  ragLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// ═══════════════════════════════════════════════════════════════
// TEST DATA
// ═══════════════════════════════════════════════════════════════

const SAMPLE_ARTICLE = `Bitcoin surged 8% today after the SEC approved the first spot Bitcoin ETFs. BlackRock's iShares Bitcoin Trust began trading on the NYSE.

Institutional investors reacted positively, with billions in inflows expected over the coming weeks. This marks a historic milestone for crypto adoption.

Meanwhile, Ethereum developers announced the Dencun upgrade timeline. The upgrade aims to reduce Layer 2 fees by implementing proto-danksharding through EIP-4844.

In other news, the Federal Reserve maintained interest rates, signaling potential cuts later this year. Crypto markets are closely watching macro developments.`;

const SHORT_TEXT = "Bitcoin is digital gold.";

const METADATA = {
  title: "Crypto Market Update",
  source: "CoinDesk",
  pubDate: "2024-01-10",
  url: "https://example.com/article",
  voteScore: 42,
};

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe("SemanticChunker", () => {
  let chunker: SemanticChunker;

  beforeEach(() => {
    chunker = new SemanticChunker();
    embeddingCounter = 0;
  });

  // ─────────────────────────────────────────────────────────────
  // Fixed Overlap Chunking
  // ─────────────────────────────────────────────────────────────

  describe("fixed_overlap method", () => {
    it("chunks text into fixed-size segments", async () => {
      const result = await chunker.chunk("doc-1", SAMPLE_ARTICLE, METADATA, {
        method: "fixed_overlap",
        targetSize: 200,
        overlap: 30,
      });

      expect(result.chunks.length).toBeGreaterThan(1);
      expect(result.method).toBe("fixed_overlap");
      expect(result.stats.chunkCount).toBe(result.chunks.length);
    });

    it("returns single chunk for short text", async () => {
      const result = await chunker.chunk("doc-2", SHORT_TEXT, METADATA, {
        method: "fixed_overlap",
        targetSize: 200,
      });

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].content).toBe(SHORT_TEXT);
    });

    it("assigns correct chunk IDs", async () => {
      const result = await chunker.chunk("doc-3", SAMPLE_ARTICLE, METADATA, {
        method: "fixed_overlap",
        targetSize: 150,
      });

      for (let i = 0; i < result.chunks.length; i++) {
        expect(result.chunks[i].id).toBe(`doc-3__chunk_${i}`);
        expect(result.chunks[i].chunkIndex).toBe(i);
        expect(result.chunks[i].totalChunks).toBe(result.chunks.length);
      }
    });

    it("preserves metadata in chunks", async () => {
      const result = await chunker.chunk("doc-4", SAMPLE_ARTICLE, METADATA, {
        method: "fixed_overlap",
        targetSize: 200,
      });

      for (const chunk of result.chunks) {
        expect(chunk.metadata.title).toBe("Crypto Market Update");
        expect(chunk.metadata.source).toBe("CoinDesk");
        expect(chunk.metadata.pubDate).toBe("2024-01-10");
      }
    });

    it("tracks character offsets", async () => {
      const result = await chunker.chunk("doc-5", SAMPLE_ARTICLE, METADATA, {
        method: "fixed_overlap",
        targetSize: 200,
        overlap: 0,
      });

      for (const chunk of result.chunks) {
        expect(chunk.charStart).toBeGreaterThanOrEqual(0);
        expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
        expect(chunk.charEnd).toBeLessThanOrEqual(SAMPLE_ARTICLE.length);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Sentence Similarity Chunking
  // ─────────────────────────────────────────────────────────────

  describe("sentence_similarity method", () => {
    it("chunks text by sentence similarity", async () => {
      const result = await chunker.chunk("doc-6", SAMPLE_ARTICLE, METADATA, {
        method: "sentence_similarity",
        targetSize: 512,
        similarityThreshold: 0.5,
      });

      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.method).toBe("sentence_similarity");
    });

    it("handles single sentence input", async () => {
      const result = await chunker.chunk("doc-7", SHORT_TEXT, METADATA, {
        method: "sentence_similarity",
      });

      expect(result.chunks.length).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Topic Boundary Chunking
  // ─────────────────────────────────────────────────────────────

  describe("topic_boundary method", () => {
    it("detects topic boundaries", async () => {
      const result = await chunker.chunk("doc-8", SAMPLE_ARTICLE, METADATA, {
        method: "topic_boundary",
        windowSize: 2,
        similarityThreshold: 0.5,
      });

      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.method).toBe("topic_boundary");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Hybrid Chunking
  // ─────────────────────────────────────────────────────────────

  describe("hybrid method", () => {
    it("combines multiple splitting signals", async () => {
      const result = await chunker.chunk("doc-9", SAMPLE_ARTICLE, METADATA, {
        method: "hybrid",
        similarityThreshold: 0.5,
        windowSize: 2,
      });

      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.method).toBe("hybrid");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Coherence Scoring
  // ─────────────────────────────────────────────────────────────

  describe("coherence scoring", () => {
    it("assigns coherence scores to chunks", async () => {
      const result = await chunker.chunk("doc-10", SAMPLE_ARTICLE, METADATA, {
        method: "fixed_overlap",
        targetSize: 200,
      });

      for (const chunk of result.chunks) {
        expect(chunk.coherenceScore).toBeGreaterThanOrEqual(0);
        expect(chunk.coherenceScore).toBeLessThanOrEqual(1);
      }
    });

    it("computes average coherence in stats", async () => {
      const result = await chunker.chunk("doc-11", SAMPLE_ARTICLE, METADATA, {
        method: "fixed_overlap",
        targetSize: 200,
      });

      expect(result.stats.avgCoherence).toBeGreaterThan(0);
      expect(result.stats.avgCoherence).toBeLessThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Statistics
  // ─────────────────────────────────────────────────────────────

  describe("stats", () => {
    it("computes accurate chunk statistics", async () => {
      const result = await chunker.chunk("doc-12", SAMPLE_ARTICLE, METADATA, {
        method: "fixed_overlap",
        targetSize: 200,
        overlap: 0,
      });

      expect(result.stats.inputLength).toBe(SAMPLE_ARTICLE.length);
      expect(result.stats.chunkCount).toBe(result.chunks.length);
      expect(result.stats.avgChunkSize).toBeGreaterThan(0);
      expect(result.stats.minChunkSize).toBeLessThanOrEqual(
        result.stats.maxChunkSize,
      );
    });
  });
});
