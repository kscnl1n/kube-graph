const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4173;

const MIME_TYPES = {
  ".html": "text/html; charset=UTF-8",
  ".js": "application/javascript; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".json": "application/json; charset=UTF-8",
  ".ico": "image/x-icon"
};

function resolvePath(urlPath) {
  const cleaned = urlPath.split("?")[0];
  if (cleaned === "/" || cleaned === "") return "index.html";
  return cleaned.replace(/^\/+/, "");
}

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, "public", resolvePath(req.url || "/"));

  // super basic security check, good enough for demo app
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // kay note - this filePath is currently set to the public folder 04/12/2026
  fs.readFile(filePath, (err, data) => {
    if (err) {
      const notFoundPath = path.join(__dirname, "public", "index.html");
      fs.readFile(notFoundPath, (indexErr, indexData) => {
        if (indexErr) {
          res.writeHead(500);
          res.end("Server error");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
        res.end(indexData);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`k8s yaml graph running on http://localhost:${PORT}`);
});
