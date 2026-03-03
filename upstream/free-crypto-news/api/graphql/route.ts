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
 * 🔮 GraphQL API Endpoint
 * 
 * Flexible GraphQL interface for crypto news queries.
 * 
 * POST /api/graphql - Execute GraphQL queries
 * GET /api/graphql - GraphQL Playground
 */

import { type NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_BASE_URL || 'https://cryptocurrency.cv';

// GraphQL Schema
const SCHEMA = `
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
`;

// Resolvers
async function fetchFromAPI(endpoint: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  } catch (error) {
    console.error(`GraphQL fetch error for ${endpoint}:`, error);
    return null;
  }
}

const resolvers: Record<string, (args: any) => Promise<any>> = {
  // News
  async news({ limit = 20, offset = 0, source, topic }) {
    let endpoint = `/api/news?limit=${limit}&offset=${offset}`;
    if (source) endpoint += `&source=${source}`;
    if (topic) endpoint += `&topic=${topic}`;
    const data = await fetchFromAPI(endpoint);
    return data?.articles || [];
  },
  
  async breaking({ limit = 10 }) {
    const data = await fetchFromAPI(`/api/breaking?limit=${limit}`);
    return data?.articles || [];
  },
  
  async search({ query, limit = 20 }) {
    const data = await fetchFromAPI(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return data?.articles || [];
  },
  
  // Market
  async sentiment() {
    const data = await fetchFromAPI('/api/sentiment');
    return data?.market || { score: 50, label: 'Neutral', bullish: 33, bearish: 33, neutral: 34 };
  },
  
  async fearGreed() {
    const data = await fetchFromAPI('/api/fear-greed');
    return data || { value: 50, classification: 'Neutral' };
  },
  
  async prices({ symbols }) {
    const data = await fetchFromAPI('/api/prices');
    const prices = data?.prices || {};
    
    let result = Object.entries(prices).map(([symbol, info]: [string, any]) => ({
      symbol,
      usd: info.usd || 0,
      change24h: info.change24h || 0,
      change7d: info.change7d,
      marketCap: info.marketCap,
      volume24h: info.volume24h,
    }));
    
    if (symbols && symbols.length > 0) {
      result = result.filter(p => symbols.includes(p.symbol.toLowerCase()));
    }
    
    return result;
  },
  
  async price({ symbol }) {
    const data = await fetchFromAPI('/api/prices');
    const info = data?.prices?.[symbol.toLowerCase()];
    if (!info) return null;
    return {
      symbol,
      usd: info.usd || 0,
      change24h: info.change24h || 0,
      change7d: info.change7d,
      marketCap: info.marketCap,
      volume24h: info.volume24h,
    };
  },
  
  // Trends
  async trending({ limit = 10, hours = 24 }) {
    const data = await fetchFromAPI(`/api/trending?limit=${limit}&hours=${hours}`);
    return data?.topics || [];
  },
  
  // Whales
  async whales({ limit = 10, minUsd = 1000000 }) {
    const data = await fetchFromAPI(`/api/whales?limit=${limit}&min_usd=${minUsd}`);
    return (data?.alerts || []).map((a: any) => ({
      hash: a.hash,
      blockchain: a.blockchain,
      symbol: a.symbol,
      amount: a.amount,
      usdValue: a.usd_value || a.amountUsd,
      from: a.from?.owner || a.from?.address,
      to: a.to?.owner || a.to?.address,
      type: a.type,
      timestamp: a.timestamp,
    }));
  },
  
  // Meta
  async sources() {
    const data = await fetchFromAPI('/api/sources');
    return data?.sources?.map((s: any) => s.name || s.key) || [];
  },
  
  async topics() {
    const data = await fetchFromAPI('/api/topics');
    return data?.topics?.map((t: any) => t.name || t) || [];
  },
};

/**
 * Recursive descent GraphQL query parser
 * 
 * Supports:
 * - Multiple root fields: { news { ... } prices { ... } }
 * - Arguments: news(limit: 10, source: "coindesk")
 * - Array arguments: prices(symbols: ["btc", "eth"])
 * - Variables via the variables object
 * - Nested field selection (returned fields filtered to selection)
 */

interface ParsedField {
  name: string;
  args: Record<string, unknown>;
  fields?: string[];
}

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < query.length) {
    // Skip whitespace
    if (/\s/.test(query[i])) { i++; continue; }
    // Skip comments
    if (query[i] === '#') {
      while (i < query.length && query[i] !== '\n') i++;
      continue;
    }
    // Structural chars
    if ('{([])},.:!'.includes(query[i])) {
      tokens.push(query[i]);
      i++;
      continue;
    }
    // String literal
    if (query[i] === '"') {
      let s = '';
      i++; // skip opening quote
      while (i < query.length && query[i] !== '"') {
        if (query[i] === '\\' && i + 1 < query.length) { s += query[i + 1]; i += 2; }
        else { s += query[i]; i++; }
      }
      i++; // skip closing quote
      tokens.push(`"${s}"`);
      continue;
    }
    // Number or word
    let word = '';
    while (i < query.length && /[a-zA-Z0-9_.\-]/.test(query[i])) {
      word += query[i]; i++;
    }
    if (word) tokens.push(word);
  }
  return tokens;
}

