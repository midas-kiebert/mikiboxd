"""Objectionable-username filter.

App Store Review guideline 1.2 asks a social app for "a method for filtering
objectionable material from being posted". In MiKiNO a username is the only free
text one user writes that another user reads — it appears in search results, on
friend requests, on invites and beside a showtime — so this is where that filter
belongs, and it is the only place it is needed.

**Scope: deliberately minimal.** This exists to satisfy guideline 1.2, not to
police taste. The list is limited to terms nobody argues about — slurs, child
safety, hardcore sexual content — plus names that would let someone pass
themselves off as MiKiNO staff. Mild profanity is *not* filtered: a user called
`bitchin_films` is not a review risk, and every term added widens the set of real
usernames wrongly refused. Whatever this misses is what `UserReport` and blocking
are for, and those are the part of guideline 1.2 that does the actual work.

**Matching.** Normalisation folds the leetspeak substitutions people reach for
first (`0`->`o`, `1`->`i`, `$`->`s`, ...) and strips everything that is not a
letter, so `f_u_c_k` and `fuck` collapse to the same string. Terms are then
matched as substrings of the folded form.

**The Scunthorpe problem.** Substring matching would catch innocent words that
happen to contain a listed term. Keeping the list short is most of the defence —
leaving `cock` off it is what stops `Hitchcock` being refused in a cinema app —
and `_ALLOWED_WORDS` covers the few that remain (`grape`, `Draper`, `torpedo`) by
being stripped out of the folded name before matching. A name that still has a
listed term left over after stripping is refused, so `draper_fuck` does not pass.

Terms too short or too ordinary to match as substrings at all go in
`_WHOLE_WORD_TERMS` and only match the entire name.
"""

import re

from app.exceptions.moderation_exceptions import ObjectionableUsernameError

# Digit/symbol substitutions folded before matching.
_LEET_TRANSLATION = str.maketrans(
    {
        "0": "o",
        "1": "i",
        "3": "e",
        "4": "a",
        "5": "s",
        "7": "t",
        "8": "b",
        "9": "g",
        "$": "s",
        "@": "a",
        "!": "i",
        "|": "i",
        "+": "t",
    }
)

_NON_LETTERS = re.compile(r"[^a-z]+")

# Matched anywhere in the normalised name.
#
# Kept short on purpose — see the module docstring. Notably absent, and staying
# absent unless a real problem turns up: mild profanity (bitch, slut, ass, tits),
# anatomy (cock, dick, pussy), and anything whose innocent host words are common
# (`spic` inside "spicy", `loli` inside "Lolita").
_SUBSTRING_TERMS: frozenset[str] = frozenset(
    {
        # Slurs — the unambiguous ones, with no innocent English host words.
        "nigger",
        "nigga",
        "chink",
        "kike",
        "faggot",
        "tranny",
        "retard",
        # Hate movements.
        "hitler",
        "nazi",
        "kkk",
        # Child safety. The one category worth being strict about.
        "pedo",
        "paedo",
        "childporn",
        # Hardcore sexual content.
        "fuck",
        "porn",
        "rape",
        "incest",
        "bestiality",
        "blowjob",
        "cumshot",
        # Impersonating MiKiNO itself.
        "mikinoteam",
        "mikinosupport",
        "mikinoadmin",
        "mikinostaff",
        "mikinohelp",
        "mikinoofficial",
    }
)

# Matched only as the entire normalised name. Impersonation of staff or the app,
# where the bare word is the problem and a compound using it is not.
_WHOLE_WORD_TERMS: frozenset[str] = frozenset(
    {
        "admin",
        "administrator",
        "moderator",
        "support",
        "staff",
        "official",
        "mikino",
    }
)

# Innocent words containing a listed substring, removed from the folded name
# before matching. Short by design — the list above is chosen so that few are
# needed. Worth extending whenever a real false positive turns up.
_ALLOWED_WORDS: tuple[str, ...] = (
    # `rape`
    "grape",
    "draper",  # a surname, and a television one
    "drape",
    "scrape",
    "trapez",
    # `pedo`
    "torpedo",
)


def normalize_for_filter(display_name: str) -> str:
    """Fold a username to the form the denylist is matched against.

    Exported for the tests, which assert the folding rather than only the
    outcome — a change here silently changes what the filter catches.
    """
    lowered = display_name.strip().lower().translate(_LEET_TRANSLATION)
    return _NON_LETTERS.sub("", lowered)


def is_display_name_objectionable(display_name: str | None) -> bool:
    """Whether this username must be refused."""
    if not display_name:
        return False
    normalized = normalize_for_filter(display_name)
    if not normalized:
        return False
    # Whole-word terms are checked against the unstripped name: stripping only
    # exists to protect substring matching from innocent host words.
    if normalized in _WHOLE_WORD_TERMS:
        return True
    stripped = normalized
    for allowed in _ALLOWED_WORDS:
        stripped = stripped.replace(allowed, "")
    return any(term in stripped for term in _SUBSTRING_TERMS)


def assert_display_name_allowed(display_name: str | None) -> None:
    """Raise if the username is objectionable.

    Raises:
        ObjectionableUsernameError: If the name is not allowed.
    """
    if is_display_name_objectionable(display_name):
        raise ObjectionableUsernameError
