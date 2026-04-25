# Magnet-Torrent

Batch conversion between BitTorrent `.torrent` files and magnet links.

## Install

```sh
pip install -r requirements.txt
```

`libtorrent` is only required for the magnet → torrent direction. On
Debian/Ubuntu the system package usually works better than pip:

```sh
sudo apt install python3-libtorrent
```

## Usage

### Torrent → magnet

```sh
# single file, print to stdout
python bittorrent_to_magnet.py path/to/file.torrent

# whole directory, write to a file
python bittorrent_to_magnet.py ./torrents -o magnets.txt
```

The generated magnet links include the `xt` (info hash), `dn` (display
name), `xl` (total length) and all `tr` (trackers) found in the torrent.

### Magnet → torrent

This direction joins the BitTorrent swarm via DHT/peers and downloads the
metadata (BEP-9), then writes a real `.torrent` file. It needs network
access and may take a while per URI.

```sh
# single magnet URI
python magnet_to_bittorrent.py "magnet:?xt=urn:btih:..." -o ./out

# batch from a file (one URI per line, '#' for comments)
python magnet_to_bittorrent.py magnets.txt -o ./out -t 120
```
