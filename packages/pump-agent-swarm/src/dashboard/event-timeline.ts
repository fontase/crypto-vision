/**
 * Event Timeline — Chronological event stream with circular buffer and real-time streaming
 *
 * Features:
 * - Captures all SwarmEventBus events and transforms them into human-readable timeline entries
 * - Circular buffer retains up to maxEvents (default 10,000) with oldest-first eviction
 * - Filtering by category, severity, agent, time range, and free-text search
 * - Real-time subscriptions for live dashboard updates
 * - Pagination support via limit/offset
 */

import { v4 as uuidv4 } from 'uuid';

import type { SwarmEventBus } from '../infra/event-bus.js';
import type { SwarmEvent, SwarmEventCategory } from '../types.js';

// ─── Types ────────────────────────────────────────────────────

export type EventCategory =
  | 'trade'
  | 'agent'
  | 'phase'
  | 'risk'
  | 'system'
  | 'bundle'
  | 'intelligence'
  | 'config';

export type EventSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export interface TimelineEvent {
  /** Unique event ID */
  id: string;
  /** Millisecond timestamp */
  timestamp: number;
  /** Event category */
  category: EventCategory;
  /** Event severity */
  severity: EventSeverity;
  /** Short title for display */
  title: string;
  /** Detailed description */
  description: string;
  /** Source agent ID (if applicable) */
  agentId?: string;
  /** Source agent type (if applicable) */
  agentType?: string;
  /** On-chain transaction signature (if applicable) */
  signature?: string;
  /** Additional structured data */
  metadata: Record<string, unknown>;
}

export interface TimelineConfig {
  /** Maximum events to retain in circular buffer (default: 10000) */
  maxEvents: number;
  /** Event categories to capture (default: all) */
  captureCategories: EventCategory[];
  /** Minimum severity to capture (default: 'info') */
  minimumSeverity: EventSeverity;
}

export interface EventFilter {
  /** Filter by categories */
  categories?: EventCategory[];
  /** Filter by minimum severity */
  minSeverity?: EventSeverity;
  /** Filter by agent ID */
  agentId?: string;
  /** Filter by time range */
  from?: number;
  /** Filter by time range */
  to?: number;
  /** Filter by text search in title/description */
  search?: string;
  /** Maximum results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// ─── Constants ────────────────────────────────────────────────

const DEFAULT_MAX_EVENTS = 10_000;
const ALL_CATEGORIES: EventCategory[] = [
  'trade',
  'agent',
  'phase',
  'risk',
  'system',
  'bundle',
  'intelligence',
  'config',
];

const SEVERITY_ORDER: Record<EventSeverity, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  critical: 4,
};

// ─── Circular Buffer ──────────────────────────────────────────

class TimelineBuffer {
  private readonly buffer: Array<TimelineEvent | undefined>;
  private head = 0;
  private _size = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array<TimelineEvent | undefined>(capacity);
  }

  get size(): number {
    return this._size;
  }

  push(item: TimelineEvent): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) {
      this._size++;
    }
  }

  /** Iterate from oldest to newest */
  *[Symbol.iterator](): IterableIterator<TimelineEvent> {
    if (this._size === 0) return;
    const start = this._size < this.capacity ? 0 : this.head;
    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % this.capacity;
      yield this.buffer[idx] as TimelineEvent;
    }
  }

  /** Iterate from newest to oldest */
  *reverseIterator(): IterableIterator<TimelineEvent> {
    if (this._size === 0) return;
    const start = this._size < this.capacity ? 0 : this.head;
    for (let i = this._size - 1; i >= 0; i--) {
      const idx = (start + i) % this.capacity;
      yield this.buffer[idx] as TimelineEvent;
    }
  }

  toArray(): TimelineEvent[] {
    return [...this];
  }

  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this._size = 0;
  }
}

// ─── Category Mapping ─────────────────────────────────────────

