# Prompt 48 — Advanced Narrative Generator

## Agent Identity & Rules

```
You are the NARRATIVE-GENERATOR builder.

RULES:
- Work on current branch (main), commit as nirholas
- Always use isBackground: true for terminals, always kill_terminal after
- No mocks — real LLM API calls, real image generation API
- TypeScript strict mode, run npx tsc --noEmit after changes
- Commit message: "feat(swarm): add advanced narrative generator with image generation and A/B testing"
```

## Objective

Create `packages/pump-agent-swarm/src/intelligence/narrative-generator.ts` — advanced narrative generation beyond the basic narrative agent. Generates multiple narrative options, ranks them for virality potential, aligns with detected trends, and generates token images via real image generation APIs.

## File Ownership

- **Creates**: `packages/pump-agent-swarm/src/intelligence/narrative-generator.ts`

## Dependencies

- `infra/event-bus.ts` — `SwarmEventBus`
- `infra/logger.ts` — structured logging
- Node.js `fetch` for API calls

## Deliverables

### Create `packages/pump-agent-swarm/src/intelligence/narrative-generator.ts`

1. **`NarrativeGenerator` class**:
   - `constructor(config: NarrativeGeneratorConfig, eventBus: SwarmEventBus)`
   - `generateNarratives(count: number, constraints?: NarrativeConstraints): Promise<TokenNarrative[]>` — generate N narrative options
   - `rankNarratives(narratives: TokenNarrative[]): Promise<RankedNarrative[]>` — rank by predicted virality
   - `alignWithTrends(narrative: TokenNarrative, trends: CategoryTrend[]): Promise<TokenNarrative>` — adjust narrative to match trends
   - `generateImage(narrative: TokenNarrative): Promise<Buffer>` — generate token image
   - `refineNarrative(narrative: TokenNarrative, feedback: string): Promise<TokenNarrative>` — iterate on a narrative
   - `getNarrativeHistory(): TokenNarrative[]` — past narratives generated

2. **NarrativeGeneratorConfig**:
   ```typescript
   interface NarrativeGeneratorConfig {
     /** OpenRouter API key */
     openRouterApiKey: string;
     /** Model for narrative generation */
     narrativeModel: string;         // default: 'google/gemini-2.0-flash-001'
     /** Image generation API key (OpenAI or Stability) */
     imageApiKey?: string;
     /** Image generation provider */
     imageProvider: 'openai' | 'stability';
     /** OpenAI image API base */
     openaiApiBase: string;          // 'https://api.openai.com/v1'
     /** Stability AI base */
     stabilityApiBase: string;       // 'https://api.stability.ai/v1'
     /** Temperature for creative generation */
     temperature: number;            // default: 0.9 (higher for creativity)
     /** Track history to avoid repetition */
     avoidRepetition: boolean;
   }
   ```

3. **NarrativeConstraints**:
   ```typescript
   interface NarrativeConstraints {
     /** Target category */
     targetCategory?: string;        // 'ai', 'animal', 'political', etc.
     /** Categories to explicitly avoid */
     avoidCategories?: string[];
     /** Must-include keywords */
     mustInclude?: string[];
     /** Tone of the narrative */
     tone?: 'funny' | 'serious' | 'edgy' | 'wholesome' | 'absurd' | 'professional';
     /** Max character length for name */
     maxNameLength?: number;
     /** Max ticker length */
     maxTickerLength?: number;       // default: 10
     /** Current trending themes to incorporate */
     trendingThemes?: string[];
     /** Narratives to avoid (already used) */
     avoidNarratives?: string[];
   }
   ```

4. **TokenNarrative**:
   ```typescript
   interface TokenNarrative {
     /** Token name */
     name: string;
     /** Token ticker/symbol */
     ticker: string;
     /** Token description (for Pump.fun listing) */
     description: string;
     /** Category */
     category: string;
     /** Narrative thesis: why would people buy this? */
     thesis: string;
     /** Meme potential (0-100) */
     memePotential: number;
     /** Target audience */
     targetAudience: string;
     /** Image prompt (for image generation) */
     imagePrompt: string;
     /** Generated image data (populated by generateImage) */
     imageData?: Buffer;
     /** Social media hooks: tweet-ready descriptions */
     socialHooks: string[];
     /** Hashtags */
     hashtags: string[];
   }
   ```

