---
name: dependency-audit
description: Audit project dependencies when they are added, upgraded, removed, or replaced. Use this skill to evaluate security vulnerabilities, known issues, breaking changes, maintenance health, project compatibility, alternatives, migration cost, and whether a dependency can be removed entirely. Prefer delegated or isolated research when subagents are available to keep detailed investigation out of the main context
disable-model-invocation: false
---

# Dependency Audit

Audit dependency changes against the project's actual usage and environment.
The goal is not only to verify that an update works, but to determine whether the dependency remains secure, maintained, compatible, appropriate, and necessary.

## When to Use

- new, removed, replaced, or upgraded dependencies;
- major version changes;
- security-sensitive dependencies;
- auth, database, networking, cryptography, runtime, build, or infrastructure dependencies;
- significant transitive dependency changes;
- explicit dependency/security/upgrade review requests.
  For routine patch/minor updates, use a lightweight audit unless risk signals justify deeper investigation.

## Delegation

When subagents, delegated tasks, or isolated contexts are available, prefer them for full audits.
The delegated researcher should:

- inspect relevant project usage;
- research the dependency;
- not modify project files;
- return only the structured result defined below.
  For multiple significant dependencies, research independently and in parallel when practical.
  Keep raw research, search logs, long changelogs, and issue lists out of the main context.
  If delegation is unavailable, perform the same process directly.

## 1. Understand Project Usage

Before researching the dependency, inspect:

- manifest and lockfile;
- version-control diff;
- imports and used APIs;
- configuration;
- runtime/framework/build/deployment environment;
- relevant tests.
  Determine why the dependency exists and how much of it the project actually uses.

## 2. Changes

Check:

- old and new versions;
- patch/minor/major change;
- relevant release notes/changelog;
- breaking changes;
- deprecated or removed APIs;
- changed defaults;
- migration requirements;
- runtime/platform requirement changes.
  Report only changes relevant to actual project usage.

## 3. Security

Check:

- known CVEs/security advisories;
- vulnerabilities affecting old or new versions;
- recently fixed vulnerabilities;
- relevant vulnerable transitive dependencies;
- security regressions or unsafe defaults.
  Prefer official advisories, GitHub Security Advisories, OSV, NVD, and maintainer announcements.
  Distinguish confirmed findings from speculation.
  Absence of known CVEs is not proof of security.

## 4. Known Issues

Review relevant recent:

- GitHub issues;
- regressions;
- bug reports;
- framework/runtime incompatibilities;
- deployment-platform problems.
  Prioritize issues matching the project's actual environment and target version.
  Do not report unrelated issue noise.

## 5. Maintenance

Evaluate:

- release and commit activity;
- maintainer responsiveness;
- important unresolved issues;
- security response;
- deprecation/archive status;
- ownership/governance concerns when relevant.
  Classify:
- **Healthy**
- **Acceptable**
- **Concerning**
- **Unmaintained**
  Do not judge maintenance solely by release frequency.

## 6. Compatibility

Verify compatibility with relevant:

- language/runtime version;
- framework;
- build system;
- module format;
- browser requirements;
- serverless/edge runtime;
- deployment platform.
  Classify:
- **Compatible**
- **Compatible with changes**
- **Uncertain**
- **Incompatible**

## 7. Cost

When relevant, consider:

- bundle size;
- startup/cold-start impact;
- runtime/memory overhead;
- transitive dependencies;
- configuration and operational complexity.
  Do not perform deep performance analysis unless it could materially affect the decision.

## 8. Alternatives

Look for alternatives only when there is a plausible reason to replace the dependency.
Compare credible candidates by:

- maintenance/security;
- compatibility;
- ecosystem maturity;
- dependency footprint;
- migration effort;
- long-term viability.
  Do not recommend migration merely because another library is newer or more popular.

## 9. Removal

Always ask:

> Does the project need this dependency at all?
> Consider replacing it with:

- standard/platform APIs;
- framework functionality;
- an already-installed dependency;
- a small local implementation.
  Prefer removal when a dependency provides trivial functionality that can be safely maintained locally.
  Do not casually reimplement security-sensitive or complex functionality such as cryptography, authentication protocols, authorization, or complex parsers.

## 10. Migration Cost

Estimate replacement/update/removal cost based on:

- affected files and APIs;
- configuration changes;
- testing effort;
- behavioral differences;
- deployment changes;
- migration risk.
  Classify:
- **Low**
- **Medium**
- **High**

## Risk

Assign:

- **Low** — routine change with no meaningful concerns.
- **Medium** — breaking changes, regressions, compatibility or maintenance concerns.
- **High** — security issue, serious regression, unsupported environment, abandonment, or major architectural risk.
- **Critical** — severe known security or operational risk requiring immediate action.

## Recommendation

Choose exactly one:

- **Upgrade**
- **Upgrade with migration changes**
- **Keep current version**
- **Replace**
- **Remove**
- **Investigate further**
  Base the recommendation on evidence and project-specific tradeoffs.

# Output

For each dependency return:

## `<dependency>: <old> → <new>`

**Risk:** Low | Medium | High | Critical
**Usage:** How the project uses it.
**Changes:** Relevant breaking/behavioral changes.
**Security:** Relevant findings or `No known relevant vulnerabilities found.`
**Issues:** Relevant known regressions/problems.
**Compatibility:** Compatible | Compatible with changes | Uncertain | Incompatible
**Maintenance:** Healthy | Acceptable | Concerning | Unmaintained
**Alternatives:** Credible alternatives, if worth considering.
**Removal:** Whether it can reasonably be removed.
**Migration cost:** Low | Medium | High
**Recommendation:** Upgrade | Upgrade with migration changes | Keep current version | Replace | Remove | Investigate further
Brief justification.
**Sources:** Primary sources for important findings.

# Context Discipline

When delegated, return only the final structured result to the parent agent.
Do not return:

- raw research;
- search logs;
- full changelogs;
- long issue lists;
- exploratory reasoning;
- irrelevant alternatives.
  Prefer primary and current sources. Never invent vulnerabilities, issues, or compatibility problems.
  Optimize for the actual project rather than dependency popularity or freshness.
