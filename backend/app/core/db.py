from sqlmodel import Session, create_engine, select

from app.core.config import settings
from app.crud import user as user_crud
from app.models.user import User, UserCreate

engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))
test_engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI_TEST))


# make sure all SQLModel models are imported (app.models) before initializing DB
# otherwise, SQLModel might fail to initialize relationships properly
# for more details: https://github.com/fastapi/full-stack-fastapi-template/issues/28


def init_db(session: Session) -> None:
    # Tables should be created with Alembic migrations
    # But if you don't want to use migrations, create
    # the tables un-commenting the next lines
    # from sqlmodel import SQLModel

    # This works because the models are already imported and registered from app.models
    # SQLModel.metadata.create_all(engine)

    user = session.exec(
        select(User).where(User.email == settings.FIRST_SUPERUSER)
    ).first()
    if not user:
        user_in = UserCreate(
            email=settings.FIRST_SUPERUSER,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            is_superuser=True,
        )
        user = user_crud.create_user(session=session, user_create=user_in)
    test_user = session.exec(
        select(User).where(User.email == settings.EMAIL_TEST_USER)
    ).first()
    if not test_user:
        test_user_in = UserCreate(
            email=settings.EMAIL_TEST_USER,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            is_superuser=False,
        )
        test_user = user_crud.create_user(session=session, user_create=test_user_in)

    session.commit()
