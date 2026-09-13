---
name: redact-fixture
description: Turn a real coding-agent transcript, rollout, database row set, or vendor export into a fixture that is safe to commit. Use before adding any file under test/fixtures.
---

# Redact a fixture

Fixtures are real files because formats drift in ways synthetic files never show. Redaction removes content, never structure.

1. Copy the source file into the scratchpad. Never edit the original in place.
2. Replace every human prompt, assistant text, thinking block, tool input, and tool result body with a short placeholder of the same JSON type, for example `"[redacted 2 lines]"`. Keep the field present so the reader sees the real shape.
3. Replace absolute paths with a fixed fake home such as `/home/fixture/<repo>`. Keep path depth the same, because Claude's project directory encoding depends on it.
4. Replace session ids, message ids, request ids, and any uuid with stable fakes that keep the same format. Keep them consistent within the file so dedupe logic still triggers.
5. Keep timestamps. Shift them all by the same offset if the capture date is sensitive. Never reorder them.
6. Keep token counts, ACU costs, model names, tool names, `origin.kind`, `isSidechain`, `type`, `version`, `cli_version`, and every structural field.
7. Search the result for anything that looks like a secret: `sk-`, `ghp_`, `Bearer `, `-----BEGIN`, `@` followed by a domain, and any hostname that is not `example.com`. Remove each.
8. Trim the file to the smallest set of lines that still exercises the cases the test needs. Say in the fixture README which cases those are.
9. Write `test/fixtures/<provider>/README.md` with: tool name and version, capture date, what was redacted, what cases the file covers.
10. Add every placeholder string you used to the list in `test/privacy.test.ts` so the privacy grep proves none of them leak into `--json` output.
