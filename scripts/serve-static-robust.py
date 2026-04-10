#!/usr/bin/env python3
"""
本地静态站：行为接近 `python -m http.server`，但在客户端提前断开时
不抛出 ConnectionAbortedError / WinError 10053 等噪声（Windows 上常见）。

在仓库根执行：
  python scripts/serve-static-robust.py 8080
"""
from __future__ import annotations

import argparse
import errno
import http.server
import socketserver
import sys


def _is_client_abort(exc: BaseException) -> bool:
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
        return True
    if isinstance(exc, OSError):
        if exc.errno in (errno.EPIPE, errno.ECONNRESET):
            return True
        if sys.platform == "win32" and getattr(exc, "winerror", None) == 10053:
            return True
    return False


class RobustHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def handle(self) -> None:
        try:
            super().handle()
        except BaseException as e:
            if _is_client_abort(e):
                return
            raise

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except BaseException as e:
            if _is_client_abort(e):
                return
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Static HTTP server with quiet client disconnects.")
    parser.add_argument(
        "port",
        nargs="?",
        type=int,
        default=8080,
        help="Listen port (default 8080)",
    )
    parser.add_argument(
        "--bind",
        default="",
        metavar="ADDRESS",
        help="Bind address (default all interfaces, same as http.server)",
    )
    args = parser.parse_args()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((args.bind, args.port), RobustHTTPRequestHandler) as httpd:
        host = args.bind or "0.0.0.0"
        print(f"Serving HTTP on {host} port {args.port} (robust client disconnects) ...", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nKeyboard interrupt received, quitting.", flush=True)
            sys.exit(0)


if __name__ == "__main__":
    main()
