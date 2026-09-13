# Demand notes

Collected 2026-09-05 from web search. Reddit itself is poorly indexed by the search tool used, so Reddit signals below are second-hand through articles that cite thread titles and comment counts. Treat counts as approximate and re-check before quoting them anywhere public.

## What people are already doing

- Usage tracking for AI coding tools is a crowded, active category. `ccusage` has about 18,200 GitHub stars (August 2026) and covers 18 CLIs. `codeburn` has about 10,900 stars, covers 25 or more tools, and ships a TUI, a macOS menu bar app, `plan set` for subscription tracking, `quota` for live utilization pulled through each tool's own credentials, and `yield`, a timestamp-window correlation of sessions to git commits. Several menu bar and taskbar trackers exist for the same limits (CodexBar, OpenUsage, CUStats, Claude-Code-Usage-Monitor, coding_agent_usage_tracker, an "AI Usage Monitor" Chrome extension that includes Devin).
- The recurring number people post is the break-even multiple: API-equivalent cost divided by subscription price. Hacker News threads cite figures like $4,500 of API-equivalent tokens on a $200 plan, and $15,000 over 8 months against $800 paid. ccusage prints this number and it is what gets screenshotted.

## Where the pain is

- Limits, not price, drive the discussion. A March 2026 r/ClaudeAI thread titled "20x max usage gone in 19 minutes" drew 330+ comments in a day; an r/ClaudeCode thread on limits being silently reduced drew 360+ in six days. Anthropic added weekly caps on 2026-08-28 and raises them 25% on 2026-09-14. OpenAI suspended the 5-hour window for Plus and Pro in July 2026. People want to know how close to a wall they are, and whether the next tier up removes the wall.
- Downgrade stories exist but are rarer and mixed with vendor bugs: reports of Max accounts silently dropped to Free, a token-inflation regression in Claude Code 2.1.100+, and articles about "some heavy users downgraded from Max back to Pro". Nobody in the results computes whether a downgrade would have held; the decisions are anecdotal.
- Multi-subscription fatigue is a steady theme: paying for Claude, ChatGPT, Cursor, and Gemini at once, cancelling Cursor after pricing changes, Cursor's request-to-credit switch and the resulting community backlash. The question "which of these am I actually using enough to keep" is asked in prose and answered by feel.
- Cross-provider comparison content is abundant and mostly benchmark-driven ("Codex uses 2 to 3 times fewer tokens"). None of it is measured on the reader's own sessions.

## What nobody in the results does

- Effective cost under every plan the vendor sells, across billing shapes (capped flat, included credit with overage, metered per unit), for the reader's own observed usage.
- A dated, append-only record of what was held when, so a tier change can be evaluated before and after.
- Per-provider plan-fit verdicts that refuse to rank providers. Every tool found either compares providers in one view or stays silent on plans.
- Honest ceilings: labelling estimates as estimates and using recorded utilization only where the tool writes it. codeburn's `quota` pulls live utilization over the network with the tool's credentials, which is the design Decadra rejected for the no-network rule; it is also the strongest competing feature, because it answers "how close to the wall" directly.

## Implications for Decadra

1. The wedge is the decision layer, not ingest. Anything spent on ingest beyond the thin readers competes with tools that have thousands of stars and a head start.
2. The commit-correlation column is already shipped by codeburn's `yield` using the exact heuristic the plan calls weak. Decadra's version has to be visibly more honest (transcript-detected commits primary, ambiguity reported) or it should not ship.
3. "How close to the wall" is the question people ask most. Decadra answers it from recorded utilization for Codex and from user anchors elsewhere. A future opt-in `quota` style pull would close the gap, but only as an explicit network opt-in.
4. Demand is real but the category is noisy. Positioning should be one sentence: it tells you which tier fits, per provider, with the math shown.

## Sources

- https://github.com/ryoppippi/ccusage
- https://github.com/getagentseal/codeburn
- https://www.developersdigest.tech/blog/codeburn-tui-dashboard-for-claude-code-token-spend
- https://www.natecue.com/en/learn/ai/ccusage-codeburn-track-claude-code-usage/
- https://github.com/Dicklesworthstone/coding_agent_usage_tracker
- https://github.com/steipete/codexbar
- https://www.openusage.ai/
- https://custats.info/
- https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
- https://dev.to/portkey/everything-we-know-about-claude-code-limits-3984
- https://www.ksred.com/claude-code-pricing-guide-which-plan-actually-saves-you-money/
- https://intuitionlabs.ai/articles/claude-pricing-plans-api-costs
- https://www.layer3labs.io/guides/is-claude-max-worth-it
- https://www.toolcolumn.com/learn/chatgpt-plus-vs-pro
- https://findskill.ai/blog/claude-code-subscription-pricing-guide/
- https://www.xda-developers.com/canceled-claude-chatgpt-gemini-subscriptions-go-back-to-powerful-ai-tool/
- https://codingwithroby.substack.com/p/i-canceled-my-cursor-subscription
- https://dmitrya.substack.com/p/the-200-ai-coding-reality-why-cursors
- https://www.techcrunch.com/2026/03/02/cursor-has-reportedly-surpassed-2b-in-annualized-revenue/
- https://www.morphllm.com/comparisons/codex-vs-claude-code
- https://composio.dev/content/claude-code-vs-openai-codex
