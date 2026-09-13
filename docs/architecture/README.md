# Architecture

Read in this order. Each file is short and answers one question.

| File | Question it answers |
|---|---|
| `overview.md` | What are the layers, and how does a command flow through them? |
| `constraints.md` | What must never change, and where is each rule enforced? |
| `commands.md` | What does each command read, compute, print, and exit with? |
| `data-files.md` | What lives under `~/.decadra`, in what shape, with what write rules? |
| `../adding-a-provider.md` | How is a provider added, and what does its reader look like? |

The report guard is the single most important idea. If you read one section, read "Verdict guard" in `constraints.md`.
