"""Flask web app for batch magnet ↔ torrent conversion.

  /                    Single-page UI
  POST /api/to-magnet  multipart upload of .torrent files → JSON of magnet links
  POST /api/to-torrent JSON {uris, timeout} → NDJSON stream of {ok, filename, data_b64} | {error}
"""
import base64
import json

from flask import Flask, Response, jsonify, render_template, request, stream_with_context

from bittorrent_to_magnet import torrent_bytes_to_magnet

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB upload cap


@app.route("/")
def index():
    return render_template("index.html")


@app.post("/api/to-magnet")
def api_to_magnet():
    files = request.files.getlist("torrents")
    if not files:
        return jsonify(error="no files uploaded"), 400
    results = []
    for f in files:
        try:
            magnet = torrent_bytes_to_magnet(f.read())
            results.append({"name": f.filename, "magnet": magnet})
        except Exception as e:
            results.append({"name": f.filename, "error": str(e)})
    return jsonify(results=results)


@app.post("/api/to-torrent")
def api_to_torrent():
    payload = request.get_json(silent=True) or {}
    uris = [u.strip() for u in payload.get("uris", []) if u and u.strip()]
    timeout = int(payload.get("timeout", 60))
    if not uris:
        return jsonify(error="no magnet URIs provided"), 400

    try:
        from magnet_to_bittorrent import magnet_to_torrent_bytes
    except ImportError as e:
        return jsonify(error=f"libtorrent not available on server: {e}"), 503

    @stream_with_context
    def generate():
        for uri in uris:
            try:
                name, data = magnet_to_torrent_bytes(uri, timeout=timeout)
                yield json.dumps({
                    "uri": uri,
                    "ok": True,
                    "filename": name,
                    "data_b64": base64.b64encode(data).decode("ascii"),
                }) + "\n"
            except Exception as e:
                yield json.dumps({"uri": uri, "ok": False, "error": str(e)}) + "\n"

    return Response(generate(), mimetype="application/x-ndjson")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
