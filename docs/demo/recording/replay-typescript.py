#!/usr/bin/env python3
"""Replay a ``script(1)`` typescript + timing pair. Pure stdlib, no util-linux.

Why this exists: ``scriptreplay`` ships with **util-linux**, which macOS does
not have. The repo's demo recordings were made on Linux, so the two files are
portable — but the documented way to play them back was not. This is a drop-in
for the playback half only: same two files, same ``--divisor`` semantics.

    python3 replay-typescript.py --divisor 8 <timing> <typescript>
    python3 replay-typescript.py --verify <timing> <typescript>

A ``script(1)`` typescript is three concatenated parts::

    <header>\\n          "Script started on ... [COMMAND=...]"
    <body>              exactly sum(counts) bytes — what the timing covers
    \\n<trailer>\\n       "Script done on ... [COMMAND_EXIT_CODE=...]"

``--verify`` reconstructs the body from the timing and compares it with the
file byte for byte. That is how the recordings in ``docs/demo/recording/``
were shown to be intact rather than truncated.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

HEADER = b"Script started on"
TRAILER = b"Script done on"


def split_typescript(raw: bytes) -> tuple[bytes, bytes, bytes]:
    """``(header, body, trailer)`` — the part the timing covers is ``body``."""
    if not raw.startswith(HEADER):
        raise SystemExit(
            "not a script(1) typescript: it does not start with "
            f"{HEADER!r}. If this is an asciinema .cast, play it with "
            "`asciinema play` instead."
        )
    nl = raw.find(b"\n")
    if nl < 0:
        raise SystemExit("malformed typescript: header line is not terminated")
    header_end = nl + 1
    # The trailer is the last "Script done on" line; a recording of a session
    # that itself printed that string is pathological, so take the last one.
    at = raw.rfind(b"\n" + TRAILER)
    if at < 0:
        raise SystemExit(
            "malformed typescript: no `Script done on ...` trailer — the "
            "recording was truncated (the recorder was killed mid-session)"
        )
    return raw[:header_end], raw[header_end:at], raw[at:]


def read_timing(path: Path) -> list[tuple[float, int]]:
    segments: list[tuple[float, int]] = []
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) != 2:
            raise SystemExit(f"{path}:{number}: expected `<delay> <count>`, got {line!r}")
        try:
            delay, count = float(parts[0]), int(parts[1])
        except ValueError:
            raise SystemExit(f"{path}:{number}: not a number pair: {line!r}") from None
        if delay < 0 or count < 0:
            raise SystemExit(f"{path}:{number}: negative delay/count: {line!r}")
        segments.append((delay, count))
    if not segments:
        raise SystemExit(f"{path}: no timing segments")
    return segments


def _slices(segments: list[tuple[float, int]], body: bytes):
    """Yield ``(delay, chunk)`` — each chunk is exactly the timed byte range."""
    offset = 0
    for delay, count in segments:
        yield delay, body[offset:offset + count]
        offset += count


def verify(segments: list[tuple[float, int]], header: bytes, body: bytes,
           trailer: bytes) -> None:
    rebuilt = b"".join(chunk for _, chunk in _slices(segments, body))
    covered = sum(count for _, count in segments)
    print(f"  header   {len(header):>8} bytes")
    print(f"  body     {len(body):>8} bytes   (timing covers {covered})")
    print(f"  trailer  {len(trailer):>8} bytes")
    print(f"  segments {len(segments):>8}")
    print(f"  duration {sum(d for d, _ in segments):>8.1f} s")
    if covered != len(body):
        raise SystemExit(
            f"  FAIL: timing covers {covered} bytes but the body is {len(body)} "
            f"— the pair does not belong together"
        )
    if rebuilt != body:
        raise SystemExit("  FAIL: reconstruction differs from the body")
    print("  OK: timing reconstructs the body byte for byte")


def replay(segments, body: bytes, *, divisor: float, trailer: bytes | None) -> None:
    out = sys.stdout.buffer
    for delay, chunk in _slices(segments, body):
        out.write(chunk)
        out.flush()
        time.sleep(delay / divisor)
    if trailer is not None:
        out.write(trailer)
        out.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("timing", type=Path)
    parser.add_argument("typescript", type=Path)
    parser.add_argument("--divisor", type=float, default=1.0,
                        help="divide every delay by this (same meaning as scriptreplay)")
    parser.add_argument("--verify", action="store_true",
                        help="check the pair byte for byte instead of playing it")
    parser.add_argument("--no-sleep", action="store_true",
                        help="play as fast as possible (for piping into a pager/CI)")
    parser.add_argument("--no-trailer", action="store_true",
                        help="do not print the `Script done ...` line at the end")
    args = parser.parse_args()

    if args.divisor <= 0:
        parser.error("--divisor must be > 0")
    raw = args.typescript.read_bytes()
    header, body, trailer = split_typescript(raw)
    segments = read_timing(args.timing)

    if args.verify:
        print(f"{args.typescript}  +  {args.timing}")
        verify(segments, header, body, trailer)
        return 0

    if args.no_sleep:
        args.divisor = float("inf")
    replay(segments, body, divisor=args.divisor,
           trailer=None if args.no_trailer else trailer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
