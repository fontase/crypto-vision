/**
 * Agent Ecosystem — Genesis Population
 *
 * Defines the founding population of 43 agents from the existing
 * agent definitions in agents/src/. Each genesis agent gets:
 * - A unique identity derived from its existing definition
 * - Base skills derived from its tags and category
 * - A PumpFun token (minted during initialization)
 *
 * This is generation 0 — the ancestors of all future organisms.
 *
 * @copyright 2024-2026 nirholas. All rights reserved.
 */

import type { GenesisAgentDef, GenesisSkill } from "./types.js";

// ─── Base Skills ────────────────────────────────────────────
// These are the foundational skills that genesis agents are born with.
// New skills can emerge through composition and learning.

export const GENESIS_SKILLS: GenesisSkill[] = [
  // Analysis
  { slug: "technical-analysis", name: "Technical Analysis", description: "Chart patterns, indicators, support/resistance levels", category: "analysis", baseWeight: 7, rarity: 0.2 },
  { slug: "fundamental-analysis", name: "Fundamental Analysis", description: "Token economics, team, roadmap, partnerships evaluation", category: "analysis", baseWeight: 7, rarity: 0.25 },
  { slug: "sentiment-analysis", name: "Sentiment Analysis", description: "Market mood, fear/greed, social signal interpretation", category: "analysis", baseWeight: 6, rarity: 0.3 },
  { slug: "macro-analysis", name: "Macro Analysis", description: "Global economic trends, interest rates, regulatory impact", category: "analysis", baseWeight: 6, rarity: 0.4 },
  { slug: "narrative-tracking", name: "Narrative Tracking", description: "Identifying and riding market narratives (AI, RWA, DePIN, etc.)", category: "analysis", baseWeight: 8, rarity: 0.35 },

  // Trading
  { slug: "momentum-trading", name: "Momentum Trading", description: "Riding trends, catching breakouts early", category: "trading", baseWeight: 7, rarity: 0.25 },
  { slug: "swing-trading", name: "Swing Trading", description: "Multi-day/week position management", category: "trading", baseWeight: 6, rarity: 0.2 },
  { slug: "scalping", name: "Scalping", description: "Rapid in-and-out trades on small price moves", category: "trading", baseWeight: 5, rarity: 0.3 },
  { slug: "position-sizing", name: "Position Sizing", description: "Kelly criterion, risk-based sizing, portfolio allocation", category: "trading", baseWeight: 8, rarity: 0.3 },
  { slug: "entry-timing", name: "Entry Timing", description: "Identifying optimal entry points and accumulation zones", category: "trading", baseWeight: 7, rarity: 0.35 },
  { slug: "exit-strategy", name: "Exit Strategy", description: "Take-profit levels, stop-losses, trailing stops", category: "trading", baseWeight: 8, rarity: 0.3 },
  { slug: "mev-awareness", name: "MEV Awareness", description: "Front-running protection, sandwich attack avoidance", category: "trading", baseWeight: 6, rarity: 0.5 },

  // DeFi
  { slug: "yield-farming", name: "Yield Farming", description: "Finding and evaluating yield opportunities across protocols", category: "defi", baseWeight: 7, rarity: 0.3 },
  { slug: "liquidity-provision", name: "Liquidity Provision", description: "LP strategies, impermanent loss management", category: "defi", baseWeight: 6, rarity: 0.35 },
  { slug: "protocol-analysis", name: "Protocol Analysis", description: "Smart contract evaluation, TVL analysis, protocol comparison", category: "defi", baseWeight: 7, rarity: 0.3 },
  { slug: "bridge-navigation", name: "Bridge Navigation", description: "Cross-chain asset movement, bridge security assessment", category: "defi", baseWeight: 5, rarity: 0.4 },
  { slug: "staking-optimization", name: "Staking Optimization", description: "Validator selection, liquid staking strategies", category: "defi", baseWeight: 6, rarity: 0.3 },
  { slug: "airdrop-hunting", name: "Airdrop Hunting", description: "Identifying and qualifying for token airdrops", category: "defi", baseWeight: 5, rarity: 0.45 },

  // Risk
  { slug: "risk-assessment", name: "Risk Assessment", description: "Rug detection, contract audit interpretation, risk scoring", category: "risk", baseWeight: 9, rarity: 0.25 },
  { slug: "portfolio-hedging", name: "Portfolio Hedging", description: "Hedging strategies using derivatives and correlated assets", category: "risk", baseWeight: 7, rarity: 0.45 },
  { slug: "drawdown-management", name: "Drawdown Management", description: "Max drawdown limits, recovery strategies", category: "risk", baseWeight: 8, rarity: 0.35 },
  { slug: "insurance-knowledge", name: "Insurance Knowledge", description: "DeFi insurance protocols, coverage strategies", category: "risk", baseWeight: 5, rarity: 0.5 },

  // Data
  { slug: "data-aggregation", name: "Data Aggregation", description: "Multi-source data collection and normalization", category: "data", baseWeight: 6, rarity: 0.2 },
  { slug: "pattern-recognition", name: "Pattern Recognition", description: "Historical pattern matching, anomaly detection", category: "data", baseWeight: 8, rarity: 0.4 },
  { slug: "api-integration", name: "API Integration", description: "Consuming and correlating data from multiple APIs", category: "data", baseWeight: 5, rarity: 0.2 },

  // Social
  { slug: "social-monitoring", name: "Social Monitoring", description: "Twitter/X, Discord, Telegram signal detection", category: "social", baseWeight: 6, rarity: 0.25 },
  { slug: "influencer-tracking", name: "Influencer Tracking", description: "KOL activity monitoring, call tracking", category: "social", baseWeight: 6, rarity: 0.3 },
  { slug: "news-interpretation", name: "News Interpretation", description: "Crypto news analysis, impact assessment", category: "social", baseWeight: 7, rarity: 0.25 },

  // On-chain
  { slug: "whale-tracking", name: "Whale Tracking", description: "Large wallet movement monitoring, smart money following", category: "onchain", baseWeight: 8, rarity: 0.35 },
  { slug: "token-flow-analysis", name: "Token Flow Analysis", description: "Exchange inflow/outflow, supply distribution", category: "onchain", baseWeight: 7, rarity: 0.35 },
  { slug: "mempool-reading", name: "Mempool Reading", description: "Pending transaction analysis, gas prediction", category: "onchain", baseWeight: 7, rarity: 0.5 },
  { slug: "smart-contract-reading", name: "Smart Contract Reading", description: "Contract verification, function analysis", category: "onchain", baseWeight: 6, rarity: 0.45 },

  // Meta
  { slug: "multi-agent-coordination", name: "Multi-Agent Coordination", description: "Working with other agents, swarm intelligence", category: "meta", baseWeight: 9, rarity: 0.6 },
  { slug: "self-improvement", name: "Self-Improvement", description: "Learning from past trades, strategy adaptation", category: "meta", baseWeight: 10, rarity: 0.7 },
  { slug: "market-regime-detection", name: "Market Regime Detection", description: "Bull/bear/crab market identification, strategy switching", category: "meta", baseWeight: 9, rarity: 0.5 },
];

