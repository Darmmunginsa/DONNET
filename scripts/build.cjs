const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, ".."),
  src = path.join(root, "src"),
  out = path.join(root, "dist");
fs.mkdirSync(out, { recursive: true });
for (const name of [
  "advanced.js",
  "domain.js",
  "app.js",
  "features.js",
  "Server.gs",
])
  new vm.Script(fs.readFileSync(path.join(src, name), "utf8"), {
    filename: name,
  });
fs.writeFileSync(
  path.join(out, "Domain.gs"),
  fs.readFileSync(path.join(src, "advanced.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(src, "domain.js"), "utf8"),
);
fs.rmSync(path.join(out, "Advanced.gs"), { force: true });
fs.copyFileSync(path.join(src, "Server.gs"), path.join(out, "Server.gs"));
fs.copyFileSync(
  path.join(src, "appsscript.json"),
  path.join(out, "appsscript.json"),
);
fs.writeFileSync(
  path.join(out, "Styles.html"),
  "<style>\n" +
    fs.readFileSync(path.join(src, "style.css"), "utf8") +
    "\n</style>",
);
fs.writeFileSync(
  path.join(out, "Client.html"),
  "<script>\n" +
    fs.readFileSync(path.join(src, "advanced.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(src, "app.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(src, "features.js"), "utf8") +
    "\n</script>",
);
fs.writeFileSync(
  path.join(out, "Index.html"),
  fs
    .readFileSync(path.join(src, "index.html"), "utf8")
    .replace("<!-- STYLES -->", "<?!= include_('Styles'); ?>")
    .replace("<!-- SCRIPT -->", "<?!= include_('Client'); ?>"),
);
console.log("Built Apps Script files in dist/");
