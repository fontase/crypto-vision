/**
 * Crypto Vision — Central Schema Exports
 *
 * Barrel file that re-exports ALL Zod schemas from the project.
 * Used by OpenAPI generators and any code needing the full schema catalog.
 *
 * @copyright 2024-2026 nirholas. All rights reserved.
 */

// ─── Primitive Schemas & Validation Helpers ──────────────────
export {
    AIAnalyzeSchema, AIChatSchema, AICompareSchema, AIEmbedSchema, AIExplainSchema, AIPortfolioReviewSchema, AIRiskAssessmentSchema, AISentimentSchema,
    AIStrategySchema, AISummarizeSchema, AgentComposeSchema, AgentMultiSchema, AgentRunSchema,
    // POST body schemas
    AskBodySchema, AssetIdsSchema, BitcoinAddressSchema, ChainIdSchema, ChainSlugSchema, ChartIntervalSchema, CoinCapIntervalSchema, CoinIdListSchema,
    // Primitives
    CoinIdSchema, DaysSchema, GenerateKeySchema, HexAddressSchema, LimitSchema, NumericIdSchema, OrchestrateSchema, PageSchema,
    PaginationSchema, PeriodSchema, PortfolioHoldingsSchema, PositiveIntSchema, PythPriceIdsSchema, RiskAnalysisSchema, SearchQuerySchema, TimeframeSchema, UrlSchema,
    // Factory
    limitSchema,
    // Validation helpers
    validateBody, validateParam,
    validateQueries, validateQuery
} from "./validation.js";

// ─── Route-Level Query & Param Schemas ───────────────────────
export {
    AgentsDiscoverQuerySchema,
    // Agents
    AgentsSearchQuerySchema, AggregateAssetsQuerySchema,
    AggregateHistoryQuerySchema,
    // Aggregate
    AggregateTickersQuerySchema, AggregateTopMoversQuerySchema, AiChainCompareQuerySchema,
    // AI
    AiCompareQuerySchema, AiCorrelationQuerySchema, AiExplainQuerySchema,
    AiPortfolioReviewQuerySchema,
    // Analytics
    AnalyticsCorrelationQuerySchema, AnalyticsL2QuerySchema,
    AnalyticsRevenueQuerySchema, AnalyticsTTActiveUsersQuerySchema, AnalyticsTTFeesQuerySchema, AnalyticsTTMarketQuerySchema, AnalyticsVolatilityQuerySchema,
    // Anomaly
    AnomalyListQuerySchema,
    // Bitcoin
    BitcoinAddressParamSchema, BitcoinBlockParamSchema, BitcoinTxParamSchema, CalendarAggregateQuerySchema, CalendarCategoryQuerySchema, CalendarCoinQuerySchema,
    // Calendar
    CalendarEventsQuerySchema, CexBookTickerQuerySchema, CexKlinesQuerySchema, CexMiniTickerQuerySchema, CexOrderbookQuerySchema, CexPairsQuerySchema, CexPricesQuerySchema,
    // CEX
    CexTickersQuerySchema, CexTradesQuerySchema, DefiHacksQuerySchema,
    // DeFi
    DefiProtocolsQuerySchema, DefiRaisesQuerySchema, DefiRevenueQuerySchema, DefiTreasuriesQuerySchema, DefiYieldsQuerySchema, DerivativesLiquidationsQuerySchema,
    DerivativesLongShortQuerySchema,
    // Derivatives
    DerivativesOiQuerySchema,
    // ETF
    EtfChartQuerySchema,
    // Exchanges
    ExchangesBybitInsuranceQuerySchema,
    ExchangesBybitRiskQuerySchema, ExchangesCoincapCandlesQuerySchema, ExchangesDeribitIndexQuerySchema, ExchangesOkxInstrumentsQuerySchema,
    ExchangesOkxMarkPriceQuerySchema,
    // Gas
    GasChainQuerySchema,
    // Governance
    GovernanceProposalsQuerySchema,
    GovernanceSpacesQuerySchema, GovernanceTopSpacesQuerySchema, GovernanceVotesQuerySchema, L2ActivityQuerySchema,
    // L2
    L2TvlQuerySchema,
    // Macro
    MacroQuoteParamSchema, MarketAthDistanceQuerySchema, MarketChartParamsSchema,
    MarketChartQuerySchema, MarketCoincapAssetsQuerySchema,
    MarketCoincapHistoryQuerySchema,
    MarketCoinloreTickersQuerySchema,
    // Market
    MarketCoinsQuerySchema, MarketCompareQuerySchema, MarketFearGreedQuerySchema,
    MarketGainersLosersQuerySchema,
    MarketHighVolumeQuerySchema, MarketMarketsQuerySchema, MarketOhlcQuerySchema, MarketPaprikaTickersQuerySchema, MarketPriceQuerySchema, MarketRatesQuerySchema, MarketSearchQuerySchema, NewsAggBreakingQuerySchema, NewsAggCategoryQuerySchema,
    // News Aggregator
    NewsAggLatestQuerySchema,
    NewsAggSearchQuerySchema, NewsAggTrendingQuerySchema, NewsBreakingQuerySchema, NewsCategoryLimitQuerySchema, NewsHomepageQuerySchema,
    // News
    NewsListQuerySchema,
    NewsSearchQuerySchema, NewsTrendingQuerySchema, NftActivityQuerySchema,
    NftBidsQuerySchema, NftCollectionQuerySchema, NftListQuerySchema, NftListingsQuerySchema, NftMarketChartQuerySchema, NftSearchQuerySchema, NftStatsQuerySchema,
    // NFT
    NftTopQuerySchema,
    NftTrendingQuerySchema, NftUserQuerySchema, OnchainBtcBlocksQuerySchema, OnchainBtcHashrateQuerySchema, OnchainBtcMinersQuerySchema,
    // Onchain
    OnchainPricesQuerySchema,
    OnchainTvlQuerySchema, PerpsDydxSparklinesQuerySchema,
    // Perps
    PerpsKlinesQuerySchema,
    // Portfolio
    PortfolioVolatilityQuerySchema,
    // Research
    ResearchAssetsQuerySchema,
    ResearchCompareQuerySchema, ResearchExchangesQuerySchema, ResearchHistodayQuerySchema,
    ResearchHistohourQuerySchema, ResearchNewsQuerySchema, ResearchPriceQuerySchema, ResearchTopMcapQuerySchema, ResearchTopVolumeQuerySchema, SocialCCHistoryQuerySchema, SocialFearGreedHistoryQuerySchema, SocialFearGreedQuerySchema, SocialLunarFeedQuerySchema, SocialLunarTopQuerySchema,
    // Social
    SocialProfilesQuerySchema,
    // Solana
    SolanaPriceQuerySchema, SolanaPriceVsQuerySchema, SolanaPricesQuerySchema,
    SolanaQuoteQuerySchema,
    SolanaSearchQuerySchema, StakingOperatorsQuerySchema,
    // Staking
    StakingRatedQuerySchema,
    // Unlocks
    UnlocksUpcomingQuerySchema,
    // Whales
    WhalesBtcLatestQuerySchema, WhalesChartNamedQuerySchema, WhalesChartsQuerySchema, WhalesEthHoldersQuerySchema,
    WhalesEthTransfersQuerySchema,
    // WebSocket
    WsPricesQuerySchema
} from "./route-schemas.js";

