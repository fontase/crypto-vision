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
 * LLM-Powered Entity Extractor
 *
 * Enhances the existing regex-based knowledge graph with LLM-powered entity
 * and relationship extraction. Uses structured prompting to identify entities,
 * relationships, events, claims, and sentiment from crypto news articles.
 *
 * Unlike the dictionary-based NER in knowledge-graph.ts, this module:
 * - Discovers novel entities not in any dictionary
 * - Extracts nuanced relationships (partnerships, acquisitions, conflicts)
 * - Identifies implicit connections and causal chains
 * - Provides entity disambiguation (Bitcoin the asset vs Bitcoin Core the software)
 * - Detects temporal context (date-specific relations)
 * - Extracts claims with attribution and confidence
 *
 * Features:
 * - Batch entity extraction with deduplication
 * - Relationship strength scoring with evidence
 * - Event detection and classification
 * - Claim extraction with source attribution
 * - Entity disambiguation via context analysis
 * - Incremental knowledge graph enrichment
 * - Rate-limited processing with progress tracking
 *
 * @module entity-extractor
 */

import { aiComplete } from './ai-provider';
import { cache, withCache } from './cache';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type EntityCategory =
  | 'person'
  | 'organization'
  | 'token'
  | 'blockchain'
  | 'protocol'
  | 'exchange'
  | 'fund'
  | 'regulator'
  | 'technology'
  | 'event'
  | 'concept'
  | 'location';

export type RelationshipType =
  | 'founded'
  | 'invested-in'
  | 'partnered-with'
  | 'acquired'
  | 'competes-with'
  | 'built-on'
  | 'regulates'
  | 'endorsed'
  | 'criticized'
  | 'hired'
  | 'sued'
  | 'forked-from'
  | 'integrated-with'
  | 'listed-on'
  | 'backed-by'
  | 'related-to';

export type EventType =
  | 'launch'
  | 'hack'
  | 'regulation'
  | 'partnership'
  | 'funding'
  | 'listing'
  | 'delisting'
  | 'upgrade'
  | 'exploit'
  | 'acquisition'
  | 'bankruptcy'
  | 'legal'
  | 'governance'
  | 'airdrop'
  | 'migration';

export interface ExtractedEntity {
  name: string;
  normalizedName: string; // lowercase, standardized
  category: EntityCategory;
  aliases: string[];
  description: string;
  sentiment: number; // -1 to 1 in context of the article
  importance: number; // 0-100 within the article
  firstMention: number; // character offset where first mentioned
  metadata: Record<string, unknown>;
}

export interface ExtractedRelationship {
  source: string; // entity name
  target: string; // entity name
  type: RelationshipType;
  description: string;
  strength: number; // 0-100
  sentiment: number; // -1 to 1
  evidence: string; // quote from the article
  temporal?: {
    date?: string;
    isOngoing: boolean;
    startDate?: string;
    endDate?: string;
  };
}

export interface ExtractedEvent {
  name: string;
  type: EventType;
  date: string; // ISO date or 'unknown'
  description: string;
  entities: string[]; // involved entity names
  impact: 'critical' | 'high' | 'medium' | 'low';
  sentiment: number; // -1 to 1
  evidence: string;
}

export interface ExtractedClaim {
  claim: string;
  source: string; // who made the claim
  target?: string; // about what/whom
  confidence: number; // 0-100 how confident the source seems
  verifiable: boolean;
  sentiment: number; // -1 to 1
  evidence: string; // supporting quote
  category: 'prediction' | 'factual' | 'opinion' | 'rumor' | 'official';
}

export interface ExtractionResult {
  articleId: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  events: ExtractedEvent[];
  claims: ExtractedClaim[];
  topics: string[];
  overallSentiment: number;
  processingTimeMs: number;
}

export interface BatchExtractionResult {
  results: ExtractionResult[];
  aggregatedEntities: AggregatedEntity[];
  aggregatedRelationships: AggregatedRelationship[];
  eventTimeline: ExtractedEvent[];
  processingTimeMs: number;
  articlesProcessed: number;
  articlesFailed: number;
}

export interface AggregatedEntity {
  name: string;
  normalizedName: string;
  category: EntityCategory;
  aliases: string[];
  mentionCount: number;
  avgSentiment: number;
  avgImportance: number;
  sources: string[]; // article IDs
  relatedEntities: string[];
}

export interface AggregatedRelationship {
  source: string;
  target: string;
  type: RelationshipType;
  mentions: number;
  avgStrength: number;
  avgSentiment: number;
  evidence: string[];
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  MAX_ARTICLE_LENGTH: 4000,
  BATCH_SIZE: 5,
  RATE_LIMIT_DELAY_MS: 300,
  CACHE_TTL: 600,
  MAX_ENTITIES_PER_ARTICLE: 20,
  MAX_RELATIONSHIPS_PER_ARTICLE: 15,
  MAX_EVENTS_PER_ARTICLE: 5,
  MAX_CLAIMS_PER_ARTICLE: 8,
  DEDUP_SIMILARITY_THRESHOLD: 0.85,
} as const;

