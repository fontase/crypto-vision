# UCAI

> Universal Contract AI Interface (UCAI) 🔗 ABI to MCP | The open standard for connecting AI agents to blockchain. MCP server generator for smart contracts. Claude + Uniswap, Aave, ERC20, NFTs, DeFi. Python CLI, Web3 integration, transaction simulation. Polygon, Arbitrum, Base, Ethereum EVM chains. Claude, GPT, LLM tooling, Solidity, OpenAI.

### Terminal Management

- **⚠️ ALWAYS use background terminals** (`isBackground: true`) for EVERY command — no exceptions. This ensures a terminal ID is returned so you can retrieve output and kill the terminal.
- **⚠️ ALWAYS kill EVERY terminal after use** — call `kill_terminal` on every terminal ID as soon as you have the output, whether the command succeeds or fails. Zero terminals should remain open when you finish a task. This is non-negotiable.
- **Kill terminals immediately** — as soon as you have the output you need, kill the terminal. Do not leave any terminals lingering. Leaked terminals accumulate and degrade Codespaces performance.
- **Never use foreground terminals** (`isBackground: false`) — foreground shells block, cannot be killed, and cause stale session issues in Codespaces. Always use `isBackground: true`.
- In GitHub Codespaces, agent-spawned terminals may be hidden — they still work. Do not assume a terminal is broken if you cannot see it.
- If a terminal appears unresponsive, kill it and create a new one rather than retrying in the same terminal.
- **Chain commands** with `&&` to minimize the number of terminal invocations.
- **Use timeouts** on commands that might hang — never let a terminal block indefinitely.
- **Workflow**: `run_in_terminal (isBackground: true)` → `get_terminal_output` → **`kill_terminal`**. Every single time. No exceptions.
