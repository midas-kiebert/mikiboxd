#!/bin/bash

branch="$(git symbolic-ref --short HEAD 2>/dev/null)"

if [[ "$branch" == "master" ]]; then
  echo "🚫 You cannot commit directly to master. Please create a feature branch."
  exit 1
fi
