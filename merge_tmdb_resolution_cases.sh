#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 <tmdb_cases_a.json> <tmdb_cases_b.json> [output.json]" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILE_A="$1"
FILE_B="$2"
OUTPUT_PATH="${3:-${ROOT_DIR}/backend/tests/fixtures/tmdb_resolution_cases.json}"

python3 - "$FILE_A" "$FILE_B" "$OUTPUT_PATH" <<'PY'
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"File not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc


def _extract_cases(payload: Any, *, source_path: Path) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        raw_cases = payload.get("cases")
    elif isinstance(payload, list):
        raw_cases = payload
    else:
        raise SystemExit(
            f"Unsupported JSON format in {source_path}: expected object or list."
        )

    if not isinstance(raw_cases, list):
        raise SystemExit(
            f"Invalid cases format in {source_path}: 'cases' must be a list."
        )

    cases: list[dict[str, Any]] = []
    for index, case in enumerate(raw_cases, start=1):
        if not isinstance(case, dict):
            raise SystemExit(
                f"Invalid case at {source_path} index {index}: expected object."
            )
        cases.append(case)
    return cases


def _normalize_case_for_dedupe(case: dict[str, Any]) -> dict[str, Any]:
    return {
        "input": case.get("input"),
        "expected": case.get("expected"),
    }


def _dedupe_by_input_expected(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for case in cases:
        # Deduplicate by semantic match criteria, not case name/metadata.
        key = json.dumps(
            _normalize_case_for_dedupe(case),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(case)
    return deduped


_NAME_RE = re.compile(r"^\d+_(.+)$")
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _case_slug(case: dict[str, Any], index: int) -> str:
    name_raw = case.get("name")
    if isinstance(name_raw, str):
        match = _NAME_RE.match(name_raw.strip())
        if match:
            suffix = match.group(1).strip().lower()
            if suffix:
                return suffix

    input_raw = case.get("input")
    if isinstance(input_raw, dict):
        title_raw = input_raw.get("title_query")
        if isinstance(title_raw, str):
            title = title_raw.strip().lower()
            if title:
                slug = _SLUG_RE.sub("_", title).strip("_")
                if slug:
                    return slug

    return f"case_{index:04d}"


def _renumber_case_names(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    renamed: list[dict[str, Any]] = []
    for index, case in enumerate(cases, start=1):
        renamed_case = dict(case)
        slug = _case_slug(case, index)
        renamed_case["name"] = f"{index:04d}_{slug}"
        renamed.append(renamed_case)
    return renamed


def main() -> int:
    file_a = Path(sys.argv[1]).resolve()
    file_b = Path(sys.argv[2]).resolve()
    output_path = Path(sys.argv[3]).resolve()

    payload_a = _load_json(file_a)
    payload_b = _load_json(file_b)
    cases_a = _extract_cases(payload_a, source_path=file_a)
    cases_b = _extract_cases(payload_b, source_path=file_b)

    merged_cases = _dedupe_by_input_expected([*cases_a, *cases_b])
    merged_cases = _renumber_case_names(merged_cases)

    if isinstance(payload_a, dict):
        output_payload: dict[str, Any] = dict(payload_a)
    else:
        output_payload = {}

    output_payload["description"] = output_payload.get(
        "description",
        "Merged TMDB resolution fixture cases.",
    )
    output_payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    output_payload["total_cases"] = len(merged_cases)
    output_payload["cases"] = merged_cases

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(output_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        f"Merged {len(cases_a)} + {len(cases_b)} cases -> {len(merged_cases)} unique cases\n"
        f"Output: {output_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
PY
