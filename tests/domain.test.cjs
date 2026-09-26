const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const D = require("../src/domain.js"),
  { seed } = require("../scripts/fixtures.cjs");
function harness() {
  let db = seed();
  function command(who, action, payload = {}, requestId = crypto.randomUUID()) {
    const out = D.execute(
      db,
      D.user(db, who + "@example.test"),
      { action, payload, requestId },
      { now: "2026-09-26T03:00:00.000Z", uuid: () => crypto.randomUUID() },
    );
    db = out.db;
    return out.result;
  }
  const h = {
    command,
    get db() {
      return db;
    },
  };
  h.customer = command("sales", "saveMaster", {
    table: "Customers",
    data: { name: "ลูกค้า ก", address: "กรุงเทพ", active: true },
  }).id;
  h.vendor = command("purchase", "saveMaster", {
    table: "Vendors",
    data: { name: "ผู้ขาย ก", active: true },
  }).id;
  h.quote = () =>
    command("sales", "saveQuote", {
      customerId: h.customer,
      date: "2026-09-26",
      vatPct: 7,
      items: [{ name: "Switch", qty: 2, price: 1000, cost: 600, unit: "ชิ้น" }],
    }).id;
  h.approve = (id) => {
    let q = db.Quotations.find((q) => q.id === id);
    command("sales", "submitQuote", {
      id,
      version: q.version,
      approverEmail: "approver@example.test",
    });
    q = db.Quotations.find((q) => q.id === id);
    command("approver", "approveQuote", {
      id,
      version: q.version,
      status: "approved",
    });
  };
  return h;
}

test("rules route approval and below-cost sales require an explanation", () => {
  const h = harness();
  h.command("admin", "saveApprovalRule", {
    name: "All",
    minAmount: 0,
    maxAmount: 100000,
    approverEmail: "approver@example.test",
  });
  const q = h.command("sales", "saveQuote", {
    customerId: h.customer,
    date: "2026-09-26",
    items: [{ name: "Loss", qty: 1, price: 100, cost: 200 }],
  });
  assert.throws(
    () => h.command("sales", "submitQuote", { id: q.id, version: q.version }),
    /เหตุผล/,
  );
  const pending = h.command("sales", "submitQuote", {
    id: q.id,
    version: q.version,
    belowCostReason: "Clear old stock",
  });
  assert.equal(
    h.db.Quotations.find((x) => x.id === pending.id).approverEmail,
    "approver@example.test",
  );
});

test("credit and refund settle cash plus withholding without deleting history", () => {
  const h = harness(),
    id = h.quote();
  h.approve(id);
  h.command("finance", "addPayment", {
    quoteId: id,
    amount: 2100,
    withholding: 40,
    date: "2026-09-26",
  });
  h.command("finance", "customerCredit", {
    quoteId: id,
    amount: 140,
    reason: "Reduction",
    date: "2026-09-26",
  });
  assert.throws(
    () =>
      h.command("finance", "refundCustomer", {
        quoteId: id,
        amount: 141,
        date: "2026-09-26",
        reason: "Refund",
      }),
    /เกิน/,
  );
  h.command("finance", "refundCustomer", {
    quoteId: id,
    amount: 100,
    withholding: 40,
    date: "2026-09-26",
    reason: "Refund",
  });
  const A = require("../src/advanced.js");
  assert.deepEqual(A.balances(h.db, h.db.Quotations[0]), {
    target: 2000,
    paid: 2000,
    credits: 140,
  });
  assert.equal(h.db.Payments.length, 1);
  assert.equal(h.db.CustomerRefunds.length, 1);
});

test("issued receipts are immutable and repeated issuance reuses their number", () => {
  const h = harness(),
    id = h.quote();
  h.approve(id);
  const pay = h.command("finance", "addPayment", {
    quoteId: id,
    amount: 500,
    date: "2026-09-26",
  });
  const doc = h.command("finance", "issueDocument", {
    kind: "receipt",
    quoteId: id,
    paymentId: pay.id,
    date: "2026-09-26",
  });
  h.command("finance", "customerCredit", {
    quoteId: id,
    amount: 50,
    reason: "Adjustment",
    date: "2026-09-26",
  });
  const again = h.command("finance", "issueDocument", {
    kind: "receipt",
    quoteId: id,
    paymentId: pay.id,
    date: "2026-09-27",
  });
  assert.equal(again.id, doc.id);
  assert.equal(h.db.Documents.length, 1);
  assert.equal(h.db.Documents[0].snapshot.quote.total, 2140);
  assert.throws(() =>
    h.command("tech", "issueDocument", {
      kind: "receipt",
      quoteId: id,
      paymentId: pay.id,
      date: "2026-09-26",
    }),
  );
});

