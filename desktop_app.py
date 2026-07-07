#!/usr/bin/env python3
"""WebPointCloud 데스크톱 런처.

Flask 서버를 로컬 전용(127.0.0.1)으로 백그라운드 스레드에서 띄우고,
pywebview로 네이티브 창을 열어 표시한다. 브라우저 탭/주소창 없이
독립된 데스크톱 앱처럼 보인다.
"""
import os
import socket
import sys
import threading
import time
import urllib.request

_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _here)


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def _wait_for_server(port: int, timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    url = f'http://127.0.0.1:{port}/'
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=0.5)
            return True
        except Exception:
            time.sleep(0.1)
    return False


def main():
    port = _find_free_port()
    os.environ['WEB_PORT'] = str(port)

    from app import app  # noqa: E402  (import 시점에 config.WEB_PORT 등을 읽으므로 환경변수 설정 후 import)

    server_thread = threading.Thread(
        target=lambda: app.run(host='127.0.0.1', port=port, debug=False,
                                use_reloader=False, threaded=True),
        daemon=True,
    )
    server_thread.start()

    if not _wait_for_server(port):
        print(f'[desktop_app] 서버가 {port} 포트에서 응답하지 않습니다', file=sys.stderr)
        sys.exit(1)

    import webview
    webview.create_window(
        'WebPointCloud',
        f'http://127.0.0.1:{port}',
        width=1600, height=1000, min_size=(1024, 700),
    )
    webview.start()


if __name__ == '__main__':
    main()
