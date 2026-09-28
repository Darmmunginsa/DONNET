const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const D = require("../src/domain.js"),
  { seed } = require("../scripts/fixtures.cjs");
function harness() {
  let db = seed();
  return {
    get db() {
      return db;
    },
    command(who, action, payload, extra = {}) {
      const out = D.execute(
        db,
        D.user(db, who + "@example.test"),
        { action, payload, requestId: crypto.randomUUID() },
        {
          now: "2026-09-28T01:00:00Z",
          uuid: () => crypto.randomUUID(),
          ...extra,
        },
      );
      db = out.db;
      return out.result;
    },
  };
}
const file = (n) => ({
  file: {
    id: "private-file-" + n,
    name: "company-" + n + ".pdf",
    mimeType: "application/pdf",
    size: 200,
    url: "",
  },
});
const payload = {
  title: "หนังสือรับรองบริษัท",
  category: "หนังสือรับรองและจดทะเบียน",
  documentNo: "DEMO",
  issuedDate: "2026-09-01",
  expiresDate: "2027-09-01",
  note: "ทดสอบ",
};
test("library metadata and attachment access are restricted to admin/finance; only admin edits", () => {
  const h = harness(),
    d = h.command("admin", "saveCompanyFile", payload),
    a = h.command(
      "admin",
      "attachFile",
      { entity: "CompanyFiles", entityId: d.id, version: 1 },
      file(1),
    );
  for (const role of ["sales", "tech", "purchase", "approver"]) {
    const u = D.user(h.db, role + "@example.test"),
      view = D.snapshot(h.db, u).data;
    assert.equal(view.CompanyFiles.length, 0);
    assert(!view.Attachments.some((x) => x.id === a.id));
    assert.throws(() => D.visibleEntity(h.db, u, "CompanyFiles", d.id, false));
    assert.throws(() => h.command(role, "saveCompanyFile", payload));
  }
  const finance = D.user(h.db, "finance@example.test"),
    view = D.snapshot(h.db, finance).data;
  assert.equal(view.CompanyFiles.length, 1);
  assert.equal(view.Attachments[0].id, a.id);
  assert.equal(
    D.visibleEntity(h.db, finance, "CompanyFiles", d.id, false).title,
    payload.title,
  );
  assert.throws(() =>
    h.command("finance", "saveCompanyFile", {
      ...payload,
      id: d.id,
      version: 2,
    }),
  );
  assert.throws(() =>
    h.command(
      "finance",
      "attachFile",
      { entity: "CompanyFiles", entityId: d.id, version: 2 },
      file(2),
    ),
  );
  assert.throws(() =>
    h.command("finance", "archiveCompanyFile", {
      id: d.id,
      version: 2,
      archived: true,
    }),
  );
});
test("new file becomes current without deleting prior versions; archive and restore keep files", () => {
  const h = harness(),
    d = h.command("admin", "saveCompanyFile", payload);
  const a = h.command(
    "admin",
    "attachFile",
    { entity: "CompanyFiles", entityId: d.id, version: 1 },
    file(1),
  );
  const b = h.command(
    "admin",
    "attachFile",
    { entity: "CompanyFiles", entityId: d.id, version: 2 },
    file(2),
  );
  assert.equal(h.db.CompanyFiles[0].currentAttachmentId, b.id);
  assert.equal(h.db.Attachments.length, 2);
  assert(h.db.Attachments.some((x) => x.id === a.id));
  assert.throws(() =>
    h.command(
      "admin",
      "attachFile",
      { entity: "CompanyFiles", entityId: d.id, version: 2 },
      file(3),
    ),
  );
  assert.equal(h.db.Attachments.length, 2);
  h.command("admin", "archiveCompanyFile", {
    id: d.id,
    version: 3,
    archived: true,
  });
  assert.throws(() =>
    h.command(
      "admin",
      "attachFile",
      { entity: "CompanyFiles", entityId: d.id, version: 4 },
      file(3),
    ),
  );
  h.command("admin", "archiveCompanyFile", {
    id: d.id,
    version: 4,
    archived: false,
  });
  assert.equal(h.db.CompanyFiles[0].currentAttachmentId, b.id);
  assert.equal(h.db.Attachments.length, 2);
});
test("library rejects invalid dates, oversized categories and forged current file references", () => {
  const h = harness();
  assert.throws(() =>
    h.command("admin", "saveCompanyFile", {
      ...payload,
      expiresDate: "2025-01-01",
    }),
  );
  assert.throws(() =>
    h.command("admin", "saveCompanyFile", {
      ...payload,
      category: "x".repeat(81),
    }),
  );
  const d = h.command("admin", "saveCompanyFile", {
    ...payload,
    currentAttachmentId: "foreign",
  });
  assert.equal(h.db.CompanyFiles[0].currentAttachmentId, "");
  assert.throws(() =>
    h.command("admin", "saveCompanyFile", { ...payload, id: d.id, version: 0 }),
  );
});
test("Office formats are allowed only in company library, executable and macro formats are refused", () => {
  const xlsx =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  assert(D.allowedAttachmentType("CompanyFiles", xlsx));
  assert(!D.allowedAttachmentType("Company", xlsx));
  assert(!D.allowedAttachmentType("Quotations", xlsx));
  assert(
    !D.allowedAttachmentType(
      "CompanyFiles",
      "application/vnd.ms-excel.sheet.macroEnabled.12",
    ),
  );
  assert(!D.allowedAttachmentType("CompanyFiles", "application/x-msdownload"));
  assert(D.allowedAttachmentType("CompanyFiles", "application/pdf"));
});
