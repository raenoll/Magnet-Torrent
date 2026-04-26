# Magnet-Torrent

Two ways to convert between BitTorrent `.torrent` files and magnet links:

- **Web app** (this repo's `index.html`) — pure browser, zero dependencies.
  Open it locally or host on GitHub Pages. Only does **torrent → magnet**;
  see *Why no magnet → torrent in the browser?* below.
- **Python CLI** — both directions; reverse needs `libtorrent`.

## Web app

Open `index.html` in any modern browser, or serve the directory:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Drop one or more `.torrent` files (or click to pick). Magnet links appear
in the textbox; copy them or download as a `.txt`. Files are parsed
locally with the Web Crypto API — nothing is uploaded.

The generated magnet links include `xt` (info hash), `dn` (display name),
`xl` (total length, summed for multi-file torrents) and every `tr`
(trackers from `announce` + `announce-list`, deduped).

### Why no magnet → torrent in the browser?

A magnet link only carries the info_hash. To turn it back into a real
`.torrent` you have to join the swarm and download the metadata over TCP
or uTP (BEP-9). Browsers can't open raw sockets, so this direction needs
a native client. Use the CLI below.

## Python CLI

```sh
pip install -r requirements.txt
# libtorrent is only needed for magnet → torrent; on Debian/Ubuntu
# `sudo apt install python3-libtorrent` works better than pip.
```

### Torrent → magnet

```sh
python bittorrent_to_magnet.py path/to/file.torrent
python bittorrent_to_magnet.py ./torrents -o magnets.txt
```

### Magnet → torrent

```sh
python magnet_to_bittorrent.py "magnet:?xt=urn:btih:..." -o ./out
python magnet_to_bittorrent.py magnets.txt -o ./out -t 120
```

Joins the swarm via DHT/peers and downloads metadata (BEP-9), then writes
a real `.torrent` file. Needs network access and live peers.
