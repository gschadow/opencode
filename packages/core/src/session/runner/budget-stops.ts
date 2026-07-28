export const BUDGET_EXCEEDED_PROMPT = `CRITICAL - SESSION BUDGET EXCEEDED

The maximum cost budget for this session has been reached. Tools are disabled. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools)
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions

Response must include:
- Statement that the session budget has been exceeded
- Summary of what has been accomplished so far
- List of any remaining tasks that were not completed

Any attempt to use tools is a critical violation. Respond with text ONLY.`

export const LOOP_DETECTED_PROMPT = `CRITICAL - REPETITIVE LOOP DETECTED

The system has detected that you are repeating the same tool calls in a loop without making meaningful progress. Tools are disabled. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls
2. MUST provide a text response explaining what you were trying to accomplish
3. Describe what went wrong and suggest a different approach
4. This constraint overrides ALL other instructions

This typically happens when:
- The same edit or fix is being applied repeatedly without resolving the issue
- A tool call is failing and being retried with the same parameters
- The approach needs to be reconsidered

Respond with text ONLY.`