const SWARM_CATEGORY_TO_TIMELINE: Record<SwarmEventCategory, EventCategory> = {
  lifecycle: 'agent',
  trading: 'trade',
  analytics: 'intelligence',
  bundle: 'bundle',
  intelligence: 'intelligence',
  coordination: 'phase',
  system: 'system',
  wallet: 'system',
  error: 'risk',
  metrics: 'system',
};

// ─── Event Transformation ─────────────────────────────────────

function severityFromType(type: string, swarmCategory: SwarmEventCategory): EventSeverity {
  if (type.includes('error') || type.includes('failed') || type.includes('failure')) return 'error';
  if (type.includes('critical') || type.includes('crash') || type.includes('panic')) return 'critical';
  if (type.includes('alert') || type.includes('degraded') || type.includes('warning')) return 'warning';
  if (type.includes('debug') || type.includes('trace')) return 'debug';
  if (swarmCategory === 'error') return 'error';
  return 'info';
}

function buildTitle(type: string, payload: Record<string, unknown>, source: string): string {
  const parts = type.split(':');
  const prefix = parts[0] ?? type;
  const action = parts[1] ?? '';

  switch (type) {
    case 'trade:executed': {
      const side = (payload['side'] as string) ?? 'traded';
      const amount = payload['amount'] ?? payload['tokenAmount'] ?? '?';
      const cost = payload['solAmount'] ?? payload['cost'] ?? '?';
      return `Agent ${source} ${side} ${String(amount)} tokens for ${String(cost)} SOL`;
    }
    case 'agent:started':
      return `Agent ${source} (${String(payload['agentType'] ?? payload['type'] ?? 'unknown')}) started`;
    case 'agent:stopped':
      return `Agent ${source} stopped`;
    case 'agent:error':
      return `Agent ${source} encountered an error`;
    case 'phase:changed':
      return `Phase changed from ${String(payload['from'] ?? '?')} to ${String(payload['to'] ?? '?')}`;
    case 'risk:alert':
      return `Risk alert: ${String(payload['message'] ?? payload['reason'] ?? 'unknown')}`;
    case 'health:degraded':
      return `System health degraded: ${String(payload['reason'] ?? source)}`;
    case 'health:recovered':
      return `System health recovered: ${source}`;
    case 'signal:generated':
      return `Signal: ${String(payload['direction'] ?? payload['signal'] ?? 'unknown')} from ${source}`;
    case 'bundle:created':
      return `Bundle created with ${String(payload['agentCount'] ?? '?')} agents`;
    case 'bundle:submitted':
      return `Bundle submitted by ${source}`;
    case 'config:updated':
      return `Configuration updated: ${String(payload['key'] ?? 'unknown')}`;
    default:
      return `${capitalize(prefix)} ${action}: ${source}`;
  }
}

