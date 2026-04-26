const $ = (sel) => document.querySelector(sel);

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle("error", isError);
}

// ---- Torrent → Magnet ----
const drop = $("#drop");
const fileInput = $("#torrent-files");
const magnetOut = $("#magnet-output");
const toMagnetStatus = $("#to-magnet-status");
const copyBtn = $("#copy-magnets");
const downloadBtn = $("#download-magnets");

async function uploadTorrents(files) {
  if (!files.length) return;
  setStatus(toMagnetStatus, `Uploading ${files.length} file(s)…`);
  const fd = new FormData();
  for (const f of files) fd.append("torrents", f);
  try {
    const res = await fetch("/api/to-magnet", { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    const { results } = await res.json();
    const lines = [];
    let ok = 0, errors = 0;
    for (const r of results) {
      if (r.magnet) { lines.push(r.magnet); ok++; }
      else { lines.push(`# ${r.name}: ${r.error}`); errors++; }
    }
    magnetOut.value = lines.join("\n");
    copyBtn.disabled = downloadBtn.disabled = lines.length === 0;
    setStatus(toMagnetStatus, `Converted ${ok}, errors ${errors}.`, errors > 0 && ok === 0);
  } catch (e) {
    setStatus(toMagnetStatus, String(e), true);
  }
}

drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => uploadTorrents([...fileInput.files]));
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); })
);
drop.addEventListener("drop", (e) => {
  const files = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith(".torrent"));
  uploadTorrents(files);
});

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(magnetOut.value);
  const old = copyBtn.textContent;
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = old), 1500);
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([magnetOut.value], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "magnets.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---- Magnet → Torrent ----
const magnetIn = $("#magnet-input");
const fetchBtn = $("#fetch-torrents");
const timeoutEl = $("#to-torrent-timeout");
const resultsEl = $("#to-torrent-results");

function makeRow(uri) {
  const li = document.createElement("li");
  li.className = "pending";
  const marker = document.createElement("span");
  marker.className = "marker";
  marker.textContent = "⋯";
  const u = document.createElement("span");
  u.className = "uri";
  u.title = uri;
  u.textContent = uri;
  const msg = document.createElement("span");
  msg.className = "msg";
  msg.textContent = "waiting…";
  li.append(marker, u, msg);
  return li;
}

fetchBtn.addEventListener("click", async () => {
  const uris = magnetIn.value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!uris.length) return;

  resultsEl.innerHTML = "";
  fetchBtn.disabled = true;
  const oldLabel = fetchBtn.textContent;
  fetchBtn.textContent = "Fetching…";

  const items = new Map();
  for (const uri of uris) {
    const li = makeRow(uri);
    resultsEl.appendChild(li);
    items.set(uri, li);
  }

  try {
    const res = await fetch("/api/to-torrent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris, timeout: Number(timeoutEl.value) || 60 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const r = JSON.parse(line);
        const li = items.get(r.uri);
        if (!li) continue;
        const marker = li.querySelector(".marker");
        const msg = li.querySelector(".msg");
        if (r.ok) {
          li.className = "ok";
          marker.textContent = "✓";
          const bytes = Uint8Array.from(atob(r.data_b64), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: "application/x-bittorrent" });
          const url = URL.createObjectURL(blob);
          msg.innerHTML = "";
          const a = document.createElement("a");
          a.href = url;
          a.download = r.filename;
          a.textContent = r.filename;
          msg.appendChild(a);
        } else {
          li.className = "error";
          marker.textContent = "✗";
          msg.textContent = r.error;
        }
      }
    }
  } catch (e) {
    for (const [, li] of items) {
      if (li.className === "pending") {
        li.className = "error";
        li.querySelector(".marker").textContent = "✗";
        li.querySelector(".msg").textContent = String(e);
      }
    }
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = oldLabel;
  }
});
