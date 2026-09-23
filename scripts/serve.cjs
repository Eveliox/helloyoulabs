// Local preview only. Production can serve the repository as ordinary static files.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
};

function createPreviewServer() {
  return http.createServer((request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let file;
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      file = path.resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (!file.startsWith(root + path.sep) || !mime[path.extname(file)]) {
      response.writeHead(404).end();
      return;
    }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": mime[path.extname(file)],
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else
        fs.createReadStream(file)
          .on("error", () => response.destroy())
          .pipe(response);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 4173;
  createPreviewServer().listen(port, "127.0.0.1", () => {
    console.log(`Hello You Labs preview: http://127.0.0.1:${port}`);
  });
}
module.exports = { createPreviewServer };
