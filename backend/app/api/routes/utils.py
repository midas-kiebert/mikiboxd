import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic.networks import EmailStr

from app.api.deps import get_current_active_superuser
from app.models.auth_schemas import Message
from app.utils import EmailDeliveryError, generate_test_email, send_email

router = APIRouter(prefix="/utils", tags=["utils"])
logger = logging.getLogger(__name__)


@router.post(
    "/test-email/",
    dependencies=[Depends(get_current_active_superuser)],
    status_code=201,
)
def test_email(email_to: EmailStr) -> Message:
    """
    Test emails.
    """
    email_data = generate_test_email(email_to=email_to)
    try:
        send_email(
            email_to=email_to,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    except EmailDeliveryError as e:
        logger.exception("Test email delivery failed for %s", email_to)
        raise HTTPException(
            status_code=502, detail=f"Could not deliver test email: {e}"
        ) from e
    return Message(message="Test email sent")


@router.get("/health-check/")
async def health_check() -> bool:
    return True
