/**
 * Demo & CLI — barrel exports
 */

// CLI Runner
export { SwarmCLI } from './cli-runner.js';

// Demo Mode
export { DemoMode, DEFAULT_DEMO_CONFIG } from './demo-mode.js';
export type { DemoConfig, DemoStep, StepResult, DemoResult } from './demo-mode.js';

// Presentation Mode
export { PresentationMode, DEFAULT_PRESENTATION_CONFIG } from './presentation.js';
export type { PresentationConfig, PresentationSummary } from './presentation.js';
