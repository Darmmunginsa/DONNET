const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const D = require("../src/domain.js");
const { seed } = require("../scripts/fixtures.cjs");
function runtime() {
  let now = Date.parse("2026-09-26T03:00:00Z"),
    failBatch = false,
    batches = [],
    locked = false;
  const db = seed(),
    names = Object.keys(D.SCHEMA),
    props = new Map([["SPREADSHEET_ID", "test-sheet"]]),
    cache = new Map(),
    emails = [];
  let cells = Object.fromEntries(
    names.map((n) => [
      n,
      [
        D.SCHEMA[n],
        ...db[n].map((r) =>
          D.SCHEMA[n].map((k) =>
            D.JSON_FIELDS.includes(k) ? JSON.stringify(r[k]) : (r[k] ?? ""),
          ),
        ),
      ],
    ]),
  );
  const clock = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  };
  const context = vm.createContext({
    console,
    Date: clock,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props.get(k) || null,
        setProperty: (k, v) => props.set(k, v),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => {
          const x = cache.get(k);
          return x && x.until > now ? x.value : null;
        },
        put: (k, value, ttl) =>
          cache.set(k, { value, until: now + ttl * 1000 }),
        remove: (k) => cache.delete(k),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          assert.equal(locked, false);
          locked = true;
          return true;
        },
        releaseLock: () => {
          locked = false;
        },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_, s) => crypto.createHash("sha256").update(s).digest(),
      base64EncodeWebSafe: (b) => Buffer.from(b).toString("base64url"),
      getUuid: () => crypto.randomUUID(),
      formatDate: () => new Date(now).toISOString().slice(0, 10),
    },
    MailApp: {
      getRemainingDailyQuota: () => 100,
      sendEmail: (e) => emails.push(e),
    },
    Sheets: {
      Spreadsheets: {
        Values: {
          batchGet: () => ({
            valueRanges: names.map((n) => ({
              values: structuredClone(cells[n]),
            })),
          }),
        },
        get: () => ({
          sheets: names.map((n, i) => ({
            properties: {
              title: n,
              sheetId: i,
              gridProperties: { rowCount: 1000 },
            },
          })),
        }),
        batchUpdate: (body, id) => {
          assert.equal(id, "test-sheet");
          if (failBatch) throw new Error("Simulated Sheets failure");
          const next = structuredClone(cells);
          for (const op of body.requests) {
            if (!op.updateCells) continue;
            const r = op.updateCells,
              name = names[r.range.sheetId];
            next[name] = [
              D.SCHEMA[name],
              ...r.rows.map((row) =>
                row.values.map((c) => {
                  const v = c.userEnteredValue || {};
                  return v.stringValue ?? v.numberValue ?? v.boolValue ?? "";
                }),
              ),
            ];
          }
          batches.push(body);
          cells = next;
        },
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(require.resolve("../src/advanced.js"), "utf8"),
    context,
  );
  vm.runInContext(
    fs.readFileSync(require.resolve("../src/domain.js"), "utf8"),
    context,
  );
  vm.runInContext(
    fs.readFileSync(require.resolve("../src/Server.gs"), "utf8"),
    context,
  );
  return {
    context,
    emails,
    cache,
    props,
    batches,
    get locked() {
      return locked;
    },
    get cells() {
      return cells;
    },
    advance: (ms) => (now += ms),
    fail: () => (failBatch = true),
    login: (who = "admin") => {
      context.beginLogin(who + "@example.test");
      const code = emails.at(-1).body.match(/\d{8}/)[0];
      return context.verifyLogin(who + "@example.test", code).token;
    },
  };
}

