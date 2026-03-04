/**
 * Tests for src/sources/social.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/fetcher.js", () => ({ fetchJSON: vi.fn() }));
vi.mock("../../lib/cache.js", () => ({
    cache: { wrap: vi.fn((_k: string, _t: number, fn: () => unknown) => fn()) },
}));

import { fetchJSON } from "../../lib/fetcher.js";
import {
    getSocialProfile,
    getSocialProfiles,
    getCryptoCompareSocial,
    getCryptoCompareSocialHistory,
    getLunarMetrics,
    getLunarTopCoins,
    getLunarFeed,
    getFearGreed,
    getFearGreedHistory,
    getSocialDashboard,
    getAggregatedSocialStats,
    getSocialTrending,
    getSocialVolume,
    getSocialSentiment,
    getSocialInfluencers,
    getRedditActivity,
    getGitHubActivity,
    computeSocialPriceCorrelation,
} from "../social.js";

const mockFetch = fetchJSON as ReturnType<typeof vi.fn>;

describe("social source adapter", () => {
    beforeEach(() => { mockFetch.mockReset(); });

    describe("getSocialProfile", () => {
        it("returns social profile", async () => {
            mockFetch.mockResolvedValue({ community_data: { twitter_followers: 1000 } });
            const result = await getSocialProfile("bitcoin");
            expect(result).toBeDefined();
        });

        it("handles error", async () => {
            mockFetch.mockRejectedValue(new Error("fail"));
            await expect(getSocialProfile("bitcoin")).rejects.toThrow();
        });
    });

    describe("getSocialProfiles", () => {
        it("returns multiple profiles", async () => {
            mockFetch.mockResolvedValue({ community_data: { twitter_followers: 100 } });
            const result = await getSocialProfiles(["bitcoin", "ethereum"]);
            expect(result).toBeDefined();
        });
    });

    describe("getCryptoCompareSocial", () => {
        it("returns CryptoCompare social data", async () => {
            mockFetch.mockResolvedValue({ Data: { General: {} } });
            const result = await getCryptoCompareSocial(1182);
            expect(result).toBeDefined();
        });
    });

    describe("getCryptoCompareSocialHistory", () => {
        it("returns social history", async () => {
            mockFetch.mockResolvedValue({ Data: [{ time: 1, comments: 10 }] });
            const result = await getCryptoCompareSocialHistory(1182);
            expect(result).toBeDefined();
        });
    });

    describe("getLunarMetrics", () => {
        it("returns LunarCrush metrics", async () => {
            mockFetch.mockResolvedValue({ data: [{ galaxy_score: 80 }] });
            const result = await getLunarMetrics("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("getLunarTopCoins", () => {
        it("returns top coins by social metric", async () => {
            mockFetch.mockResolvedValue({ data: [{ symbol: "BTC" }] });
            const result = await getLunarTopCoins();
            expect(result).toBeDefined();
        });
    });

    describe("getLunarFeed", () => {
        it("returns social feed", async () => {
            mockFetch.mockResolvedValue({ data: [{ title: "BTC update" }] });
            const result = await getLunarFeed("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("getFearGreed", () => {
        it("returns fear & greed index", async () => {
            mockFetch.mockResolvedValue({ data: [{ value: "72", value_classification: "Greed" }] });
            const result = await getFearGreed();
            expect(result).toBeDefined();
        });
    });

    describe("getFearGreedHistory", () => {
        it("returns historical fear & greed", async () => {
            mockFetch.mockResolvedValue({ data: [{ value: "72" }, { value: "65" }] });
            const result = await getFearGreedHistory(30);
            expect(result).toBeDefined();
        });
    });

    describe("getSocialDashboard", () => {
        it("returns dashboard data", async () => {
            mockFetch.mockResolvedValue({ data: [{ value: "72" }] });
            const result = await getSocialDashboard();
            expect(result).toBeDefined();
        });
    });

    describe("getAggregatedSocialStats", () => {
        it("returns aggregated stats", async () => {
            mockFetch.mockResolvedValue({ community_data: {} });
            const result = await getAggregatedSocialStats("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("getSocialTrending", () => {
        it("returns trending social coins", async () => {
            mockFetch.mockResolvedValue({ coins: [{ item: { id: "btc" } }] });
            const result = await getSocialTrending();
            expect(result).toBeDefined();
        });
    });

    describe("getSocialVolume", () => {
        it("returns social volume data", async () => {
            mockFetch.mockResolvedValue({ Data: [{ time: 1, comments: 100 }] });
            const result = await getSocialVolume(1182);
            expect(result).toBeDefined();
        });
    });

    describe("getSocialSentiment", () => {
        it("returns sentiment analysis", async () => {
            mockFetch.mockResolvedValue({ community_data: {} });
            const result = await getSocialSentiment("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("getSocialInfluencers", () => {
        it("returns influencer data", async () => {
            mockFetch.mockResolvedValue({ data: [{ name: "whale" }] });
            const result = await getSocialInfluencers("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("getRedditActivity", () => {
        it("returns Reddit data", async () => {
            mockFetch.mockResolvedValue({ community_data: { reddit_subscribers: 5000 } });
            const result = await getRedditActivity("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("getGitHubActivity", () => {
        it("returns GitHub data", async () => {
            mockFetch.mockResolvedValue({ developer_data: { forks: 100 } });
            const result = await getGitHubActivity("BTC");
            expect(result).toBeDefined();
        });
    });

    describe("computeSocialPriceCorrelation", () => {
        it("returns correlation data", async () => {
            mockFetch.mockResolvedValue({ Data: [{ time: 1, comments: 10 }] });
            const result = await computeSocialPriceCorrelation("BTC", 1182, 30);
            expect(result).toBeDefined();
        });
    });
});
