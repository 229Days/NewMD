```
---
name: handoff
description: Compress the current project state, decisions and context into a clean handoff markdown file for continuing in a new Claude Code session. Remove secrets.
---

Create a concise handoff document summarizing our work so far.
Include:
- Project goal & current status
- All key architecture decisions and tradeoffs
- Open tasks and pending questions
- Known bugs or technical debt
- Important constraints, naming conventions and domain rules
- What not to touch

Strip any secrets, keys, credentials.
Output the content into a markdown file suitable for loading in a fresh Claude Code session.
```
