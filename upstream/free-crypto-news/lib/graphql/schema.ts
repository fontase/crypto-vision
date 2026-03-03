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
 * GraphQL Schema Definition
 *
 * Centralized schema string for the crypto news GraphQL API.
 * Used by the route handler and subscription server.
 */

export const SCHEMA = `
type Article {
  id: ID!
  title: String!
  source: String!
  sourceKey: String
  link: String!
  timeAgo: String!
  timestamp: String
  sentiment: String
  sentimentScore: Float
  isBreaking: Boolean
  topics: [String!]
  summary: String
}

type MarketSentiment {
  score: Int!
  label: String!
  bullish: Int!
  bearish: Int!
  neutral: Int!
}

type FearGreed {
  value: Int!
  classification: String!
  timestamp: String
  previousClose: Int
  weekAgo: Int
  monthAgo: Int
}

type Price {
  symbol: String!
  usd: Float!
  change24h: Float
  change7d: Float
  marketCap: Float
  volume24h: Float
}

type TrendingTopic {
  name: String!
  mentions: Int!
  sentiment: String
  change: Float
}

type WhaleAlert {
  hash: String!
  blockchain: String!
  symbol: String!
  amount: Float!
  usdValue: Float!
  from: String
  to: String
  type: String
  timestamp: String
}

type Query {
  # News queries
  news(limit: Int, offset: Int, source: String, topic: String): [Article!]!
  breaking(limit: Int): [Article!]!
  search(query: String!, limit: Int): [Article!]!
  article(id: ID!): Article

  # Market data
  sentiment: MarketSentiment!
  fearGreed: FearGreed!
  prices(symbols: [String!]): [Price!]!
  price(symbol: String!): Price

  # Trends
  trending(limit: Int, hours: Int): [TrendingTopic!]!

  # Whale activity
  whales(limit: Int, minUsd: Float): [WhaleAlert!]!

  # Meta
  sources: [String!]!
  topics: [String!]!
}

type Subscription {
  # Real-time news feed – optional source/topic filters
  newsFeed(source: String, topic: String): Article!

  # Live price updates for a given symbol (e.g. "btc")
  priceUpdated(symbol: String!): Price!
}
`;

/** Field-level cost weights for complexity analysis */
export const FIELD_COSTS: Record<string, number> = {
  news: 10,
  breaking: 10,
  search: 15,
  article: 5,
  sentiment: 3,
  fearGreed: 3,
  prices: 8,
  price: 5,
  trending: 8,
  whales: 10,
  sources: 2,
  topics: 2,
  // Subscriptions (evaluated at subscribe-time)
  newsFeed: 5,
  priceUpdated: 5,
};

/** Multiplier cost per list item requested (applied to `limit` arg) */
export const LIST_COST_PER_ITEM = 0.5;
