/**
 * Tests for the vector store module.
 *
 * Exercises the in-memory vector store backend, which is the default
 * when no GCP_PROJECT_ID is set. Tests cover upsert, search, delete,
 * count, cosine similarity, and filtering.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Ensure in-memory backend is used
vi.stubEnv("GCP_PROJECT_ID", "");
vi.stubEnv("REDIS_URL", "");

const { createVectorStore, cosineSimilarity } = await import("@/lib/vector-store.js");

describe("vector-store module", () => {
  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const v = [1, 2, 3, 4, 5];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it("returns 0 for orthogonal vectors", () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    it("returns -1 for opposite vectors", () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    it("handles normalized vectors correctly", () => {
      const a = [0.6, 0.8, 0];
      const b = [0.6, 0.8, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    it("returns correct similarity for non-trivial vectors", () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      // cos(a,b) = (4+10+18) / (sqrt(14) * sqrt(77)) ≈ 0.9746
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.9746, 3);
    });

    it("returns 0 when one vector is all zeros", () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      expect(cosineSimilarity(a, b)).toBe(0);
    });
  });

  describe("InMemoryVectorStore", () => {
    let store: Awaited<ReturnType<typeof createVectorStore>>;

    beforeEach(() => {
      store = createVectorStore();
    });

    it("starts empty", async () => {
      expect(await store.count()).toBe(0);
    });

    it("reports in-memory backend", () => {
      expect(store.backend).toBe("in-memory");
    });

    it("upserts and counts vectors", async () => {
      await store.upsert("v1", [1, 0, 0], "first vector", { category: "test" });
      await store.upsert("v2", [0, 1, 0], "second vector", { category: "test" });
      expect(await store.count()).toBe(2);
    });

    it("upsert overwrites existing entry with same ID", async () => {
      await store.upsert("v1", [1, 0, 0], "original", { category: "a" });
      await store.upsert("v1", [0, 1, 0], "updated", { category: "b" });
      expect(await store.count()).toBe(1);

      const results = await store.search([0, 1, 0], 1);
      expect(results[0].content).toBe("updated");
    });

    it("deletes a vector by ID", async () => {
      await store.upsert("v1", [1, 0, 0], "to delete", {});
      expect(await store.count()).toBe(1);
      await store.delete("v1");
      expect(await store.count()).toBe(0);
    });

    it("delete is a no-op for non-existent ID", async () => {
      await store.delete("nonexistent");
      expect(await store.count()).toBe(0);
    });

    describe("search", () => {
      beforeEach(async () => {
        // Insert 4 test vectors along different axes
        await store.upsert("x-axis", [1, 0, 0], "x-axis vector", { category: "spatial" });
        await store.upsert("y-axis", [0, 1, 0], "y-axis vector", { category: "spatial" });
        await store.upsert("z-axis", [0, 0, 1], "z-axis vector", { category: "other" });
        await store.upsert("xy-diag", [0.707, 0.707, 0], "xy diagonal", { category: "spatial" });
      });

      it("returns results sorted by descending similarity", async () => {
        const results = await store.search([1, 0, 0], 10);
        expect(results.length).toBe(4);
        // x-axis should be the most similar to the query [1,0,0]
        expect(results[0].id).toBe("x-axis");
        expect(results[0].score).toBeCloseTo(1.0, 3);
        // z-axis should be least similar (orthogonal)
        expect(results[results.length - 1].score).toBeCloseTo(0.0, 3);
      });

      it("respects topK limit", async () => {
        const results = await store.search([1, 0, 0], 2);
        expect(results.length).toBe(2);
      });

      it("returns content and metadata", async () => {
        const results = await store.search([1, 0, 0], 1);
        expect(results[0].content).toBe("x-axis vector");
        expect(results[0].metadata).toEqual({ category: "spatial" });
      });

      it("filters by category", async () => {
        const results = await store.search([0, 0, 1], 10, { category: "spatial" });
        // z-axis has category "other", should be excluded
        expect(results.every((r) => r.metadata.category === "spatial")).toBe(true);
        expect(results.length).toBe(3);
      });

      it("filters by source", async () => {
        await store.upsert("s1", [1, 0, 0], "sourced", { source: "alpha" });
        await store.upsert("s2", [0, 1, 0], "sourced-b", { source: "beta" });

        const results = await store.search([1, 0, 0], 10, { source: "alpha" });
        expect(results.every((r) => r.metadata.source === "alpha")).toBe(true);
      });

      it("returns empty for a query that matches no filter", async () => {
        const results = await store.search([1, 0, 0], 10, { category: "nonexistent" });
        expect(results.length).toBe(0);
      });

      it("handles search on empty store", async () => {
        const emptyStore = createVectorStore();
        const results = await emptyStore.search([1, 0, 0], 10);
        expect(results).toEqual([]);
      });
    });
  });
});
