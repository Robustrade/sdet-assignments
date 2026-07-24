# Reviewing SDET Submission PRs

This repository has no CI pipeline. Submission PRs are reviewed **locally**, using the `submission-reviewer` Claude Code agent defined in [`.claude/agents/submission-reviewer.md`](./.claude/agents/submission-reviewer.md).

## Why no CI

The assignment is deliberately open-ended (TypeScript is expected, but structure, test runner, and mocking approach are the candidate's design choices to make). A fixed CI job list rewards conforming to the pipeline's assumptions over sound test engineering judgment. A local, rubric-driven review — grounded in [`SDET_ASSIGNMENT.md`](./SDET_ASSIGNMENT.md) and [`sdet_evaluation_guide.md`](./sdet_evaluation_guide.md) — reads the actual code and design choices instead.

## Running a review

From within Claude Code, in this repository:

```
Use the submission-reviewer agent to review PR #<number>
```

or, if you already have the PR checked out locally, just ask it to review the current branch. The agent will:

1. Read `SDET_ASSIGNMENT.md`, `sdet_evaluation_guide.md`, and `pull_request_template_sdet.md` for the current rubric.
2. Identify the single `submission/<candidate-name>/` directory the PR touches.
3. Install dependencies and run `npm run lint`, `npm run build` (type-check), `npm test`, and `npm run validate-schema` (or whatever subset exists) inside that directory, recording pass/fail.
4. Score the submission against every category in `sdet_evaluation_guide.md`, citing `file:line` evidence.
5. Produce a single written report: scores, overall band, top strengths/gaps, and whether the PR description actually covers what the template requires.

## What the agent does not do

It does not comment on the PR, push commits, approve/request changes, or merge, and it does not modify any file in the candidate's submission. If you want its findings posted as a PR comment, say so explicitly — that is a separate, deliberate action, not something a review request implies.

## Manual checklist (if reviewing without the agent)

- [ ] `npm ci && npm run lint` passes in the submitted `submission/<candidate>/` directory
- [ ] `npm run build` (type-check) passes
- [ ] `npm test` passes
- [ ] Every listed lifecycle transition has at least one test; at least two invalid transitions are proven impossible
- [ ] Webhook idempotency (duplicate `event_id`) is tested
- [ ] The payment provider is genuinely mocked, with call count/arguments asserted, not just "was called"
- [ ] PR description covers every section in `pull_request_template_sdet.md`, including Responsible AI usage
