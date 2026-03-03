/**
 * @copyright 2024-2026 nirholas. All rights reserved.
 * @license SPDX-License-Identifier: SEE LICENSE IN LICENSE
 * @see https://github.com/nirholas/free-crypto-news
 *
 * Source Profile Metadata
 * Editorial descriptions, website URLs, and profile data for news sources.
 * Used by /source/[key] profile pages.
 */

export interface SourceProfile {
  /** Short editorial description of the source */
  description: string;
  /** Main website URL (not RSS) */
  website: string;
  /** Year founded/launched */
  founded?: number;
  /** Primary focus areas */
  focus: string[];
  /** Type of publication */
  type: 'mainstream' | 'crypto-native' | 'research' | 'institutional' | 'protocol' | 'fintech' | 'government';
}

/**
 * Curated editorial profiles for major sources.
 * Keys match RSS_SOURCES / SOURCE_TIERS keys.
 */
export const SOURCE_PROFILES: Record<string, SourceProfile> = {
  // ═══════════════════════════════════════════════════════════════
  // Tier 1 — Mainstream
  // ═══════════════════════════════════════════════════════════════
  bloomberg: {
    description: 'Global financial news leader providing institutional-grade crypto and digital asset coverage with deep market analysis.',
    website: 'https://www.bloomberg.com/crypto',
    founded: 1981,
    focus: ['Markets', 'Institutional', 'Regulation', 'Macro'],
    type: 'mainstream',
  },
  reuters: {
    description: 'One of the world\'s largest wire services, delivering breaking crypto news with a focus on regulation, institutional adoption, and geopolitics.',
    website: 'https://www.reuters.com/technology/cryptocurrency/',
    founded: 1851,
    focus: ['Breaking News', 'Regulation', 'Institutional'],
    type: 'mainstream',
  },
  wsj: {
    description: 'The Wall Street Journal\'s crypto desk covers digital assets from a financial market perspective, with investigative reporting and analysis.',
    website: 'https://www.wsj.com/news/types/cryptocurrency',
    founded: 1889,
    focus: ['Markets', 'Regulation', 'Investigation'],
    type: 'mainstream',
  },
  cnbc: {
    description: 'CNBC\'s crypto coverage combines real-time market reporting with expert commentary and interviews with industry leaders.',
    website: 'https://www.cnbc.com/cryptocurrency/',
    founded: 1989,
    focus: ['Markets', 'Trading', 'Interviews'],
    type: 'mainstream',
  },
  forbes: {
    description: 'Forbes covers the business side of crypto — billionaire investors, startup funding, and the intersection of traditional and digital finance.',
    website: 'https://www.forbes.com/crypto-blockchain/',
    founded: 1917,
    focus: ['Business', 'Investing', 'Profiles'],
    type: 'mainstream',
  },
  techcrunch: {
    description: 'TechCrunch covers crypto through a technology and startup lens, focusing on venture funding, product launches, and web3 infrastructure.',
    website: 'https://techcrunch.com/category/cryptocurrency/',
    founded: 2005,
    focus: ['Startups', 'Funding', 'Technology'],
    type: 'mainstream',
  },

  // ═══════════════════════════════════════════════════════════════
  // Tier 2 — Premium crypto-native
  // ═══════════════════════════════════════════════════════════════
  coindesk: {
    description: 'The leading crypto media brand, known for its Consensus conference and comprehensive coverage of Bitcoin, Ethereum, DeFi, and policy.',
    website: 'https://www.coindesk.com',
    founded: 2013,
    focus: ['Bitcoin', 'Ethereum', 'DeFi', 'Policy', 'Markets'],
    type: 'crypto-native',
  },
  theblock: {
    description: 'Data-driven crypto journalism combining investigative reporting with institutional-grade research and market intelligence.',
    website: 'https://www.theblock.co',
    founded: 2018,
    focus: ['Research', 'Investigation', 'Data', 'Markets'],
    type: 'crypto-native',
  },
  blockworks: {
    description: 'Financial media brand focused on digital assets, hosting the Permissionless conference and publishing institutional-grade research.',
    website: 'https://blockworks.co',
    founded: 2018,
    focus: ['Institutional', 'DeFi', 'Research', 'Markets'],
    type: 'crypto-native',
  },
  decrypt: {
    description: 'Making crypto accessible — Decrypt combines news coverage with educational explainers and guides for a mainstream audience.',
    website: 'https://decrypt.co',
    founded: 2018,
    focus: ['News', 'Education', 'Gaming', 'Culture'],
    type: 'crypto-native',
  },
  defiant: {
    description: 'The Defiant is DeFi\'s leading media outlet, covering decentralized finance protocols, yields, governance, and the open financial system.',
    website: 'https://thedefiant.io',
    founded: 2019,
    focus: ['DeFi', 'Governance', 'Protocols', 'Yields'],
    type: 'crypto-native',
  },
  dlnews: {
    description: 'Independent crypto journalism outlet delivering breaking news and in-depth reporting on the digital asset industry.',
    website: 'https://www.dlnews.com',
    founded: 2022,
    focus: ['Breaking News', 'Investigation', 'Analysis'],
    type: 'crypto-native',
  },
  unchained: {
    description: 'Founded by Laura Shin, Unchained delivers in-depth crypto podcast interviews and long-form investigative journalism.',
    website: 'https://unchainedcrypto.com',
    founded: 2016,
    focus: ['Podcasts', 'Investigation', 'Interviews'],
    type: 'crypto-native',
  },

  // ═══════════════════════════════════════════════════════════════
  // Tier 3 — Established crypto news
  // ═══════════════════════════════════════════════════════════════
  cointelegraph: {
    description: 'One of the oldest and largest crypto publications, covering news, analysis, and opinion across the blockchain ecosystem.',
    website: 'https://cointelegraph.com',
    founded: 2013,
    focus: ['News', 'Analysis', 'Altcoins', 'Markets'],
    type: 'crypto-native',
  },
  bitcoinmagazine: {
    description: 'The original Bitcoin publication, focused exclusively on Bitcoin culture, technology, mining, and the Lightning Network.',
    website: 'https://bitcoinmagazine.com',
    founded: 2012,
    focus: ['Bitcoin', 'Mining', 'Lightning', 'Culture'],
    type: 'crypto-native',
  },
  bankless: {
    description: 'Bankless covers the frontier of DeFi and Ethereum through podcasts, newsletters, and community-driven content.',
    website: 'https://www.bankless.com',
    founded: 2019,
    focus: ['Ethereum', 'DeFi', 'L2s', 'Podcasts'],
    type: 'crypto-native',
  },
  cryptoslate: {
    description: 'Crypto news and data platform providing real-time coverage alongside coin metrics, exchange data, and research.',
    website: 'https://cryptoslate.com',
    founded: 2017,
    focus: ['News', 'Data', 'Markets', 'Research'],
    type: 'crypto-native',
  },
  beincrypto: {
    description: 'Global crypto news outlet with coverage in 10+ languages, focusing on market analysis, trading, and beginner education.',
    website: 'https://beincrypto.com',
    founded: 2018,
    focus: ['Trading', 'Analysis', 'Education', 'Global'],
    type: 'crypto-native',
  },

  // ═══════════════════════════════════════════════════════════════
  // Research
  // ═══════════════════════════════════════════════════════════════
  messari: {
    description: 'Institutional-grade crypto research and data platform, known for its annual theses and detailed protocol analyses.',
    website: 'https://messari.io',
    founded: 2018,
    focus: ['Research', 'Data', 'Protocols', 'Governance'],
    type: 'research',
  },
  paradigm: {
    description: 'Crypto-native investment firm publishing open research on cryptography, protocol design, and mechanism engineering.',
    website: 'https://www.paradigm.xyz',
    founded: 2018,
    focus: ['Research', 'Cryptography', 'DeFi', 'Infrastructure'],
    type: 'research',
  },
  a16z: {
    description: 'Andreessen Horowitz\'s crypto arm publishes influential research on web3 policy, state of crypto reports, and protocol analysis.',
    website: 'https://a16zcrypto.com',
    founded: 2018,
    focus: ['Policy', 'Research', 'State of Crypto', 'Web3'],
    type: 'research',
  },
  nansen: {
    description: 'On-chain analytics platform providing wallet-level insights, smart money tracking, and blockchain data research.',
    website: 'https://www.nansen.ai',
    founded: 2020,
    focus: ['On-Chain', 'Analytics', 'Smart Money', 'Data'],
    type: 'research',
  },
  dune: {
    description: 'Community-driven blockchain analytics platform where anyone can create and share on-chain dashboards and research.',
    website: 'https://dune.com',
    founded: 2018,
    focus: ['Analytics', 'Dashboards', 'On-Chain', 'Community'],
    type: 'research',
  },

  // ═══════════════════════════════════════════════════════════════
  // Institutional / Protocol
  // ═══════════════════════════════════════════════════════════════
  coinmarketcap: {
    description: 'The world\'s most-referenced crypto data aggregator, providing prices, market caps, and analytics for 10,000+ tokens.',
    website: 'https://coinmarketcap.com',
    founded: 2013,
    focus: ['Data', 'Prices', 'Market Cap', 'Rankings'],
    type: 'institutional',
  },
  coingecko: {
    description: 'Independent crypto data aggregator tracking prices, liquidity, developer activity, and community metrics.',
    website: 'https://www.coingecko.com',
    founded: 2014,
    focus: ['Data', 'Prices', 'DeFi', 'NFTs'],
    type: 'institutional',
  },
};

/**
 * Get the editorial profile for a source, or generate a minimal one from RSS_SOURCES data.
 */
export function getSourceProfile(key: string): SourceProfile | null {
  return SOURCE_PROFILES[key.toLowerCase()] ?? null;
}
