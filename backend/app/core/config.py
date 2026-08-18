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
from typing import Annotated, Any

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

from app.core.client_version import parse_version
from app.core.enums import Environment


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
    ENVIRONMENT: Environment = Environment.LOCAL
    DEBUG: bool = False

    # Set by scripts/test.sh. Forces emails_enabled off so the test suite never
    # sends real mail through whatever SMTP creds happen to be in .env.
    TESTING: bool = False

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

    # Short-lived access tokens limit the damage of a stolen token. Clients use
    # a long-lived refresh token (below) to silently mint new access tokens via
    # POST /login/refresh-token, so users are not forced to re-login.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30  # 30 minutes

    # Refresh tokens are long-lived and re-issued on every refresh (sliding
    # window), so an actively-used client effectively never logs out; an idle
    # client only re-authenticates after this window lapses.
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 90  # 90 days

    # Whether the app may offer the watchlist digest to users who have never
    # turned it on (see `show_watchlist_digest_tip` on /me). Off: the feature
    # works and is reachable in Settings, but nothing advertises it, so it can
    # be lived with for a while before being pointed at everyone. Flipping this
    # env var is the whole switch — no client release involved.
    WATCHLIST_DIGEST_TIP_ENABLED: bool = False

    # How long password-reset links stay valid
    EMAIL_RESET_TOKEN_EXPIRE_HOURS: int = 48

    # How long "confirm your email" links stay valid. Longer than a reset link:
    # nothing prompts the user to act on it, so it has to survive a weekend in
    # an unread inbox. Expiring one is not a dead end either — the app can ask
    # for a fresh one (POST /me/resend-verification).
    EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS: int = 24 * 14

    # Bearer key for the read-only /monitor/scrape/* routes (scrape-run/recap
    # health data for machine consumers, e.g. an unattended monitoring agent,
    # that can't hold a user JWT). Unset means those routes refuse every
    # request rather than falling open.
    SCRAPE_MONITOR_API_KEY: str | None = None

    # -------------------------------------------------------------------------
    # Social sign-in
    # -------------------------------------------------------------------------

    # The app's bundle ID — native Sign in with Apple issues identity tokens
    # with this as the `aud` claim (no separate OAuth client is needed).
    APPLE_CLIENT_ID: str = "com.midaskiebert.mikino"

    # Credentials for Apple's token endpoints, needed only to *revoke* a user's
    # Sign in with Apple tokens when they delete their account — which Apple
    # requires of any app offering Sign in with Apple (guideline 5.1.1(v) and
    # https://developer.apple.com/support/offering-account-deletion-in-your-app/).
    #
    # All three come from the Apple Developer portal: the team ID, the key ID of
    # a "Sign in with Apple" private key, and the contents of that key's .p8
    # file (PEM, newlines intact — in an env var, "\n" escapes are accepted and
    # unescaped by `apple_client_secret`).
    #
    # Unset by default, and unset means revocation is skipped with a warning
    # rather than blocking the deletion: a user asking to delete their account
    # must always succeed, whatever Apple's endpoint is doing.
    APPLE_TEAM_ID: str | None = None
    APPLE_KEY_ID: str | None = None
    APPLE_PRIVATE_KEY: str | None = None

    @property
    def apple_token_revocation_configured(self) -> bool:
        return bool(self.APPLE_TEAM_ID and self.APPLE_KEY_ID and self.APPLE_PRIVATE_KEY)

    # Accepted audiences for Google ID tokens: the iOS, Android, and Web OAuth
    # client IDs from Google Cloud Console. The mobile app requests an ID token
    # scoped to the Web client (`webClientId`), so that one is the one that
    # actually appears as `aud` — but all are accepted since GoogleSignin
    # configuration variants can vary this.
    GOOGLE_CLIENT_IDS: Annotated[list[str] | str, BeforeValidator(_parse_cors)] = []

    # -------------------------------------------------------------------------
    # CORS
    # -------------------------------------------------------------------------

    # Which origins are allowed to make cross-origin requests to the API.
    # The FRONTEND_HOST is always included automatically (see all_cors_origins).
    FRONTEND_HOST: str = "http://localhost:5173"
    # Used by the backend to generate absolute links to itself in emails
    # (e.g. one-click unsubscribe links, which must hit the API directly).
    API_HOST: str = "http://localhost:8000"
    # Used by the backend to generate customer-facing links in emails (e.g. the
    # watchlist digest's movie links). Unlike FRONTEND_HOST, which points at the
    # admin dashboard, this points at the public marketing/app site.
    PUBLIC_HOST: str = "http://localhost:5173"
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

    # -------------------------------------------------------------------------
    # Monitoring & Notifications
    # -------------------------------------------------------------------------

    SENTRY_DSN: HttpUrl | None = None  # Set this to enable Sentry error tracking

    TELEGRAM_USER_ID: int | None = None
    TELEGRAM_BOT_TOKEN: str | None = None
    ENABLE_TELEGRAM: bool = False

    # -------------------------------------------------------------------------
    # Client version gate
    # -------------------------------------------------------------------------

    # Lowest mobile app `version` (from app.json, sent as X-Client-Version) still
    # allowed to call the API. Requests from an older native build get a 426
    # Upgrade Required instead of hitting routes they don't understand — see
    # app/core/client_version.py. `None` disables the gate for that platform
    # (every version is accepted), which is the default so this stays inert
    # until a breaking mobile change actually needs it.
    #
    # Per-platform on purpose: App Store review runs to weeks where Play review
    # runs to a day, so the two floors are never raised at the same moment and
    # a shared setting would force the faster store to wait for the slower one.
    # Raise each one only once that platform's release is actually installed —
    # the X-Client-Version header on live traffic is what tells you, not the
    # store listing, since an approved build still takes days to roll out.
    MIN_SUPPORTED_CLIENT_VERSION_IOS: str | None = None
    MIN_SUPPORTED_CLIENT_VERSION_ANDROID: str | None = None

    # Store links surfaced in the 426 response so the app can deep-link straight
    # to the update instead of hardcoding store URLs into the client.
    APP_STORE_URL_IOS: HttpUrl | None = None
    APP_STORE_URL_ANDROID: HttpUrl | None = HttpUrl(
        "https://play.google.com/store/apps/details?id=com.midaskiebert.mikino"
    )

    @field_validator(
        "MIN_SUPPORTED_CLIENT_VERSION_IOS", "MIN_SUPPORTED_CLIENT_VERSION_ANDROID"
    )
    @classmethod
    def _validate_min_supported_client_version(cls, value: str | None) -> str | None:
        if value is not None:
            parse_version(value)  # raises ValueError if malformed
        return value

    # -------------------------------------------------------------------------
    # Response compression
    # -------------------------------------------------------------------------

    # GZip middleware compresses JSON responses on the wire — typical payloads
    # shrink 5–10x at compresslevel=6 (the standard CPU/bandwidth tradeoff).
    ENABLE_GZIP: bool = True
    GZIP_MINIMUM_SIZE_BYTES: int = 500  # Don't compress tiny responses
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
            if self.ENVIRONMENT is Environment.LOCAL:
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