// ═══════════════════════════════════════════════════════════════
// EXTRACTION PROMPTS
// ═══════════════════════════════════════════════════════════════

const ENTITY_EXTRACTION_PROMPT = `You are an expert crypto/blockchain entity extraction system. Extract all meaningful entities from the article below.

For each entity, provide:
- name: The canonical name (not abbreviation unless that's the standard name)
- normalizedName: lowercase, standardized version
- category: person|organization|token|blockchain|protocol|exchange|fund|regulator|technology|event|concept|location
- aliases: Other names or abbreviations used
- description: Brief context about the entity's role in this article
- sentiment: How the article frames this entity (-1 to 1)
- importance: How central this entity is to the article (0-100)

Return JSON:
{
  "entities": [
    {
      "name": "...",
      "normalizedName": "...",
      "category": "...",
      "aliases": [],
      "description": "...",
      "sentiment": -1 to 1,
      "importance": 0-100,
      "firstMention": 0
    }
  ],
  "topics": ["defi", "regulation", "layer-2", ...],
  "overallSentiment": -1 to 1
}`;

const RELATIONSHIP_EXTRACTION_PROMPT = `You are an expert at identifying relationships between entities in crypto news. Given an article and a list of entities found in it, extract all meaningful relationships.

Relationship types: founded, invested-in, partnered-with, acquired, competes-with, built-on, regulates, endorsed, criticized, hired, sued, forked-from, integrated-with, listed-on, backed-by, related-to

For each relationship, provide:
- source/target: entity names (must match the provided entity list)
- type: one of the relationship types above
- description: brief description of the relationship
- strength: 0-100 (how strong/significant is this relationship)
- sentiment: -1 to 1 (positive partnership? hostile lawsuit?)
- evidence: exact quote from the article supporting this relationship
- temporal: date context if available

Return JSON:
{
  "relationships": [
    {
      "source": "Entity A",
      "target": "Entity B",
      "type": "partnered-with",
      "description": "...",
      "strength": 0-100,
      "sentiment": -1 to 1,
      "evidence": "exact quote...",
      "temporal": { "date": "2025-01-15", "isOngoing": true }
    }
  ],
  "events": [
    {
      "name": "Event name",
      "type": "launch|hack|regulation|partnership|funding|listing|upgrade|exploit|acquisition|bankruptcy|legal|governance|airdrop|migration",
      "date": "YYYY-MM-DD or unknown",
      "description": "...",
      "entities": ["Entity A", "Entity B"],
      "impact": "critical|high|medium|low",
      "sentiment": -1 to 1,
      "evidence": "exact quote..."
    }
  ],
  "claims": [
    {
      "claim": "The specific claim being made",
      "source": "Who is making the claim",
      "target": "About what/whom",
      "confidence": 0-100,
      "verifiable": true|false,
      "sentiment": -1 to 1,
      "evidence": "exact quote...",
      "category": "prediction|factual|opinion|rumor|official"
    }
  ]
}`;

// ═══════════════════════════════════════════════════════════════
// SINGLE ARTICLE EXTRACTION
// ═══════════════════════════════════════════════════════════════

