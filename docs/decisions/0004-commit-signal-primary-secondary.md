# 0004: Transcript commit call primary, time window secondary

Date: 2026-09-05. Status: accepted, from one laptop's probe.

Context: the brief proposed "a git commit landed in the session's directory within N minutes of the last message" as an effort proxy. The plan called it weak and set a decision rule: drop it if ambiguity exceeds 25% at N=15, sparsity exceeds 60%, or the rank correlation with turns is below 0.3. `scripts/probe-commit-proxy.ts` ran on the user's laptop over 34 Claude Code sessions in 60 days.

Result: ambiguity 18%, sparsity 60%, Spearman 0.65, agreement with the transcript signal 87%. 19 of 34 sessions ran outside any git repo.

Decision: the git commit call found in the transcript is the primary signal (no ambiguity, no dependence on the directory still existing). The time-window count ships as a secondary column labelled weak, with the caveat in every format. The Claude co-author trailer is a third, Claude-only signal. Codex numbers were not available (the probe output was cut) and 1,021 Codex rollouts with two commit calls suggest automated runs; revisit when the Codex half is in.