test("revision preserves original rows while cancellation releases procurement capacity", () => {
  const h = harness(),
    id = h.quote();
  h.approve(id);
  const revised = h.command("sales", "reviseQuote", {
    id,
    version: h.db.Quotations[0].version,
  });
  assert.equal(h.db.Quotations[1].revisionOf, id);
  assert.equal(h.db.Quotations[1].revision, 2);
  assert.equal(h.db.Quotations[0].status, "superseded");
  h.approve(revised.id);
  const qi = h.db.QuoteItems.find((x) => x.quoteId === revised.id);
  const pr = h.command("sales", "createProcurement", {
    quoteId: revised.id,
    items: [{ quoteItemId: qi.id, qty: 2 }],
  });
  h.command("purchase", "cancelProcurement", {
    id: pr.id,
    version: pr.version,
    reason: "Wrong request",
  });
  h.command("sales", "createProcurement", {
    quoteId: revised.id,
    items: [{ quoteItemId: qi.id, qty: 2 }],
  });
  assert.equal(h.db.Procurements.length, 2);
});

test("PO tax, discounted returns and refunds settle to zero and allow reordering", () => {
  const h = harness(),
    id = h.quote();
  h.approve(id);
  const qi = h.db.QuoteItems[0];
  const pr = h.command("sales", "createProcurement", {
    quoteId: id,
    items: [{ quoteItemId: qi.id, qty: 2 }],
  });
  const offer = h.command("purchase", "saveVendorQuote", {
    procurementId: pr.id,
    itemId: h.db.ProcurementItems[0].id,
    vendorId: h.vendor,
    unitPrice: 0.07,
  });
  const advance = () =>
    h.command("purchase", "advancePurchase", {
      id: pr.id,
      version: h.db.Procurements[0].version,
    });
  advance();
  advance();
  advance();
  h.command("purchase", "selectVendor", {
    id: offer.id,
    version: h.db.Procurements[0].version,
  });
  advance();
  let po = h.db.PurchaseOrders[0];
  po = h.command("purchase", "setPOTerms", {
    id: po.id,
    version: po.version,
    discountPct: 10,
    vatPct: 7,
  });
  po = h.db.PurchaseOrders[0];
  h.command("finance", "payVendor", {
    purchaseOrderId: po.id,
    amount: po.total,
    date: "2026-09-26",
  });
  let line = h.db.PurchaseOrderItems[0];
  h.command("purchase", "receiveItem", {
    id: line.id,
    version: line.version,
    qty: 2,
    date: "2026-09-26",
  });
  for (let n = 0; n < 2; n++) {
    line = h.db.PurchaseOrderItems[0];
    h.command("purchase", "returnPurchaseItem", {
      id: line.id,
      version: line.version,
      qty: 1,
      reason: "Return",
      date: "2026-09-26",
    });
  }
  const A = require("../src/advanced.js");
  assert.equal(A.poBalances(h.db, po).target, 0);
  h.command("finance", "refundVendor", {
    purchaseOrderId: po.id,
    amount: po.total,
    reason: "Refund",
    date: "2026-09-26",
  });
  assert.equal(A.poBalances(h.db, po).paid, 0);
  h.command("sales", "createProcurement", {
    quoteId: id,
    items: [{ quoteItemId: qi.id, qty: 2 }],
  });
  assert.equal(A.profitability(h.db, h.db.Quotations[0]).committedCost, 0);
});

