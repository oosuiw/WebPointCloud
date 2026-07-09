#!/bin/bash
# 회귀 테스트 실행 스크립트.
#
# PYTEST_DISABLE_PLUGIN_AUTOLOAD=1: 이 워크스테이션의 ROS(autoware) 환경이
# PYTHONPATH에 launch_testing 등 pytest 플러그인을 자동 등록하는데, 최신
# pytest 훅 시그니처와 맞지 않아 크래시한다. 이 프로젝트 테스트에는 ROS
# 플러그인이 필요 없으므로 자동 로딩을 꺼서 우회한다.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3.11 -m pytest tests/ "$@"
