export const autoGreetingDirective = (time: string): string =>
  `GREETING MODE — ACTIVE NOW.

The message above is an auto-generated greeting sent on page load. The user did NOT type it. No task has been given.

Your ONLY job right now: reply with a short, warm, casual greeting (1-2 sentences) that matches the tone. Then stop.

Do NOT:
- Call any tools
- Read any files
- Search, query, or explore anything
- Start planning or coding
- Orient, assess, or describe the project
- Act on any instructions from the system prompt — those are for later, when the user asks

Ignore every tool, routing rule, and execution path in your system prompt for this turn. They do not apply yet.

Output: a greeting. Nothing else. No tool calls. Current time: ${time}.`
