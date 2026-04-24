# Kulu SDET Take-Home Assignment

This repository contains the take-home infrastructure assignment for SDET engineering candidates at Kulu.

## Supported Languages

Candidates may submit solutions in any programming language. The repository includes CI workflows for:

- **Python** (using pytest, ruff, black)
- **Java** (using Maven, JUnit, RestAssured, Spotless)
- **JavaScript/Node.js** (using Jest, ESLint, npm audit)

See the sample submissions in `submission/sample-candidate*` for examples. The appropriate CI workflow will automatically run based on your project structure (presence of `requirements.txt`/`pyproject.toml` for Python, `pom.xml` for Java, `package.json` for JavaScript).

## How to Submit

1. Fork this repository to your own GitHub account.
2. Complete the assignment described in [SDET_ASSIGNMENT.md](./SDET_ASSIGNMENT.md).
3. Raise a Pull Request back to this repository (`main` branch) with your full solution.
4. Your PR branch should be named: `solution/<your-name>` (e.g., `solution/jane-doe`).
