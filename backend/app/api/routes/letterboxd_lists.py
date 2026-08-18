"""Public Letterboxd-list routes.

The curated lists (Letterboxd's Top 250, the official year lists, and so on)
are not anyone's property: they are scraped once and shared by every user, the
same way the cinema list is. Filtering the catalogue by one is therefore a
browse action, not an account action, and it is served without a token.

The account-scoped half of this feature — the lists a user has added
themselves, and adding or removing them — stays on `/me/letterboxd-lists`,
because those *are* someone's property.
"""

from fastapi import APIRouter

from app.api.deps import SessionDep
from app.schemas.letterboxd_list import LetterboxdListPublic
from app.services import letterboxd_lists as letterboxd_lists_service

router = APIRouter(prefix="/letterboxd-lists", tags=["letterboxd-lists"])


@router.get("/curated", response_model=list[LetterboxdListPublic])
def get_curated_letterboxd_lists(
    session: SessionDep,
) -> list[LetterboxdListPublic]:
    return letterboxd_lists_service.list_curated_lists(session=session)
