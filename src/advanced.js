/* Extended workflows. No network or storage: all mutations run inside Domain's lock/transaction. */
var Advanced = (function () {
  "use strict";
  const fields = {
    Settings: ["key", "value"],
    ApprovalRules: [
      "name",
      "minAmount",
      "maxAmount",
      "approverEmail",
      "belowCostOnly",
      "priority",
      "active",
    ],
    CustomerCredits: ["quoteId", "amount", "reason", "date"],
    CustomerRefunds: ["quoteId", "amount", "withholding", "reason", "date"],
    PurchaseReturns: [
      "purchaseOrderId",
      "purchaseOrderItemId",
      "qty",
      "amount",
      "reason",
      "date",
    ],
    VendorRefunds: [
      "purchaseOrderId",
      "amount",
      "withholding",
      "reason",
      "date",
    ],
    RFQs: [
      "number",
      "procurementId",
      "vendorId",
      "vendor",
      "itemIds",
      "note",
      "replyDue",
    ],
    Documents: [
      "number",
      "kind",
      "quoteId",
      "purchaseOrderId",
      "paymentId",
      "rfqId",
      "date",
      "snapshot",
      "by",
    ],
    Outbox: [
      "to",
      "subject",
      "body",
      "entity",
      "entityId",
      "ownerEmail",
      "status",
      "attempts",
      "sentAt",
      "error",
      "dedupeKey",
    ],
    BackupLog: ["name", "fileId", "status", "note"],
  };
  const extensions = {
    Company: [
      "branch",
      "logoAttachmentId",
      "signatureAttachmentId",
      "stampAttachmentId",
    ],
    Quotations: [
      "expectedClose",
      "probability",
      "dealStage",
      "belowCostReason",
      "revisionOf",
      "revision",
    ],
    Procurements: ["assetCategory", "cancelled", "cancelReason"],
    PurchaseOrders: [
      "subtotal",
      "discountPct",
      "discount",
      "vatPct",
      "vat",
      "creditDays",
      "dueDate",
      "depositPct",
      "paymentTerms",
      "cancelled",
    ],
    VendorPayments: ["withholding"],
    TechJobs: ["cancelReason"],
    Contracts: ["alertDays", "alertEmails"],
    Attachments: ["relatedTable", "relatedId"],
  };
  const JSON_FIELDS = ["value", "itemIds", "snapshot", "alertEmails"];
  const sum = (rows, key) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);
  const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  function reservedQty(db, item) {
    const ids = new Set(
      db.PurchaseOrderItems.filter((x) => x.procurementItemId === item.id).map(
        (x) => x.id,
      ),
    );
    return Math.max(
      0,
      item.qty -
        sum(
          db.PurchaseReturns.filter((x) => ids.has(x.purchaseOrderItemId)),
          "qty",
        ),
    );
  }
  function config(db) {
    return db.Settings.find((r) => r.key === "workspace")?.value || {};
  }
  function balances(db, q) {
    const credits = sum(
      db.CustomerCredits.filter((x) => x.quoteId === q.id),
      "amount",
    );
    const payments = db.Payments.filter((x) => x.quoteId === q.id),
      refunds = db.CustomerRefunds.filter((x) => x.quoteId === q.id);
    return {
      target: round(q.total - credits),
      paid: round(
        sum(payments, "amount") +
          sum(payments, "withholding") -
          sum(refunds, "amount") -
          sum(refunds, "withholding"),
      ),
      credits,
    };
  }
  function poBalances(db, po) {
    const credits = sum(
        db.PurchaseReturns.filter((x) => x.purchaseOrderId === po.id),
        "amount",
      ),
      payments = db.VendorPayments.filter((x) => x.purchaseOrderId === po.id),
      refunds = db.VendorRefunds.filter((x) => x.purchaseOrderId === po.id);
    return {
      target: round(po.total - credits),
      paid: round(
        sum(payments, "amount") +
          sum(payments, "withholding") -
          sum(refunds, "amount") -
          sum(refunds, "withholding"),
      ),
      credits,
    };
  }
  function profitability(db, q) {
    const rows = db.QuoteItems.filter(
      (x) => x.quoteId === q.id && x.type === "item",
    );
    let committed = 0,
      forecastCost = 0;
    const details = rows.map((i) => {
      const procurementIds = new Set(
        db.ProcurementItems.filter((p) => p.quoteItemId === i.id).map(
          (p) => p.id,
        ),
      );
      const ordered = db.PurchaseOrderItems.filter(
        (x) =>
          procurementIds.has(x.procurementItemId) &&
          !db.PurchaseOrders.find((p) => p.id === x.purchaseOrderId)?.cancelled,
      );
      let qty = 0,
        cost = 0;
      ordered.forEach((line) => {
        const po = db.PurchaseOrders.find((p) => p.id === line.purchaseOrderId),
          returned = sum(
            db.PurchaseReturns.filter((x) => x.purchaseOrderItemId === line.id),
            "qty",
          );
        const netQty = Math.max(0, line.qty - returned);
        qty += netQty;
        cost +=
          netQty * line.unitPrice * (1 - Number(po?.discountPct || 0) / 100);
      });
      committed += cost;
      const estimate = cost + Math.max(0, i.qty - qty) * i.cost;
      forecastCost += estimate;
      return {
        id: i.id,
        name: i.name,
        qty: i.qty,
        orderedQty: qty,
        committedCost: round(cost),
        forecastCost: round(estimate),
        revenue: round(i.total * (1 - q.discountPct / 100)),
      };
    });
    const jobIds = new Set(
      db.TechJobs.filter((j) => j.quoteId === q.id).map((j) => j.id),
    );
    const expenses = sum(
      db.TechExpenses.filter((e) => jobIds.has(e.jobId)),
      "amount",
    );
    const credits = sum(
      db.CustomerCredits.filter((c) => c.quoteId === q.id),
      "amount",
    );
    const revenue = round(
      q.subtotal - q.discount - credits / (1 + q.vatPct / 100),
    );
    const profit = round(revenue - forecastCost - expenses);
    return {
      quoteId: q.id,
      number: q.number,
      revenue,
      committedCost: round(committed),
      forecastCost: round(forecastCost),
      expenses,
      profit,
      margin: revenue ? round((profit / revenue) * 100) : 0,
      details,
    };
  }
  function reports(db) {
    const quotes = db.Quotations.filter(
      (q) => !["cancelled", "superseded"].includes(q.status),
    );
    const margins = quotes.map((q) => profitability(db, q));
    const months = {};
    quotes
      .filter((q) => !q.closed && q.dealStage !== "lost")
      .forEach((q) => {
        const month = (q.expectedClose || q.date).slice(0, 7),
          probability =
            q.dealStage === "won" ? 100 : Number(q.probability ?? 50);
        const net = q.subtotal - q.discount;
        months[month] ??= { month, pipeline: 0, weighted: 0, count: 0 };
        months[month].pipeline = round(months[month].pipeline + net);
        months[month].weighted = round(
          months[month].weighted + (net * probability) / 100,
        );
        months[month].count++;
      });
    return {
      margins,
      forecast: Object.values(months).sort((a, b) =>
        a.month.localeCompare(b.month),
      ),
    };
  }
  function approval(db, q, p, h) {
    const cost = db.QuoteItems.filter(
        (i) => i.quoteId === q.id && i.type === "item",
      ).reduce((s, i) => s + i.qty * i.cost, 0),
      below = q.subtotal - q.discount < round(cost);
    if (below)
      h.required(p.belowCostReason || q.belowCostReason, "เหตุผลขายต่ำกว่าทุน");
    const candidates = db.ApprovalRules.filter(
      (r) =>
        r.active &&
        q.total >= r.minAmount &&
        q.total <= r.maxAmount &&
        (!r.belowCostOnly || below),
    ).sort(
      (a, b) =>
        Number(b.belowCostOnly) - Number(a.belowCostOnly) ||
        b.priority - a.priority ||
        b.minAmount - a.minAmount,
    );
    const rulesExist = db.ApprovalRules.some((r) => r.active);
    if (rulesExist)
      h.assert(
        candidates.length,
        "ไม่มีกฎผู้อนุมัติที่ครอบคลุมวงเงินนี้ กรุณาติดต่อผู้ดูแล",
      );
    return candidates[0]?.approverEmail || p.approverEmail;
  }
  function queue(c, to, subject, body, entity, entityId, key) {
    if (!config(c.db).emailEnabled) return;
    const target = c.email(to);
    if (c.db.Outbox.some((o) => o.dedupeKey === key)) return;
    return c.add("Outbox", {
      to: target,
      subject: c.str(subject, 300),
      body: c.str(body, 12000),
      entity,
      entityId,
      ownerEmail: c.u.email,
      status: "pending",
      attempts: 0,
      sentAt: "",
      error: "",
      dedupeKey: key,
    });
  }
  function after(c, result) {
    const { db, req, p, u } = c;
    if (req.action === "submitQuote")
      queue(
        c,
        result.approverEmail,
        "ขออนุมัติ " + result.number,
        "มีใบเสนอราคารออนุมัติ " +
          result.number +
          "\nกรุณาเข้าระบบ D On Net เพื่อตรวจรายละเอียด",
        "Quotations",
        result.id,
        "approval:" + result.id + ":" + result.version,
      );
    if (req.action === "approveQuote")
      queue(
        c,
        result.ownerEmail,
        "ผลอนุมัติ " + result.number,
        "สถานะ " + result.status + "\n" + c.str(p.comment),
        "Quotations",
        result.id,
        "result:" + result.id + ":" + result.version,
      );
    if (req.action === "assignJob")
      queue(
        c,
        result.techEmail,
        "งานใหม่: " + result.title,
        "นัดหมาย " +
          result.scheduledAt +
          "\nกรุณาเปิดระบบ D On Net เพื่อตรวจงาน",
        "TechJobs",
        result.id,
        "job:" + result.id,
      );
    if (["advanceJob", "cancelJob", "reassignJob"].includes(req.action))
      queue(
        c,
        db.Quotations.find((q) => q.id === result.quoteId).ownerEmail,
        "อัปเดตงาน " + result.title,
        "สถานะ " + result.status,
        "TechJobs",
        result.id,
        "job-status:" + result.id + ":" + result.version,
      );
    if (req.action === "saveQuote" && !result.expectedClose) {
      result.expectedClose = result.date;
      result.probability = 50;
      result.dealStage = "open";
      result.revision = 1;
      result.revisionOf = "";
      result.belowCostReason = "";
    }
    if (
      ["createProcurement", "assignJob"].includes(req.action) &&
      result.quoteId
    ) {
      const q = db.Quotations.find((q) => q.id === result.quoteId);
      if (q.dealStage !== "won")
        c.change("Quotations", q, { dealStage: "won", probability: 100 });
    }
    if (req.action === "closeQuote") result.dealStage = "won";
  }
  function execute(c) {
    const {
      db,
      u,
      p,
      req,
      assert,
      permit,
      has,
      get,
      quoteRead,
      quoteWrite,
      jobRead,
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
    } = c;
    let r;
    switch (req.action) {
      case "saveWorkspaceSettings": {
        permit(u, []);
        const v = p.data || {},
          copies = v.documentCopies || [
            { label: "ต้นฉบับ · ลูกค้า", color: "#17654f" },
          ];
        assert(
          Array.isArray(copies) && copies.length > 0 && copies.length <= 5,
          "จำนวนสำเนาต้องเป็น 1–5 ชุด",
        );
        const value = {
          emailEnabled: v.emailEnabled === true,
          backupEnabled: v.backupEnabled === true,
          reminderDays: num(v.reminderDays ?? 30, 1, 365),
          documentCopies: copies.map((x) => {
            assert(/^#[a-fA-F0-9]{6}$/.test(x.color), "สีเอกสารไม่ถูกต้อง");
            return { label: required(x.label, "ชื่อสำเนา"), color: x.color };
          }),
        };
        const old = db.Settings.find((x) => x.key === "workspace");
        if (old) {
          version(old);
          r = change("Settings", old, { value });
        } else r = add("Settings", { key: "workspace", value });
        return r;
      }
      case "saveApprovalRule": {
        permit(u, []);
        const approver = c.user(db, email(p.approverEmail));
        permit(approver, ["approver"]);
        const values = {
          name: required(p.name, "ชื่อกฎ"),
          minAmount: money(num(p.minAmount, 0)),
          maxAmount: money(num(p.maxAmount, 0)),
          approverEmail: approver.email,
          belowCostOnly: p.belowCostOnly === true,
          priority: num(p.priority || 0, 0, 1000),
          active: p.active !== false,
        };
        assert(
          values.maxAmount >= values.minAmount,
          "วงเงินสูงสุดต้องไม่น้อยกว่าวงเงินต่ำสุด",
        );
        if (p.id) {
          r = get(db, "ApprovalRules", p.id);
          version(r);
          return change("ApprovalRules", r, values);
        }
        return add("ApprovalRules", values);
      }
      case "updatePipeline": {
        r = quoteWrite(db, u, p.id);
        version(r);
        assert(
          !r.closed && !["cancelled", "superseded"].includes(r.status),
          "งานปิดหรือยกเลิกแล้ว",
        );
        assert(
          ["open", "won", "lost"].includes(p.dealStage),
          "สถานะโอกาสขายไม่ถูกต้อง",
        );
        return change("Quotations", r, {
          expectedClose: date(p.expectedClose),
          probability: num(p.probability, 0, 100),
          dealStage: p.dealStage,
        });
      }
      case "copyQuote":
      case "reviseQuote": {
        const q = quoteWrite(db, u, p.id);
        version(q);
        assert(!q.closed, "เปิดงานที่ปิดแล้วก่อนสร้างฉบับแก้ไข");
        if (req.action === "reviseQuote") {
          assert(
            ["approved", "rejected", "draft"].includes(q.status),
            "สถานะนี้สร้างฉบับแก้ไขไม่ได้",
          );
          assert(
            !db.Procurements.some((x) => x.quoteId === q.id && !x.cancelled) &&
              !db.TechJobs.some(
                (x) => x.quoteId === q.id && x.status !== "cancelled",
              ) &&
              !db.Payments.some((x) => x.quoteId === q.id),
            "มีงานหรือการเงินเชื่อมแล้ว ให้คัดลอกใบใหม่แทนการแทนที่ใบเดิม",
          );
          change("Quotations", q, { status: "superseded" });
        }
        const values = Object.fromEntries(
          Object.entries(q).filter(
            ([k]) => !["id", "version", "createdAt", "updatedAt"].includes(k),
          ),
        );
        Object.assign(values, {
          number: number("Quotations", "QT"),
          status: "draft",
          approverEmail: "",
          closed: false,
          revisionOf: req.action === "reviseQuote" ? q.id : "",
          revision:
            req.action === "reviseQuote" ? Number(q.revision || 1) + 1 : 1,
          ownerEmail: u.email,
        });
        r = add("Quotations", values);
        db.QuoteItems.filter((i) => i.quoteId === q.id).forEach((i) =>
          add("QuoteItems", {
            ...Object.fromEntries(
              Object.entries(i).filter(
                ([k]) =>
                  !["id", "version", "createdAt", "updatedAt"].includes(k),
              ),
            ),
            quoteId: r.id,
          }),
        );
        return r;
      }
      case "cancelQuote": {
        r = quoteWrite(db, u, p.id);
        version(r);
        assert(
          !r.closed && !["cancelled", "superseded"].includes(r.status),
          "สถานะไม่พร้อมยกเลิก",
        );
        assert(
          !db.Procurements.some((x) => x.quoteId === r.id && !x.cancelled) &&
            !db.TechJobs.some(
              (x) => x.quoteId === r.id && x.status !== "cancelled",
            ),
          "ยกเลิกงานจัดซื้อและงานช่างที่เกี่ยวข้องก่อน",
        );
        assert(
          balances(db, r).paid === 0,
          "ต้องบันทึกปรับยอดและคืนเงินก่อนยกเลิก",
        );
        add("DealNotes", {
          quoteId: r.id,
          text: "ยกเลิก: " + required(p.reason, "เหตุผล"),
          by: u.email,
        });
        return change("Quotations", r, {
          status: "cancelled",
          dealStage: "lost",
        });
      }
      case "reopenQuote": {
        r = quoteWrite(db, u, p.id);
        version(r);
        assert(
          r.closed && r.status === "approved",
          "เปิดใหม่ได้เฉพาะงานที่ปิดแล้ว",
        );
        add("DealNotes", {
          quoteId: r.id,
          text: "เปิดงานใหม่: " + required(p.reason, "เหตุผล"),
          by: u.email,
        });
        return change("Quotations", r, { closed: false });
      }
      case "cancelProcurement": {
        r = get(db, "Procurements", p.id);
        assert(
          has(u, ["purchase"]) || (r.quoteId && quoteWrite(db, u, r.quoteId)),
          "ไม่มีสิทธิ์",
        );
        version(r);
        assert(!r.cancelled, "งานถูกยกเลิกแล้ว");
        assert(
          !db.PurchaseOrders.some(
            (po) => po.procurementId === r.id && !po.cancelled,
          ),
          "ยกเลิก PO ทุกใบก่อนยกเลิกงานจัดซื้อ",
        );
        return change("Procurements", r, {
          cancelled: true,
          closed: true,
          cancelReason: required(p.reason, "เหตุผล"),
        });
      }
      case "cancelPurchaseOrder": {
        permit(u, ["purchase"]);
        r = get(db, "PurchaseOrders", p.id);
        version(r);
        assert(!r.cancelled, "PO ถูกยกเลิกแล้ว");
        const items = db.PurchaseOrderItems.filter(
          (x) => x.purchaseOrderId === r.id,
        );
        assert(
          items.every(
            (x) =>
              x.received -
                sum(
                  db.PurchaseReturns.filter(
                    (t) => t.purchaseOrderItemId === x.id,
                  ),
                  "qty",
                ) ===
              0,
          ),
          "คืนสินค้าที่รับมาแล้วก่อน",
        );
        assert(poBalances(db, r).paid === 0, "ต้องรับเงินคืนจากผู้ขายก่อน");
        return change("PurchaseOrders", r, {
          cancelled: true,
          note: r.note + "\nยกเลิก: " + required(p.reason, "เหตุผล"),
        });
      }
      case "cancelJob":
      case "reassignJob":
      case "reopenJob": {
        r = get(db, "TechJobs", p.id);
        quoteWrite(db, u, r.quoteId);
        version(r);
        required(p.reason, "เหตุผล");
        if (req.action === "cancelJob") {
          assert(
            r.status !== "completed" && r.status !== "cancelled",
            "งานเสร็จหรือยกเลิกแล้ว",
          );
          return change("TechJobs", r, {
            status: "cancelled",
            cancelReason: p.reason,
          });
        }
        if (req.action === "reopenJob") {
          assert(
            r.status === "completed" &&
              !get(db, "Quotations", r.quoteId).closed,
            "เปิดงานขายก่อน แล้วจึงเปิดงานช่างใหม่",
          );
          return change("TechJobs", r, {
            status: "inprogress",
            note: r.note + "\nเปิดใหม่: " + p.reason,
          });
        }
        assert(
          !["completed", "cancelled"].includes(r.status),
          "ไม่สามารถเปลี่ยนผู้รับผิดชอบงานที่จบแล้ว",
        );
        const tech = c.user(db, email(p.techEmail));
        permit(tech, ["tech"]);
        return change("TechJobs", r, {
          techEmail: tech.email,
          techName: tech.name,
          status: "assigned",
          note: r.note + "\nเปลี่ยนช่าง: " + p.reason,
        });
      }
      case "customerCredit": {
        permit(u, ["finance"]);
        r = quoteRead(db, u, p.quoteId);
        assert(r.status === "approved" && !r.closed, "เปิดงานขายก่อนปรับยอด");
        const amount = money(num(p.amount, 0.01));
        assert(amount <= balances(db, r).target, "ปรับยอดเกินยอดใบเสนอราคา");
        return add("CustomerCredits", {
          quoteId: r.id,
          amount,
          date: date(p.date),
          reason: required(p.reason, "เหตุผลปรับยอด"),
        });
      }
      case "refundCustomer": {
        permit(u, ["finance"]);
        r = quoteRead(db, u, p.quoteId);
        const amount = money(num(p.amount, 0)),
          withholding = money(num(p.withholding || 0, 0)),
          b = balances(db, r);
        assert(
          amount + withholding > 0 &&
            money(amount + withholding) <= money(b.paid - b.target),
          "ยอดคืนเกินส่วนที่รับไว้หลังปรับยอด",
        );
        return add("CustomerRefunds", {
          quoteId: r.id,
          amount,
          withholding,
          date: date(p.date),
          reason: required(p.reason, "เหตุผลคืนเงิน"),
        });
      }
      case "setPOTerms": {
        permit(u, ["purchase"]);
        r = get(db, "PurchaseOrders", p.id);
        version(r);
        assert(!r.cancelled, "PO ถูกยกเลิก");
        assert(
          !db.VendorPayments.some((x) => x.purchaseOrderId === r.id) &&
            !db.Receipts.some((x) => x.purchaseOrderId === r.id),
          "แก้เงื่อนไขก่อนจ่ายหรือรับสินค้าเท่านั้น",
        );
        const subtotal = money(
            sum(
              db.PurchaseOrderItems.filter((x) => x.purchaseOrderId === r.id),
              "total",
            ),
          ),
          discountPct = num(p.discountPct || 0, 0, 100),
          discount = money((subtotal * discountPct) / 100),
          vatPct = num(p.vatPct || 0, 0, 100),
          vat = money(((subtotal - discount) * vatPct) / 100);
        return change("PurchaseOrders", r, {
          subtotal,
          discountPct,
          discount,
          vatPct,
          vat,
          total: money(subtotal - discount + vat),
          creditDays: num(p.creditDays || 0, 0, 3650),
          dueDate: date(p.dueDate, true),
          depositPct: num(p.depositPct || 0, 0, 100),
          paymentTerms: str(p.paymentTerms),
        });
      }
      case "returnPurchaseItem": {
        permit(u, ["purchase"]);
        r = get(db, "PurchaseOrderItems", p.id);
        version(r);
        const po = get(db, "PurchaseOrders", r.purchaseOrderId);
        assert(!po.cancelled, "PO ถูกยกเลิก");
        const qty = num(p.qty, 0.001),
          returned = sum(
            db.PurchaseReturns.filter((x) => x.purchaseOrderItemId === r.id),
            "qty",
          );
        assert(qty <= r.received - returned, "คืนสินค้าเกินจำนวนที่รับไว้");
        const remaining = poBalances(db, po).target;
        const fullReturn = db.PurchaseOrderItems.filter(
          (x) => x.purchaseOrderId === po.id,
        ).every(
          (x) =>
            Math.abs(
              x.qty -
                sum(
                  db.PurchaseReturns.filter(
                    (t) => t.purchaseOrderItemId === x.id,
                  ),
                  "qty",
                ) -
                (x.id === r.id ? qty : 0),
            ) < 1e-8,
        );
        const amount = fullReturn
          ? remaining
          : Math.min(
              remaining,
              money(
                qty *
                  r.unitPrice *
                  (1 - Number(po.discountPct || 0) / 100) *
                  (1 + Number(po.vatPct || 0) / 100),
              ),
            );
        assert(amount <= remaining, "มูลค่าคืนเกินยอด PO");
        const rec = add("PurchaseReturns", {
          purchaseOrderId: po.id,
          purchaseOrderItemId: r.id,
          qty,
          amount,
          reason: required(p.reason, "เหตุผลคืนสินค้า"),
          date: date(p.date),
        });
        change("PurchaseOrderItems", r, {});
        return rec;
      }
      case "refundVendor": {
        permit(u, ["purchase", "finance"]);
        r = get(db, "PurchaseOrders", p.purchaseOrderId);
        const amount = money(num(p.amount, 0)),
          withholding = money(num(p.withholding || 0, 0)),
          b = poBalances(db, r);
        assert(
          amount + withholding > 0 &&
            money(amount + withholding) <= money(b.paid - b.target),
          "ยอดคืนเกินเงินจ่ายหลังหักสินค้าคืน",
        );
        return add("VendorRefunds", {
          purchaseOrderId: r.id,
          amount,
          withholding,
          reason: required(p.reason, "เหตุผล"),
          date: date(p.date),
        });
      }
      case "createRFQ": {
        permit(u, ["purchase"]);
        const pr = get(db, "Procurements", p.procurementId);
        assert(pr.stage <= 4 && !pr.cancelled, "งานไม่พร้อมขอราคา");
        const vendor = active("Vendors", p.vendorId);
        assert(
          Array.isArray(p.itemIds) && p.itemIds.length,
          "เลือกรายการสินค้า",
        );
        p.itemIds.forEach((id) =>
          assert(
            get(db, "ProcurementItems", id).procurementId === pr.id,
            "สินค้าไม่ตรงงานจัดซื้อ",
          ),
        );
        r = add("RFQs", {
          number: number("RFQs", "RFQ"),
          procurementId: pr.id,
          vendorId: vendor.id,
          vendor,
          itemIds: [...new Set(p.itemIds)],
          note: str(p.note),
          replyDue: date(p.replyDue),
        });
        if (p.sendEmail) {
          assert(config(db).emailEnabled, "เปิดการส่งอีเมลในตั้งค่าก่อน");
          const lines = p.itemIds
            .map((id) => {
              const i = get(db, "ProcurementItems", id);
              return i.name + " จำนวน " + i.qty + " " + i.unit;
            })
            .join("\n");
          queue(
            c,
            vendor.email,
            "ขอราคา " + r.number,
            lines + "\nขอราคาภายใน " + r.replyDue + "\n" + r.note,
            "Procurements",
            pr.id,
            "rfq:" + r.id,
          );
        }
        return r;
      }
      case "issueDocument": {
        assert(
          [
            "quotation",
            "invoice",
            "receipt",
            "taxInvoice",
            "purchaseOrder",
            "rfq",
          ].includes(p.kind),
          "ชนิดเอกสารไม่ถูกต้อง",
        );
        let snapshot = {},
          prefix = "DOC",
          quoteId = "",
          purchaseOrderId = "",
          paymentId = "",
          rfqId = "";
        if (
          ["quotation", "invoice", "receipt", "taxInvoice"].includes(p.kind)
        ) {
          const q = quoteRead(db, u, p.quoteId);
          quoteId = q.id;
          assert(
            !["cancelled", "superseded"].includes(q.status),
            "เอกสารถูกยกเลิกหรือแทนที่แล้ว",
          );
          if (p.kind !== "quotation")
            assert(q.status === "approved", "ใบเสนอราคายังไม่อนุมัติ");
          if (["receipt", "taxInvoice"].includes(p.kind)) {
            permit(u, ["sales", "finance"]);
            const pay = get(db, "Payments", p.paymentId);
            assert(pay.quoteId === q.id, "การรับเงินไม่ตรงกับใบเสนอราคา");
            paymentId = pay.id;
            snapshot.payment = pay;
          }
          snapshot.quote = q;
          snapshot.items = db.QuoteItems.filter((i) => i.quoteId === q.id);
          snapshot.company = q.company;
          snapshot.party = q.customer;
          prefix = {
            quotation: "QT-D",
            invoice: "AI",
            receipt: "RC",
            taxInvoice: "TI",
          }[p.kind];
        } else if (p.kind === "purchaseOrder") {
          permit(u, ["purchase", "finance"]);
          const po = get(db, "PurchaseOrders", p.purchaseOrderId);
          assert(!po.cancelled, "PO ถูกยกเลิก");
          purchaseOrderId = po.id;
          snapshot = {
            po,
            items: db.PurchaseOrderItems.filter(
              (i) => i.purchaseOrderId === po.id,
            ),
            company: po.company,
            party: po.vendor,
          };
          prefix = "PO-D";
        } else {
          permit(u, ["purchase"]);
          const rfq = get(db, "RFQs", p.rfqId);
          rfqId = rfq.id;
          snapshot = {
            rfq,
            items: db.ProcurementItems.filter((i) =>
              rfq.itemIds.includes(i.id),
            ),
            company: db.Company[0] || {},
            party: rfq.vendor,
          };
          prefix = "RFQ-D";
        }
        if (p.kind === "taxInvoice")
          assert(
            snapshot.company.name &&
              snapshot.company.address &&
              snapshot.company.taxId,
            "ตั้งค่าชื่อ ที่อยู่ เลขผู้เสียภาษีของบริษัทก่อนออกใบกำกับภาษี",
          );
        if (paymentId) {
          const prior = db.Documents.find(
            (x) => x.kind === p.kind && x.paymentId === paymentId,
          );
          if (prior) return prior;
        }
        snapshot.copies = config(db).documentCopies || [
          { label: "ต้นฉบับ · ลูกค้า", color: "#17654f" },
          { label: "สำเนา · บัญชี", color: "#b34b4b" },
          { label: "สำเนา · บริษัท", color: "#5c70a6" },
        ];
        assert(
          JSON.stringify(snapshot).length <= 45000,
          "Document snapshot exceeds storage limit",
        );
        return add("Documents", {
          number: number("Documents", prefix),
          kind: p.kind,
          quoteId,
          purchaseOrderId,
          paymentId,
          rfqId,
          date: date(p.date),
          snapshot: JSON.parse(JSON.stringify(snapshot)),
          by: u.email,
        });
      }
      case "setBranding": {
        permit(u, []);
        r = get(db, "Company", p.id);
        version(r);
        assert(
          [
            "logoAttachmentId",
            "signatureAttachmentId",
            "stampAttachmentId",
          ].includes(p.slot),
          "ช่องรูปไม่ถูกต้อง",
        );
        const a = get(db, "Attachments", p.attachmentId);
        assert(
          a.entity === "Company" &&
            a.entityId === r.id &&
            a.mimeType.startsWith("image/"),
          "ต้องเป็นรูปที่แนบกับบริษัท",
        );
        return change("Company", r, { [p.slot]: a.id });
      }
      case "retryEmail":
      case "cancelEmail": {
        permit(u, []);
        r = get(db, "Outbox", p.id);
        version(r);
        assert(
          ["failed", "uncertain", "pending"].includes(r.status),
          "รายการนี้ส่งแล้วหรือกำลังส่ง",
        );
        if (req.action === "retryEmail")
          required(p.reason, "เหตุผลที่ตรวจสอบแล้วว่ายังไม่ส่ง");
        return change("Outbox", r, {
          status: req.action === "retryEmail" ? "pending" : "cancelled",
          error: "",
        });
      }
      default:
        return null;
    }
  }
  return {
    reservedQty,
    fields,
    extensions,
    JSON_FIELDS,
    config,
    balances,
    poBalances,
    profitability,
    reports,
    approval,
    execute,
    after,
    queue,
  };
})();
if (typeof module !== "undefined") module.exports = Advanced;