export async function extractFromArticle(
  articleId: string,
  title: string,
  content: string,
  source?: string
): Promise<ExtractionResult> {
  const cacheKey = `entity-extract:${articleId}`;
  const cached = cache.get<ExtractionResult>(cacheKey);
  if (cached) return cached;

  const startTime = Date.now();
  const truncatedContent = content.slice(0, CONFIG.MAX_ARTICLE_LENGTH);
  const articleText = `Title: ${title}\nSource: ${source || 'unknown'}\n\n${truncatedContent}`;

  // Step 1: Extract entities
  let entities: ExtractedEntity[] = [];
  let topics: string[] = [];
  let overallSentiment = 0;

  try {
    const entityResponse = await aiComplete(
      ENTITY_EXTRACTION_PROMPT,
      articleText,
      { temperature: 0.1, maxTokens: 2000 }
    );

    const parsed = safeParseJSON<{
      entities: ExtractedEntity[];
      topics: string[];
      overallSentiment: number;
    }>(entityResponse);

    if (parsed) {
      entities = (parsed.entities || [])
        .slice(0, CONFIG.MAX_ENTITIES_PER_ARTICLE)
        .map((e) => ({
          ...e,
          normalizedName: e.normalizedName || e.name.toLowerCase(),
          category: e.category || 'concept',
          aliases: e.aliases || [],
          sentiment: clamp(e.sentiment ?? 0, -1, 1),
          importance: clamp(e.importance ?? 50, 0, 100),
          firstMention: e.firstMention || 0,
          metadata: e.metadata || {},
        }));
      topics = parsed.topics || [];
      overallSentiment = clamp(parsed.overallSentiment ?? 0, -1, 1);
    }
  } catch (error) {
    console.error(`[entity-extractor] Entity extraction failed for ${articleId}:`, error);
  }

  // Step 2: Extract relationships, events, and claims
  let relationships: ExtractedRelationship[] = [];
  let events: ExtractedEvent[] = [];
  let claims: ExtractedClaim[] = [];

  if (entities.length > 0) {
    try {
      const entityNames = entities.map((e) => e.name).join(', ');
      const relPrompt = `Article:\n${articleText}\n\nEntities found: ${entityNames}\n\nExtract relationships, events, and claims.`;

      const relResponse = await aiComplete(
        RELATIONSHIP_EXTRACTION_PROMPT,
        relPrompt,
        { temperature: 0.1, maxTokens: 2500 }
      );

      const parsed = safeParseJSON<{
        relationships: ExtractedRelationship[];
        events: ExtractedEvent[];
        claims: ExtractedClaim[];
      }>(relResponse);

      if (parsed) {
        relationships = (parsed.relationships || [])
          .slice(0, CONFIG.MAX_RELATIONSHIPS_PER_ARTICLE)
          .map((r) => ({
            ...r,
            strength: clamp(r.strength ?? 50, 0, 100),
            sentiment: clamp(r.sentiment ?? 0, -1, 1),
          }));

        events = (parsed.events || [])
          .slice(0, CONFIG.MAX_EVENTS_PER_ARTICLE)
          .map((e) => ({
            ...e,
            sentiment: clamp(e.sentiment ?? 0, -1, 1),
          }));

        claims = (parsed.claims || [])
          .slice(0, CONFIG.MAX_CLAIMS_PER_ARTICLE)
          .map((c) => ({
            ...c,
            confidence: clamp(c.confidence ?? 50, 0, 100),
            sentiment: clamp(c.sentiment ?? 0, -1, 1),
          }));
      }
    } catch (error) {
      console.error(`[entity-extractor] Relationship extraction failed for ${articleId}:`, error);
    }
  }

  const result: ExtractionResult = {
    articleId,
    entities,
    relationships,
    events,
    claims,
    topics,
    overallSentiment,
    processingTimeMs: Date.now() - startTime,
  };

  cache.set(cacheKey, result, CONFIG.CACHE_TTL);

  return result;
}

// ═══════════════════════════════════════════════════════════════
// BATCH EXTRACTION
// ═══════════════════════════════════════════════════════════════

export async function extractFromArticles(
  articles: Array<{
    id: string;
    title: string;
    content: string;
    source?: string;
  }>,
  onProgress?: (done: number, total: number) => void
): Promise<BatchExtractionResult> {
  const startTime = Date.now();
  const results: ExtractionResult[] = [];
  let failed = 0;

  // Process in batches
  for (let i = 0; i < articles.length; i += CONFIG.BATCH_SIZE) {
    const batch = articles.slice(i, i + CONFIG.BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map((article) =>
        extractFromArticle(article.id, article.title, article.content, article.source)
      )
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        failed++;
      }
    }

    onProgress?.(Math.min(i + CONFIG.BATCH_SIZE, articles.length), articles.length);

    // Rate limiting
    if (i + CONFIG.BATCH_SIZE < articles.length) {
      await sleep(CONFIG.RATE_LIMIT_DELAY_MS);
    }
  }

  // Aggregate entities across all articles
  const aggregatedEntities = aggregateEntities(results);
  const aggregatedRelationships = aggregateRelationships(results);
  const eventTimeline = results
    .flatMap((r) => r.events)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return {
    results,
    aggregatedEntities,
    aggregatedRelationships,
    eventTimeline,
    processingTimeMs: Date.now() - startTime,
    articlesProcessed: results.length,
    articlesFailed: failed,
  };
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATION
// ═══════════════════════════════════════════════════════════════

