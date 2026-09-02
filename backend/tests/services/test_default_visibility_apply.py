"""Changing `default_visibility_mode` with and without applying it to the
showtimes the user has already selected.

Every showtime without an explicit setting tracks the account default live, so
switching the default silently rewrites who can see the user on all of them.
`apply_default_visibility_to_existing=False` is the "new showtimes only" answer
to the prompt that now precedes the switch: it must leave every already-selected
showtime running under the mode it had.
"""

from collections.abc import Callable

from sqlmodel import Session

from app.core.enums import GoingStatus, VisibilityMode
from app.crud import showtime_visibility as showtime_visibility_crud
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User, UserUpdate
from app.services import me as me_service
from app.utils import now_amsterdam_naive


def _select(
    session: Session,
    *,
    user: User,
    showtime: Showtime,
    going_status: GoingStatus = GoingStatus.GOING,
) -> None:
    session.add(
        ShowtimeSelection(
            user_id=user.id,
            showtime_id=showtime.id,
            going_status=going_status,
        )
    )
    session.flush()


def _effective_mode(
    session: Session, *, user: User, showtime: Showtime
) -> VisibilityMode:
    return showtime_visibility_crud.get_effective_modes_for_showtimes(
        session=session, owner_id=user.id, showtime_ids=[showtime.id]
    )[showtime.id]


def _set_default(
    session: Session,
    *,
    user: User,
    mode: VisibilityMode,
    apply_to_existing: bool | None,
) -> None:
    user_in = (
        UserUpdate(default_visibility_mode=mode)
        if apply_to_existing is None
        else UserUpdate(
            default_visibility_mode=mode,
            apply_default_visibility_to_existing=apply_to_existing,
        )
    )
    me_service.update_me(session=session, user_in=user_in, current_user=user)


def test_new_showtimes_only_keeps_selected_showtimes_on_the_old_mode(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    user = user_factory(default_visibility_mode=VisibilityMode.FRIENDS_OF_FRIENDS)
    selected = showtime_factory()
    unselected = showtime_factory()
    _select(db_transaction, user=user, showtime=selected)

    _set_default(
        db_transaction,
        user=user,
        mode=VisibilityMode.INVITED_ONLY,
        apply_to_existing=False,
    )

    assert (
        _effective_mode(db_transaction, user=user, showtime=selected)
        == VisibilityMode.FRIENDS_OF_FRIENDS
    )
    # Anything not already selected still picks up the new default.
    assert (
        _effective_mode(db_transaction, user=user, showtime=unselected)
        == VisibilityMode.INVITED_ONLY
    )


def test_apply_to_existing_moves_selected_showtimes_onto_the_new_mode(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    user = user_factory(default_visibility_mode=VisibilityMode.FRIENDS_OF_FRIENDS)
    selected = showtime_factory()
    _select(db_transaction, user=user, showtime=selected)

    _set_default(
        db_transaction,
        user=user,
        mode=VisibilityMode.INVITED_ONLY,
        apply_to_existing=True,
    )

    assert (
        _effective_mode(db_transaction, user=user, showtime=selected)
        == VisibilityMode.INVITED_ONLY
    )


def test_omitting_the_flag_applies_to_existing_showtimes(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    """Clients built before the prompt existed send no flag at all, and must
    keep the behaviour they were written against."""
    user = user_factory(default_visibility_mode=VisibilityMode.FRIENDS_OF_FRIENDS)
    selected = showtime_factory()
    _select(db_transaction, user=user, showtime=selected)

    _set_default(
        db_transaction,
        user=user,
        mode=VisibilityMode.ALL_FRIENDS,
        apply_to_existing=None,
    )

    assert (
        _effective_mode(db_transaction, user=user, showtime=selected)
        == VisibilityMode.ALL_FRIENDS
    )


def test_new_showtimes_only_leaves_explicit_per_showtime_choices_alone(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    user = user_factory(default_visibility_mode=VisibilityMode.FRIENDS_OF_FRIENDS)
    overridden = showtime_factory()
    _select(db_transaction, user=user, showtime=overridden)
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=db_transaction,
        owner_id=user.id,
        showtime_id=overridden.id,
        mode=VisibilityMode.INVITED_ONLY,
        now=now_amsterdam_naive(),
    )

    _set_default(
        db_transaction,
        user=user,
        mode=VisibilityMode.ALL_FRIENDS,
        apply_to_existing=False,
    )

    assert (
        _effective_mode(db_transaction, user=user, showtime=overridden)
        == VisibilityMode.INVITED_ONLY
    )


def test_new_showtimes_only_does_not_pin_showtimes_the_user_dropped(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    """NOT_GOING is not a showtime the user is going to or interested in, so it
    is not one of the ones being protected — it keeps tracking the default."""
    user = user_factory(default_visibility_mode=VisibilityMode.FRIENDS_OF_FRIENDS)
    not_going = showtime_factory()
    _select(
        db_transaction,
        user=user,
        showtime=not_going,
        going_status=GoingStatus.NOT_GOING,
    )

    _set_default(
        db_transaction,
        user=user,
        mode=VisibilityMode.ALL_FRIENDS,
        apply_to_existing=False,
    )

    assert (
        _effective_mode(db_transaction, user=user, showtime=not_going)
        == VisibilityMode.ALL_FRIENDS
    )


def test_has_selected_showtimes_reports_whether_the_prompt_is_worth_asking(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    """What the settings screen skips the prompt on: an account with nothing
    selected — or only showtimes it has said no to — has nothing to apply the
    new default to."""
    user = user_factory()
    assert not showtime_visibility_crud.has_selected_showtimes(
        session=db_transaction, owner_id=user.id
    )

    _select(
        db_transaction,
        user=user,
        showtime=showtime_factory(),
        going_status=GoingStatus.NOT_GOING,
    )
    assert not showtime_visibility_crud.has_selected_showtimes(
        session=db_transaction, owner_id=user.id
    )

    _select(
        db_transaction,
        user=user,
        showtime=showtime_factory(),
        going_status=GoingStatus.INTERESTED,
    )
    assert showtime_visibility_crud.has_selected_showtimes(
        session=db_transaction, owner_id=user.id
    )
