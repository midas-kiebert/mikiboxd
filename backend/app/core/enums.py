from enum import Enum, unique


@unique
class GoingStatus(str, Enum):
    GOING = "GOING"
    NOT_GOING = "NOT_GOING"
    INTERESTED = "INTERESTED"


@unique
class TimeOfDay(str, Enum):
    MORNING = "MORNING"
    AFTERNOON = "AFTERNOON"
    EVENING = "EVENING"
    NIGHT = "NIGHT"


@unique
class FilterPresetScope(str, Enum):
    SHOWTIMES = "SHOWTIMES"
    MOVIES = "MOVIES"
