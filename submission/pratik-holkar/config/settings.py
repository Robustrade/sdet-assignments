"""Loads `config/<env>.properties`, expanding `${VAR}` and `${VAR:-default}`
tokens from os.environ. Switch envs with `TEST_ENV=stg` (or qa, prd).
"""

import os
import re
from dataclasses import dataclass
from pathlib import Path

_ENV_VAR_PATTERN = re.compile(r"\$\{([A-Z0-9_]+)(?::-([^}]*))?\}")


def _expand(value: str) -> str:
    def repl(match: re.Match) -> str:
        name = match.group(1)
        default = match.group(2) or ""
        return os.environ.get(name, default)

    return _ENV_VAR_PATTERN.sub(repl, value).strip()


def _parse_properties(path: Path) -> dict[str, str]:
    props: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        props[key.strip()] = _expand(value)
    return props


@dataclass(frozen=True)
class Settings:
    env: str
    base_url: str
    db_url: str
    api_user: str
    api_token: str
    request_timeout_seconds: int
    use_inprocess_service: bool

    @classmethod
    def load(cls, env: str | None = None) -> "Settings":
        env = (env or os.environ.get("TEST_ENV") or "qa").lower()
        root = Path(__file__).resolve().parent
        path = root / f"{env}.properties"
        if not path.exists():
            raise FileNotFoundError(
                f"Unknown TEST_ENV='{env}'. Expected one of: "
                + ", ".join(p.stem for p in root.glob("*.properties"))
            )
        props = _parse_properties(path)
        return cls(
            env=props.get("env", env),
            base_url=props.get("base_url", ""),
            db_url=props.get("db_url", ""),
            api_user=props.get("api_user", ""),
            api_token=props.get("api_token", ""),
            request_timeout_seconds=int(props.get("request_timeout_seconds", "10")),
            use_inprocess_service=props.get("use_inprocess_service", "true").lower() == "true",
        )
