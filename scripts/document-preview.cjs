/* Local review gallery: synthetic data only, no login and no database access. */
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const Forms = require("../src/document-forms.js");
const labels = {
  quotation: "ใบเสนอราคา",
  invoice: "ใบส่งสินค้า / แจ้งหนี้",
  receipt: "ใบเสร็จรับเงิน",
  taxInvoice: "ใบกำกับภาษี",
  purchaseOrder: "ใบสั่งซื้อ",
  rfq: "ใบขอราคา",
  tempDelivery: "ใบส่งของชั่วคราว",
};
const c = {
  name: "บริษัท ตัวอย่างระบบ จำกัด",
  address: "99 ถนนตัวอย่าง แขวงตัวอย่าง\nเขตตัวอย่าง กรุงเทพมหานคร 10000",
  taxId: "0000000000000",
  phone: "02-000-0000",
  email: "office@example.test",
};
const party = {
  name: "บริษัท ลูกค้าตัวอย่าง จำกัด",
  address: "88 ถนนทดสอบ กรุงเทพมหานคร 10000",
  contact: "ผู้ติดต่อทดสอบ",
  phone: "02-111-1111",
  taxId: "0000000000000",
};
const quote = {
  number: "QT-DEMO-001",
  date: "2026-09-27",
  subtotal: 30000,
  discount: 500,
  discountPct: 500 / 300,
  vatPct: 7,
  vat: 2065,
  total: 31565,
  note: "ข้อมูลสมมติสำหรับตรวจรูปแบบเอกสารเท่านั้น",
  terms:
    "การชำระเงิน: ภายใน 30 วัน\nกำหนดส่ง: ภายใน 7 วันหลังยืนยันคำสั่งซื้อ\nการรับประกัน: 3 ปี ตามเงื่อนไขผู้ผลิต",
  paymentTerms: "เครดิต 30 วัน",
  presentation: {
    saleName: "ฝ่ายขายตัวอย่าง",
    salePhone: "02-000-0000",
    saleEmail: "sales@example.test",
    expires: "2026-10-27",
    customerPO: "DEMO-PO-001",
    fonts: { info: 12, items: 12, totals: 12, notes: 12 },
    columns: {
      pn: true,
      qty: true,
      unit: true,
      price: true,
      disc: false,
      total: true,
    },
  },
};
const items = [
  { type: "group", name: "ระบบเครือข่าย / NETWORK" },
  {
    type: "item",
    name: "Network Switch 24 Ports",
    partNo: "SW-24",
    description: "24 Port Gigabit Ethernet\nรับประกันอุปกรณ์ 3 ปี",
    qty: 2,
    unit: "เครื่อง",
    price: 15000,
    total: 30000,
  },
  {
    type: "item",
    name: "บริการติดตั้งและทดสอบระบบ",
    qty: 1,
    unit: "งาน",
    price: 0,
    priceText: "Included",
    total: 0,
  },
];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4176");
  const kind = labels[url.searchParams.get("kind")]
    ? url.searchParams.get("kind")
    : "quotation";
  const s = {
    company: c,
    party,
    quote,
    items,
    copies: [{ label: "ตัวอย่าง — ข้อมูลสมมติ", color: "#1a3a5c" }],
  };
  if (kind === "purchaseOrder") {
    s.po = { ...quote, number: "PO-DEMO-001" };
    delete s.quote;
  }
  if (kind === "rfq") {
    s.rfq = { number: "RFQ-DEMO-001", note: quote.note };
    delete s.quote;
  }
  if (["receipt", "taxInvoice"].includes(kind))
    s.payment = { date: "2026-09-27", amount: 10000, withholding: 0 };
  const doc = {
    kind,
    number: kind.toUpperCase() + "-DEMO-001",
    date: "2026-09-27",
    snapshot: s,
  };
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html lang="th"><meta charset="utf-8"><title>ตัวอย่างเอกสาร DONNET</title><style>' +
      fs.readFileSync(path.resolve(__dirname, "../src/style.css"), "utf8") +
      'body{background:#e2e8f0;padding:24px}.gallery-nav{display:flex;flex-direction:row;gap:12px;flex-wrap:wrap;max-width:1000px;margin:0 auto 20px}.gallery-nav a{background:white;padding:10px;border-radius:6px}.legacy-copy{width:194mm;margin:auto}#print-area{display:block}h1{text-align:center;font-size:20px}</style><h1>ตัวอย่างเอกสารจากแม่แบบเดิม · ข้อมูลสมมติ</h1><nav class="gallery-nav">' +
      Object.entries(labels)
        .map(([k, l]) => '<a href="?kind=' + k + '">' + l + "</a>")
        .join("") +
      '</nav><main id="print-area">' +
      Forms.render(doc) +
      "</main></html>",
  );
});
server.listen(4176, "127.0.0.1", () =>
  console.log("Document gallery: http://127.0.0.1:4176"),
);