function parseArgValue(tokens: string[], pos: { i: number }): unknown {
  const t = tokens[pos.i];
  if (!t) return null;

  // String
  if (t.startsWith('"')) {
    pos.i++;
    return t.slice(1, -1);
  }
  // Array
  if (t === '[') {
    pos.i++; // skip [
    const arr: unknown[] = [];
    while (pos.i < tokens.length && tokens[pos.i] !== ']') {
      if (tokens[pos.i] === ',') { pos.i++; continue; }
      arr.push(parseArgValue(tokens, pos));
    }
    pos.i++; // skip ]
    return arr;
  }
  // Boolean
  if (t === 'true' || t === 'false') { pos.i++; return t === 'true'; }
  // Number
  if (/^-?\d+(\.\d+)?$/.test(t)) { pos.i++; return parseFloat(t); }
  // Variable reference ($varName) — just return as string for now
  if (t.startsWith('$')) { pos.i++; return t; }
  // Enum / identifier
  pos.i++;
  return t;
}

function parseArgs(tokens: string[], pos: { i: number }): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (tokens[pos.i] !== '(') return args;
  pos.i++; // skip (
  while (pos.i < tokens.length && tokens[pos.i] !== ')') {
    if (tokens[pos.i] === ',') { pos.i++; continue; }
    const key = tokens[pos.i]; pos.i++;
    if (tokens[pos.i] === ':') pos.i++; // skip :
    args[key] = parseArgValue(tokens, pos);
  }
  pos.i++; // skip )
  return args;
}

function parseSelectionSet(tokens: string[], pos: { i: number }): string[] {
  const fields: string[] = [];
  if (tokens[pos.i] !== '{') return fields;
  pos.i++; // skip {
  let depth = 0;
  while (pos.i < tokens.length && !(tokens[pos.i] === '}' && depth === 0)) {
    if (tokens[pos.i] === '{') { depth++; pos.i++; continue; }
    if (tokens[pos.i] === '}') { depth--; pos.i++; continue; }
    if (tokens[pos.i] === '(' || tokens[pos.i] === ')' || tokens[pos.i] === ':' || tokens[pos.i] === ',') {
      pos.i++; continue;
    }
    const fieldName = tokens[pos.i];
    if (fieldName && /^[a-zA-Z_]/.test(fieldName)) {
      fields.push(fieldName);
    }
    pos.i++;
  }
  pos.i++; // skip closing }
  return fields;
}

