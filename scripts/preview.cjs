/* LOCAL DEVELOPMENT ONLY. Never deploy this role-switching server. */
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const Domain = require("../src/domain.js"),
  { seed } = require("./fixtures.cjs");
const root = path.resolve(__dirname, ".."),
  src = path.join(root, "src"),
  dbPath = path.join(root, ".preview-data.json"),
  filePath = path.join(root, ".preview-files.json");
let db = fs.existsSync(dbPath)
  ? Object.assign(Domain.empty(), JSON.parse(fs.readFileSync(dbPath, "utf8")))
  : seed();
let files = fs.existsSync(filePath)
  ? JSON.parse(fs.readFileSync(filePath, "utf8"))
  : {};
const sessions = new Map(),
  port = Number(process.env.PORT || 4173);
function persist(next) {
  const tmp = dbPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, dbPath);
  db = next;
}
function auth(token) {
  const mail = sessions.get(token);
  if (!mail) throw new Error("SESSION_EXPIRED");
  return Domain.user(db, mail);
}
function ctx() {
  return { now: new Date().toISOString(), uuid: () => crypto.randomUUID() };
}
function invoke(method, args) {
  if (method === "previewUsers")
    return {
      users: db.Users.filter((u) => u.active).map(({ email, name, roles }) => ({
        email,
        name,
        roles,
      })),
    };
  if (method === "previewLogin") {
    const u = Domain.user(db, args[0]),
      token = crypto.randomUUID() + crypto.randomUUID();
    sessions.set(token, u.email);
    return { token };
  }
  if (method === "logout") {
    sessions.delete(args[0]);
    return { ok: true };
  }
  const u = auth(args[0]);
  if (method === "loadWorkspace") return Domain.snapshot(db, u);
  if (method === "executeCommand") {
    const out = Domain.execute(db, u, args[1], ctx());
    if (!out.replayed) persist(out.db);
    return out.result;
  }
  if (method === "uploadAttachment") {
    const req = args[1],
      f = args[2];
    if (req.action !== "attachFile") throw new Error("คำขอไม่ถูกต้อง");
    Domain.visibleEntity(db, u, req.payload.entity, req.payload.entityId, true);
    if (
      !/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(f.mimeType) ||
      Buffer.from(f.base64, "base64").length > 5 * 1024 * 1024
    )
      throw new Error("ไฟล์ไม่ถูกต้อง");
    req.payload.fileHash = crypto
      .createHash("sha256")
      .update(f.base64)
      .digest("hex");
    const fileId = crypto.randomUUID();
    const out = Domain.execute(db, u, req, {
      ...ctx(),
      file: {
        id: fileId,
        name: f.name,
        mimeType: f.mimeType,
        size: Buffer.from(f.base64, "base64").length,
        url: "",
      },
    });
    if (!out.replayed) {
      files[fileId] = f;
      fs.writeFileSync(filePath, JSON.stringify(files));
      persist(out.db);
    }
    return out.result;
  }
  if (method === "downloadAttachment") {
    const a = db.Attachments.find((a) => a.id === args[1]);
    if (!a) throw new Error("ไม่พบไฟล์");
    Domain.visibleEntity(db, u, a.entity, a.entityId, false);
    return files[a.fileId];
  }
  throw new Error("ไม่พบคำสั่ง");
}
const server = http.createServer(async (req, res) => {
  const host = req.headers.host || "";
  if (!["127.0.0.1:" + port, "localhost:" + port].includes(host)) {
    res.writeHead(403);
    return res.end();
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "GET") {
    const routes = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/style.css": ["style.css", "text/css; charset=utf-8"],
      "/app.js": ["app.js", "text/javascript; charset=utf-8"],
      "/advanced.js": ["advanced.js", "text/javascript; charset=utf-8"],
      "/features.js": ["features.js", "text/javascript; charset=utf-8"],
    };
    const file = routes[req.url];
    if (!file) {
      res.writeHead(404);
      return res.end("Not found");
    }
    let content = fs.readFileSync(path.join(src, file[0]), "utf8");
    if (file[0] === "index.html")
      content = content
        .replace("<!-- STYLES -->", '<link rel="stylesheet" href="/style.css">')
        .replace(
          "<!-- SCRIPT -->",
          '<script src="/advanced.js"></script><script src="/app.js"></script><script src="/features.js"></script>',
        );
    res.writeHead(200, { "Content-Type": file[1] });
    return res.end(content);
  }
  if (req.method !== "POST" || !req.url.startsWith("/api/")) {
    res.writeHead(405);
    return res.end();
  }
  const origin = req.headers.origin;
  if (
    origin &&
    !["http://127.0.0.1:" + port, "http://localhost:" + port].includes(origin)
  ) {
    res.writeHead(403);
    return res.end();
  }
  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 7500000) throw new Error("Request too large");
    }
    const args = JSON.parse(raw);
    if (!Array.isArray(args)) throw new Error("Invalid request");
    const result = invoke(req.url.slice(5), args);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    "Local-only preview: http://127.0.0.1:" +
      port +
      " (business data starts empty)",
  ),
);
