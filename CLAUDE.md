## Skill 自动路由

Available skills:

- grill-with-docs
- tdd
- diagnose
- handoff
- caveman

Routing rules:

1. If the user is planning a new feature, module, architecture, requirements, or design discussion, call /grill-with-docs automatically.
2. If the user wants to implement core logic, functions, business code, or test-driven development, call /tdd automatically.
3. If the user reports a bug, error, unexpected behavior, or debugging task, call /diagnose automatically.
4. If the user wants to end the session, save progress, create a handoff, or summarize context for the next session, call /handoff automatically.
5. If the user asks for log reading, quick code review, simple fix, or concise technical answer, call /caveman automatically.

Constraints:

- Do NOT call any skill for trivial one-line changes, simple file edits, or obvious configuration changes.
- If the intent is unclear, ask the user before calling a skill.
- If the user manually types /skill-name, follow the manual command.
- Only call one skill per turn when possible.
