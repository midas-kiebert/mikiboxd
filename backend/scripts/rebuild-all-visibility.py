"""Rebuild the ShowtimeVisibilityEffective cache for every user.

Needed after friendship rows are written directly via SQL (bypassing
app.crud.friendship, which normally triggers this rebuild per friend-add),
and after any change to the rules in `crud.showtime_visibility` themselves:
the table is a cache of those rules, and rows already written under the old
ones are only recomputed when something happens to touch them. Until this
runs, a stale row keeps granting visibility the current rules would refuse —
which is a privacy leak, not just a stale read, so treat it as part of
deploying such a change rather than as cleanup.
"""

from sqlmodel import select

from app.api.deps import get_db_context
from app.crud.showtime_visibility import rebuild_effective_visibility_for_owner
from app.models.user import User

with get_db_context() as session:
    user_ids = session.exec(select(User.id)).all()
    for user_id in user_ids:
        rebuild_effective_visibility_for_owner(session=session, owner_id=user_id)
    session.commit()
    print(f"Rebuilt visibility cache for {len(user_ids)} users")
