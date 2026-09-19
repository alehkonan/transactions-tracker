---
name: testing
description: Project testing conventions. Use when creating, modifying, reviewing, or running tests, or when adding test-only hooks to application code.
---

# Testing

For end-to-end workflow interactions:

- Add stable `data-testid` hooks to application elements involved in the workflow.
- Locate those elements with `getByTestId`.
- Use role/name locators only in tests that explicitly verify accessibility semantics.
- Use the available Playwright MCP tools for browser interactions.
