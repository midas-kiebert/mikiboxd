from enum import Enum, unique


@unique
class GoingStatus(str, Enum):
    GOING = "GOING"
    NOT_GOING = "NOT_GOING"
    INTERESTED = "INTERESTED"
