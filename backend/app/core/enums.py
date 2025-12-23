from enum import Enum, unique


@unique
class GoingStatus(str, Enum):
    GOING = "going"
    NOT_GOING = "not_going"
    CONSIDERING = "considering"