function parseQuery(query: string): ParsedField[] {
  const tokens = tokenize(query);
  const pos = { i: 0 };
  const fields: ParsedField[] = [];

  // Skip optional "query" keyword and operation name
  if (tokens[pos.i] === 'query' || tokens[pos.i] === 'mutation') {
    pos.i++;
    // Skip operation name if present
    if (pos.i < tokens.length && tokens[pos.i] !== '{' && tokens[pos.i] !== '(') pos.i++;
    // Skip variables definition
    if (tokens[pos.i] === '(') {
      let depth = 1; pos.i++;
      while (pos.i < tokens.length && depth > 0) {
        if (tokens[pos.i] === '(') depth++;
        else if (tokens[pos.i] === ')') depth--;
        pos.i++;
      }
    }
  }

  // Skip to opening brace of root selection set
  if (tokens[pos.i] === '{') pos.i++;

  // Parse multiple fields
  while (pos.i < tokens.length && tokens[pos.i] !== '}') {
    const name = tokens[pos.i];
    if (!name || !/^[a-zA-Z_]/.test(name)) { pos.i++; continue; }
    pos.i++;

    const args = parseArgs(tokens, pos);
    const selFields = tokens[pos.i] === '{' ? parseSelectionSet(tokens, pos) : undefined;

    fields.push({ name, args, fields: selFields });
  }

  return fields;
}

// Execute GraphQL query — supports multiple root fields
async function executeQuery(query: string, variables?: Record<string, any>) {
  const parsedFields = parseQuery(query);
  if (parsedFields.length === 0) {
    return { errors: [{ message: 'Could not parse query. Ensure it follows GraphQL syntax: { fieldName(args) { subFields } }' }] };
  }

  const data: Record<string, any> = {};
  const errors: Array<{ message: string; path?: string[] }> = [];

  // Resolve all root fields in parallel
  const results = await Promise.allSettled(
    parsedFields.map(async (field) => {
      const resolver = resolvers[field.name];
      if (!resolver) {
        throw new Error(`Unknown field: ${field.name}`);
      }

      // Substitute variables into args
      const resolvedArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(field.args)) {
        if (typeof v === 'string' && v.startsWith('$') && variables?.[v.slice(1)] !== undefined) {
          resolvedArgs[k] = variables[v.slice(1)];
        } else {
          resolvedArgs[k] = v;
        }
      }

      const result = await resolver(resolvedArgs);

      // Filter to requested fields if specified
      if (field.fields && field.fields.length > 0 && result !== null) {
        if (Array.isArray(result)) {
          return { name: field.name, data: result.map((item: Record<string, unknown>) => {
            if (typeof item !== 'object' || item === null) return item;
            const filtered: Record<string, unknown> = {};
            for (const f of field.fields!) {
              if (f in item) filtered[f] = item[f];
            }
            return filtered;
          })};
        } else if (typeof result === 'object') {
          const filtered: Record<string, unknown> = {};
          for (const f of field.fields) {
            if (f in result) filtered[f] = result[f];
          }
          return { name: field.name, data: filtered };
        }
      }

      return { name: field.name, data: result };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      data[result.value.name] = result.value.data;
    } else {
      const errMsg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
      errors.push({ message: errMsg });
    }
  }

  if (errors.length > 0 && Object.keys(data).length === 0) {
    return { errors };
  }
  return errors.length > 0 ? { data, errors } : { data };
}

// GET - GraphQL Playground
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');
  
  // If query provided, execute it
  if (query) {
    const result = await executeQuery(query);
    return NextResponse.json(result);
  }
  
  // Return playground HTML
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Crypto News GraphQL</title>
  <link rel="stylesheet" href="https://unpkg.com/graphiql/graphiql.min.css" />
</head>
<body style="margin: 0;">
  <div id="graphiql" style="height: 100vh;"></div>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql/graphiql.min.js"></script>
  <script>
    const fetcher = GraphiQL.createFetcher({ url: '/api/graphql' });
    ReactDOM.render(
      React.createElement(GraphiQL, { 
        fetcher,
        defaultQuery: \`# Crypto News GraphQL API
{
  news(limit: 5) {
    title
    source
    sentiment
    timeAgo
  }
}
\`
      }),
      document.getElementById('graphiql'),
    );
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}

// POST - Execute GraphQL queries
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, variables } = body;
    
    if (!query) {
      return NextResponse.json({ errors: [{ message: 'Query required' }] }, { status: 400 });
    }
    
    const result = await executeQuery(query, variables);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ errors: [{ message }] }, { status: 500 });
  }
}
