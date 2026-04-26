// Pure-browser .torrent → magnet converter.
// Bencode-parses the file, finds the byte slice of the `info` value,
// SHA-1's it via Web Crypto to get the info_hash, and assembles a magnet URI.

const utf8 = new TextDecoder("utf-8", { fatal: false });

function parseTorrent(buffer) {
  const u8 = new Uint8Array(buffer);
  let pos = 0;

  const expect = (byte, label) => {
    if (u8[pos] !== byte) {
      throw new Error(`expected ${label} at offset ${pos}, got 0x${(u8[pos] ?? 0).toString(16)}`);
    }
  };
  const findByte = (byte) => {
    const i = u8.indexOf(byte, pos);
    if (i < 0) throw new Error(`unterminated token at offset ${pos}`);
    return i;
  };

  function readInt() {
    expect(0x69, "'i'");
    pos++;
    const end = findByte(0x65);
    const s = utf8.decode(u8.subarray(pos, end));
    pos = end + 1;
    return BigInt(s);
  }
  function readString() {
    const colon = findByte(0x3a);
    const len = Number(utf8.decode(u8.subarray(pos, colon)));
    pos = colon + 1;
    const out = u8.subarray(pos, pos + len);
    pos += len;
    return out;
  }
  function readList() {
    pos++; // skip 'l'
    const arr = [];
    while (u8[pos] !== 0x65) arr.push(readValue());
    pos++;
    return arr;
  }
  function readDict() {
    pos++; // skip 'd'
    const obj = new Map();
    while (u8[pos] !== 0x65) {
      const key = utf8.decode(readString());
      obj.set(key, readValue());
    }
    pos++;
    return obj;
  }
  function readValue() {
    const c = u8[pos];
    if (c === 0x69) return readInt();
    if (c === 0x6c) return readList();
    if (c === 0x64) return readDict();
    if (c >= 0x30 && c <= 0x39) return readString();
    throw new Error(`unexpected byte 0x${(c ?? 0).toString(16)} at offset ${pos}`);
  }

  // Top-level: parse manually so we can capture the byte slice of `info`.
  expect(0x64, "top-level dict");
  pos++;
  const meta = new Map();
  let infoStart = -1, infoEnd = -1;
  while (u8[pos] !== 0x65) {
    const key = utf8.decode(readString());
    const valStart = pos;
    const value = readValue();
    if (key === "info") { infoStart = valStart; infoEnd = pos; }
    meta.set(key, value);
  }
  if (infoStart < 0) throw new Error("missing 'info' dictionary");
  return { meta, infoBytes: u8.subarray(infoStart, infoEnd) };
}

async function torrentToMagnet(buffer) {
  const { meta, infoBytes } = parseTorrent(buffer);
  const digest = await crypto.subtle.digest("SHA-1", infoBytes);
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const params = [["xt", `urn:btih:${hash}`]];

  const info = meta.get("info");
  const name = info?.get("name");
  if (name) params.push(["dn", utf8.decode(name)]);

  // Total length: single-file vs multi-file.
  let xl = 0n;
  if (info.has("length")) {
    xl = info.get("length");
  } else if (info.has("files")) {
    for (const f of info.get("files")) {
      const len = f.get?.("length");
      if (typeof len === "bigint") xl += len;
    }
  }
  if (xl > 0n) params.push(["xl", xl.toString()]);

  // Trackers: announce + announce-list, deduped, order preserved.
  const trackers = [];
  const push = (s) => { if (s && !trackers.includes(s)) trackers.push(s); };
  if (meta.has("announce")) push(utf8.decode(meta.get("announce")));
  for (const tier of meta.get("announce-list") ?? []) {
    for (const t of tier) push(utf8.decode(t));
  }
  for (const t of trackers) params.push(["tr", t]);

  return "magnet:?" + params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// ---- UI ----

const $ = (sel) => document.querySelector(sel);
const drop = $("#drop");
const fileInput = $("#torrent-files");
const output = $("#output");
const statusEl = $("#status");
const copyBtn = $("#copy");
const downloadBtn = $("#download");
const clearBtn = $("#clear");

function setStatus(text, level = "") {
  statusEl.textContent = text;
  statusEl.classList.remove("error", "warn");
  if (level) statusEl.classList.add(level);
}

function setBusy(busy) {
  drop.style.pointerEvents = busy ? "none" : "";
  drop.style.opacity = busy ? "0.6" : "";
}

async function processFiles(files) {
  if (!files.length) return;
  setBusy(true);
  setStatus(`Processing ${files.length} file(s)…`);
  const lines = [];
  let ok = 0, errors = 0;
  for (const f of files) {
    try {
      const buf = await f.arrayBuffer();
      lines.push(await torrentToMagnet(buf));
      ok++;
    } catch (e) {
      lines.push(`# ${f.name}: ${e.message}`);
      errors++;
    }
  }
  // Append, don't overwrite — supports incremental drops.
  output.value = output.value
    ? output.value.replace(/\s+$/, "") + "\n" + lines.join("\n")
    : lines.join("\n");
  const hasOutput = output.value.length > 0;
  copyBtn.disabled = downloadBtn.disabled = clearBtn.disabled = !hasOutput;
  const level = errors ? (ok ? "warn" : "error") : "";
  setStatus(`Converted ${ok}, errors ${errors}.`, level);
  setBusy(false);
}

drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  processFiles([...fileInput.files]);
  fileInput.value = ""; // allow re-selecting the same file
});

["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); })
);
drop.addEventListener("drop", (e) => {
  const files = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith(".torrent"));
  if (!files.length) {
    setStatus("No .torrent files in the drop.", "warn");
    return;
  }
  processFiles(files);
});

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(output.value);
  const old = copyBtn.textContent;
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = old), 1500);
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([output.value + "\n"], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "magnets.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});

clearBtn.addEventListener("click", () => {
  output.value = "";
  copyBtn.disabled = downloadBtn.disabled = clearBtn.disabled = true;
  setStatus("");
});