// ─── Tag to Skill Mapping ───────────────────────────────────
// Maps agent tags to skill slugs for the genesis population

const TAG_TO_SKILLS: Record<string, string[]> = {
  // DeFi skills
  "defi": ["protocol-analysis", "yield-farming", "risk-assessment"],
  "yield": ["yield-farming", "liquidity-provision", "staking-optimization"],
  "yield-farming": ["yield-farming", "liquidity-provision", "protocol-analysis"],
  "apy": ["yield-farming", "fundamental-analysis"],
  "apr": ["yield-farming", "fundamental-analysis"],
  "liquidity": ["liquidity-provision", "protocol-analysis"],
  "staking": ["staking-optimization", "yield-farming"],
  "bridge": ["bridge-navigation", "risk-assessment"],
  "airdrop": ["airdrop-hunting", "social-monitoring"],
  "insurance": ["insurance-knowledge", "risk-assessment"],

  // Trading skills
  "trading": ["momentum-trading", "position-sizing", "exit-strategy"],
  "dex": ["scalping", "mev-awareness", "entry-timing"],
  "aggregator": ["data-aggregation", "scalping"],
  "mev": ["mev-awareness", "mempool-reading"],

  // Analysis skills
  "analysis": ["technical-analysis", "fundamental-analysis"],
  "technical-analysis": ["technical-analysis", "pattern-recognition"],
  "fundamental-analysis": ["fundamental-analysis", "protocol-analysis"],
  "sentiment": ["sentiment-analysis", "social-monitoring"],
  "macro": ["macro-analysis", "market-regime-detection"],
  "narrative": ["narrative-tracking", "sentiment-analysis"],

  // Risk skills
  "risk": ["risk-assessment", "drawdown-management", "portfolio-hedging"],
  "security": ["risk-assessment", "smart-contract-reading"],
  "audit": ["smart-contract-reading", "risk-assessment"],
  "rug": ["risk-assessment", "smart-contract-reading"],

  // Data skills
  "data": ["data-aggregation", "api-integration"],
  "analytics": ["pattern-recognition", "data-aggregation"],
  "research": ["fundamental-analysis", "data-aggregation"],
  "comparison": ["protocol-analysis", "data-aggregation"],

  // Social skills
  "social": ["social-monitoring", "influencer-tracking"],
  "news": ["news-interpretation", "sentiment-analysis"],
  "twitter": ["social-monitoring", "influencer-tracking"],

  // On-chain skills
  "onchain": ["token-flow-analysis", "whale-tracking"],
  "whale": ["whale-tracking", "token-flow-analysis"],
  "nft": ["fundamental-analysis", "social-monitoring"],

  // Tax/Legal
  "tax": ["fundamental-analysis", "macro-analysis"],
  "regulation": ["macro-analysis", "news-interpretation"],

  // Meta
  "education": ["self-improvement", "fundamental-analysis"],
  "onboarding": ["self-improvement", "protocol-analysis"],
  "strategy": ["market-regime-detection", "multi-agent-coordination"],
  "portfolio": ["position-sizing", "portfolio-hedging", "drawdown-management"],
};