function buildDescription(type: string, payload: Record<string, unknown>, source: string): string {
  const parts = type.split(':');
  const action = parts[1] ?? type;

  switch (type) {
    case 'trade:executed': {
      const side = (payload['side'] as string) ?? 'trade';
      const tokenAmount = payload['amount'] ?? payload['tokenAmount'] ?? 'unknown';
      const solAmount = payload['solAmount'] ?? payload['cost'] ?? 'unknown';
      const mint = payload['mint'] ?? payload['tokenMint'] ?? 'unknown';
      return `${capitalize(side)} executed by ${source}: ${String(tokenAmount)} tokens of ${String(mint)} for ${String(solAmount)} SOL`;
    }
    case 'agent:started':
      return `Agent ${source} of type ${String(payload['agentType'] ?? payload['type'] ?? 'unknown')} has been initialized and started`;
    case 'agent:stopped':
      return `Agent ${source} has been stopped. Reason: ${String(payload['reason'] ?? 'normal shutdown')}`;
    case 'agent:error':
      return `Agent ${source} error: ${String(payload['error'] ?? payload['message'] ?? 'unknown error')}`;
    case 'phase:changed':
      return `Swarm phase transitioned from ${String(payload['from'] ?? '?')} to ${String(payload['to'] ?? '?')}. Trigger: ${String(payload['trigger'] ?? 'automatic')}`;
    case 'risk:alert':
      return `Risk management alert — ${String(payload['message'] ?? payload['reason'] ?? 'No details')}. Level: ${String(payload['level'] ?? 'unknown')}`;
    case 'health:degraded':
      return `System component ${source} reporting degraded health: ${String(payload['reason'] ?? 'unknown reason')}. Metrics: ${JSON.stringify(payload['metrics'] ?? {})}`;
    case 'signal:generated':
      return `Intelligence signal generated by ${source}: direction=${String(payload['direction'] ?? payload['signal'] ?? '?')}, confidence=${String(payload['confidence'] ?? '?')}`;
    default:
      return `Event ${type} from ${source}: ${action}. Payload keys: ${Object.keys(payload).join(', ') || 'none'}`;
  }
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function mapCategory(type: string, swarmCategory: SwarmEventCategory): EventCategory {
  // Check type-specific overrides first
  if (type.startsWith('trade:')) return 'trade';
  if (type.startsWith('agent:')) return 'agent';
  if (type.startsWith('phase:')) return 'phase';
  if (type.startsWith('risk:')) return 'risk';
  if (type.startsWith('health:')) return 'system';
  if (type.startsWith('signal:')) return 'intelligence';
  if (type.startsWith('bundle:')) return 'bundle';
  if (type.startsWith('config:')) return 'config';

  // Fallback to category-level mapping
  return SWARM_CATEGORY_TO_TIMELINE[swarmCategory] ?? 'system';
}

// ─── EventTimeline ────────────────────────────────────────────

export class EventTimeline {
  private readonly buffer: TimelineBuffer;
  private readonly config: TimelineConfig;
  private readonly subscribers = new Map<string, (event: TimelineEvent) => void>();
  private readonly categoryCounts = new Map<EventCategory, number>();
  private subscriptionId: string | undefined;

  constructor(
    private readonly eventBus: SwarmEventBus,
    config?: Partial<TimelineConfig>,
  ) {
    this.config = {
      maxEvents: config?.maxEvents ?? DEFAULT_MAX_EVENTS,
      captureCategories: config?.captureCategories ?? [...ALL_CATEGORIES],
      minimumSeverity: config?.minimumSeverity ?? 'info',
    };

    this.buffer = new TimelineBuffer(this.config.maxEvents);

    // Initialize category counts
    for (const cat of ALL_CATEGORIES) {
      this.categoryCounts.set(cat, 0);
    }

    // Subscribe to ALL events on the bus using wildcard
    this.subscriptionId = this.eventBus.subscribe(
      '*',
      (event: SwarmEvent) => { this.handleSwarmEvent(event); },
      { source: 'event-timeline' },
    );
  }

  // ── Event Ingestion ─────────────────────────────────────────

  private handleSwarmEvent(event: SwarmEvent): void {
    const timelineEvent = this.transformEvent(event);

    // Check capture category filter
    if (!this.config.captureCategories.includes(timelineEvent.category)) {
      return;
    }

    // Check minimum severity
    if (SEVERITY_ORDER[timelineEvent.severity] < SEVERITY_ORDER[this.config.minimumSeverity]) {
      return;
    }

    // Store in buffer
    this.buffer.push(timelineEvent);

    // Update category count
    this.categoryCounts.set(
      timelineEvent.category,
      (this.categoryCounts.get(timelineEvent.category) ?? 0) + 1,
    );

    // Notify subscribers
    for (const callback of this.subscribers.values()) {
      try {
        callback(timelineEvent);
      } catch {
        // Subscriber errors should not break the timeline
      }
    }
  }

  private transformEvent(event: SwarmEvent): TimelineEvent {
    const category = mapCategory(event.type, event.category);
    const severity = severityFromType(event.type, event.category);
    const title = buildTitle(event.type, event.payload, event.source);
    const description = buildDescription(event.type, event.payload, event.source);

    return {
      id: uuidv4(),
      timestamp: event.timestamp,
      category,
      severity,
      title,
      description,
      agentId: event.source || undefined,
      agentType: (event.payload['agentType'] as string) ?? (event.payload['type'] as string) ?? undefined,
      signature: (event.payload['signature'] as string) ?? (event.payload['txSignature'] as string) ?? undefined,
      metadata: {
        originalType: event.type,
        originalCategory: event.category,
        correlationId: event.correlationId,
        ...event.payload,
      },
    };
  }

  // ── Query Methods ───────────────────────────────────────────

  /** Get filtered events from the timeline */
  getEvents(filter?: EventFilter): TimelineEvent[] {
    if (!filter) {
      return this.buffer.toArray();
    }

    const results: TimelineEvent[] = [];
    const searchLower = filter.search?.toLowerCase();

    for (const event of this.buffer) {
      if (!this.matchesFilter(event, filter, searchLower)) continue;
      results.push(event);
    }

    // Apply pagination
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  /** Get the most recent N events (newest first) */
  getRecentEvents(limit: number): TimelineEvent[] {
    const results: TimelineEvent[] = [];
    for (const event of this.buffer.reverseIterator()) {
      results.push(event);
      if (results.length >= limit) break;
    }
    return results;
  }

  /** Get events filtered by category */
  getEventsByCategory(category: EventCategory): TimelineEvent[] {
    return this.getEvents({ categories: [category] });
  }

  /** Get events filtered by agent ID */
  getEventsByAgent(agentId: string): TimelineEvent[] {
    return this.getEvents({ agentId });
  }

  /** Get total number of stored events */
  getEventCount(): number {
    return this.buffer.size;
  }

  /** Get event count per category (total ingested, not just buffered) */
  getEventCountByCategory(): Map<EventCategory, number> {
    return new Map(this.categoryCounts);
  }

  // ── Subscriptions ───────────────────────────────────────────

  /** Subscribe to new timeline events. Returns an unsubscribe function. */
  subscribe(callback: (event: TimelineEvent) => void): () => void {
    const id = uuidv4();
    this.subscribers.set(id, callback);
    return () => {
      this.subscribers.delete(id);
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /** Clear all stored events and reset counts */
  clear(): void {
    this.buffer.clear();
    for (const cat of ALL_CATEGORIES) {
      this.categoryCounts.set(cat, 0);
    }
  }

  /** Tear down the timeline and unsubscribe from the event bus */
  destroy(): void {
    if (this.subscriptionId) {
      this.eventBus.unsubscribe(this.subscriptionId);
      this.subscriptionId = undefined;
    }
    this.subscribers.clear();
    this.buffer.clear();
  }

  // ── Filter Logic ────────────────────────────────────────────

  private matchesFilter(
    event: TimelineEvent,
    filter: EventFilter,
    searchLower?: string,
  ): boolean {
    // Category filter
    if (filter.categories && filter.categories.length > 0) {
      if (!filter.categories.includes(event.category)) return false;
    }

    // Severity filter
    if (filter.minSeverity) {
      if (SEVERITY_ORDER[event.severity] < SEVERITY_ORDER[filter.minSeverity]) {
        return false;
      }
    }

    // Agent filter
    if (filter.agentId) {
      if (event.agentId !== filter.agentId) return false;
    }

    // Time range filter
    if (filter.from !== undefined && event.timestamp < filter.from) return false;
    if (filter.to !== undefined && event.timestamp > filter.to) return false;

    // Text search filter (case-insensitive substring match)
    if (searchLower) {
      const titleMatch = event.title.toLowerCase().includes(searchLower);
      const descMatch = event.description.toLowerCase().includes(searchLower);
      if (!titleMatch && !descMatch) return false;
    }

    return true;
  }
}
