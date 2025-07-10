from typing import Any

from sqlmodel import Session, select

from app.core.security import get_password_hash, verify_password
from app.models import User, UserCreate, UserUpdate, FriendRequest, Friendship

from uuid import UUID


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).first()
    return session_user


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        return None
    if not verify_password(password, db_user.hashed_password):
        return None
    return db_user


def canonical_pair(a: UUID, b: UUID) -> tuple[UUID, UUID]:
    """
    Returns a canonical pair of UUIDs such that the first is always less than or equal to the second.
    This is useful for ensuring that friendships are stored in a consistent order.
    """
    return (a, b) if a < b else (b, a)


def add_friendship(*, session: Session, user_id: UUID, friend_id: UUID) -> None:
    if user_id == friend_id:
        raise ValueError("You cannot add yourself as a friend.")

    users = session.exec(
        select(User).where(
            (User.id == user_id) | (User.id == friend_id)
        )
    ).all()

    if len(users) != 2:
        raise ValueError("Both user and friend must be valid users.")

    user_1_id, user_2_id = canonical_pair(user_id, friend_id)
    existing_friendship = session.exec(
        select(Friendship).where(
            (Friendship.user_id == user_1_id) & (Friendship.friend_id == user_2_id)
        )
    ).first()
    if existing_friendship:
        raise ValueError("Friendship already exists between these users.")

    friendship = Friendship(user_id=user_1_id, friend_id=user_2_id)
    session.add(friendship)
    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise ValueError(f"Failed to add friendship: {str(e)}")


def accept_friend_request(*, session: Session, sender_id: UUID, receiver_id: UUID) -> None:
    request = session.exec(
        select(FriendRequest).where(
            (FriendRequest.sender_id == sender_id) & (FriendRequest.receiver_id == receiver_id)
        )
    ).first()
    if not request:
        raise ValueError("No friend request found between these users.")

    add_friendship(session=session, user_id=receiver_id, friend_id=sender_id)
    delete_friend_request(session=session, sender_id=sender_id, receiver_id=receiver_id)

    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise ValueError(f"Failed to accept friend request: {str(e)}")


def delete_friend_request(
        *,
        session: Session,
        sender_id: UUID,
        receiver_id: UUID
) -> None:
    request = session.exec(
        select(FriendRequest).where(
            (FriendRequest.sender_id == sender_id) & (FriendRequest.receiver_id == receiver_id)
        )
    ).first()
    if not request:
        raise ValueError("No friend request found between these users.")

    session.delete(request)

    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise ValueError(f"Failed to remove friend request: {str(e)}")


def send_friend_request(*, session: Session, sender_id: UUID, receiver_id: UUID) -> None:
    if sender_id == receiver_id:
        raise ValueError("You cannot send a friend request to yourself.")

    users = session.exec(
        select(User).where(
            (User.id == sender_id) | (User.id == receiver_id)
        )
    ).all()

    if len(users) != 2:
        raise ValueError("Both sender and receiver must be valid users.")

    existing_friendship = session.exec(
        select(Friendship).where(
            (Friendship.user_id == sender_id) & (Friendship.friend_id == receiver_id)
        )
    ).first()
    if existing_friendship:
        raise ValueError("Friendship already exists between these users.")

    existing_request = session.exec(
        select(FriendRequest).where(
            (FriendRequest.sender_id == sender_id) & (FriendRequest.receiver_id == receiver_id)
        )
    ).first()
    if existing_request:
        raise ValueError("Friend request already exists between these users.")

    existing_reverse_request = session.exec(
        select(FriendRequest).where(
            (FriendRequest.sender_id == receiver_id) & (FriendRequest.receiver_id == sender_id)
        )
    ).first()
    if existing_reverse_request:
        raise ValueError("A friend request has already been sent in the reverse direction.")

    friend_request = FriendRequest(sender_id=sender_id, receiver_id=receiver_id)
    session.add(friend_request)

    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise ValueError(f"Failed to send friend request: {str(e)}")


def delete_friendship(*, session: Session, user_id: UUID, friend_id: UUID) -> None:
    user_1_id, user_2_id = canonical_pair(user_id, friend_id)
    friendship = session.exec(
        select(Friendship).where(
            (Friendship.user_id == user_1_id) & (Friendship.friend_id == user_2_id)
        )
    ).first()
    if not friendship:
        raise ValueError("Friendship does not exist between these users.")

    session.delete(friendship)

    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise ValueError(f"Failed to delete friendship: {str(e)}")


def get_friends(*, session: Session, user_id: UUID) -> list[User]:
    friends = session.exec(
        select(Friendship).where(
            (Friendship.user_id == user_id) | (Friendship.friend_id == user_id)
        )
    ).all()

    friend_ids = set()
    for friendship in friends:
        if friendship.user_id != user_id:
            friend_ids.add(friendship.user_id)
        if friendship.friend_id != user_id:
            friend_ids.add(friendship.friend_id)

    return session.exec(select(User).where(User.id.in_(friend_ids))).all()


def get_sent_friend_requests(*, session: Session, user_id: UUID) -> list[User]:
    requests = session.exec(
        select(FriendRequest).where(FriendRequest.sender_id == user_id)
    ).all()
    receiver_ids = [request.receiver_id for request in requests]
    return session.exec(select(User).where(User.id.in_(receiver_ids))).all()


def get_received_friend_requests(*, session: Session, user_id: UUID) -> list[User]:
    requests = session.exec(
        select(FriendRequest).where(FriendRequest.receiver_id == user_id)
    ).all()
    sender_ids = [request.sender_id for request in requests]
    return session.exec(select(User).where(User.id.in_(sender_ids))).all()


def search_users(
    *, session: Session, query: str, limit: int = 10, offset: int = 0
) -> list[User]:
    """
    Search for users by email or username.
    """
    statement = (
        select(User)
        .where(
            (User.display_name.ilike(f"%{query}%"))
        )
        .limit(limit)
        .offset(offset)
    )
    return session.exec(statement).all(
)