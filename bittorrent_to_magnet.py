"""Convert .torrent files to magnet links (single file or batch)."""
import argparse
import hashlib
import sys
import urllib.parse
from pathlib import Path

import bencoding


def torrent_bytes_to_magnet(data: bytes) -> str:
    meta = bencoding.bdecode(data)

    if b"info" not in meta:
        raise ValueError("missing 'info' dictionary")

    info = meta[b"info"]
    info_hash = hashlib.sha1(bencoding.bencode(info)).hexdigest()

    params = [("xt", f"urn:btih:{info_hash}")]

    name = info.get(b"name")
    if name:
        params.append(("dn", name.decode("utf-8", errors="replace")))

    # Total length: single-file torrents store it directly,
    # multi-file torrents need summing each file's length.
    total_length = 0
    if b"length" in info:
        total_length = info[b"length"]
    elif b"files" in info:
        total_length = sum(f.get(b"length", 0) for f in info[b"files"])
    if total_length:
        params.append(("xl", str(total_length)))

    trackers = []
    if b"announce" in meta:
        trackers.append(meta[b"announce"].decode("utf-8", errors="replace"))
    for tier in meta.get(b"announce-list", []) or []:
        for tracker in tier:
            t = tracker.decode("utf-8", errors="replace")
            if t not in trackers:
                trackers.append(t)
    for tracker in trackers:
        params.append(("tr", tracker))

    query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    return f"magnet:?{query}"


def torrent_to_magnet(torrent_path: Path) -> str:
    return torrent_bytes_to_magnet(Path(torrent_path).read_bytes())


def iter_torrent_files(input_path: Path):
    if input_path.is_file():
        yield input_path
    elif input_path.is_dir():
        for entry in sorted(input_path.iterdir()):
            if entry.is_file() and entry.suffix.lower() == ".torrent":
                yield entry
    else:
        raise FileNotFoundError(input_path)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Convert .torrent files to magnet links (single file or batch)."
    )
    parser.add_argument(
        "input",
        help="Path to a .torrent file, or a directory containing .torrent files.",
    )
    parser.add_argument(
        "-o", "--output",
        help="Write magnet links to this file (default: stdout).",
    )
    args = parser.parse_args(argv)

    input_path = Path(args.input)
    out_stream = open(args.output, "w", encoding="utf-8") if args.output else sys.stdout

    converted = errors = 0
    try:
        for tf in iter_torrent_files(input_path):
            try:
                out_stream.write(torrent_to_magnet(tf) + "\n")
                converted += 1
            except Exception as e:
                errors += 1
                print(f"[error] {tf}: {e}", file=sys.stderr)
    finally:
        if args.output:
            out_stream.close()

    print(f"[done] converted {converted} torrent(s), {errors} error(s)", file=sys.stderr)
    return 1 if errors and not converted else 0


if __name__ == "__main__":
    sys.exit(main())
