from datetime import datetime

DUTCH_WEEKDAYS = {
    "ma": 0, "di": 1, "wo": 2, "do": 3,
    "vr": 4, "za": 5, "zo": 6,
}

DUTCH_MONTHS = {
    "jan": 1, "feb": 2, "mrt": 3, "apr": 4,
    "mei": 5, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "okt": 10, "nov": 11, "dec": 12,
}

def get_closest_exact_date(dutch_date_str: str, search_years: int = 1) -> datetime:
    """
    Parse 'wo 8 mei 19:30' and return the closest datetime (past or future)
    with matching weekday, day, month, and time.
    """
    parts = dutch_date_str.strip().split()
    if len(parts) != 4:
        raise ValueError("Expected format: '<weekday> <day> <month> <HH:MM>'")

    weekday_str, day_str, month_str, time_str = parts
    weekday_target = DUTCH_WEEKDAYS.get(weekday_str.lower())
    month_target = DUTCH_MONTHS.get(month_str.lower())

    if weekday_target is None or month_target is None:
        raise ValueError(f"Unknown weekday or month: {weekday_str}, {month_str}")

    try:
        day = int(day_str)
        hour, minute = map(int, time_str.split(":"))
    except ValueError:
        raise ValueError(f"Invalid day or time: {weekday_str}, {day_str}, {month_str} {time_str}")

    now = datetime.now()
    best_match = None
    min_diff = None

    for delta_year in range(-search_years, search_years + 1):
        year = now.year + delta_year

        try:
            candidate = datetime(year, month_target, day, hour, minute)
        except ValueError:
            continue  # Skip invalid dates like Feb 30

        if candidate.weekday() != weekday_target:
            continue  # Weekday doesn't match

        diff = abs((candidate - now).total_seconds())
        if min_diff is None or diff < min_diff:
            min_diff = diff
            best_match = candidate

    if not best_match:
        raise ValueError(f"Invalid day or time: {weekday_str}, {day_str}, {month_str} {time_str}")

    return best_match