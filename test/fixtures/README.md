# Fixtures

Real files from real tools, redacted with the `redact-fixture` skill. Never synthetic. Each provider directory carries a README naming the tool version, capture date, what was redacted, and the cases the file covers.

Placeholder strings used during redaction are registered in `test/placeholders.ts`. `CONTENT_PLACEHOLDERS` are the ones that must never reach output, and `test/privacy.test.ts` proves it. Redacted session ids and the fixture home path sit in `ID_PLACEHOLDERS` instead, because a session id is what the readout prints when it names the session you are in.

Fixtures exist for Claude Code (`claude/`) and Codex (`codex/`). Cursor, Devin, and Muse fixtures land with their readers.
