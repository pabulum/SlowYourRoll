#!/usr/bin/env node
// Static file server for local development. Zero dependencies — the app is buildless
// and ships no runtime deps, so serving it shouldn't drag in a toolchain either.
//
//   npm run dev                # http://localhost:8000
//   npm run dev -- --port=3000
//   PORT=3000 npm run dev
//
// Unlike a stock static server this sends no-cache headers: ES modules are fetched
// individually and a 304 on a stale module is a confusing way to lose an edit.

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const portArg = process.argv.slice(2).find((a) => a.startsWith("--port="));
const PORT = Number(portArg ? portArg.slice(7) : process.env.PORT || 8000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/** Resolve a URL path to a file inside ROOT, or null if it escapes or doesn't exist. */
async function resolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  // normalize() collapses ".." before we join, so a traversal can't climb out of ROOT.
  const full = join(ROOT, normalize(decoded));
  if (full !== ROOT && !full.startsWith(ROOT + "/")) return null;

  try {
    const info = await stat(full);
    if (info.isDirectory()) return resolve(join(decoded, "index.html"));
    return full;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const file = await resolve(req.url || "/");

  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 Not Found\n");
    console.log(`404 ${req.method} ${req.url}`);
    return;
  }

  res.writeHead(200, {
    "content-type": TYPES[extname(file)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Try: npm run dev -- --port=${PORT + 1}`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(
    `Slow Your Roll → http://localhost:${PORT}  (serving ${ROOT}, Ctrl-C to stop)`,
  );
});
