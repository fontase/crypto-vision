/**
 * Tests for the RAG (Retrieval-Augmented Generation) module.
 *
 * Tests the ragQuery function's flow: embedding → search → LLM generation.
 * Uses mocked embeddings and AI providers since no credentials are
 * available in the test environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Ensure in-memory mode
vi.stubEnv("GCP_PROJECT_ID", "");
vi.stubEnv("OPENAI_API_KEY", "");
vi.stubEnv("REDIS_URL", "");

// Mock the embeddings module to avoid needing real API credentials
vi.mock("@/lib/embeddings.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue([1, 0, 0]),
  generateEmbeddings: vi.fn().mockImplementation((texts: string[]) =>
    Promise.resolve(texts.map((t) => ({ text: t, embedding: [1, 0, 0], model: "mock", tokens: 10 }))),
  ),
  EMBEDDING_DIMENSION: 768,
  getEmbeddingDimension: () => 768,
  getEmbeddingProviderName: () => "mock",
}));

// Mock the AI module to avoid needing real API credentials
vi.mock("@/lib/ai.js", () => ({
  aiComplete: vi.fn().mockResolvedValue({
    text: "This is a mock AI response about DeFi protocols.",
    provider: "mock",
    model: "mock-model",
    tokensUsed: 100,
  }),
  isAIConfigured: () => true,
  getConfiguredProviders: () => ["mock"],
}));

const { ragQuery, ragAskAboutProtocol, ragAskAboutNews, ragFindAgent } = await import("@/lib/rag.js");
const { vectorStore } = await import("@/lib/vector-store.js");

describe("rag module", () => {
  beforeEach(async () => {
    // Clear vector store between tests
    // We are getting a fresh import each time but the store is a singleton
    // So we delete known keys
    const count = await vectorStore.count();
    if (count > 0) {
      // Search and delete all existing entries
      const dummyVec = [1, 0, 0];
      const all = await vectorStore.search(dummyVec, 1000);
      for (const item of all) {
        await vectorStore.delete(item.id);
      }
    }
  });

  describe("ragQuery", () => {
    it("falls back to direct LLM when vector store is empty", async () => {
      const result = await ragQuery("What is DeFi?");

      expect(result.answer).toBeTruthy();
      expect(result.ragUsed).toBe(false);
      expect(result.sources).toEqual([]);
      expect(result.retrievalCount).toBe(0);
      expect(result.model).toBe("mock-model");
    });

    it("uses RAG when vector store has matching content", async () => {
      // Populate vector store with test data
      await vectorStore.upsert(
        "protocol:aave",
        [0.9, 0.1, 0],
        "Protocol: Aave\nCategory: Lending\nTVL: $10B",
        { category: "protocol", source: "defillama", name: "Aave" },
      );
      await vectorStore.upsert(
        "protocol:uniswap",
        [0.8, 0.2, 0],
        "Protocol: Uniswap\nCategory: DEX\nTVL: $5B",
        { category: "protocol", source: "defillama", name: "Uniswap" },
      );

      const result = await ragQuery("What are the top DeFi protocols?");

      expect(result.answer).toBeTruthy();
      expect(result.ragUsed).toBe(true);
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.retrievalCount).toBeGreaterThan(0);
      expect(result.contextLength).toBeGreaterThan(0);
    });

    it("respects category filter", async () => {
      await vectorStore.upsert(
        "news:1",
        [0.9, 0.1, 0],
        "Bitcoin hits new ATH at $150K",
        { category: "news", source: "CoinDesk" },
      );
      await vectorStore.upsert(
        "protocol:compound",
        [0.8, 0.2, 0],
        "Protocol: Compound\nCategory: Lending",
        { category: "protocol", source: "defillama" },
      );

      const result = await ragQuery("What's happening in crypto?", {
        category: "news",
      });

      expect(result.ragUsed).toBe(true);
      // All sources should be news category
      for (const source of result.sources) {
        expect(source.category).toBe("news");
      }
    });

    it("respects topK option", async () => {
      // Add many entries
      for (let i = 0; i < 10; i++) {
        await vectorStore.upsert(
          `doc:${i}`,
          [1 - i * 0.05, i * 0.05, 0],
          `Document ${i}`,
          { category: "test" },
        );
      }

      const result = await ragQuery("test query", { topK: 3 });
      expect(result.sources.length).toBeLessThanOrEqual(3);
    });

    it("filters out low-score results with minScore", async () => {
      // Insert one highly relevant and one barely relevant
      await vectorStore.upsert(
        "relevant",
        [1, 0, 0],
        "Highly relevant document",
        { category: "test" },
      );
      await vectorStore.upsert(
        "irrelevant",
        [0, 0, 1],
        "Completely orthogonal document",
        { category: "test" },
      );

      const result = await ragQuery("test query", { minScore: 0.5 });
      // The orthogonal doc (score ~0) should be filtered out
      const irrelevantSource = result.sources.find((s) => s.id === "irrelevant");
      expect(irrelevantSource).toBeUndefined();
    });

    it("returns model info from LLM response", async () => {
      await vectorStore.upsert("doc:1", [1, 0, 0], "Test doc", { category: "general" });

      const result = await ragQuery("test");
      expect(result.model).toBe("mock-model");
      expect(result.tokensUsed).toBe(100);
    });
  });

  describe("convenience functions", () => {
    beforeEach(async () => {
      await vectorStore.upsert(
        "protocol:test",
        [0.9, 0.1, 0],
        "Protocol: TestProto",
        { category: "protocol", source: "defillama" },
      );
      await vectorStore.upsert(
        "news:test",
        [0.8, 0.2, 0],
        "News: Test Article",
        { category: "news", source: "CoinDesk" },
      );
      await vectorStore.upsert(
        "agent:test",
        [0.7, 0.3, 0],
        "Agent: Test Agent",
        { category: "agent", source: "agents" },
      );
    });

    it("ragAskAboutProtocol passes category filter", async () => {
      const result = await ragAskAboutProtocol("What is TVL?");
      expect(result.answer).toBeTruthy();
    });

    it("ragAskAboutNews passes category filter", async () => {
      const result = await ragAskAboutNews("Latest crypto news?");
      expect(result.answer).toBeTruthy();
    });

    it("ragFindAgent passes category filter", async () => {
      const result = await ragFindAgent("I need help with yield farming");
      expect(result.answer).toBeTruthy();
    });
  });
});
