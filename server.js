const http = require("http");
const fs = require("fs");
const path = require("path");
const handler = require("./api/app");

const PORT = process.env.PORT || 8080;
const ROOT = path.join(__dirname, "public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

const server = http.createServer((req, res) => {
  if ((req.url || "").startsWith("/api")) return handler(req, res);
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    res.end("No encontrado");
    return;
  }
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log("Control de parqueaderos en http://localhost:" + PORT);
  console.log("Admin inicial: admin / Admin2026!");
});