function aggregateEntities(results: ExtractionResult[]): AggregatedEntity[] {
  const entityMap = new Map<string, {
    entity: ExtractedEntity;
    sources: Set<string>;
    sentiments: number[];
    importances: number[];
    relatedEntities: Set<string>;
  }>();

  for (const result of results) {
    for (const entity of result.entities) {
      const key = entity.normalizedName;
      const existing = entityMap.get(key);

      if (existing) {
        existing.sources.add(result.articleId);
        existing.sentiments.push(entity.sentiment);
        existing.importances.push(entity.importance);
        // Track co-occurring entities
        for (const other of result.entities) {
          if (other.normalizedName !== key) {
            existing.relatedEntities.add(other.normalizedName);
          }
        }
      } else {
        const relatedSet = new Set<string>();
        for (const other of result.entities) {
          if (other.normalizedName !== key) relatedSet.add(other.normalizedName);
        }

        entityMap.set(key, {
          entity,
          sources: new Set([result.articleId]),
          sentiments: [entity.sentiment],
          importances: [entity.importance],
          relatedEntities: relatedSet,
        });
      }
    }
  }

  return Array.from(entityMap.values())
    .map(({ entity, sources, sentiments, importances, relatedEntities }) => ({
      name: entity.name,
      normalizedName: entity.normalizedName,
      category: entity.category,
      aliases: entity.aliases,
      mentionCount: sources.size,
      avgSentiment: Math.round((sentiments.reduce((a, b) => a + b, 0) / sentiments.length) * 100) / 100,
      avgImportance: Math.round(importances.reduce((a, b) => a + b, 0) / importances.length),
      sources: Array.from(sources),
      relatedEntities: Array.from(relatedEntities).slice(0, 10),
    }))
    .sort((a, b) => b.mentionCount - a.mentionCount);
}

function aggregateRelationships(results: ExtractionResult[]): AggregatedRelationship[] {
  const relMap = new Map<string, {
    rel: ExtractedRelationship;
    mentions: number;
    strengths: number[];
    sentiments: number[];
    evidence: string[];
  }>();

  for (const result of results) {
    for (const rel of result.relationships) {
      const key = `${rel.source.toLowerCase()}|${rel.type}|${rel.target.toLowerCase()}`;
      const existing = relMap.get(key);

      if (existing) {
        existing.mentions++;
        existing.strengths.push(rel.strength);
        existing.sentiments.push(rel.sentiment);
        if (rel.evidence) existing.evidence.push(rel.evidence);
      } else {
        relMap.set(key, {
          rel,
          mentions: 1,
          strengths: [rel.strength],
          sentiments: [rel.sentiment],
          evidence: rel.evidence ? [rel.evidence] : [],
        });
      }
    }
  }

  return Array.from(relMap.values())
    .map(({ rel, mentions, strengths, sentiments, evidence }) => ({
      source: rel.source,
      target: rel.target,
      type: rel.type,
      mentions,
      avgStrength: Math.round(strengths.reduce((a, b) => a + b, 0) / strengths.length),
      avgSentiment: Math.round((sentiments.reduce((a, b) => a + b, 0) / sentiments.length) * 100) / 100,
      evidence: evidence.slice(0, 5),
    }))
    .sort((a, b) => b.mentions - a.mentions);
}

// ═══════════════════════════════════════════════════════════════
// ENTITY DISAMBIGUATION
// ═══════════════════════════════════════════════════════════════

export async function disambiguateEntity(
  name: string,
  context: string
): Promise<{
  resolvedName: string;
  category: EntityCategory;
  confidence: number;
  reasoning: string;
}> {
  return withCache(cache, `disambiguate:${name}:${context.slice(0, 100)}`, CONFIG.CACHE_TTL, async () => {
    const prompt = `Disambiguate this entity: "${name}"

Context: ${context.slice(0, 500)}

In crypto, many names are ambiguous:
- "Bitcoin" could be BTC the asset, Bitcoin Core software, Bitcoin network, or Bitcoin Cash
- "Polygon" could be Polygon/MATIC, Polygon zkEVM, or Polygon Labs
- "CZ" could be Changpeng Zhao or a concept

Determine the most likely interpretation.

Return JSON:
{
  "resolvedName": "The canonical, unambiguous name",
  "category": "person|organization|token|blockchain|protocol|exchange|fund|regulator|technology|event|concept|location",
  "confidence": 0-100,
  "reasoning": "Why this interpretation"
}`;

    const response = await aiComplete(
      'You are a crypto entity disambiguation expert.',
      prompt,
      { temperature: 0.1, maxTokens: 400 }
    );

    const parsed = safeParseJSON<{
      resolvedName: string;
      category: EntityCategory;
      confidence: number;
      reasoning: string;
    }>(response);

    return {
      resolvedName: parsed?.resolvedName || name,
      category: parsed?.category || 'concept',
      confidence: clamp(parsed?.confidence ?? 50, 0, 100),
      reasoning: parsed?.reasoning || 'No disambiguation available',
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function safeParseJSON<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const blockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (blockMatch) {
      try { return JSON.parse(blockMatch[1].trim()) as T; } catch { /* */ }
    }
    const objMatch = raw.match(/[\[{][\s\S]*[\]}]/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]) as T; } catch { /* */ }
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
