/* Pure business rules, shared by Apps Script, local preview and tests. */
if (typeof module !== "undefined") var Advanced = require("./advanced.js");
var Domain = (function () {
  "use strict";
  const BASE = ["id", "version", "createdAt", "updatedAt"];
  const fields = {
    Users: ["email", "name", "roles", "active"],
    Company: ["name", "address", "taxId", "phone", "email"],
    Customers: [
      "name",
      "contact",
      "phone",
      "email",
      "address",
      "taxId",
      "active",
    ],
    Vendors: [
      "name",
      "contact",
      "phone",
      "email",
      "address",
      "taxId",
      "active",
    ],
    Catalog: ["name", "partNo", "unit", "price", "cost", "vendorId", "active"],
    Quotations: [
      "number",
      "customerId",
      "customer",
      "company",
      "ownerEmail",
      "status",
      "date",
      "discountPct",
      "vatPct",
      "subtotal",
      "discount",
      "vat",
      "total",
      "note",
      "terms",
      "approverEmail",
      "closed",
    ],
    QuoteItems: [
      "quoteId",
      "type",
      "catalogId",
      "name",
      "partNo",
      "description",
      "unit",
      "qty",
      "price",
      "cost",
      "discountPct",
      "total",
      "sort",
    ],
    Approvals: ["quoteId", "status", "comment", "by"],
    Payments: [
      "quoteId",
      "amount",
      "withholding",
      "date",
      "method",
      "reference",
      "note",
    ],
    Procurements: [
      "number",
      "quoteId",
      "type",
      "note",
      "requiredDate",
      "stage",
      "closed",
      "ownerEmail",
    ],
    ProcurementItems: [
      "procurementId",
      "quoteItemId",
      "name",
      "partNo",
      "unit",
      "qty",
      "cost",
    ],
    VendorQuotes: [
      "procurementId",
      "itemId",
      "vendorId",
      "unitPrice",
      "leadDays",
      "note",
      "selected",
    ],
    PurchaseOrders: [
      "number",
      "procurementId",
      "vendorId",
      "vendor",
      "company",
      "total",
      "note",
    ],
    PurchaseOrderItems: [
      "purchaseOrderId",
      "procurementItemId",
      "name",
      "unit",
      "qty",
      "unitPrice",
      "total",
      "received",
    ],
    VendorPayments: ["purchaseOrderId", "amount", "date", "reference", "note"],
    Shipments: ["purchaseOrderId", "date", "tracking", "note"],
    Receipts: ["purchaseOrderId", "purchaseOrderItemId", "qty", "date", "note"],
    TechJobs: [
      "quoteId",
      "title",
      "techEmail",
      "techName",
      "scheduledAt",
      "contact",
      "phone",
      "location",
      "materials",
      "note",
      "status",
      "completionNote",
    ],
    TechExpenses: ["jobId", "category", "amount", "date", "note"],
    DealNotes: ["quoteId", "text", "by"],
    Contracts: ["number", "name", "party", "start", "end", "value", "note"],
    ContractQuotes: ["contractId", "quoteId"],
    Attachments: [
      "entity",
      "entityId",
      "name",
      "mimeType",
      "fileId",
      "url",
      "size",
      "by",
    ],
    AuditLog: ["actor", "action", "entityId", "summary"],
    Requests: ["actor", "requestId", "fingerprint", "result"],
  };
  Object.assign(fields, Advanced.fields);
  Object.entries(Advanced.extensions).forEach(([table, columns]) =>
    fields[table].push(...columns),
  );
  const SCHEMA = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, BASE.concat(v)]),
  );
  const JSON_FIELDS = [
    "roles",
    "customer",
    "company",
    "vendor",
    "result",
    ...Advanced.JSON_FIELDS,
  ];
  const ROLES = ["admin", "sales", "approver", "purchase", "tech", "finance"];
  const STAGES = [
    "",
    "รับงาน",
    "ขอราคา",
    "รับราคา",
    "เทียบราคา",
    "ออก PO",
    "จ่ายเงิน",
    "ยืนยันส่ง",
    "รับของครบ",
  ];
  function empty() {
    return Object.fromEntries(Object.keys(SCHEMA).map((k) => [k, []]));
  }
  function fail(message) {
    throw new Error(message);
  }
  function assert(ok, message) {
    if (!ok) fail(message);
  }
  function str(value, max) {
    const s = String(value == null ? "" : value).trim();
    assert(s.length <= (max || 4000), "ข้อความยาวเกินกำหนด");
    return s;
  }
  function required(value, label) {
    const s = str(value);
    assert(s, "กรุณาระบุ" + label);
    return s;
  }
  function num(value, min, max) {
    const n = Number(value);
    assert(
      Number.isFinite(n) && n >= min && n <= (max == null ? 1e10 : max),
      "จำนวนหรือยอดเงินไม่ถูกต้อง",
    );
    return n;
  }
  function money(n) {
    const cents = Math.round((n + Number.EPSILON) * 100);
    assert(
      Number.isSafeInteger(cents),
      "ยอดเงินเกินขอบเขตที่คำนวณได้อย่างแม่นยำ",
    );
    return cents / 100;
  }
  function date(v, optional) {
    const s = str(v);
    if (!s && optional) return "";
    assert(
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
        !isNaN(Date.parse(s)) &&
        new Date(s).toISOString().slice(0, 10) === s,
      "วันที่ไม่ถูกต้อง",
    );
    return s;
  }
  function email(v) {
    const s = str(v, 254).toLowerCase();
    assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), "อีเมลไม่ถูกต้อง");
    return s;
  }
  function has(user, roles) {
    return (
      user.roles.includes("admin") || roles.some((r) => user.roles.includes(r))
    );
  }
  function permit(user, roles) {
    assert(has(user, roles), "ไม่มีสิทธิ์ทำรายการนี้");
  }
  function get(db, table, id) {
    const r = db[table].find((x) => x.id === id);
    assert(r, "ไม่พบข้อมูล " + table);
    return r;
  }
  function user(db, emailAddress) {
    const u = db.Users.find(
      (x) =>
        x.email === String(emailAddress).toLowerCase() && x.active === true,
    );
    assert(u, "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน");
    return u;
  }
  function ownsQuote(u, q) {
    return (
      has(u, ["approver", "finance"]) ||
      (has(u, ["sales"]) && q.ownerEmail === u.email)
    );
  }
  function quoteRead(db, u, id) {
    const q = get(db, "Quotations", id);
    assert(ownsQuote(u, q), "ไม่มีสิทธิ์เข้าถึงใบเสนอราคานี้");
    return q;
  }
  function quoteWrite(db, u, id) {
    const q = get(db, "Quotations", id);
    assert(
      has(u, []) || (has(u, ["sales"]) && q.ownerEmail === u.email),
      "ไม่มีสิทธิ์แก้ไขใบเสนอราคานี้",
    );
    return q;
  }
  function jobRead(db, u, id) {
    const j = get(db, "TechJobs", id);
    assert(
      has(u, []) ||
        (has(u, ["tech"]) && j.techEmail === u.email) ||
        ownsQuote(u, get(db, "Quotations", j.quoteId)),
      "ไม่มีสิทธิ์เข้าถึงงานช่างนี้",
    );
    return j;
  }
  function visibleEntity(db, u, entity, id, write) {
    if (entity === "CompanyFiles") {
      permit(u, write ? [] : ["finance"]);
      const record = get(db, "CompanyFiles", id);
      if (write) assert(!record.archived, "คืนเอกสารจากแฟ้มเก่าก่อนแนบไฟล์");
      return record;
    }
    if (entity === "Company") {
      if (write) permit(u, []);
      return get(db, "Company", id);
    }
    if (entity === "Vendors") {
      permit(
        u,
        write ? ["purchase"] : ["purchase", "sales", "approver", "finance"],
      );
      return get(db, "Vendors", id);
    }
    if (entity === "Quotations")
      return write && !has(u, ["finance"])
        ? quoteWrite(db, u, id)
        : quoteRead(db, u, id);
    if (entity === "TechJobs") {
      const j = jobRead(db, u, id);
      if (write)
        assert(
          has(u, []) ||
            (has(u, ["tech"]) && j.techEmail === u.email) ||
            (has(u, ["sales"]) &&
              get(db, "Quotations", j.quoteId).ownerEmail === u.email),
          "ไม่มีสิทธิ์แนบไฟล์",
        );
      return j;
    }
    if (entity === "Procurements") {
      const p = get(db, entity, id);
      assert(
        has(u, ["purchase", "finance"]) ||
          (p.quoteId && ownsQuote(u, get(db, "Quotations", p.quoteId))),
        "ไม่มีสิทธิ์เข้าถึงงานจัดซื้อ",
      );
      if (write) permit(u, ["purchase", "finance"]);
      return p;
    }
    fail("ประเภทเอกสารแนบไม่ถูกต้อง");
  }
  function snapshot(db, u) {
    const out = empty();
    const allSales = has(u, ["approver", "finance"]),
      sales = has(u, ["sales"]),
      purchase = has(u, ["purchase", "finance"]);
    out.Company = db.Company;
    out.Users = has(u, [])
      ? db.Users
      : db.Users.filter(
          (x) =>
            x.active &&
            (has(u, ["sales", "purchase", "approver", "finance"]) ||
              x.id === u.id),
        ).map((x) => ({
          id: x.id,
          name: x.name,
          email: x.email,
          roles: x.roles,
        }));
    out.Quotations = db.Quotations.filter(
      (q) => allSales || (sales && q.ownerEmail === u.email),
    );
    const qids = new Set(out.Quotations.map((q) => q.id));
    ["QuoteItems", "Approvals", "Payments", "DealNotes"].forEach(
      (t) => (out[t] = db[t].filter((r) => qids.has(r.quoteId))),
    );
    out.Customers = has(u, ["sales", "approver", "finance"])
      ? db.Customers
      : [];
    out.Vendors = has(u, ["sales", "purchase", "approver", "finance"])
      ? db.Vendors
      : [];
    out.Catalog = has(u, ["sales", "purchase", "approver"]) ? db.Catalog : [];
    out.Procurements = db.Procurements.filter(
      (p) => purchase || qids.has(p.quoteId),
    );
    const pids = new Set(out.Procurements.map((p) => p.id));
    out.ProcurementItems = db.ProcurementItems.filter((i) =>
      pids.has(i.procurementId),
    );
    out.VendorQuotes = db.VendorQuotes.filter((i) => pids.has(i.procurementId));
    out.PurchaseOrders = db.PurchaseOrders.filter((i) =>
      pids.has(i.procurementId),
    );
    const poids = new Set(out.PurchaseOrders.map((p) => p.id));
    ["PurchaseOrderItems", "VendorPayments", "Shipments", "Receipts"].forEach(
      (t) => (out[t] = db[t].filter((i) => poids.has(i.purchaseOrderId))),
    );
    out.TechJobs = db.TechJobs.filter(
      (j) =>
        qids.has(j.quoteId) || (has(u, ["tech"]) && j.techEmail === u.email),
    );
    const jids = new Set(out.TechJobs.map((j) => j.id));
    out.TechExpenses = db.TechExpenses.filter((x) => jids.has(x.jobId));
    out.Contracts = has(u, ["sales", "finance", "approver"])
      ? db.Contracts.filter(
          (c) =>
            has(u, ["finance", "approver"]) ||
            db.ContractQuotes.some(
              (l) => l.contractId === c.id && qids.has(l.quoteId),
            ),
        )
      : [];
    const cids = new Set(out.Contracts.map((c) => c.id));
    out.ContractQuotes = db.ContractQuotes.filter(
      (l) => cids.has(l.contractId) && qids.has(l.quoteId),
    );
    out.CompanyFiles = has(u, ["finance"]) ? db.CompanyFiles : [];
    const companyFileIds = new Set(out.CompanyFiles.map((d) => d.id));
    out.Attachments = db.Attachments.filter((a) =>
      a.entity === "CompanyFiles"
        ? companyFileIds.has(a.entityId)
        : a.entity === "Company" ||
          (a.entity === "Vendors" &&
            out.Vendors.some((v) => v.id === a.entityId)) ||
          (a.entity === "Quotations"
            ? qids.has(a.entityId)
            : a.entity === "Procurements"
              ? pids.has(a.entityId)
              : jids.has(a.entityId)),
    );
    out.AuditLog = has(u, []) ? db.AuditLog.slice(-100).reverse() : [];
    out.Settings = db.Settings;
    out.ApprovalRules = has(u, ["sales", "approver"]) ? db.ApprovalRules : [];
    ["CustomerCredits", "CustomerRefunds"].forEach(
      (t) => (out[t] = db[t].filter((x) => qids.has(x.quoteId))),
    );
    ["PurchaseReturns", "VendorRefunds"].forEach(
      (t) => (out[t] = db[t].filter((x) => poids.has(x.purchaseOrderId))),
    );
    out.RFQs = db.RFQs.filter((x) => pids.has(x.procurementId));
    const rfqIds = new Set(out.RFQs.map((x) => x.id));
    out.Documents = db.Documents.filter(
      (x) =>
        qids.has(x.quoteId) ||
        poids.has(x.purchaseOrderId) ||
        rfqIds.has(x.rfqId) ||
        (x.kind === "tempDelivery" && jids.has(x.snapshot?.job?.id)),
    );
    out.Outbox = has(u, [])
      ? db.Outbox
      : db.Outbox.filter((x) => x.ownerEmail === u.email || x.to === u.email);
    out.BackupLog = has(u, []) ? db.BackupLog : [];
    return {
      user: u,
      data: out,
      stages: STAGES,
      reports: Advanced.reports(out),
    };
  }
  function normalizePresentation(v, h) {
    const result = {};
    for (const k of [
      "tag",
      "source",
      "saleName",
      "salePhone",
      "customerFax",
      "customerPO",
      "validity",
      "paymentMethod",
    ])
      result[k] = h.str(v[k], 200);
    result.saleEmail = h.str(v.saleEmail, 200);
    result.expires = h.date(v.expires, true);
    result.pricePeriod = ["month", "year"].includes(v.pricePeriod)
      ? v.pricePeriod
      : "";
    result.color = /^#[0-9a-f]{6}$/i.test(v.color || "") ? v.color : "#1a3a5c";
    result.fonts = {};
    for (const k of ["info", "items", "totals", "notes"])
      result.fonts[k] = h.num(v.fonts?.[k] ?? 12, 8, 20);
    result.columns = {};
    for (const k of ["pn", "qty", "unit", "price", "disc", "total"])
      result.columns[k] = v.columns?.[k] !== false;
    result.pad = h.num(v.pad ?? 4, 0, 16);
    result.lineHeight = h.num(v.lineHeight ?? 1.35, 1, 2.5);
    result.colLines = v.colLines === true;
    result.discountMode = v.discountMode === "amount" ? "amount" : "pct";
    result.discountAmount = h.num(v.discountAmount || 0, 0);
    return result;
  }
  function execute(source, u, req, ctx) {
    assert(req && typeof req.action === "string", "คำขอไม่ถูกต้อง");
    assert(
      /^[a-zA-Z0-9_-]{12,100}$/.test(req.requestId || ""),
      "requestId ไม่ถูกต้อง",
    );
    const fingerprint = JSON.stringify({
      action: req.action,
      payload: req.payload || {},
    });
    assert(fingerprint.length < 100000, "คำขอใหญ่เกินกำหนด");
    const prior = source.Requests.find(
      (r) => r.actor === u.email && r.requestId === req.requestId,
    );
    if (prior) {
      assert(
        prior.fingerprint === fingerprint,
        "requestId นี้ถูกใช้กับข้อมูลอื่นแล้ว",
      );
      return { db: source, result: prior.result, replayed: true };
    }
    const db = JSON.parse(JSON.stringify(source)),
      p = req.payload || {};
    const now = ctx.now,
      uid = ctx.uuid;
    function add(t, values) {
      const r = Object.assign(
        { id: uid(), version: 1, createdAt: now, updatedAt: now },
        values,
      );
      db[t].push(r);
      return r;
    }
    function change(t, r, values, version) {
      if (version !== undefined)
        assert(
          Number(version) === r.version,
          "ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนบันทึก",
        );
      Object.assign(r, values, { version: r.version + 1, updatedAt: now });
      return r;
    }
    function version(r) {
      assert(
        Number(p.version) === r.version,
        "ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนบันทึก",
      );
    }
    function number(t, prefix) {
      const bangkokMonth = new Date(Date.parse(now) + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 7);
      const key = prefix + "-" + bangkokMonth.replace("-", "") + "-";
      const ns = db[t]
        .filter((r) => (r.number || "").startsWith(key))
        .map((r) => Number(r.number.slice(key.length)));
      return key + String(Math.max(0, ...ns) + 1).padStart(4, "0");
    }
    function active(t, id) {
      const r = get(db, t, id);
      assert(r.active !== false, "ข้อมูลนี้ถูกปิดใช้งานแล้ว");
      return r;
    }
    function approved(q) {
      assert(
        q.status === "approved" && !q.closed,
        "ต้องเป็นใบเสนอราคาที่อนุมัติและยังไม่ปิดงาน",
      );
    }
    const context = {
      db,
      u,
      p,
      req,
      assert,
      permit,
      has,
      get,
      user,
      quoteRead,
      quoteWrite,
      jobRead,
      visibleEntity,
      version,
      add,
      change,
      number,
      active,
      str,
      required,
      num,
      money,
      date,
      email,
      now,
      uid,
    };
    let result;
    switch (req.action) {
      case "saveMaster": {
        const t = p.table;
        assert(
          ["Customers", "Vendors", "Catalog", "Company", "Users"].includes(t),
          "ตารางไม่ถูกต้อง",
        );
        permit(
          u,
          t === "Customers"
            ? ["sales"]
            : t === "Vendors" || t === "Catalog"
              ? ["purchase"]
              : [],
        );
        const data = p.data || {},
          values = {};
        fields[t].forEach((k) => {
          if (k !== "active" && k !== "roles" && !k.endsWith("AttachmentId"))
            values[k] = str(data[k]);
        });
        values.name = required(data.name, "ชื่อ");
        if (t !== "Company") values.active = data.active !== false;
        if (t === "Catalog") {
          values.price = money(num(data.price, 0));
          values.cost = money(num(data.cost, 0));
          if (values.vendorId) active("Vendors", values.vendorId);
        }
        if (t === "Users") {
          values.email = email(data.email);
          values.roles = data.roles;
          assert(
            Array.isArray(values.roles) &&
              values.roles.length &&
              values.roles.every((r) => ROLES.includes(r)),
            "บทบาทไม่ถูกต้อง",
          );
          assert(
            !db.Users.some((x) => x.id !== p.id && x.email === values.email),
            "อีเมลนี้มีอยู่แล้ว",
          );
          if (p.id === u.id)
            assert(
              values.active && values.roles.includes("admin"),
              "ไม่สามารถยกเลิกสิทธิ์ผู้ดูแลของตนเอง",
            );
        }
        if (t === "Company" && db.Company.length) {
          const r = db.Company[0];
          assert(p.id === r.id, "มีข้อมูลบริษัทแล้ว กรุณาแก้ไขรายการเดิม");
        }
        if (p.id) version(get(db, t, p.id));
        result = p.id
          ? change(t, get(db, t, p.id), values, p.version)
          : add(t, values);
        break;
      }
      case "saveQuote": {
        permit(u, ["sales"]);
        const old = p.id ? quoteWrite(db, u, p.id) : null;
        if (old) {
          version(old);
          assert(
            ["draft", "rejected"].includes(old.status),
            "แก้ไขได้เฉพาะฉบับร่างหรือใบที่ไม่อนุมัติ",
          );
        }
        const customer = active("Customers", p.customerId);
        assert(
          Array.isArray(p.items) && p.items.length > 0 && p.items.length <= 100,
          "ต้องมีรายการสินค้า 1–100 บรรทัด",
        );
        const items = p.items.map((it, sort) => {
          const type = it.type || "item";
          const presentation = {
            rowHeight: num(it.rowHeight || 0, 0, 600),
            displayNo: str(it.displayNo, 20),
            priceText: str(it.priceText, 80),
          };
          assert(
            ["item", "group", "note", "blank", "pagebreak"].includes(type),
            "ชนิดบรรทัดไม่ถูกต้อง",
          );
          if (type !== "item")
            return {
              ...presentation,
              type,
              name: str(it.name),
              description: str(it.description),
              sort,
              qty: 0,
              price: 0,
              cost: 0,
              total: 0,
              unit: "",
              partNo: "",
              catalogId: "",
              discountPct: 0,
            };
          assert(
            !presentation.priceText ||
              !Number.isFinite(
                Number(presentation.priceText.replace(/,/g, "")),
              ),
            "ราคาตัวเลขต้องใส่ในช่องราคา",
          );
          if (it.catalogId) active("Catalog", it.catalogId);
          const qty = num(it.qty, 0.001, 1e6),
            price = presentation.priceText ? 0 : money(num(it.price, 0)),
            discountPct = num(it.discountPct || 0, 0, 100);
          return {
            ...presentation,
            type,
            name: required(it.name, "ชื่อสินค้า"),
            catalogId: str(it.catalogId),
            partNo: str(it.partNo),
            description: str(it.description),
            unit: str(it.unit),
            qty,
            price,
            cost: money(num(it.cost || 0, 0)),
            discountPct,
            total: money(qty * price * (1 - discountPct / 100)),
            sort,
          };
        });
        assert(
          items.some((i) => i.type === "item"),
          "ต้องมีสินค้าอย่างน้อย 1 รายการ",
        );
        const subtotal = money(items.reduce((s, i) => s + i.total, 0)),
          discountPct =
            p.discountMode === "amount"
              ? (num(p.discountAmount || 0, 0, subtotal) / (subtotal || 1)) *
                100
              : num(p.discountPct || 0, 0, 100),
          vatPct = num(p.vatPct == null ? 7 : p.vatPct, 0, 100);
        const discount = money((subtotal * discountPct) / 100),
          vat = money(((subtotal - discount) * vatPct) / 100);
        const values = {
          presentation: normalizePresentation(
            p.presentation || old?.presentation || {},
            { str, num, date },
          ),
          customerId: customer.id,
          customer: JSON.parse(JSON.stringify(customer)),
          company: db.Company[0] || {},
          status: "draft",
          date: date(p.date),
          discountPct,
          vatPct,
          subtotal,
          discount,
          vat,
          total: money(subtotal - discount + vat),
          note: str(p.note),
          terms: str(p.terms),
          approverEmail: "",
          closed: false,
        };
        values.presentation.discountMode =
          p.discountMode === "amount" ? "amount" : "pct";
        values.presentation.discountAmount =
          p.discountMode === "amount" ? discount : 0;
        result = old
          ? change("Quotations", old, values)
          : add(
              "Quotations",
              Object.assign(values, {
                number: number("Quotations", "QT"),
                ownerEmail: u.email,
              }),
            );
        db.QuoteItems = db.QuoteItems.filter((i) => i.quoteId !== result.id);
        items.forEach((i) =>
          add("QuoteItems", Object.assign(i, { quoteId: result.id })),
        );
        break;
      }
      case "submitQuote": {
        const q = quoteWrite(db, u, p.id);
        version(q);
        assert(
          ["draft", "rejected"].includes(q.status),
          "สถานะไม่พร้อมส่งอนุมัติ",
        );
        const approver = user(db, email(Advanced.approval(db, q, p, context)));
        permit(approver, ["approver"]);
        assert(
          approver.email !== q.ownerEmail,
          "ผู้อนุมัติต้องเป็นคนละคนกับเจ้าของใบเสนอราคา",
        );
        result = change("Quotations", q, {
          status: "pending",
          approverEmail: approver.email,
          belowCostReason: str(p.belowCostReason || q.belowCostReason),
        });
        break;
      }
      case "approveQuote": {
        permit(u, ["approver"]);
        const q = get(db, "Quotations", p.id);
        version(q);
        assert(
          q.status === "pending" &&
            q.approverEmail === u.email &&
            q.ownerEmail !== u.email,
          "ไม่ใช่ผู้อนุมัติที่กำหนด หรือสถานะไม่พร้อม",
        );
        assert(
          ["approved", "rejected"].includes(p.status),
          "ผลอนุมัติไม่ถูกต้อง",
        );
        if (p.status === "rejected") required(p.comment, "เหตุผลไม่อนุมัติ");
        result = change("Quotations", q, { status: p.status });
        add("Approvals", {
          quoteId: q.id,
          status: p.status,
          comment: str(p.comment),
          by: u.email,
        });
        break;
      }
      case "addPayment": {
        permit(u, ["sales", "finance"]);
        const q = quoteRead(db, u, p.quoteId);
        approved(q);
        const amount = money(num(p.amount, 0.01)),
          withholding = money(num(p.withholding || 0, 0));
        const balance = Advanced.balances(db, q),
          paid = balance.paid;
        assert(
          money(paid + amount + withholding) <= balance.target,
          "ยอดรับเงินรวมภาษีหัก ณ ที่จ่ายเกินยอดคงเหลือ",
        );
        result = add("Payments", {
          quoteId: q.id,
          amount,
          withholding,
          date: date(p.date),
          method: str(p.method),
          reference: str(p.reference),
          note: str(p.note),
        });
        break;
      }
      case "addNote": {
        const q = quoteWrite(db, u, p.quoteId);
        result = add("DealNotes", {
          quoteId: q.id,
          text: required(p.text, "บันทึก"),
          by: u.email,
        });
        break;
      }
      case "createProcurement": {
        let q = null;
        if (p.quoteId) {
          q = quoteWrite(db, u, p.quoteId);
          approved(q);
        } else permit(u, ["purchase"]);
        assert(
          Array.isArray(p.items) && p.items.length > 0 && p.items.length <= 100,
          "ต้องเลือกรายการจัดซื้อ",
        );
        const seen = new Set();
        const items = p.items.map((i) => {
          const qty = num(i.qty, 0.001, 1e6);
          if (q) {
            const qi = get(db, "QuoteItems", i.quoteItemId);
            assert(
              qi.quoteId === q.id && qi.type === "item" && !seen.has(qi.id),
              "รายการสินค้าไม่ตรงกับใบเสนอราคาหรือซ้ำ",
            );
            seen.add(qi.id);
            const used = db.ProcurementItems.filter(
              (x) =>
                x.quoteItemId === qi.id &&
                !get(db, "Procurements", x.procurementId).cancelled,
            ).reduce((s, x) => s + Advanced.reservedQty(db, x), 0);
            assert(
              used + qty <= qi.qty + 1e-8,
              "จำนวนจัดซื้อเกินจำนวนคงเหลือของ " + qi.name,
            );
            return {
              quoteItemId: qi.id,
              name: qi.name,
              partNo: qi.partNo,
              unit: qi.unit,
              qty,
              cost: qi.cost,
            };
          }
          return {
            quoteItemId: "",
            name: required(i.name, "สินค้า"),
            partNo: str(i.partNo),
            unit: str(i.unit),
            qty,
            cost: money(num(i.cost || 0, 0)),
          };
        });
        result = add("Procurements", {
          number: number("Procurements", "PR"),
          quoteId: q ? q.id : "",
          type: q ? "sale" : "internal",
          note: str(p.note),
          requiredDate: date(p.requiredDate, true),
          stage: 1,
          closed: false,
          ownerEmail: u.email,
          assetCategory: str(p.assetCategory || (q ? "" : "ทั่วไป")),
          cancelled: false,
          cancelReason: "",
        });
        items.forEach((i) =>
          add(
            "ProcurementItems",
            Object.assign(i, { procurementId: result.id }),
          ),
        );
        break;
      }
      case "saveVendorQuote": {
        permit(u, ["purchase"]);
        const pr = get(db, "Procurements", p.procurementId);
        assert(
          pr.stage <= 4 && !pr.closed && !pr.cancelled,
          "ออก PO แล้วหรือยกเลิกงาน ไม่สามารถเปลี่ยนราคา",
        );
        const it = get(db, "ProcurementItems", p.itemId);
        assert(it.procurementId === pr.id, "รายการไม่ตรงกับงานจัดซื้อ");
        active("Vendors", p.vendorId);
        const values = {
          procurementId: pr.id,
          itemId: it.id,
          vendorId: p.vendorId,
          unitPrice: money(num(p.unitPrice, 0)),
          leadDays: num(p.leadDays || 0, 0, 3650),
          note: str(p.note),
        };
        const old = db.VendorQuotes.find(
          (v) => v.itemId === it.id && v.vendorId === p.vendorId,
        );
        if (old) version(old);
        result = old
          ? change("VendorQuotes", old, values, p.version)
          : add("VendorQuotes", Object.assign(values, { selected: false }));
        break;
      }
      case "selectVendor": {
        permit(u, ["purchase"]);
        const v = get(db, "VendorQuotes", p.id),
          pr = get(db, "Procurements", v.procurementId);
        version(pr);
        assert(
          pr.stage <= 4 && !pr.closed,
          "ออก PO แล้ว ไม่สามารถเปลี่ยนผู้ขาย",
        );
        db.VendorQuotes.filter((x) => x.itemId === v.itemId).forEach((x) =>
          change("VendorQuotes", x, { selected: x.id === v.id }),
        );
        result = change("Procurements", pr, {});
        break;
      }
      case "advancePurchase": {
        permit(u, ["purchase"]);
        const pr = get(db, "Procurements", p.id);
        version(pr);
        assert(
          !pr.closed && !pr.cancelled && pr.stage < 8,
          "งานอยู่ขั้นสุดท้ายแล้วหรือยกเลิก",
        );
        const next = pr.stage + 1,
          items = db.ProcurementItems.filter((x) => x.procurementId === pr.id);
        if (next === 4)
          assert(
            items.every((i) => db.VendorQuotes.some((v) => v.itemId === i.id)),
            "ต้องมีราคาผู้ขายครบทุกสินค้า",
          );
        if (next === 5) {
          assert(
            items.every((i) =>
              db.VendorQuotes.some((v) => v.itemId === i.id && v.selected),
            ),
            "ต้องเลือกผู้ขายครบทุกสินค้า",
          );
          const selected = db.VendorQuotes.filter(
              (v) => v.procurementId === pr.id && v.selected,
            ),
            vendors = [...new Set(selected.map((v) => v.vendorId))];
          vendors.forEach((vid) => {
            const vendor = active("Vendors", vid);
            const vs = selected.filter((v) => v.vendorId === vid);
            const total = money(
              vs.reduce(
                (s, v) =>
                  s +
                  money(
                    get(db, "ProcurementItems", v.itemId).qty * v.unitPrice,
                  ),
                0,
              ),
            );
            const po = add("PurchaseOrders", {
              number: number("PurchaseOrders", "PO"),
              procurementId: pr.id,
              vendorId: vid,
              vendor,
              company: db.Company[0] || {},
              total,
              subtotal: total,
              discountPct: 0,
              discount: 0,
              vatPct: 0,
              vat: 0,
              creditDays: 0,
              dueDate: "",
              depositPct: 0,
              paymentTerms: "",
              cancelled: false,
              note: "ยอดก่อนภาษีตามราคาที่บันทึก",
            });
            vs.forEach((v) => {
              const i = get(db, "ProcurementItems", v.itemId);
              add("PurchaseOrderItems", {
                purchaseOrderId: po.id,
                procurementItemId: i.id,
                name: i.name,
                unit: i.unit,
                qty: i.qty,
                unitPrice: v.unitPrice,
                total: money(i.qty * v.unitPrice),
                received: 0,
              });
            });
          });
        }
        if (next === 8) {
          const pos = db.PurchaseOrders.filter(
            (x) => x.procurementId === pr.id && !x.cancelled,
          );
          const ids = new Set(pos.map((x) => x.id));
          assert(
            db.PurchaseOrderItems.filter((x) =>
              ids.has(x.purchaseOrderId),
            ).every((x) => x.received >= x.qty),
            "ยังรับสินค้าไม่ครบ",
          );
        }
        result = change("Procurements", pr, {
          stage: next,
          closed: next === 8,
        });
        break;
      }
      case "payVendor": {
        permit(u, ["purchase", "finance"]);
        const po = get(db, "PurchaseOrders", p.purchaseOrderId),
          amount = money(num(p.amount, 0.01));
        assert(!po.cancelled, "PO ถูกยกเลิก");
        const withholding = money(num(p.withholding || 0, 0)),
          balance = Advanced.poBalances(db, po),
          paid = balance.paid;
        assert(
          money(paid + amount + withholding) <= balance.target,
          "ยอดจ่ายเกินยอด PO",
        );
        result = add("VendorPayments", {
          purchaseOrderId: po.id,
          amount,
          withholding,
          date: date(p.date),
          reference: str(p.reference),
          note: str(p.note),
        });
        break;
      }
      case "addShipment": {
        permit(u, ["purchase"]);
        assert(
          !get(db, "PurchaseOrders", p.purchaseOrderId).cancelled,
          "PO ถูกยกเลิก",
        );
        result = add("Shipments", {
          purchaseOrderId: p.purchaseOrderId,
          date: date(p.date),
          tracking: required(p.tracking, "เลขติดตาม/ข้อมูลขนส่ง"),
          note: str(p.note),
        });
        break;
      }
      case "receiveItem": {
        permit(u, ["purchase"]);
        const it = get(db, "PurchaseOrderItems", p.id);
        assert(
          !get(db, "PurchaseOrders", it.purchaseOrderId).cancelled,
          "PO ถูกยกเลิก",
        );
        version(it);
        const qty = num(p.qty, 0.001, 1e6);
        assert(it.received + qty <= it.qty + 1e-8, "รับสินค้าเกินจำนวนสั่ง");
        result = add("Receipts", {
          purchaseOrderId: it.purchaseOrderId,
          purchaseOrderItemId: it.id,
          qty,
          date: date(p.date),
          note: str(p.note),
        });
        change("PurchaseOrderItems", it, { received: it.received + qty });
        break;
      }
      case "assignJob": {
        const q = quoteWrite(db, u, p.quoteId);
        approved(q);
        const tech = user(db, email(p.techEmail));
        permit(tech, ["tech"]);
        result = add("TechJobs", {
          quoteId: q.id,
          title: required(p.title, "ชื่องาน"),
          techEmail: tech.email,
          techName: tech.name,
          scheduledAt: date(p.scheduledAt),
          contact: str(p.contact),
          phone: str(p.phone),
          location: str(p.location),
          materials: str(p.materials),
          note: str(p.note),
          status: "assigned",
          completionNote: "",
        });
        break;
      }
      case "advanceJob": {
        const j = jobRead(db, u, p.id);
        assert(
          has(u, []) || (has(u, ["tech"]) && j.techEmail === u.email),
          "เฉพาะช่างที่รับผิดชอบเท่านั้น",
        );
        version(j);
        const next = {
          assigned: "accepted",
          accepted: "inprogress",
          inprogress: "completed",
        }[j.status];
        assert(next, "งานเสร็จแล้ว");
        if (next === "completed") required(p.completionNote, "สรุปผลการทำงาน");
        result = change("TechJobs", j, {
          status: next,
          completionNote: str(p.completionNote),
        });
        break;
      }
      case "addExpense": {
        const j = jobRead(db, u, p.jobId);
        assert(
          has(u, []) || (has(u, ["tech"]) && j.techEmail === u.email),
          "เฉพาะช่างที่รับผิดชอบเท่านั้น",
        );
        assert(
          !["completed", "cancelled"].includes(j.status),
          "งานเสร็จหรือยกเลิกแล้ว",
        );
        result = add("TechExpenses", {
          jobId: j.id,
          category: required(p.category, "ประเภทค่าใช้จ่าย"),
          amount: money(num(p.amount, 0.01)),
          date: date(p.date),
          note: str(p.note),
        });
        break;
      }
      case "saveContract": {
        permit(u, ["sales", "finance"]);
        assert(
          Array.isArray(p.quoteIds) && p.quoteIds.length,
          "ต้องเชื่อมใบเสนอราคาอย่างน้อย 1 ใบ",
        );
        [...new Set(p.quoteIds)].forEach((id) => quoteRead(db, u, id));
        const values = {
          number: required(p.number, "เลขสัญญา"),
          name: required(p.name, "ชื่อสัญญา"),
          party: required(p.party, "คู่สัญญา"),
          start: date(p.start),
          end: date(p.end),
          value: money(num(p.value, 0)),
          note: str(p.note),
        };
        assert(values.end >= values.start, "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม");
        values.alertDays = num(p.alertDays || 30, 1, 365);
        values.alertEmails = (p.alertEmails || []).map(email);
        values.alertEmails.forEach((address) =>
          assert(
            db.Users.some((x) => x.email === address && x.active),
            "ผู้รับแจ้งเตือนต้องเป็นผู้ใช้ระบบ",
          ),
        );
        assert(
          !db.Contracts.some(
            (c) => c.number === values.number && c.id !== p.id,
          ),
          "เลขสัญญาซ้ำ",
        );
        if (p.id) {
          const c = get(db, "Contracts", p.id);
          db.ContractQuotes.filter((x) => x.contractId === c.id).forEach((l) =>
            quoteRead(db, u, l.quoteId),
          );
          version(c);
          result = change("Contracts", c, values);
          db.ContractQuotes = db.ContractQuotes.filter(
            (x) => x.contractId !== c.id,
          );
        } else result = add("Contracts", values);
        [...new Set(p.quoteIds)].forEach((quoteId) =>
          add("ContractQuotes", { contractId: result.id, quoteId }),
        );
        break;
      }
      case "closeQuote": {
        const q = quoteWrite(db, u, p.id);
        version(q);
        approved(q);
        assert(
          db.Procurements.filter((x) => x.quoteId === q.id).every(
            (x) => x.closed || x.cancelled,
          ),
          "ยังมีงานจัดซื้อไม่เสร็จ",
        );
        assert(
          db.TechJobs.filter((x) => x.quoteId === q.id).every((x) =>
            ["completed", "cancelled"].includes(x.status),
          ),
          "ยังมีงานช่างไม่เสร็จ",
        );
        assert(
          Advanced.balances(db, q).paid === Advanced.balances(db, q).target,
          "ยังรับเงินไม่ครบ",
        );
        result = change("Quotations", q, { closed: true });
        break;
      }
      case "attachFile": {
        const parentRecord = visibleEntity(db, u, p.entity, p.entityId, true);
        if (p.entity === "CompanyFiles") version(parentRecord);
        if (p.relatedTable || p.relatedId) {
          assert(
            [
              "Payments",
              "VendorPayments",
              "TechExpenses",
              "Receipts",
              "RFQs",
            ].includes(p.relatedTable),
            "ประเภทหลักฐานไม่ถูกต้อง",
          );
          const related = get(db, p.relatedTable, p.relatedId);
          const parent =
            p.relatedTable === "Payments"
              ? related.quoteId
              : p.relatedTable === "TechExpenses"
                ? related.jobId
                : p.relatedTable === "RFQs"
                  ? related.procurementId
                  : get(db, "PurchaseOrders", related.purchaseOrderId)
                      .procurementId;
          const parentType =
            p.relatedTable === "Payments"
              ? "Quotations"
              : p.relatedTable === "TechExpenses"
                ? "TechJobs"
                : "Procurements";
          assert(
            parent === p.entityId && parentType === p.entity,
            "หลักฐานไม่ตรงกับงาน",
          );
        }
        assert(ctx.file && ctx.file.id, "ไม่พบไฟล์ที่อัปโหลด");
        result = add("Attachments", {
          entity: p.entity,
          entityId: p.entityId,
          name: required(ctx.file.name, "ชื่อไฟล์"),
          mimeType: ctx.file.mimeType,
          fileId: ctx.file.id,
          url: ctx.file.url,
          size: ctx.file.size,
          by: u.email,
          relatedTable: str(p.relatedTable),
          relatedId: str(p.relatedId),
        });
        if (p.entity === "CompanyFiles")
          change("CompanyFiles", parentRecord, {
            currentAttachmentId: result.id,
          });
        break;
      }
      default:
        result = Advanced.execute(context);
        if (!result) fail("ไม่รู้จักคำสั่ง");
    }
    Advanced.after(context, result);
    const reply = {
      id: result.id,
      number: result.number || "",
      version: result.version,
    };
    add("AuditLog", {
      actor: u.email,
      action: req.action,
      entityId: result.id,
      summary: result.number || result.name || result.title || req.action,
    });
    add("Requests", {
      actor: u.email,
      requestId: req.requestId,
      fingerprint,
      result: reply,
    });
    Object.entries(db).forEach(([t, rows]) =>
      rows.forEach((r) =>
        assert(
          SCHEMA[t].every(
            (k) =>
              JSON.stringify(r[k] === undefined ? "" : r[k]).length < 45000,
          ),
          "ข้อมูลหนึ่งช่องใหญ่เกินกำหนด",
        ),
      ),
    );
    return { db, result: reply, replayed: false };
  }
  function allowedAttachmentType(entity, mimeType) {
    return (
      /^(image\/(png|jpeg|webp)|application\/pdf)$/.test(mimeType) ||
      (entity === "CompanyFiles" &&
        [
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "text/plain",
          "text/csv",
        ].includes(mimeType))
    );
  }
  return {
    allowedAttachmentType,
    SCHEMA,
    JSON_FIELDS,
    ROLES,
    STAGES,
    empty,
    user,
    has,
    snapshot,
    execute,
    visibleEntity,
    money,
  };
})();
if (typeof module !== "undefined") module.exports = Domain;
