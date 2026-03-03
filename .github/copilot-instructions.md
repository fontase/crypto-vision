### Project Philosophy

- **We have unlimited Claude credits** — never cut corners, never settle for "good enough." Build the best possible version of everything.
- **Always be improving** — every session should leave the codebase better than it was found. Proactively fix tech debt, improve performance, harden security, expand test coverage, and refine UX.
- **Ship production-quality code** — write thorough tests, handle edge cases, add meaningful error messages, and document public APIs.
- **Think big, execute precisely** — propose ambitious improvements but implement them carefully and incrementally.

### Git Identity

- **Always commit and push as `nirholas`** — before any git commit or push, configure:
  ```
  git config user.name "nirholas"
  git config user.email "nirholas@users.noreply.github.com"
  ```

### Terminal Management

- **Always use background terminals** (`isBackground: true`) for every command so a terminal ID is returned
- **Always kill the terminal** after the command completes, whether it succeeds or fails — never leave terminals open
- Do not reuse foreground shell sessions — stale sessions block future terminal operations in Codespaces
- In GitHub Codespaces, agent-spawned terminals may be hidden — they still work. Do not assume a terminal is broken if you cannot see it
- If a terminal appears unresponsive, kill it and create a new one rather than retrying in the same terminal
