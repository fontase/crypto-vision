/**
 * Swarm Structured Logger — Agent-aware, phase-tagged logging
 *
 * Features:
 * - Structured JSON output for machine consumption
 * - Colorized console output for human readability
 * - Agent ID, category, phase, and correlation ID on every entry
 * - Child loggers inherit parent context
 * - Global sink for forwarding all logs to dashboard/event bus
 * - Non-blocking: logging never throws or awaits
 */

import { v4 as uuidv4 } from 'uuid';

import type { SwarmPhase } from '../types.js';

// ─── Types ────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  agentId?: string;
  category?: string;
  phase?: SwarmPhase;
  correlationId?: string;
  message: string;
  data?: Record<string, unknown>;
  error?: { message: string; stack?: string };
}

export interface LoggerOptions {
  level: LogLevel;
  jsonOutput?: boolean;
  agentId?: string;
  category?: string;
}

type LogSink = (entry: LogEntry) => void;

// ─── Constants ────────────────────────────────────────────────

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
} as const;

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
};

// ─── SwarmLogger ──────────────────────────────────────────────

/**
 * Structured logger that tags every entry with agent context.
 *
 * Create via `SwarmLogger.create()` for agent-specific loggers,
 * or instantiate directly for custom configuration.
 *
 * ```typescript
 * const logger = SwarmLogger.create('trader-0', 'trading');
 * logger.setPhase('trading');
 * logger.info('Buy order executed', { mint: '...', solAmount: 0.05 });
 * ```
 */
export class SwarmLogger {
  private level: LogLevel;
  private readonly jsonOutput: boolean;
  private readonly agentId?: string;
  private readonly category?: string;
  private readonly correlationId?: string;
  private phase?: SwarmPhase;

  /** Global sink receives every log entry from every logger instance */
  private static globalSink: LogSink | undefined;

  constructor(options: LoggerOptions & { correlationId?: string }) {
    this.level = options.level;
    this.jsonOutput = options.jsonOutput ?? false;
    this.agentId = options.agentId;
    this.category = options.category;
    this.correlationId = options.correlationId;
  }

  // ─── Static Factory ───────────────────────────────────────

  /**
   * Create a logger pre-configured for a specific agent.
   * Defaults to `info` level, console mode, and a fresh correlation ID.
   */
  static create(agentId: string, category?: string): SwarmLogger {
    return new SwarmLogger({
      level: 'info',
      agentId,
      category,
      correlationId: uuidv4(),
    });
  }

  /**
   * Set a global sink that receives every log entry from every
   * `SwarmLogger` instance. Useful for forwarding logs to a
   * dashboard or event bus.
   *
   * Pass `undefined` to remove the sink.
   */
  static setGlobalSink(sink: LogSink | undefined): void {
    SwarmLogger.globalSink = sink;
  }

  // ─── Configuration ────────────────────────────────────────

  /** Change the minimum log level at runtime */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** Set the current swarm phase — automatically included in all subsequent logs */
  setPhase(phase: SwarmPhase): void {
    this.phase = phase;
  }

  // ─── Child Logger ─────────────────────────────────────────

  /**
   * Create a child logger that inherits this logger's configuration
   * and merges additional context. Child loggers share the parent's
   * log level, output mode, and phase.
   */
  child(context: {
    agentId?: string;
    category?: string;
    correlationId?: string;
  }): SwarmLogger {
    const child = new SwarmLogger({
      level: this.level,
      jsonOutput: this.jsonOutput,
      agentId: context.agentId ?? this.agentId,
      category: context.category ?? this.category,
      correlationId: context.correlationId ?? this.correlationId,
    });
    child.phase = this.phase;
    return child;
  }

  // ─── Log Methods ──────────────────────────────────────────

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, undefined, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, undefined, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, undefined, data);
  }

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    this.log('error', message, error, data);
  }

  // ─── Internal ─────────────────────────────────────────────

  private log(
    level: LogLevel,
    message: string,
    error?: Error,
    data?: Record<string, unknown>,
  ): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      ...(this.agentId !== undefined && { agentId: this.agentId }),
      ...(this.category !== undefined && { category: this.category }),
      ...(this.phase !== undefined && { phase: this.phase }),
      ...(this.correlationId !== undefined && {
        correlationId: this.correlationId,
      }),
      ...(data !== undefined && { data }),
      ...(error !== undefined && {
        error: {
          message: error.message,
          ...(error.stack !== undefined && { stack: error.stack }),
        },
      }),
    };

    // Emit to console/stdout
    if (this.jsonOutput) {
      this.writeJson(entry);
    } else {
      this.writeConsole(entry);
    }

    // Forward to global sink (non-blocking)
    if (SwarmLogger.globalSink) {
      try {
        SwarmLogger.globalSink(entry);
      } catch {
        // Never let sink errors propagate — logging must not break agents
      }
    }
  }

  /** JSON mode: one valid JSON object per line (NDJSON) */
  private writeJson(entry: LogEntry): void {
    const output: Record<string, unknown> = {
      timestamp: new Date(entry.timestamp).toISOString(),
      level: entry.level,
    };
    if (entry.agentId !== undefined) output['agentId'] = entry.agentId;
    if (entry.category !== undefined) output['category'] = entry.category;
    if (entry.phase !== undefined) output['phase'] = entry.phase;
    if (entry.correlationId !== undefined)
      output['correlationId'] = entry.correlationId;
    output['message'] = entry.message;
    if (entry.data !== undefined) output['data'] = entry.data;
    if (entry.error !== undefined) output['error'] = entry.error;

    const line = JSON.stringify(output);
    if (entry.level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  /** Console mode: human-readable with ANSI colors */
  private writeConsole(entry: LogEntry): void {
    const time = new Date(entry.timestamp)
      .toISOString()
      .slice(11, 23); // HH:mm:ss.SSS

    const levelColor = LEVEL_COLORS[entry.level];
    const levelTag = `${levelColor}[${entry.level.toUpperCase()}]${COLORS.reset}`;

    // Build context tag: [agentId/category] or [agentId] or [category]
    let contextTag = '';
    if (this.agentId || this.category) {
      const parts: string[] = [];
      if (this.agentId) parts.push(`${COLORS.green}${this.agentId}${COLORS.reset}`);
      if (this.category) parts.push(this.category);
      contextTag = ` [${parts.join('/')}]`;
    }

    // Phase tag
    let phaseTag = '';
    if (entry.phase) {
      phaseTag = ` ${COLORS.magenta}(${entry.phase})${COLORS.reset}`;
    }

    // Flatten data into key=value pairs
    let dataSuffix = '';
    if (entry.data) {
      dataSuffix =
        ' ' +
        Object.entries(entry.data)
          .map(([k, v]) => `${COLORS.gray}${k}=${formatValue(v)}${COLORS.reset}`)
          .join(' ');
    }

    // Error info
    let errorSuffix = '';
    if (entry.error) {
      errorSuffix = ` ${COLORS.red}err=${entry.error.message}${COLORS.reset}`;
      if (entry.error.stack) {
        errorSuffix += `\n${COLORS.gray}${entry.error.stack}${COLORS.reset}`;
      }
    }

    const line = `${COLORS.gray}${time}${COLORS.reset} ${levelTag}${contextTag}${phaseTag} ${entry.message}${dataSuffix}${errorSuffix}`;

    if (entry.level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/** Format a value for console key=value display */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
