#!/bin/sh
# PreToolUse(Bash) guard: refuse in-place edits driven by perl.
#
# Why this is a script and not an inline `command`
# ------------------------------------------------
# settings.json already narrows this hook with `if: "Bash(perl *)"`, but that
# filter is best-effort. Claude Code splits the Bash command into subcommands
# (stripping leading assignments, descending into $() and backticks) and FAILS
# OPEN when it cannot fully parse one. A command with awkward quoting therefore
# reaches this hook with no perl in it at all, so an unconditional `exit 2`
# would block unrelated commands while blaming perl. This script re-checks the
# command and stays quiet unless perl is genuinely being invoked; `if` is left
# in place as a cheap pre-filter so the common case never spawns a shell.
#
# Hook contract (PreToolUse)
# --------------------------
#   stdin  - JSON describing the tool call; the Bash command is at
#            .tool_input.command
#   exit 0 - allow the command
#   exit 2 - block it; stderr is fed back to Claude as the reason
#
# Matching
# --------
# perl is matched only as a whole command word: preceded by the start of the
# string, whitespace, or a shell operator (| & ; parens), and followed by
# whitespace or the end of the string. That catches `perl -pi -e ...`,
# `cat x | perl -ne ...` and `FOO=bar perl -v`, while leaving words that merely
# contain it -- `perlman`, `/usr/bin/perl5` -- alone.
#
# Failure mode
# ------------
# If jq is missing, grep sees empty input and the command is allowed. The guard
# fails open on purpose: a machine without jq should lose the check, not have
# every Bash call blocked.

cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)

if printf '%s' "$cmd" | grep -qE '(^|[|&;()[:space:]])perl([[:space:]]|$)'; then
  echo 'Use the Edit tool, not perl for in-place edits.' >&2
  exit 2
fi

exit 0