test("mail queue sends once, and ambiguous send failure requires manual retry", () => {
  const r = runtime(),
    token = r.login();
  const command = (action, payload) =>
    r.context.executeCommand(token, {
      action,
      payload,
      requestId: crypto.randomUUID(),
    });
  command("saveWorkspaceSettings", { data: { emailEnabled: true } });
  const before = r.context.readDb_(),
    next = JSON.parse(JSON.stringify(before));
  next.Outbox.push(
    r.context.systemRow_({
      to: "approver@example.test",
      subject: "Test",
      body: "Synthetic test",
      entity: "Quotations",
      entityId: "q",
      status: "pending",
      attempts: 0,
      dedupeKey: "test",
    }),
  );
  r.context.commit_(before, next);
  const initial = r.emails.length;
  r.context.runMailQueue_();
  r.context.runMailQueue_();
  assert.equal(r.emails.length, initial + 1);
  assert.equal(r.context.readDb_().Outbox[0].status, "sent");
  const before2 = r.context.readDb_(),
    next2 = JSON.parse(JSON.stringify(before2));
  next2.Outbox.push(
    r.context.systemRow_({
      to: "approver@example.test",
      subject: "Fail",
      body: "Synthetic test",
      status: "pending",
      attempts: 0,
      dedupeKey: "fail",
    }),
  );
  r.context.commit_(before2, next2);
  r.context.MailApp.sendEmail = () => {
    throw Error("network interrupted");
  };
  r.context.runMailQueue_();
  r.context.runMailQueue_();
  const failed = r.context.readDb_().Outbox[1];
  assert.equal(failed.status, "uncertain");
  assert.equal(failed.attempts, 1);
});

test("reminder scheduler deduplicates contract reminders and filters inactive recipients", () => {
  const r = runtime(),
    before = r.context.readDb_(),
    next = JSON.parse(JSON.stringify(before));
  next.Settings.push(
    r.context.systemRow_({ key: "workspace", value: { emailEnabled: true } }),
  );
  next.Contracts.push(
    r.context.systemRow_({
      number: "CT-TEST",
      name: "Test",
      end: "2026-09-30",
      alertDays: 30,
      alertEmails: ["finance@example.test", "unknown@example.test"],
    }),
  );
  r.context.commit_(before, next);
  r.context.scheduleReminders_();
  r.context.scheduleReminders_();
  const outbox = r.context.readDb_().Outbox;
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "finance@example.test");
});

