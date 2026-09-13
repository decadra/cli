/**
 * Reading the shell command out of a tool call. Lives beside GIT_COMMIT, which is the other
 * shared rule about tool command text, so any reader that parses exec arguments can use it.
 */
/**
 * 0.144.x passes JavaScript to the exec tool with the shell script inside a `cmd` string
 * literal, so the raw text carries the two characters backslash and n where the script has
 * a newline. The commit rule's newline guard only works on the decoded string.
 */
export function decodeExecInput(input: string): string {
  const at = input.search(/\bcmd\s*:\s*"/);
  if (at === -1) return input;
  const start = input.indexOf('"', at);
  let i = start + 1;
  while (i < input.length) {
    if (input[i] === '\\') {
      i += 2;
      continue;
    }
    if (input[i] === '"') break;
    i += 1;
  }
  try {
    const decoded: unknown = JSON.parse(input.slice(start, i + 1));
    return typeof decoded === 'string' ? decoded : input;
  } catch {
    return input;
  }
}

/** The shell text a tool call is about to run, whichever shape the build uses. */
export function toolCommandText(payload: Record<string, unknown>): string {
  if (payload['type'] === 'custom_tool_call') {
    return typeof payload['input'] === 'string' ? decodeExecInput(payload['input']) : '';
  }
  const args = payload['arguments'];
  if (typeof args !== 'string') return typeof args === 'object' && args !== null ? JSON.stringify(args) : '';
  try {
    const parsed = JSON.parse(args) as { command?: unknown };
    if (Array.isArray(parsed.command)) return parsed.command.join(' ');
    if (typeof parsed.command === 'string') return parsed.command;
    return args;
  } catch {
    return args;
  }
}