test("notification retries are deduplicated and company edits retain validated branding", () => {
  const h = harness();
  h.command("admin", "saveWorkspaceSettings", { data: { emailEnabled: true } });
  const id = h.quote(),
    q = h.db.Quotations[0],
    requestId = crypto.randomUUID(),
    payload = {
      id,
      version: q.version,
      approverEmail: "approver@example.test",
    };
  h.command("sales", "submitQuote", payload, requestId);
  h.command("sales", "submitQuote", payload, requestId);
  assert.equal(h.db.Outbox.length, 1);
  const company = h.command("admin", "saveMaster", {
    table: "Company",
    data: { name: "Company" },
  });
  // A forged attachment identifier cannot bypass the setBranding validation.
  h.command("admin", "saveMaster", {
    table: "Company",
    id: company.id,
    version: company.version,
    data: { name: "Changed", logoAttachmentId: "foreign" },
  });
  assert.notEqual(h.db.Company[0].logoAttachmentId, "foreign");
});
test("fresh system has no business rows", () => {
  const db = seed();
  assert.equal(db.Quotations.length, 0);
  assert.equal(db.Customers.length, 0);
});

test("document numbers use Bangkok month across UTC month boundary", () => {
  const h = harness();
  const out = D.execute(
    h.db,
    D.user(h.db, "sales@example.test"),
    {
      action: "saveQuote",
      requestId: crypto.randomUUID(),
      payload: {
        customerId: h.customer,
        date: "2026-10-01",
        items: [{ name: "A", qty: 1, price: 100 }],
      },
    },
    { now: "2026-09-30T18:00:00.000Z", uuid: () => crypto.randomUUID() },
  );
  assert.equal(out.result.number, "QT-202610-0001");
  assert.throws(() => D.money(1e16), /แม่นยำ/);
});
test("quote computes totals on server and snapshots customer", () => {
  const h = harness(),
    id = h.quote(),
    q = h.db.Quotations.find((q) => q.id === id);
  assert.equal(q.total, 2140);
  h.command("sales", "saveMaster", {
    table: "Customers",
    id: h.customer,
    version: 1,
    data: { name: "เปลี่ยนชื่อ" },
  });
  assert.equal(q.customer.name, "ลูกค้า ก");
});
test("rejects missing permissions, forged owner, and self approval", () => {
  const h = harness(),
    id = h.quote();
  assert.throws(
    () =>
      h.command("tech", "saveQuote", {
        customerId: h.customer,
        date: "2026-09-26",
        items: [],
      }),
    /สิทธิ์/,
  );
  assert.throws(
    () =>
      h.command("sales", "approveQuote", {
        id,
        version: 1,
        status: "approved",
      }),
    /สิทธิ์/,
  );
  assert.throws(
    () =>
      h.command("sales", "submitQuote", {
        id,
        version: 1,
        approverEmail: "sales@example.test",
      }),
    /สิทธิ์/,
  );
});
test("approval only assigned approver, draft cannot handoff", () => {
  const h = harness(),
    id = h.quote();
  assert.throws(
    () => h.command("sales", "createProcurement", { quoteId: id, items: [] }),
    /อนุมัติ/,
  );
  h.command("sales", "submitQuote", {
    id,
    version: 1,
    approverEmail: "approver@example.test",
  });
  assert.throws(
    () =>
      h.command("admin", "approveQuote", {
        id,
        version: 2,
        status: "approved",
      }),
    /ผู้อนุมัติ/,
  );
});
test("retry is idempotent; changed payload with same key rejected", () => {
  const h = harness(),
    requestId = crypto.randomUUID(),
    payload = { table: "Customers", data: { name: "Retry" } };
  const a = h.command("sales", "saveMaster", payload, requestId),
    b = h.command("sales", "saveMaster", payload, requestId);
  assert.equal(a.id, b.id);
  assert.equal(h.db.Customers.filter((c) => c.name === "Retry").length, 1);
  assert.throws(
    () =>
      h.command(
        "sales",
        "saveMaster",
        { table: "Customers", data: { name: "different" } },
        requestId,
      ),
    /requestId/,
  );
});
test("stale and missing versions cannot overwrite records", () => {
  const h = harness();
  h.command("sales", "saveMaster", {
    table: "Customers",
    id: h.customer,
    version: 1,
    data: { name: "New" },
  });
  for (const version of [1, undefined])
    assert.throws(
      () =>
        h.command("sales", "saveMaster", {
          table: "Customers",
          id: h.customer,
          version,
          data: { name: "Lost" },
        }),
      /โหลดใหม่/,
    );
  assert.equal(h.db.Customers[0].name, "New");
});
test("split procurement tracks quote item and prevents overordering", () => {
  const h = harness(),
    id = h.quote();
  h.approve(id);
  const item = h.db.QuoteItems.find((i) => i.quoteId === id);
  for (let n = 0; n < 2; n++)
    h.command("sales", "createProcurement", {
      quoteId: id,
      items: [{ quoteItemId: item.id, qty: 1 }],
    });
  assert.equal(h.db.Procurements.length, 2);
  assert.throws(
    () =>
      h.command("sales", "createProcurement", {
        quoteId: id,
        items: [{ quoteItemId: item.id, qty: 1 }],
      }),
    /เกิน/,
  );
  assert.equal(h.db.Procurements.length, 2);
});
test("foreign quote item cannot be handed off", () => {
  const h = harness(),
    q1 = h.quote(),
    q2 = h.quote();
  h.approve(q1);
  const item = h.db.QuoteItems.find((i) => i.quoteId === q2);
  assert.throws(
    () =>
      h.command("sales", "createProcurement", {
        quoteId: q1,
        items: [{ quoteItemId: item.id, qty: 1 }],
      }),
    /ไม่ตรง/,
  );
});
test("end-to-end sales, purchase, tech, payments and closing", () => {
  const h = harness(),
    qid = h.quote();
  h.approve(qid);
  const qi = h.db.QuoteItems.find((i) => i.quoteId === qid);
  const pid = h.command("sales", "createProcurement", {
    quoteId: qid,
    items: [{ quoteItemId: qi.id, qty: 2 }],
  }).id;
  const item = h.db.ProcurementItems[0];
  const offer = h.command("purchase", "saveVendorQuote", {
    procurementId: pid,
    itemId: item.id,
    vendorId: h.vendor,
    unitPrice: 600,
  }).id;
  const advance = () => {
    const p = h.db.Procurements.find((x) => x.id === pid);
    h.command("purchase", "advancePurchase", { id: pid, version: p.version });
  };
  advance();
  advance();
  advance();
  assert.throws(advance, /เลือกผู้ขาย/);
  h.command("purchase", "selectVendor", {
    id: offer,
    version: h.db.Procurements[0].version,
  });
  advance();
  const po = h.db.PurchaseOrders[0];
  assert.equal(po.total, 1200);
  assert.equal(h.db.PurchaseOrderItems[0].procurementItemId, item.id);
  assert.throws(
    () =>
      h.command("purchase", "saveVendorQuote", {
        procurementId: pid,
        itemId: item.id,
        vendorId: h.vendor,
        unitPrice: 500,
        version: 1,
      }),
    /ออก PO/,
  );
  advance();
  advance();
  assert.throws(advance, /รับสินค้าไม่ครบ/);
  const poi = h.db.PurchaseOrderItems[0];
  h.command("purchase", "receiveItem", {
    id: poi.id,
    version: poi.version,
    qty: 2,
    date: "2026-09-26",
  });
  advance();
  assert.equal(h.db.Procurements[0].closed, true);
  h.command("finance", "payVendor", {
    purchaseOrderId: po.id,
    amount: 1200,
    date: "2026-09-26",
  });
  const jid = h.command("sales", "assignJob", {
    quoteId: qid,
    title: "ติดตั้ง",
    techEmail: "tech@example.test",
    scheduledAt: "2026-09-26",
  }).id;
  h.command("tech", "addExpense", {
    jobId: jid,
    category: "เดินทาง",
    amount: 100,
    date: "2026-09-26",
  });
  for (let n = 0; n < 3; n++)
    h.command("tech", "advanceJob", {
      id: jid,
      version: h.db.TechJobs[0].version,
      completionNote: n === 2 ? "ส่งมอบแล้ว" : "",
    });
  h.command("finance", "addPayment", {
    quoteId: qid,
    amount: 2100,
    withholding: 40,
    date: "2026-09-26",
  });
  h.command("sales", "closeQuote", {
    id: qid,
    version: h.db.Quotations[0].version,
  });
  assert.equal(h.db.Quotations[0].closed, true);
  assert.ok(h.db.AuditLog.length > 15);
  assert.equal(h.db.TechExpenses[0].jobId, jid);
});
test("tech snapshot never includes prices, unrelated jobs, users or quotes", () => {
  const h = harness(),
    qid = h.quote();
  h.approve(qid);
  h.command("sales", "assignJob", {
    quoteId: qid,
    title: "ติดตั้ง",
    techEmail: "tech@example.test",
    scheduledAt: "2026-09-26",
  });
  const view = D.snapshot(h.db, D.user(h.db, "tech@example.test")).data;
  assert.equal(view.TechJobs.length, 1);
  for (const t of [
    "Quotations",
    "QuoteItems",
    "Payments",
    "Customers",
    "Procurements",
    "VendorQuotes",
    "AuditLog",
    "Requests",
  ])
    assert.equal(view[t].length, 0, t);
  assert.equal(view.Users.length, 1);
});
test("other technician cannot change or access job or attachment", () => {
  const h = harness(),
    qid = h.quote();
  h.approve(qid);
  const jid = h.command("sales", "assignJob", {
    quoteId: qid,
    title: "Test",
    techEmail: "tech@example.test",
    scheduledAt: "2026-09-26",
  }).id;
  h.command("admin", "saveMaster", {
    table: "Users",
    data: {
      name: "Other",
      email: "other@example.test",
      roles: ["tech"],
      active: true,
    },
  });
  assert.throws(
    () => h.command("other", "advanceJob", { id: jid, version: 1 }),
    /สิทธิ์/,
  );
  assert.throws(
    () =>
      D.visibleEntity(
        h.db,
        D.user(h.db, "other@example.test"),
        "TechJobs",
        jid,
        false,
      ),
    /สิทธิ์/,
  );
});
test("overpayment, negative values and invalid dates rejected without writes", () => {
  const h = harness(),
    id = h.quote();
  h.approve(id);
  const before = JSON.stringify(h.db);
  for (const p of [
    { amount: 2141, date: "2026-09-26" },
    { amount: -10, date: "2026-09-26" },
    { amount: 5, date: "2026-02-30" },
  ])
    assert.throws(() =>
      h.command("finance", "addPayment", { quoteId: id, ...p }),
    );
  assert.equal(JSON.stringify(h.db), before);
});
test("contracts retain many quote links and payment aggregation source", () => {
  const h = harness(),
    q1 = h.quote(),
    q2 = h.quote();
  const c = h.command("sales", "saveContract", {
    number: "CT-1",
    name: "Support",
    party: "ลูกค้า",
    start: "2026-01-01",
    end: "2026-12-31",
    value: 4280,
    quoteIds: [q1, q2],
  }).id;
  assert.equal(h.db.ContractQuotes.filter((l) => l.contractId === c).length, 2);
});
test("special quote rows preserved and excluded from totals", () => {
  const h = harness(),
    id = h.command("sales", "saveQuote", {
      customerId: h.customer,
      date: "2026-09-26",
      items: [
        { type: "group", name: "Network" },
        { type: "item", name: "A", qty: 1, price: 100 },
        { type: "pagebreak" },
        { type: "note", description: "ข้อความ" },
      ],
    }).id;
  assert.equal(h.db.Quotations[0].total, 107);
  assert.equal(h.db.QuoteItems.filter((i) => i.quoteId === id).length, 4);
});
test("internal purchases have no fake quote relation", () => {
  const h = harness();
  h.command("purchase", "createProcurement", {
    items: [{ name: "Office PC", qty: 1, unit: "ชุด" }],
  });
  assert.equal(h.db.Procurements[0].quoteId, "");
  assert.equal(h.db.Procurements[0].type, "internal");
});
test("deactivating yourself or omitting roles is rejected", () => {
  const h = harness();
  assert.throws(
    () =>
      h.command("admin", "saveMaster", {
        table: "Users",
        id: "admin",
        version: 1,
        data: {
          name: "Admin",
          email: "admin@example.test",
          roles: ["sales"],
          active: true,
        },
      }),
    /ตนเอง/,
  );
});