/**
 * Derive skill slugs from an agent's tags.
 * Returns a deduplicated list of skill slugs.
 */
export function deriveSkillsFromTags(tags: string[]): string[] {
  const skills = new Set<string>();
  for (const tag of tags) {
    const mappedSkills = TAG_TO_SKILLS[tag.toLowerCase()];
    if (mappedSkills) {
      for (const skill of mappedSkills) {
        skills.add(skill);
      }
    }
  }

  // Every agent gets base meta skills
  skills.add("self-improvement");

  // Minimum 3 skills per agent
  if (skills.size < 3) {
    skills.add("data-aggregation");
    skills.add("risk-assessment");
  }

  return [...skills];
}

/**
 * Generate a token symbol from an agent identifier.
 * Takes first letters of each word, uppercase, max 6 chars.
 */
export function generateSymbol(identifier: string): string {
  const words = identifier.split("-").filter((w) => w.length > 0);
  if (words.length === 1) {
    return words[0].slice(0, 6).toUpperCase();
  }
  const symbol = words.map((w) => w[0]).join("").toUpperCase();
  return symbol.slice(0, 6);
}

/**
 * Categorize an agent based on its identifier keywords.
 */
export function categorizeAgent(identifier: string): string {
  const id = identifier.toLowerCase();
  if (id.includes("yield") || id.includes("farm") || id.includes("apy") || id.includes("apr")) return "defi";
  if (id.includes("risk") || id.includes("security") || id.includes("audit") || id.includes("insurance")) return "risk";
  if (id.includes("trade") || id.includes("dex") || id.includes("swap") || id.includes("aggregator")) return "trading";
  if (id.includes("whale") || id.includes("onchain") || id.includes("flow")) return "onchain";
  if (id.includes("news") || id.includes("social") || id.includes("sentiment")) return "social";
  if (id.includes("bridge") || id.includes("l2") || id.includes("cross-chain")) return "defi";
  if (id.includes("tax") || id.includes("regulation")) return "analysis";
  if (id.includes("airdrop") || id.includes("hunt")) return "defi";
  if (id.includes("staking") || id.includes("validator")) return "defi";
  if (id.includes("analysis") || id.includes("research") || id.includes("compare")) return "analysis";
  if (id.includes("education") || id.includes("onboard") || id.includes("mentor")) return "meta";
  return "analysis";
}

/**
 * Convert an agent definition JSON into a genesis organism definition.
 */
export function agentToGenesisDef(agent: {
  identifier: string;
  meta: { title: string; description: string; avatar: string; tags?: string[] };
  config: { systemRole: string };
}): GenesisAgentDef {
  const tags = agent.meta.tags ?? [];
  return {
    identifier: agent.identifier,
    name: agent.meta.title,
    symbol: generateSymbol(agent.identifier),
    avatar: agent.meta.avatar,
    description: agent.meta.description,
    systemPrompt: agent.config.systemRole,
    tags,
    skills: deriveSkillsFromTags(tags),
    category: categorizeAgent(agent.identifier),
  };
}
