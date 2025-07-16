#!/usr/bin/env bash

set -e
set -x

TESTING=true coverage run --source=app -m pytest
coverage report --show-missing
coverage html --title "${@-coverage}"
