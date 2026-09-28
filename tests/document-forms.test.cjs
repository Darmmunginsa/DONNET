const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const D = require("../src/domain.js"),
  Forms = require("../src/document-forms.js"),
  { seed } = require("../scripts/fixtures.cjs");
function setup() {
  let db = seed();
  const command = (action, payload) => {
    const out = D.execute(
      db,
      D.user(db, "admin@example.test"),
      { action, payload, requestId: crypto.randomUUID() },
      { now: "2026-09-27T01:00:00Z", uuid: () => crypto.randomUUID() },
    );
    db = out.db;
    return db.Quotations.find((x) => x.id === out.result.id) || out.result;
  };
  const customer = command("saveMaster", {
    table: "Customers",
    data: { name: "บริษัทตัวอย่าง", active: true },
  });
  return {
    command,
    customer,
    get db() {
      return db;
    },
  };
}
function payload(h) {
  return {
    customerId: h.customer.id,
    date: "2026-09-27",
    items: [
      { type: "item", name: "Switch", qty: 2, price: 1000, cost: 500 },
      {
        type: "item",
        name: "Install",
        qty: 1,
        price: 9999,
        priceText: "Included",
        rowHeight: 42,
        displayNo: "A.2",
      },
    ],
    discountMode: "amount",
    discountAmount: 100,
    presentation: {
      discountMode: "amount",
      discountAmount: 100,
      fonts: { items: 14 },
      columns: { pn: false },
      saleName: "Test",
      expires: "2026-10-27",
    },
  };
}
test("Included is zero, amount discount is server-calculated, and layout survives saving and issuance", () => {
  const h = setup(),
    q = h.command("saveQuote", payload(h));
  assert.equal(q.total, 2033);
  assert.equal(q.discount, 100);
  assert.equal(q.presentation.columns.pn, false);
  const i = h.db.QuoteItems.find((i) => i.priceText);
  assert.equal(i.price, 0);
  assert.equal(i.total, 0);
  assert.equal(i.rowHeight, 42);
  assert.equal(i.displayNo, "A.2");
  const saved = h.command("saveQuote", {
    ...payload(h),
    id: q.id,
    version: q.version,
    presentation: undefined,
  });
  assert.equal(saved.presentation.fonts.items, 14);
  const doc = h.command("issueDocument", {
    kind: "quotation",
    quoteId: q.id,
    date: q.date,
  });
  h.command("saveQuote", {
    ...payload(h),
    id: q.id,
    version: saved.version,
    presentation: { fonts: { items: 10 } },
  });
  assert.equal(
    h.db.Documents.find((d) => d.id === doc.id).snapshot.quote.presentation
      .fonts.items,
    14,
  );
});
test("layout bounds and excessive amount discounts reject without writes", () => {
  for (const extra of [
    { discountAmount: 2001 },
    { presentation: { fonts: { items: 500 } } },
    { presentation: { lineHeight: -1 } },
    { items: [{ name: "Bad", qty: 1, price: 1, rowHeight: 601 }] },
  ]) {
    const h = setup();
    assert.throws(() => h.command("saveQuote", { ...payload(h), ...extra }));
    assert.equal(h.db.Quotations.length, 0);
  }
  const h = setup();
  assert.throws(() =>
    h.command("saveQuote", {
      ...payload(h),
      items: [{ name: "Free", qty: 1, price: 0 }],
      discountAmount: 1,
    }),
  );
});
function sample() {
  return {
    kind: "quotation",
    number: "DOC-1",
    date: "2026-09-27",
    snapshot: {
      company: { name: "Sample & Co" },
      party: { name: "Customer" },
      quote: {
        number: "QT-1",
        date: "2026-09-27",
        subtotal: 2000,
        discount: 100,
        vat: 133,
        vatPct: 7,
        total: 2033,
        note: "A & B <script>bad()</script>",
        terms: "Payment: 30 days",
        presentation: {
          columns: {
            pn: false,
            qty: true,
            unit: true,
            price: true,
            disc: true,
            total: true,
          },
        },
      },
      items: [
        {
          name: "First",
          type: "item",
          qty: 2,
          price: 1000,
          total: 2000,
          unit: "<img src=x onerror=bad()>",
        },
        { type: "pagebreak" },
        {
          name: "Included",
          type: "item",
          qty: 1,
          price: 0,
          priceText: "Included",
          total: 0,
        },
      ],
    },
  };
}
test("quotation escapes content, repeats page header, hides selected columns and totals once", () => {
  const html = Forms.render(sample());
  assert.equal((html.match(/class="pdf-page"/g) || []).length, 2);
  assert.equal((html.match(/Quotation No\./g) || []).length, 2);
  assert.equal((html.match(/GRAND TOTAL/g) || []).length, 1);
  assert(!html.includes("Part No."));
  assert(!html.includes("<script>"));
  assert(!html.includes("<img src=x"));
  assert(html.includes("A &amp; B &lt;script&gt;"));
  assert(!html.includes("A &amp;amp;"));
  assert(html.includes("Included"));
});
test("receipt shows only the paid installment, and every document kind renders", () => {
  const doc = sample();
  doc.snapshot.payment = { amount: 1040, withholding: 30, date: "2026-09-27" };
  doc.kind = "receipt";
  const html = Forms.render(doc);
  assert(html.includes("1,070.00"));
  assert(html.includes("1,040.00"));
  assert(!html.includes("First"));
  for (const kind of ["invoice", "taxInvoice", "purchaseOrder", "rfq"]) {
    const d = sample();
    d.kind = kind;
    assert(Forms.render(d).includes("legacy-items"));
  }
});
test("baht text rounds to cents before integer conversion", () => {
  assert.equal(Forms.bahtText(0.999), "หนึ่งบาทถ้วน");
  assert.equal(Forms.bahtText(21.25), "ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์");
  assert.equal(Forms.bahtText(0), "ศูนย์บาทถ้วน");
});

test("numeric text cannot print an amount that differs from ledger totals", () => {
  const h = setup();
  for (const priceText of ["100", "1,000", "1e2"])
    assert.throws(() =>
      h.command("saveQuote", {
        ...payload(h),
        items: [{ name: "Mismatch", qty: 1, price: 0, priceText }],
      }),
    );
});
