"""Wire compatibility for app builds shipped before the `viewer` block.

Native builds up to and including mobile 1.0.3 read the viewer's own state as
flat top-level fields on showtimes and movies (`going`, `friends_going`,
`seat_row`, ...). Those fields have since moved under `viewer` (see
`app.core.viewer`), which on an already-installed build would silently render
every showtime as "not going" rather than fail loudly.

Gating those users out with a 426 (see `app.core.middleware`) would work, but
it is a hard wall for a change that does not need one: the old and new shapes
carry exactly the same data, so the response can simply keep mirroring the
viewer block back onto the top level.

The mirrors are `computed_field`s derived from `viewer`, so the two shapes can
never drift and the flat values stay typed in the OpenAPI schema. They are
marked deprecated, which carries through to the generated client — nothing
written from here on should read them.

When there is no viewer at all (an anonymous browse), the mirrors report empty
lists and NOT_GOING. That is a lie the old shape forces: it has no way to say
"nobody asked". It is also harmless, because no build old enough to read these
fields can reach an anonymous response — guest browsing shipped alongside
`viewer`.

Retirement: the mobile app sends `X-Client-Version` on every request (see
`app.core.middleware`), so the versions still calling are observable. Once no
traffic arrives from a build older than the first release that reads `viewer`,
delete every `LEGACY_VIEWER_FIELD` block in `app.schemas.showtime` and
`app.schemas.movie`, then delete this module and its call in `app.main`.
"""

from typing import Any

LEGACY_VIEWER_FIELD = (
    "Moved to `viewer`; mirrored here only for app builds older than 1.1.0. "
    "See app.schemas.legacy_viewer_compat."
)


def mark_deprecated_fields_optional(openapi_schema: dict[str, Any]) -> dict[str, Any]:
    """Drop deprecated properties from every schema's `required` list.

    The mirrors are always present on the wire, so pydantic rightly calls them
    required — but the generated TypeScript client turns `required` into
    "you must supply this when building one of these", and the app does build
    showtimes locally (composing a sheet's showtime out of a list row). Without
    this, every such site would have to hand-write a dozen fields it is not
    allowed to read and that are on their way out.
    """
    for schema in openapi_schema.get("components", {}).get("schemas", {}).values():
        required = schema.get("required")
        if not required:
            continue
        properties = schema.get("properties", {})
        schema["required"] = [
            name
            for name in required
            if properties.get(name, {}).get("deprecated") is not True
        ]
    return openapi_schema
