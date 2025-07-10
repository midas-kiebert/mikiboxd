from fastapi import APIRouter

router = APIRouter(tags=["test"], prefix="/test")

from app.models import Message

@router.get("/my-test")
async def my_test() -> Message:
    # wait for 1 second
    import asyncio
    await asyncio.sleep(1)
    return Message(message="Hi!")