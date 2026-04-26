# Magnet-Torrent

Batch conversion between BitTorrent `.torrent` files and magnet links — as
CLI scripts and as a small Flask web app.

## Install

```sh
pip install -r requirements.txt
```

`libtorrent` is only needed for the magnet → torrent direction. On
Debian/Ubuntu the system package usually works better than pip:

```sh
sudo apt install python3-libtorrent
```

## Web app

```sh
python app.py
# open http://localhost:5000
```

The page has two sections:

- **Torrent → Magnet**: drag-and-drop or pick `.torrent` files, get magnet
  links back; copy all or download as a `.txt`.
- **Magnet → Torrent**: paste one URI per line; the server joins the swarm
  via DHT (BEP-9) and streams `.torrent` files back as they're ready, each
  with a per-row download link.

Endpoints:

| Method & path        | Body                                | Response                      |
|----------------------|-------------------------------------|-------------------------------|
| `POST /api/to-magnet` | multipart `torrents[]`              | JSON `{results:[{name, magnet\|error}]}` |
| `POST /api/to-torrent` | JSON `{uris:[...], timeout:60}`     | NDJSON stream of `{uri, ok, filename, data_b64}` or `{uri, ok:false, error}` |

## CLI

### Torrent → magnet

```sh
python bittorrent_to_magnet.py path/to/file.torrent
python bittorrent_to_magnet.py ./torrents -o magnets.txt
```

The generated magnet links include the `xt` (info hash), `dn` (display
name), `xl` (total length), and all `tr` (trackers) from the torrent.

### Magnet → torrent

```sh
python magnet_to_bittorrent.py "magnet:?xt=urn:btih:..." -o ./out
python magnet_to_bittorrent.py magnets.txt -o ./out -t 120
```

Joins the BitTorrent swarm via DHT/peers and downloads metadata (BEP-9),
then writes a real `.torrent` file. Needs network access and live peers.
