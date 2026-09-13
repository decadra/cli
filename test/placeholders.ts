/** Every placeholder string the redact-fixture skill has used. Grown with each fixture. */
export const PLACEHOLDERS: string[] = [
  '[redacted',
  '/home/fixture/',
  'msg_fixture',
  'call_fixture',
  'ctc_fixture',
  'rs_fixture',
  '01a07365-0000-7000-8000-',
  '2f44129c-0000-4000-8000-',
  '11111111-',
];

/**
 * Redacted identifiers and paths that are meant to appear in output. A session id is what
 * the readout names when it says which session you are in, and a cwd is a path, not
 * content. Redacting them in a fixture protects the capture; it does not make them secret.
 */
export const ID_PLACEHOLDERS: string[] = ['/home/fixture/', '01a07365-0000-7000-8000-', '2f44129c-0000-4000-8000-', '11111111-'];

/** Placeholders that must never reach output: prompt text and redaction markers. */
export const CONTENT_PLACEHOLDERS: string[] = PLACEHOLDERS.filter((p) => !ID_PLACEHOLDERS.includes(p));
