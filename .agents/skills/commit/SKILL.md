---
name: commit
description: Review all pending changes and split them into multiple logically-separate commits, one per concrete change, instead of bundling everything into a single commit. Use whenever the user asks to commit, stage, or save changes to git in this repo.
---

## Review the full diff first

Run in parallel: `git status`, `git diff` (unstaged) and `git diff --cached` (staged),
and `git log --oneline -10` (for this repo's commit message style). Don't skip this —
grouping decisions require seeing every changed file, not just the ones mentioned in
the conversation.

## Group changes into logical commits

A "logical change" is one concrete, coherent piece of work — one bug fix, one new
feature, one refactor, one config/style tweak, one test addition. Default to
**splitting**, not bundling:

- Two changes that happen to have been made in the same session are still two
  commits if they address different concerns (e.g. "add pagination page-size
  selector" and "add a colored necessity-level tag" are separate commits, even
  back-to-back).
- A new util/component plus its own test file is one commit (the test belongs with
  the code it tests).
- A schema/query change plus the UI code that depends on it is one commit if the UI
  wouldn't work without it; otherwise split.
- Don't fragment a single indivisible change (e.g. don't separate a function from
  its only caller, or split one function's logic across two commits).

When unsure whether two changes are related, prefer splitting — a reviewer can always
squash later, but an unrelated bundle is harder to review or revert piecemeal.

## Commit each group

For each group, in order:

1. Stage only that group's files (`git add <specific files>` — never `-A` or `.`).
   If a single file mixes two unrelated changes, use `git add -p` to stage only the
   relevant hunks.
2. Write a concise commit message (1–2 sentences, focused on _why_) matching this
   repo's existing style from `git log`.
3. Commit via a heredoc. Do not add `Co-Authored-By` trailers or any model- or provider-specific attribution unless the user explicitly requests it.
4. Run `git status` to confirm the working tree before moving to the next group.

## Still follow the standing git safety rules

No `--no-verify` / `--no-gpg-sign`, never amend unless explicitly asked, never
force-push, never commit unless the user asked, and warn before committing anything
that looks like a secret.

## When there really is only one logical change

If the whole diff is genuinely one coherent change, a single commit is correct —
this skill is about not _defaulting_ to one big commit, not about inflating commit
count for its own sake.
