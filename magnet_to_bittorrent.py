"""Fetch .torrent files for magnet URIs by joining the swarm via libtorrent.

A magnet link only carries the info_hash (and optionally name/trackers); the
real torrent metadata (file list, piece hashes) lives with peers and must be
downloaded via the BEP-9 ut_metadata extension. This script does exactly that.
"""
import argparse
import re
import sys
import time
from pathlib import Path

try:
    import libtorrent as lt
except ImportError:
    sys.stderr.write(
        "This module requires the python 'libtorrent' binding.\n"
        "  Debian/Ubuntu: sudo apt install python3-libtorrent\n"
        "  pip:           pip install libtorrent\n"
    )
    raise


_INVALID_FS_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_filename(name: str) -> str:
    cleaned = _INVALID_FS_CHARS.sub("_", name).strip(" .")
    return cleaned or "torrent"


def _make_session() -> "lt.session":
    session = lt.session()
    session.listen_on(6881, 6891)
    # Bootstrap DHT so we can find peers without trackers.
    for host, port in [
        ("router.bittorrent.com", 6881),
        ("router.utorrent.com", 6881),
        ("dht.transmissionbt.com", 6881),
    ]:
        session.add_dht_router(host, port)
    session.start_dht()
    return session


def _add_magnet(session: "lt.session", magnet: str, save_path: Path):
    """Wrap libtorrent's API differences across versions."""
    if hasattr(lt, "parse_magnet_uri"):
        params = lt.parse_magnet_uri(magnet)
        if isinstance(params, dict):
            params["save_path"] = str(save_path)
            return session.add_torrent(params)
        params.save_path = str(save_path)
        return session.add_torrent(params)
    return lt.add_magnet_uri(session, magnet, {"save_path": str(save_path)})


def magnet_to_torrent_bytes(magnet: str, timeout: int = 60) -> tuple[str, bytes]:
    """Fetch metadata for a magnet URI and return (filename, .torrent bytes)."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        session = _make_session()
        handle = _add_magnet(session, magnet, Path(tmp))
        try:
            deadline = time.time() + timeout
            while not handle.has_metadata():
                if time.time() > deadline:
                    raise TimeoutError(f"metadata fetch timed out after {timeout}s")
                time.sleep(1)
            info = handle.get_torrent_info()
            creator = lt.create_torrent(info)
            torrent_data = lt.bencode(creator.generate())
            return f"{_safe_filename(info.name())}.torrent", torrent_data
        finally:
            try:
                session.remove_torrent(handle)
            except Exception:
                pass


def magnet_to_torrent(magnet: str, out_dir: Path, timeout: int = 60) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    name, data = magnet_to_torrent_bytes(magnet, timeout=timeout)
    out_path = out_dir / name
    out_path.write_bytes(data)
    return out_path


def iter_magnets(input_arg: str):
    """Yield magnet URIs from a literal URI or a file with one URI per line."""
    if input_arg.startswith("magnet:?"):
        yield input_arg
        return
    path = Path(input_arg)
    if not path.exists():
        raise FileNotFoundError(input_arg)
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                yield line


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Fetch .torrent files for magnet URIs via libtorrent."
    )
    parser.add_argument(
        "input",
        help="A magnet URI, or a path to a text file with one URI per line.",
    )
    parser.add_argument(
        "-o", "--output-dir", default=".",
        help="Directory to write .torrent files into (default: cwd).",
    )
    parser.add_argument(
        "-t", "--timeout", type=int, default=60,
        help="Per-URI metadata fetch timeout in seconds (default: 60).",
    )
    args = parser.parse_args(argv)

    out_dir = Path(args.output_dir)
    saved = errors = 0
    for magnet in iter_magnets(args.input):
        try:
            path = magnet_to_torrent(magnet, out_dir, timeout=args.timeout)
            print(f"[ok] {path}")
            saved += 1
        except Exception as e:
            errors += 1
            print(f"[error] {magnet[:80]}: {e}", file=sys.stderr)

    print(f"[done] saved {saved} torrent(s), {errors} error(s)", file=sys.stderr)
    return 1 if errors and not saved else 0


if __name__ == "__main__":
    sys.exit(main())
