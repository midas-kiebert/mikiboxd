import os
import sys
from datetime import datetime
from typing import Any

import pytz
import requests
from loguru import logger
from loguru._logger import Logger

from app.core.config import settings

os.environ["TZ"] = "Europe/Amsterdam"


def dynamic_formatter(record: Any) -> str:
    base = "[{time:HH:mm:ss}] [{level}] {module}:{function}:{line} - {message}"

    extras = record.get("extra", {})
    if extras:
        base += " ("
        for key, value in extras.items():
            base += f"{key}={value}, "
        base += ")\n"
    else:
        base += "\n"

    if record["exception"]:
        base += "{exception}"

    return base


def dynamic_console_formatter(record: Any) -> str:
    base = "[<green>{time:HH:mm:ss}</green>] <level>[{level}]</level> {module}:{function}:<blue>{line}</blue> - {message}\n"

    if record["exception"]:
        base += "{exception}"

    return base


def notify_on_error(message: Any) -> None:
    record = message.record
    text = f"Error in {record['module']}:{record['function']} at line {record['line']}\n\n{record['message']}"

    requests.post(
        f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage",
        data={
            "chat_id": settings.TELEGRAM_USER_ID,
            "text": text,
        },
    )


def setup_logger(name: str, log_dir: str = "app/logs") -> Logger:
    today = datetime.now(pytz.timezone("Europe/Amsterdam")).strftime("%Y-%m-%d")
    log_path = os.path.join(log_dir, today, name)
    os.makedirs(log_path, exist_ok=True)

    log_file_debug = os.path.join(log_path, "debug.log")
    log_file_errors = os.path.join(log_path, "error.log")
    log_file_trace = os.path.join(log_path, "trace.log")
    log_file_info = os.path.join(log_path, "info.log")

    logger.remove()  # Remove default handler

    if settings.DEBUG:
        logger.add(
            log_file_trace,
            format=dynamic_formatter,
            level="TRACE",
            rotation="00:00",  # Rotate daily at midnight
            compression="zip",  # Compress rotated logs
            enqueue=True,
            backtrace=True,
            diagnose=True,
            retention="3 days",  # Keep logs for 3 days
        )

        logger.add(
            log_file_debug,
            format=dynamic_formatter,
            level="DEBUG",
            rotation="00:00",  # Rotate daily at midnight
            compression="zip",  # Compress rotated logs
            enqueue=True,
            backtrace=True,
            diagnose=True,
            retention="7 days",  # Keep debug logs for 7 days
        )

    logger.add(
        log_file_errors,
        format=dynamic_formatter,
        level="ERROR",
        rotation="00:00",  # Rotate daily at midnight
        compression="zip",  # Compress rotated logs
        enqueue=True,
        backtrace=True,
        diagnose=True,
        retention="30 days",
    )

    logger.add(
        log_file_info,
        format=dynamic_formatter,
        level="INFO",
        rotation="00:00",  # Rotate daily at midnight
        compression="zip",  # Compress rotated logs
        enqueue=True,
        backtrace=True,
        diagnose=True,
    )

    logger.add(
        sys.stderr,
        format=dynamic_console_formatter,
        level="DEBUG" if settings.DEBUG else "INFO",
        enqueue=True,
        backtrace=True,
        diagnose=True,
        colorize=True,
    )

    if settings.ENABLE_TELEGRAM:
        logger.add(notify_on_error, level="ERROR")

    return logger  # type: ignore