5. **RankedNarrative**:
   ```typescript
   interface RankedNarrative {
     narrative: TokenNarrative;
     /** Rank position (1 = best) */
     rank: number;
     /** Predicted virality score (0-100) */
     viralityScore: number;
     /** Virality factors */
     factors: {
       nameQuality: number;         // Is the name catchy, memorable, searchable?
       tickerQuality: number;       // Is the ticker short, pronounceable?
       memeability: number;         // How easily can this become a meme?
       trendAlignment: number;      // Does it match current trends?
       uniqueness: number;          // Is this different from recent launches?
       controversyFactor: number;   // Controversial = viral (but risky)
     };
     /** LLM reasoning for the ranking */
     reasoning: string;
   }
   ```

6. **LLM narrative generation** (OpenRouter):
   ```typescript
   // System prompt for narrative generation:
   // "You are a crypto memecoin narrative expert. Generate token names and narratives
   //  that will go viral on Crypto Twitter and Pump.fun. You understand what makes
   //  a memecoin successful: catchy name, relatable theme, cultural relevance,
   //  and memeable imagery. Your narratives should be creative, timely, and have
   //  potential for community formation."
   //
   // User prompt includes constraints, trending themes, and asked-for count
   // Response format: JSON array of TokenNarrative objects
   //
   // POST https://openrouter.ai/api/v1/chat/completions
   // Model: configured narrativeModel
   // response_format: { type: 'json_object' }
   ```

7. **LLM virality ranking** (second LLM call):
   ```typescript
   // System prompt for ranking:
   // "You are a crypto market analyst who predicts which memecoins will gain traction.
   //  Rank the following token narratives by predicted virality. Consider: name
   //  catchiness, cultural relevance, meme potential, ticker quality, and uniqueness.
   //  Score each factor 0-100 and provide overall ranking."
   //
   // Input: array of TokenNarrative objects
   // Output: RankedNarrative array
   ```

8. **Image generation**:

   **OpenAI DALL-E**:
   ```typescript
   // POST https://api.openai.com/v1/images/generations
   // Headers: Authorization: Bearer ${apiKey}
   // Body: {
   //   model: "dall-e-3",
   //   prompt: narrative.imagePrompt,
   //   n: 1,
   //   size: "1024x1024",
   //   quality: "standard",
   //   response_format: "b64_json"
   // }
   // Response: { data: [{ b64_json: "..." }] }
   // Decode base64 to Buffer
   ```

   **Stability AI** (fallback):
   ```typescript
   // POST https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image
   // Headers: Authorization: Bearer ${apiKey}, Content-Type: application/json
   // Body: {
   //   text_prompts: [{ text: narrative.imagePrompt, weight: 1 }],
   //   cfg_scale: 7,
   //   height: 1024,
   //   width: 1024,
   //   samples: 1,
   //   steps: 30
   // }
   // Response: { artifacts: [{ base64: "...", finishReason: "SUCCESS" }] }
   ```

9. **Trend alignment**:
   - Take an existing narrative and adjust it to better match current trends
   - If "AI agents" is trending and narrative is about a dog → keep dog but add AI angle
   - LLM call: "Adjust this narrative to incorporate the following trending themes while maintaining its core identity"

10. **Repetition avoidance**:
    - Track all generated narratives in history
    - Before generating, include history in LLM prompt: "Avoid these previously used concepts: ..."
    - Check generated names against Pump.fun API to avoid duplicates

### Success Criteria

- LLM generates creative, diverse narratives via real OpenRouter API
- Virality ranking produces meaningful differentiation between narratives
- Image generation calls real OpenAI or Stability API and returns valid image Buffer
- Trend alignment modifies narratives to match current trends
- Repetition avoidance prevents duplicate concepts
- Constraints are properly enforced (category, tone, length)
- Compiles with `npx tsc --noEmit`
