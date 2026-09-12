# PrNerd repository instructions (example AGENTS.md)
# This file is loaded into the Static Pack as untrusted repository context.

## Review priorities for this repo
- Prefer correctness and security findings over style.
- TypeScript strictness matters; flag unsafe `any` in public APIs.
- CLI and GitHub Action entrypoints must fail safely on malformed LLM output.
