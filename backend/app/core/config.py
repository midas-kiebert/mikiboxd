"""Application configuration.

All settings are read from environment variables (or the root `.env` file).
Pydantic Settings handles type coercion and validation automatically, so if a
required variable is missing or has the wrong type, the app will refuse to start
with a clear error message.

Usage:
    from app.core.config import settings
    print(settings.POSTGRES_SERVER)

Environment variables are declared as class fields. Computed fields (marked with
@computed_field) are derived values that are built from other fields at runtime.
"""

import secrets
import warnings
from typing import Annotated, Any, Literal

from pydantic import (
    AnyUrl,
    BeforeValidator,
    EmailStr,
    HttpUrl,
    PostgresDsn,
    computed_field,
    field_validator,
    model_validator,
)
from pydantic_core import MultiHostUrl
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing_extensions import Self


def _parse_cors(v: Any) -> list[str] | str:
    """Accept CORS origins as either a comma-separated string or a JSON list.

    This is needed because environment variables are always strings, so a list
    of origins must be encoded as either:
      - A comma-separated string: "http://localhost:3000,https://example.com"
      - A JSON array string:      '["http://localhost:3000"]'
    """
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",")]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Read from the root .env file, one level above /backend/
        env_file="../.env",
        # Silently ignore empty strings instead of treating them as values
        env_ignore_empty=True,
        # Don't fail on extra environment variables that aren't declared here
        extra="ignore",
    )

    # -------------------------------------------------------------------------
    # General
    # -------------------------------------------------------------------------

    PROJECT_NAME: str
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: Literal["local", "staging", "production"] = "local"
    DEBUG: bool = False

    @field_validator("DEBUG", mode="before")
    @classmethod
    def _normalize_debug_aliases(cls, value: Any) -> Any:
        """Allow the strings "debug" and "release" as aliases for True/False.

        Some deployment pipelines set DEBUG=release or DEBUG=debug rather than
        a boolean. This validator normalises those aliases.
        """
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized == "release":
                return False
            if normalized == "debug":
                return True
        return value

    # -------------------------------------------------------------------------
    # Authentication & Security
    # -------------------------------------------------------------------------

    # This key is used to sign JWT tokens. It defaults to a random value on
    # startup, which means tokens are invalidated on every restart in local dev.
    # In production, set this to a stable secret via the environment.
    SECRET_KEY: str = secrets.token_urlsafe(32)

    # TODO: Reduce this once refresh tokens are implemented. Long-lived access
    # tokens are a security risk — a stolen token stays valid for 90 days.
    # The proper fix is short-lived access tokens (e.g. 15 min) paired with a
    # longer-lived refresh token that issues new access tokens.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 90  # 90 days

    # How long password-reset links stay valid
    EMAIL_RESET_TOKEN_EXPIRE_HOURS: int = 48

    # -------------------------------------------------------------------------
    # CORS
    # -------------------------------------------------------------------------

    # Which origins are allowed to make cross-origin requests to the API.
    # The FRONTEND_HOST is always included automatically (see all_cors_origins).
    FRONTEND_HOST: str = "http://localhost:5173"
    BACKEND_CORS_ORIGINS: Annotated[
        list[AnyUrl] | str, BeforeValidator(_parse_cors)
    ] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def all_cors_origins(self) -> list[str]:
        """Combines BACKEND_CORS_ORIGINS with FRONTEND_HOST into one list.

        The trailing slash is stripped because browsers send origins without it,
        and a mismatch would cause CORS requests to be rejected.
        """
        return [str(origin).rstrip("/") for origin in self.BACKEND_CORS_ORIGINS] + [
            self.FRONTEND_HOST
        ]

    # -------------------------------------------------------------------------
    # Database
    # -------------------------------------------------------------------------

    POSTGRES_SERVER: str
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = ""

    # Connection pool settings. The pool keeps `pool_size` persistent connections
    # open. Under heavy load it can open up to `pool_size + max_overflow` total.
    # Connections idle for longer than `pool_recycle` seconds are replaced to
    # avoid using stale connections that the server has closed.
    SQLALCHEMY_POOL_SIZE: int = 20
    SQLALCHEMY_MAX_OVERFLOW: int = 20
    SQLALCHEMY_POOL_TIMEOUT_SECONDS: int = 30
    SQLALCHEMY_POOL_RECYCLE_SECONDS: int = 1800
    # Pre-ping sends a lightweight query before handing a connection to a route,
    # ensuring the connection is still alive. Slight overhead, but prevents errors
    # caused by the DB closing idle connections.
    SQLALCHEMY_POOL_PRE_PING: bool = True

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
        """The full PostgreSQL connection URI, built from the individual POSTGRES_* vars."""
        return MultiHostUrl.build(
            scheme="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_DATABASE_URI_TEST(self) -> PostgresDsn:
        """Same as SQLALCHEMY_DATABASE_URI but points to a separate test database.

        The test database name is the main database name with a `_test` suffix.
        This is used by the test suite so that tests never touch production data.
        """
        return MultiHostUrl.build(
            scheme="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=f"{self.POSTGRES_DB}_test",
        )

    # -------------------------------------------------------------------------
    # Email / SMTP
    # -------------------------------------------------------------------------

    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_TIMEOUT_SECONDS: float = 20.0

    # The "From" address and display name used on all outgoing emails
    EMAILS_FROM_EMAIL: EmailStr | None = None
    EMAILS_FROM_NAME: str | None = None  # Display name, not an email address

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        """Fall back to PROJECT_NAME as the email sender display name."""
        if not self.EMAILS_FROM_NAME:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def emails_enabled(self) -> bool:
        """True only when both an SMTP host and a From address are configured."""
        return bool(self.SMTP_HOST and self.EMAILS_FROM_EMAIL)

    # -------------------------------------------------------------------------
    # Scraping & Integrations
    # -------------------------------------------------------------------------

    TMDB_KEY: str  # API key for The Movie Database

    # How many days to keep past showtimes in the database before pruning them
    SHOWTIME_RETENTION_DAYS: int = 1

    # How many days to wait before re-syncing a user's Letterboxd watchlist
    LETTERBOXD_LAST_WATCHLIST_SYNC_RETENTION_DAYS: int = 1

    # Timeout for sending the post-scrape recap email
    SCRAPE_RECAP_EMAIL_TIMEOUT_SECONDS: float = 120.0

    # -------------------------------------------------------------------------
    # Monitoring & Notifications
    # -------------------------------------------------------------------------

    SENTRY_DSN: HttpUrl | None = None  # Set this to enable Sentry error tracking

    TELEGRAM_USER_ID: int | None = None
    TELEGRAM_BOT_TOKEN: str | None = None
    ENABLE_TELEGRAM: bool = False

    # -------------------------------------------------------------------------
    # Performance
    # -------------------------------------------------------------------------

    # GZip-compress HTTP responses larger than GZIP_MINIMUM_SIZE_BYTES.
    # Level 6 is the default zlib balance between speed and compression ratio.
    ENABLE_GZIP: bool = True
    GZIP_MINIMUM_SIZE_BYTES: int = 500
    GZIP_COMPRESS_LEVEL: int = 6

    # -------------------------------------------------------------------------
    # First-run / Seeding
    # -------------------------------------------------------------------------

    # These credentials are used to create the initial superuser on first startup.
    FIRST_SUPERUSER: EmailStr
    FIRST_SUPERUSER_PASSWORD: str

    # Used as the recipient address when sending test emails during development
    EMAIL_TEST_USER: EmailStr = "test@example.com"

    # -------------------------------------------------------------------------
    # Secret validation
    # -------------------------------------------------------------------------

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        """Warn or error if a sensitive setting still has the placeholder value.

        In local development a warning is logged so the app still starts.
        In staging and production the app refuses to start entirely.
        """
        if value == "changethis":
            message = (
                f'The value of {var_name} is "changethis", '
                "for security, please change it, at least for deployments."
            )
            if self.ENVIRONMENT == "local":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        self._check_default_secret("SECRET_KEY", self.SECRET_KEY)
        self._check_default_secret("POSTGRES_PASSWORD", self.POSTGRES_PASSWORD)
        self._check_default_secret(
            "FIRST_SUPERUSER_PASSWORD", self.FIRST_SUPERUSER_PASSWORD
        )
        return self


# The single shared settings instance used throughout the application.
# Import this wherever settings are needed:
#   from app.core.config import settings
settings = Settings()  # type: ignore