test("backup resumes after a file failure without copying completed files again", () => {
  const r = runtime(),
    before = r.context.readDb_(),
    next = JSON.parse(JSON.stringify(before));
  next.BackupLog.push(
    r.context.systemRow_({ fileId: "folder", status: "running" }),
  );
  r.context.commit_(before, next);
  let manifest = {
      folderId: "folder",
      entries: [
        { id: "a", name: "A.pdf" },
        { id: "b", name: "B.pdf" },
      ],
      index: 0,
    },
    fail = true;
  const copied = new Set(),
    copies = [];
  r.props.set("BACKUP_MANIFEST_ID", "manifest");
  r.context.PropertiesService.getScriptProperties = () => ({
    getProperty: (k) => r.props.get(k),
    deleteProperty: (k) => r.props.delete(k),
  });
  const folder = {
    getFilesByName: (name) => ({ hasNext: () => copied.has(name) }),
  };
  r.context.DriveApp = {
    getFolderById: () => folder,
    getFileById: (id) =>
      id === "manifest"
        ? {
            getBlob: () => ({
              getDataAsString: () => JSON.stringify(manifest),
            }),
            setContent: (s) => {
              manifest = JSON.parse(s);
            },
          }
        : {
            makeCopy: (name) => {
              if (id === "b" && fail) throw Error("temporary");
              copied.add(name);
              copies.push(name);
            },
          },
  };
  r.context.continueBackup_();
  assert.equal(manifest.index, 1);
  assert.equal(r.context.readDb_().BackupLog[0].status, "partial");
  fail = false;
  r.context.continueBackup_();
  assert.equal(manifest.index, 2);
  assert.equal(r.context.readDb_().BackupLog[0].status, "complete");
  assert.deepEqual(copies, ["a__A.pdf", "b__B.pdf"]);
  assert.equal(r.props.has("BACKUP_MANIFEST_ID"), false);
});
test("Gmail OTP authorizes only allowlisted users and is single-use", () => {
  const r = runtime();
  r.context.beginLogin("stranger@example.test");
  assert.equal(r.emails.length, 0);
  const token = r.login();
  assert.ok(token.length > 40);
  assert.equal(r.context.loadWorkspace(token).user.email, "admin@example.test");
  const code = r.emails[0].body.match(/\d{8}/)[0];
  assert.throws(
    () => r.context.verifyLogin("admin@example.test", code),
    /หมดอายุ/,
  );
  r.context.logout(token);
  assert.throws(() => r.context.loadWorkspace(token), /SESSION_EXPIRED/);
  assert.equal(r.locked, false);
});
test("OTP cooldown, expiry and attempt limit are enforced", () => {
  const r = runtime();
  r.context.beginLogin("admin@example.test");
  r.context.beginLogin("admin@example.test");
  assert.equal(r.emails.length, 1);
  const code = r.emails[0].body.match(/\d{8}/)[0];
  r.advance(290000);
  assert.throws(() => r.context.verifyLogin("admin@example.test", "wrong"));
  r.advance(11000);
  assert.throws(
    () => r.context.verifyLogin("admin@example.test", code),
    /หมดอายุ/,
  );
  r.context.beginLogin("admin@example.test");
  const code2 = r.emails.at(-1).body.match(/\d{8}/)[0];
  for (let i = 0; i < 5; i++)
    assert.throws(() => r.context.verifyLogin("admin@example.test", "wrong"));
  assert.throws(() => r.context.verifyLogin("admin@example.test", code2));
  assert.equal(r.locked, false);
});
test("Sheets adapter commits business record, audit and retry marker together; strings never formulas", () => {
  const r = runtime(),
    token = r.login();
  const req = {
    requestId: crypto.randomUUID(),
    action: "saveMaster",
    payload: {
      table: "Customers",
      data: { name: '=IMPORTXML("https://example.test")' },
    },
  };
  const result = r.context.executeCommand(token, req);
  assert.equal(r.batches.length, 1);
  const names = r.batches[0].requests
    .filter((x) => x.updateCells)
    .map((x) => Object.keys(D.SCHEMA)[x.updateCells.range.sheetId]);
  assert.deepEqual(Array.from(names), ["Customers", "AuditLog", "Requests"]);
  const values = r.batches[0].requests[0].updateCells.rows[0].values;
  assert.ok(
    values.some(
      (v) =>
        v.userEnteredValue?.stringValue ===
        '=IMPORTXML("https://example.test")',
    ),
  );
  assert.equal(r.context.executeCommand(token, req).id, result.id);
  assert.equal(r.batches.length, 1);
});
test("failed Sheets batch leaves business data and idempotency log untouched", () => {
  const r = runtime(),
    token = r.login(),
    before = JSON.stringify(r.cells);
  r.fail();
  assert.throws(
    () =>
      r.context.executeCommand(token, {
        requestId: crypto.randomUUID(),
        action: "saveMaster",
        payload: { table: "Customers", data: { name: "Fail" } },
      }),
    /Simulated/,
  );
  assert.equal(JSON.stringify(r.cells), before);
  assert.equal(r.locked, false);
});
test("only intended public Apps Script entry points exist", () => {
  const code = fs.readFileSync(require.resolve("../src/Server.gs"), "utf8");
  const functions = Array.from(
    code.matchAll(/^function (\w+)\(/gm),
    (m) => m[1],
  ).filter((n) => !n.endsWith("_"));
  assert.deepEqual(functions, [
    "doGet",
    "beginLogin",
    "verifyLogin",
    "logout",
    "loadWorkspace",
    "executeCommand",
    "uploadAttachment",
    "downloadAttachment",
    "requestBackup",
  ]);
});
