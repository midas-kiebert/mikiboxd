"""Who a read is being performed for.

The catalogue — what is playing, where, and when — is public: it is the same
for everyone and needs no account to be useful. What sits *on top* of it is
personal: whether you are going, which of your friends are, who invited you,
what is on your Letterboxd watchlist. The read endpoints serve both at once,
annotating the public rows with whatever the requester is entitled to see.

`ViewerId` names the requester in that sentence. `None` is not an error or a
missing value to be defaulted — it is a legitimate viewer, an anonymous one,
who is entitled to the catalogue and to none of the annotations. Every query
and converter that takes one must therefore have a defined answer for `None`
rather than assuming an account exists:

  - personal annotations (going status, friends going, invites, seats) come
    back empty or at their neutral default, never omitted from the response;
  - filters that can only mean something to an account (a saved cinema preset,
    a Letterboxd list, "showtimes my friends are going to") are skipped, so an
    anonymous read is the unfiltered catalogue rather than an empty list.

Threading this instead of a `UUID` is what lets one code path serve both, which
matters because the two must never disagree about what is playing.
"""

from uuid import UUID

ViewerId = UUID | None
"""The account a read is annotated for, or ``None`` for an anonymous visitor."""
