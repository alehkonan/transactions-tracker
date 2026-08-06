---
name: creating-skills
description: How to add a new skill to this repo — where the files go, the required frontmatter, and the .claude/skills symlink step. Activate whenever creating, adding, or scaffolding a new skill (e.g. "create a skill for X", "add a skill that documents Y").
---

# Creating a new skill (transactions-tracker)

## The rule

**Skills are authored in `.agents/skills/<name>/`. `.claude/skills/<name>` is always a symlink to it, never a real
directory.** Every existing skill in this repo follows this split — confirm it before adding a new one:

```bash
ls -la .claude/skills/   # every entry should be `lrwxr-xr-x ... -> ../../.agents/skills/<name>`
```

`.agents/skills/` is the source of truth (portable across any tool that reads that convention); `.claude/skills/` is
just how Claude Code's skill loader discovers them in this repo. Never write a `SKILL.md` directly under
`.claude/skills/<name>/` — that creates a duplicate, tool-specific copy that will drift from `.agents/skills/`.

## Steps

1. Pick a kebab-case name matching the library/topic (e.g. `react-datepicker`, `drizzle-recipes`, `project-structure`
   — not `ReactDatepicker` or `date_picker`). This is both the directory name and the frontmatter `name:`.

2. Create the real directory and file:

   ```bash
   mkdir -p .agents/skills/<name>
   ```

   Write `.agents/skills/<name>/SKILL.md` with this frontmatter:

   ```markdown
   ---
   name: <name>
   description: <one dense paragraph — what it covers, then an explicit "Activate when ..." trigger clause>
   ---
   ```

   The `description` is the only thing the skill loader shows before activation, so front-load concrete trigger
   phrases (library name, file names it applies to, situations that should activate it) rather than a vague summary —
   see any existing `SKILL.md` frontmatter line for the density expected.

3. Symlink it from `.claude/skills/`, **relative**, matching the existing entries exactly:

   ```bash
   cd .claude/skills && ln -s ../../.agents/skills/<name> <name>
   ```

4. Verify:

   ```bash
   ls -la .claude/skills/<name>          # -> ../../.agents/skills/<name>
   cat .claude/skills/<name>/SKILL.md    # resolves through the link
   ```

## Content conventions (match the existing skills)

- **Condensed reference skills** (`base-ui`, `react-hook-form`, `drizzle-recipes`, `react-datepicker`): built from the
  library's real docs but rewritten, not pasted — prose + short code blocks + tables, trimmed to what this repo would
  actually reach for. State the source URL near the top ("condensed, not verbatim") and flag anything this repo does
  differently from the library's own default guidance (e.g. `react-hook-form`'s "always `Controller`" project
  convention). If the library has a live docs site, verify you're reading the version this repo would actually install
  (`npm view <pkg> version`) before condensing — don't assume the first URL you're given is current; a stale major can
  document a different API entirely.
- **Procedural skills** (`commit`): numbered steps, imperative voice, short — describes a workflow to execute, not a
  library to reference.
- **Structural/placement skills** (`project-structure`): a "where does X go" table plus a short numbered rules list and
  a "red flags" section for review. Use this shape for anything about _this repo's_ conventions rather than a
  third-party library.
- A skill that outgrows one file gets a `references/` (or, for narrowly-scoped rule sets, a differently-named)
  subdirectory next to `SKILL.md` — see `playwright-cli/references/` or `tanstack-start-best-practices/rules/` — with
  `SKILL.md` staying as the entry point that links out to them. Don't reach for this until the flat file is genuinely
  unwieldy.
- Keep it terse. These files are loaded into context on activation — every paragraph is a paragraph the model has to
  read before doing the actual task.
