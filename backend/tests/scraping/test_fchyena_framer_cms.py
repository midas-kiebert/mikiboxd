import struct

from app.scraping.cinemas.amsterdam.fchyena import (
    FramerCmsError,
    _find_films_component_url,
    _parse_framer_cms_records,
    _property_titles,
    _read_framer_value,
)


def _encode_string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack(">I", len(encoded)) + encoded


def _encode_field(name: str, tag: int, payload: bytes) -> bytes:
    return _encode_string(name) + struct.pack(">B", tag) + payload


def _encode_string_field(name: str, value: str) -> bytes:
    return _encode_field(name, 12, _encode_string(value))


def _encode_record(fields: bytes, field_count: int) -> bytes:
    return struct.pack(">H", field_count) + fields


def _encode_chunk(records: list[bytes]) -> bytes:
    return struct.pack(">I", len(records)) + b"".join(records)


def test_parses_string_fields() -> None:
    record = _encode_record(
        _encode_string_field("id", "abc123") + _encode_string_field("kQ0YfWdY0", "Beavers"),
        field_count=2,
    )
    records = _parse_framer_cms_records(_encode_chunk([record]))
    assert records == [{"id": "abc123", "kQ0YfWdY0": "Beavers"}]


def test_records_can_have_different_field_counts() -> None:
    # A nullable field left empty in the CMS is omitted entirely rather than
    # written out as a null value, so two records for the same collection can
    # carry a different number of fields.
    full_record = _encode_record(
        _encode_string_field("a", "1") + _encode_string_field("b", "2"),
        field_count=2,
    )
    sparse_record = _encode_record(_encode_string_field("a", "1"), field_count=1)
    records = _parse_framer_cms_records(_encode_chunk([full_record, sparse_record]))
    assert records == [{"a": "1", "b": "2"}, {"a": "1"}]


def test_null_field_type_tag_decodes_to_none() -> None:
    record = _encode_record(_encode_field("year", 0, b""), field_count=1)
    records = _parse_framer_cms_records(_encode_chunk([record]))
    assert records == [{"year": None}]


def test_boolean_and_number_field_types() -> None:
    fields = (
        _encode_field("isSpecial", 2, struct.pack(">B", 1))
        + _encode_field("rating", 8, struct.pack(">d", 8.5))
    )
    record = _encode_record(fields, field_count=2)
    records = _parse_framer_cms_records(_encode_chunk([record]))
    assert records == [{"isSpecial": True, "rating": 8.5}]


def test_unknown_type_tag_raises() -> None:
    record = _encode_record(_encode_field("bogus", 99, b""), field_count=1)
    try:
        _parse_framer_cms_records(_encode_chunk([record]))
    except FramerCmsError:
        pass
    else:
        raise AssertionError("expected FramerCmsError for an unknown type tag")


def test_property_titles_maps_title_to_obfuscated_key() -> None:
    # A tiny slice of the shape Framer's compiled property-control object
    # literal actually takes: `KEY:{...,title:\`Human Title\`,...}`.
    component_js = (
        "u(Z,{YWNKrbteq:{defaultValue:``,title:`Production ID`,type:f.String},"
        "kQ0YfWdY0:{defaultValue:``,title:`Title`,type:f.String}})"
    )
    titles = _property_titles(component_js)
    assert titles["Production ID"] == "YWNKrbteq"
    assert titles["Title"] == "kQ0YfWdY0"


def test_property_titles_ignores_entries_without_a_title() -> None:
    component_js = "u(Z,{someKey:{defaultValue:``,type:f.String}})"
    assert _property_titles(component_js) == {}


def test_find_films_component_url_matches_component_id_prefix() -> None:
    html = (
        '<link rel="modulepreload" fetchpriority="low" '
        'href="https://framerusercontent.com/sites/site1/react.DwKF3UUh.mjs">'
        '<link rel="modulepreload" fetchpriority="low" '
        'href="https://framerusercontent.com/sites/site1/Fs7yzW3IK.COkRvsk8.mjs">'
    )
    url = _find_films_component_url(html)
    assert url == "https://framerusercontent.com/sites/site1/Fs7yzW3IK.COkRvsk8.mjs"


def test_find_films_component_url_returns_none_when_no_candidate_matches() -> None:
    html = (
        '<link rel="modulepreload" fetchpriority="low" '
        'href="https://framerusercontent.com/sites/site1/framer.WHr7ivHY.mjs">'
    )
    assert _find_films_component_url(html) is None


def test_read_framer_value_reads_a_bare_string() -> None:
    from app.scraping.cinemas.amsterdam.fchyena import _FramerBinaryReader

    data = struct.pack(">B", 12) + _encode_string("hello")
    reader = _FramerBinaryReader(data)
    assert _read_framer_value(reader) == "hello"
