# Kulu SDET Take-Home Assignment

This repository contains the take-home infrastructure assignment for SDET engineering candidates at Kulu.

## Language

Solutions must be written in **TypeScript** (plain JavaScript is acceptable with a strong reason — see [SDET_ASSIGNMENT.md](./SDET_ASSIGNMENT.md)). See the reference scaffold in [`submission/sample-candidate-ts`](./submission/sample-candidate-ts) for the expected project structure, design patterns, and how to run the suite.

## Review Process

There is no CI pipeline for this repository. Incoming submission PRs are reviewed locally against [`sdet_evaluation_guide.md`](./sdet_evaluation_guide.md) using the `submission-reviewer` Claude Code agent — see [`pr_review_guide.md`](./pr_review_guide.md) for how that works. Candidates are still expected to run lint, type-check, and the test suite themselves before opening a PR (see the "Validation" section of [`pull_request_template_sdet.md`](./pull_request_template_sdet.md)).

## How to Submit

1. Fork this repository to your own GitHub account.
2. Complete the assignment described in [SDET_ASSIGNMENT.md](./SDET_ASSIGNMENT.md).
3. Raise a Pull Request back to this repository (`main` branch) with your full solution, under `submission/<your-name>/`.
4. Your PR branch should be named: `solution/<your-name>` (e.g., `solution/jane-doe`).
5. Fill out the PR description using [`pull_request_template_sdet.md`](./pull_request_template_sdet.md).
