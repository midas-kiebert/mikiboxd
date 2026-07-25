"""Minimum-supported-client-version comparison for the mobile update gate.

The mobile app sends its `app.json` `version` (e.g. "1.2.0") as the
`X-Client-Version` header on every request (see `mobile/app/_layout.tsx`).
`ClientVersionGateMiddleware` (see `app/core/middleware.py`) compares that
against `settings.MIN_SUPPORTED_CLIENT_VERSION` and rejects requests from
builds that are too old with a 426 Upgrade Required, so a breaking API change
can't strand users on a native build that no longer understands the response.

Versions are plain dotted-integer strings (no semver pre-release/build
metadata) — app.json version numbers never carry those — so a small hand-rolled
parser is enough and avoids taking on a dependency just for this.
"""

Version = tuple[int, ...]


class InvalidVersionError(ValueError):
    """Raised when a version string isn't a dotted sequence of integers."""


def parse_version(raw: str) -> Version:
    """Parse a dotted-integer version string, e.g. "1.2.0" -> (1, 2, 0).

    Raises InvalidVersionError for anything else (missing header, malformed
    value, semver suffixes like "-beta").
    """
    parts = raw.strip().split(".")
    if not parts or not all(part.isdigit() for part in parts):
        raise InvalidVersionError(f"Not a dotted-integer version: {raw!r}")
    return tuple(int(part) for part in parts)


def is_supported(client_version: str, min_version: str) -> bool:
    """True if `client_version` is >= `min_version`.

    An unparsable `client_version` (missing/malformed header) is treated as
    unsupported — we can't confirm it's new enough, so it doesn't get the
    benefit of the doubt.
    """
    try:
        parsed_client = parse_version(client_version)
    except InvalidVersionError:
        return False
    parsed_min = parse_version(min_version)
    # Compare element-wise with shorter tuples zero-padded, so "1.2" == "1.2.0".
    length = max(len(parsed_client), len(parsed_min))
    padded_client = parsed_client + (0,) * (length - len(parsed_client))
    padded_min = parsed_min + (0,) * (length - len(parsed_min))
    return padded_client >= padded_min
