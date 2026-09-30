```
---
name: diagnose
description: Diagnose bugs systematically. Follow reproduce → minimize → hypothesize → instrument → fix → regression test.
---

Diagnose the bug using this strict workflow:
1. Confirm steps to reliably reproduce the bug.
2. Create a minimal reproduction case if possible.
3. List testable hypotheses for the root cause.
4. Add logging or assertions to validate or invalidate hypotheses.
5. Implement the minimal fix.
6. Write a regression test that would catch this bug in the future.

Do not jump straight to fixes before validating root cause.
```
