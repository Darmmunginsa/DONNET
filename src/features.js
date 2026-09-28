/* Additional screens use the same authenticated RPC and business rules. */
const Features = (() => {
  const baseRender = render,
    baseAction = action,
    baseNav = renderNav,
    baseContract = contractForm;
  const kindLabels = {
    quotation: "ใบเสนอราคา",
    tempDelivery: "ใบส่งของชั่วคราว",
    invoice: "ใบส่งสินค้า / ใบแจ้งหนี้ / ใบวางบิล",
    receipt: "ใบเสร็จรับเงิน",
    taxInvoice: "ใบเสร็จรับเงิน / ใบกำกับภาษี",
    purchaseOrder: "ใบสั่งซื้อ",
    rfq: "ใบขอราคา",
  };
  const bal = (q) => Advanced.balances(state.data, q),
    pbal = (po) => Advanced.poBalances(state.data, po);
  function reportPage() {
    const reports = state.reports || Advanced.reports(state.data);
    return (
      head(
        "INSIGHTS",
        "Forecast และกำไร",
        "รายได้และต้นทุนก่อน VAT · คำนวณจากรายการที่เชื่อมกัน",
        button("ส่งออกข้อมูล", "export", "", "primary"),
      ) +
      panel(
        "ประมาณการยอดขายรายเดือน",
        reports.forecast.length
          ? table(
              [
                "เดือนคาดปิด",
                "จำนวนงาน",
                "มูลค่าโอกาสขาย",
                "ถ่วงน้ำหนักโอกาสสำเร็จ",
              ],
              reports.forecast.map(
                (m) =>
                  `<tr><td>${esc(m.month)}</td><td>${m.count}</td><td>${money(m.pipeline)}</td><td>${money(m.weighted)}</td></tr>`,
              ),
            )
          : empty(
              "ยังไม่มีโอกาสขาย",
              "กำหนดเดือนคาดปิดและเปอร์เซ็นต์ในแต่ละใบเสนอราคา",
            ),
      ) +
      panel(
        "กำไรประมาณการรายงาน",
        reports.margins.length
          ? table(
              [
                "ใบเสนอราคา",
                "รายได้สุทธิ",
                "ต้นทุนสั่งซื้อ",
                "ต้นทุนประมาณการทั้งหมด",
                "ค่าใช้จ่ายช่าง",
                "กำไร",
                "อัตรากำไร",
              ],
              reports.margins.map(
                (m) =>
                  `<tr><td>${link(m.number, "sales/" + m.quoteId)}</td><td>${money(m.revenue)}</td><td>${money(m.committedCost)}</td><td>${money(m.forecastCost)}</td><td>${money(m.expenses)}</td><td class="${m.profit < 0 ? "red-text" : ""}">${money(m.profit)}</td><td>${m.margin}%</td></tr>`,
              ),
            )
          : empty("ยังไม่มีข้อมูล", "เริ่มจากใบเสนอราคา"),
      ) +
      `<div class="callout">ต้นทุนประมาณการ = ต้นทุนสั่งซื้อจริงตามรายการ + ต้นทุนตั้งต้นของจำนวนที่ยังไม่ได้สั่งซื้อ กำไรหักค่าใช้จ่ายช่างแล้ว สินค้าคืนและรายการปรับยอดถูกนำมาคำนวณด้วย</div>`
    );
  }
  function documentsPage() {
    return (
      head(
        "DOCUMENT CENTER",
        "เอกสารออกเลขแล้ว",
        "พิมพ์ซ้ำจากข้อมูล ณ วันที่ออกเอกสาร",
      ) +
      panel(
        "ทะเบียนเอกสาร",
        data("Documents").length
          ? table(
              ["เลขที่", "ชนิด", "วันที่", "อ้างอิง", ""],
              data("Documents")
                .slice()
                .reverse()
                .map(
                  (d) =>
                    `<tr><td>${esc(d.number)}</td><td>${kindLabels[d.kind]}</td><td>${displayDate(d.date)}</td><td>${esc(d.snapshot.quote?.number || d.snapshot.po?.number || d.snapshot.rfq?.number)}</td><td>${button("พิมพ์สำเนา", "document-print", d.id)}</td></tr>`,
                ),
            )
          : empty(
              "ยังไม่มีเอกสาร",
              "ออกเอกสารจากใบเสนอราคา ใบรับเงิน PO หรือใบขอราคา",
            ),
      )
    );
  }
  function outboxPage() {
    return (
      head(
        "COMMUNICATION",
        "อีเมลและการแจ้งเตือน",
        "ติดตามรายการรอส่ง ส่งแล้ว และรายการที่ต้องตรวจสอบ",
      ) +
      (preview
        ? '<div class="callout">โหมดทดลองสร้างรายการรอส่งเพื่อทดสอบเท่านั้น ไม่ส่งอีเมลจริง</div>'
        : "") +
      panel(
        "รายการอีเมล",
        data("Outbox").length
          ? table(
              ["ผู้รับ", "หัวข้อ", "สถานะ", "รายละเอียด", ""],
              data("Outbox")
                .slice()
                .reverse()
                .map(
                  (o) =>
                    `<tr><td>${esc(o.to)}</td><td>${esc(o.subject)}</td><td>${esc({ pending: "รอส่ง", sending: "กำลังส่ง", sent: "ส่งแล้ว", uncertain: "ต้องตรวจสอบ", failed: "ไม่สำเร็จ", cancelled: "ยกเลิก" }[o.status] || o.status)}</td><td>${esc(o.error || displayDate(o.sentAt))}</td><td>${has("admin") && ["pending", "failed", "uncertain"].includes(o.status) ? button("ยกเลิก", "email-cancel", o.id) + (o.status !== "pending" ? button("ตรวจแล้ว ส่งใหม่", "email-retry", o.id) : "") : ""}</td></tr>`,
                ),
            )
          : empty("ยังไม่มีอีเมล", "เปิดการแจ้งเตือนในตั้งค่าเพื่อใช้งาน"),
      )
    );
  }
  function settingsPanels() {
    const cfg = Advanced.config(state.data),
      co = data("Company")[0];
    return (
      panel(
        "การอนุมัติตามวงเงิน / ขายต่ำกว่าทุน",
        data("ApprovalRules").length
          ? table(
              ["กฎ", "วงเงิน", "ผู้อนุมัติ", "เฉพาะต่ำกว่าทุน", "สถานะ", ""],
              data("ApprovalRules").map(
                (r) =>
                  `<tr><td>${esc(r.name)}<small>ลำดับ ${r.priority}</small></td><td>${money(r.minAmount)} – ${money(r.maxAmount)}</td><td>${esc(r.approverEmail)}</td><td>${r.belowCostOnly ? "ใช่" : "ทุกกรณี"}</td><td>${r.active ? "ใช้งาน" : "ปิด"}</td><td>${button("แก้ไข", "approval-rule", r.id)}</td></tr>`,
              ),
            )
          : empty(
              "ยังไม่มีกฎ",
              "ถ้าไม่ตั้งกฎ ฝ่ายขายเลือกผู้อนุมัติรายใบได้ เมื่อเปิดกฎ ต้องครอบคลุมวงเงินทุกช่วง",
            ),
        button("+ เพิ่มกฎ", "approval-rule"),
      ) +
      panel(
        "การแจ้งเตือนและสำรองข้อมูล",
        `<div class="detail-meta"><span>อีเมลอัตโนมัติ<strong>${cfg.emailEnabled ? "เปิด" : "ปิด"}</strong></span><span>สำรองรายวัน<strong>${cfg.backupEnabled ? "เปิด" : "ปิด"}</strong></span><span>สำเนาเอกสาร<strong>${cfg.documentCopies?.length || 3} ชุด</strong></span></div><div class="actions">${button("ตั้งค่าการทำงาน", "workspace-settings")}${button("สำรองตอนนี้", "backup")}</div><p class="muted">ติดตั้งงานตามเวลาหนึ่งครั้งใน Google Apps Script ก่อนใช้อีเมล/สำรองอัตโนมัติ</p>${data(
          "BackupLog",
        )
          .map(
            (b) => `<p>${esc(b.name)} · ${esc(b.status)} · ${esc(b.note)}</p>`,
          )
          .join("")}`,
      ) +
      (co
        ? panel(
            "โลโก้ ลายเซ็น และตราประทับ",
            files("Company", co.id) +
              `<div class="actions">${button("กำหนดภาพบนเอกสาร", "branding", co.id)}</div><p class="muted">แนบภาพก่อนแล้วเลือกประเภท รูปจะใช้ในใบเสนอราคาและเอกสารใหม่</p>`,
          )
        : "")
    );
  }
  function quotePanels(q) {
    const m =
        (state.reports?.margins || []).find((x) => x.quoteId === q.id) ||
        Advanced.profitability(state.data, q),
      b = bal(q);
    return (
      panel(
        "โอกาสขายและต้นทุน",
        `<div class="detail-meta"><span>เดือนคาดปิด<strong>${esc(q.expectedClose || q.date)}</strong></span><span>โอกาสสำเร็จ<strong>${q.dealStage === "won" ? 100 : (q.probability ?? 50)}%</strong></span><span>กำไรประมาณการ<strong class="${m.profit < 0 ? "red-text" : ""}">${money(m.profit)} บาท</strong></span><span>คงเหลือหลังปรับยอด<strong>${money(b.target - b.paid)} บาท</strong></span></div><div class="actions">${own(q) && !q.closed && !["cancelled", "superseded"].includes(q.status) ? button("ปรับโอกาสขาย", "pipeline", q.id) : ""}${own(q) ? button("คัดลอกใบใหม่", "copy-quote", q.id) : ""}${own(q) && !q.closed && ["draft", "rejected", "approved"].includes(q.status) ? button("สร้างฉบับแก้ไข", "revise-quote", q.id) : ""}${own(q) && q.closed ? button("เปิดงานขายใหม่", "reopen-quote", q.id) : ""}${own(q) && !q.closed && !["cancelled", "superseded"].includes(q.status) ? button("ยกเลิกใบ", "cancel-quote", q.id, "danger") : ""}${has("finance") && q.status === "approved" ? button("ปรับยอดลูกค้า", "customer-credit", q.id) + button("คืนเงินลูกค้า", "customer-refund", q.id) : ""}</div>${q.belowCostReason ? `<p>เหตุผลขายต่ำกว่าทุน: ${esc(q.belowCostReason)}</p>` : ""}${q.revisionOf ? `<p>ฉบับแก้ไขจาก ${link(row("Quotations", q.revisionOf)?.number || q.revisionOf, "sales/" + q.revisionOf)}</p>` : ""}`,
      ) +
      panel(
        "ประวัติปรับยอด / คืนเงิน",
        data("CustomerCredits")
          .filter((c) => c.quoteId === q.id)
          .map(
            (c) =>
              `<p>ปรับยอด ${money(c.amount)} · ${displayDate(c.date)} · ${esc(c.reason)}</p>`,
          )
          .join("") +
          data("CustomerRefunds")
            .filter((c) => c.quoteId === q.id)
            .map(
              (c) =>
                `<p>คืนเงิน ${money(c.amount)} · ยกเลิกหัก ณ ที่จ่าย ${money(c.withholding)} · ${esc(c.reason)}</p>`,
            )
            .join("") || '<p class="muted">ยังไม่มีรายการ</p>',
      )
    );
  }
  function purchasePanels(pr) {
    const offers = data("RFQs").filter((r) => r.procurementId === pr.id);
    return (
      panel(
        "ใบขอราคาผู้ขาย",
        `<div class="actions">${has("purchase") && !pr.cancelled && pr.stage < 5 ? button("+ ใบขอราคา / ส่งอีเมล", "rfq", pr.id) : ""}${has("purchase") && !pr.cancelled ? button("ยกเลิกงานจัดซื้อ", "cancel-procurement", pr.id, "danger") : ""}</div>${pr.cancelled ? '<div class="callout">ยกเลิกงานแล้ว · ' + esc(pr.cancelReason) + "</div>" : ""}${
          offers.length
            ? table(
                ["เลขที่", "ผู้ขาย", "ขอราคาภายใน", ""],
                offers.map(
                  (r) =>
                    `<tr><td>${esc(r.number)}</td><td>${esc(r.vendor.name)}</td><td>${displayDate(r.replyDue)}</td><td>${button("ออกเอกสาร", "issue-rfq", r.id)}</td></tr>`,
                ),
              )
            : '<p class="muted">ยังไม่มีใบขอราคา</p>'
        }`,
      ) +
      data("PurchaseOrders")
        .filter((po) => po.procurementId === pr.id)
        .map((po) => {
          const b = pbal(po);
          return panel(
            "เงื่อนไขและการคืน · " + esc(po.number),
            `<div class="detail-meta"><span>ยอดก่อนส่วนลด<strong>${money(po.subtotal ?? po.total)}</strong></span><span>ส่วนลด / VAT<strong>${po.discountPct || 0}% / ${po.vatPct || 0}%</strong></span><span>คงเหลือสุทธิ<strong>${money(b.target - b.paid)}</strong></span><span>วันครบกำหนด<strong>${displayDate(po.dueDate)}</strong></span></div><p class="muted">เครดิต ${po.creditDays || 0} วัน · มัดจำ ${po.depositPct || 0}% · ${esc(po.paymentTerms || "ไม่ระบุ")}</p><div class="actions">${has("purchase") && !po.cancelled ? button("ภาษี / เครดิต / มัดจำ", "po-terms", po.id) + button("คืนสินค้า", "return-item", po.id) + button("ยกเลิก PO", "cancel-po", po.id, "danger") : ""}${has("purchase", "finance") && !po.cancelled ? button("รับเงินคืนผู้ขาย", "vendor-refund", po.id) : ""}</div>${po.cancelled ? '<span class="badge red">ยกเลิกแล้ว</span>' : ""}${data(
              "PurchaseReturns",
            )
              .filter((r) => r.purchaseOrderId === po.id)
              .map(
                (r) =>
                  `<p>คืน ${r.qty} · ${money(r.amount)} บาท · ${esc(r.reason)}</p>`,
              )
              .join("")}${data("VendorRefunds")
              .filter((r) => r.purchaseOrderId === po.id)
              .map(
                (r) =>
                  `<p>รับคืน ${money(r.amount)} · ยกเลิกหัก ณ ที่จ่าย ${money(r.withholding)} · ${esc(r.reason)}</p>`,
              )
              .join("")}`,
          );
        })
        .join("")
    );
  }
  function settingsForm() {
    const item = data("Settings").find((x) => x.key === "workspace"),
      cfg = item?.value || {},
      copies = cfg.documentCopies || [
        { label: "ต้นฉบับ · ลูกค้า", color: "#17654f" },
        { label: "สำเนา · บัญชี", color: "#b34b4b" },
        { label: "สำเนา · บริษัท", color: "#5c70a6" },
      ];
    openModal(
      "ตั้งค่าการทำงาน",
      `<div class="form-grid"><label class="check span-two"><input name="emailEnabled" type="checkbox" ${cfg.emailEnabled ? "checked" : ""}>ส่งอีเมลแจ้งเตือนอัตโนมัติ</label><label class="check span-two"><input name="backupEnabled" type="checkbox" ${cfg.backupEnabled ? "checked" : ""}>สำรองตารางและไฟล์แนบรายวัน</label>${field("reminderDays", "แจ้งเตือนสัญญาล่วงหน้า (วัน)", cfg.reminderDays || 30, "number", 'min="1" max="365" required')}${area("copies", "สำเนาเอกสาร: ชื่อสำเนา | สี (หนึ่งชุดต่อบรรทัด)", copies.map((x) => x.label + " | " + x.color).join("\n"))}</div>`,
      async () => {
        const v = formValues();
        await run("saveWorkspaceSettings", {
          version: item?.version,
          data: {
            emailEnabled: $("[name=emailEnabled]").checked,
            backupEnabled: $("[name=backupEnabled]").checked,
            reminderDays: v.reminderDays,
            documentCopies: v.copies
              .split("\n")
              .filter((x) => x.trim())
              .map((x) => {
                const [label, color] = x.split("|");
                return { label: label?.trim(), color: color?.trim() };
              }),
          },
        });
      },
    );
  }
  function approvalForm(id) {
    const r = row("ApprovalRules", id) || {};
    openModal(
      "กฎผู้อนุมัติ",
      `<div class="form-grid">${field("name", "ชื่อกฎ", r.name, "text", "required")}${select(
        "approverEmail",
        "ผู้อนุมัติ",
        data("Users")
          .filter((x) => x.roles.some((r) => ["admin", "approver"].includes(r)))
          .map((x) => [x.email, x.name]),
        r.approverEmail,
      )}${field("minAmount", "วงเงินตั้งแต่", r.minAmount || 0, "number", 'min="0" step="0.01" required')}${field("maxAmount", "วงเงินถึง", r.maxAmount ?? 10000000, "number", 'min="0" step="0.01" required')}${field("priority", "ลำดับความสำคัญ (มากใช้ก่อน)", r.priority || 0, "number", 'min="0" max="1000"')}<label class="check"><input name="belowCostOnly" type="checkbox" ${r.belowCostOnly ? "checked" : ""}>เฉพาะขายต่ำกว่าทุน</label><label class="check"><input name="active" type="checkbox" ${r.active !== false ? "checked" : ""}>ใช้งาน</label></div>`,
      async () =>
        run("saveApprovalRule", {
          ...formValues(),
          id: id || "",
          version: r.version,
          active: $("[name=active]").checked,
          belowCostOnly: $("[name=belowCostOnly]").checked,
        }),
    );
  }
  function issue(kind, ids) {
    openModal(
      "ออก" + kindLabels[kind],
      `<div class="form-grid">${field("date", "วันที่เอกสาร", today(), "date", "required")}<div class="callout span-two">ระบบออกเลขเอกสารและเก็บข้อมูล ณ วันนี้ สามารถพิมพ์สำเนาซ้ำจากทะเบียนเอกสาร${kind === "taxInvoice" ? "<br>โปรดตรวจรายละเอียดบริษัท ผู้ซื้อ และแบบเอกสารกับผู้รับผิดชอบบัญชีก่อนนำไปใช้จริง" : ""}</div></div>`,
      async () => {
        const result = await run("issueDocument", {
          kind,
          ...ids,
          ...formValues(),
        });
        if (result) await printIssued(result.id);
      },
      "ออกเลขและพิมพ์",
    );
  }
  async function imageHtml(attachmentId, cls) {
    if (!attachmentId) return "";
    const f = await rpc("downloadAttachment", token, attachmentId);
    if (!f.mimeType.startsWith("image/")) return "";
    return `<img class="${cls}" alt="ภาพบริษัท" src="data:${esc(f.mimeType)};base64,${f.base64}">`;
  }
  async function printIssued(id) {
    const doc = row("Documents", id);
    if (!doc) throw new Error("ไม่พบเอกสาร");
    const s = doc.snapshot,
      c = s.company || {},
      party = s.party || {},
      q = s.quote,
      po = s.po,
      payment = s.payment;
    const [logo, signature, stamp] = await Promise.all([
      imageHtml(c.logoAttachmentId, "document-logo"),
      imageHtml(c.signatureAttachmentId, "document-signature"),
      imageHtml(c.stampAttachmentId, "document-stamp"),
    ]);
    const source = (html) => html.match(/src="([^"]+)"/)?.[1] || "";
    $("#print-area").innerHTML = DocumentForms.render(doc, {
      logo: source(logo),
      signature: source(signature),
      stamp: source(stamp),
    });
    await Promise.all(
      Array.from($("#print-area").querySelectorAll("img")).map((img) =>
        img.decode().catch(() => {}),
      ),
    );
    showDocumentPreview(
      $("#print-area").innerHTML,
      kindLabels[doc.kind] + " · " + doc.number,
    );
  }
  function exportForm() {
    const excluded = [
      "Requests",
      "Outbox",
      "Users",
      "Settings",
      "AuditLog",
      "BackupLog",
    ];
    const tables = Object.keys(state.data).filter(
      (t) => !excluded.includes(t) || (has("admin") && t !== "Requests"),
    );
    openModal(
      "ส่งออก CSV",
      `<div class="form-grid">${select(
        "table",
        "ชุดข้อมูล",
        tables.map((t) => [t, masterLabels[t] || t]),
      )}<p class="muted span-two">ส่งออกเฉพาะข้อมูลที่บัญชีนี้มีสิทธิ์อ่าน</p></div>`,
      async () => {
        const name = formValues().table,
          rows = data(name),
          keys = [...new Set(rows.flatMap(Object.keys))];
        if (!keys.length) throw new Error("ยังไม่มีข้อมูลในชุดนี้");
        function cell(v) {
          let s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
          if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
          return '"' + s.replace(/"/g, '""') + '"';
        }
        const csv =
          "\uFEFF" +
          [
            keys.map(cell).join(","),
            ...rows.map((r) => keys.map((k) => cell(r[k])).join(",")),
          ].join("\r\n");
        const url = URL.createObjectURL(
            new Blob([csv], { type: "text/csv;charset=utf-8" }),
          ),
          a = document.createElement("a");
        a.href = url;
        a.download = name + "-" + today() + ".csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        $("#modal").close();
      },
      "ดาวน์โหลด",
    );
  }
  async function featureAction(name, id, el) {
    const q = row("Quotations", id),
      po = row("PurchaseOrders", id),
      pr = row("Procurements", id),
      job = row("TechJobs", id);
    switch (name) {
      case "approval-rule":
        return approvalForm(id);
      case "workspace-settings":
        return settingsForm();
      case "backup":
        if (preview)
          return toast("สำรอง Google Drive ได้หลังติดตั้งในบัญชีจริง");
        await rpc("requestBackup", token);
        toast("เริ่มสำรองข้อมูลแล้ว");
        return refresh();
      case "export":
        return exportForm();
      case "pipeline":
        return simple(
          "โอกาสขาย",
          field(
            "expectedClose",
            "วันที่คาดปิดงาน",
            q.expectedClose || q.date,
            "date",
            "required",
          ) +
            field(
              "probability",
              "โอกาสสำเร็จ (%)",
              q.probability ?? 50,
              "number",
              'min="0" max="100" required',
            ) +
            select(
              "dealStage",
              "สถานะ",
              [
                ["open", "กำลังติดตาม"],
                ["won", "ได้งานแล้ว"],
                ["lost", "ไม่ได้งาน"],
              ],
              q.dealStage || "open",
            ),
          "updatePipeline",
          { id, version: q.version },
        );
      case "submit-quote": {
        const rules = data("ApprovalRules").filter((x) => x.active);
        openModal(
          "ส่งใบเสนอราคาอนุมัติ",
          `<div class="form-grid">${
            rules.length
              ? '<div class="callout span-two">ระบบเลือกผู้อนุมัติตามวงเงินและกฎขายต่ำกว่าทุนที่ผู้ดูแลกำหนด</div>'
              : select(
                  "approverEmail",
                  "ผู้อนุมัติ",
                  data("Users")
                    .filter(
                      (u) =>
                        u.email !== q.ownerEmail &&
                        u.roles.some((r) => ["admin", "approver"].includes(r)),
                    )
                    .map((u) => [u.email, u.name]),
                )
          }${area("belowCostReason", "เหตุผลขายต่ำกว่าทุน (จำเป็นเมื่อราคาขายต่ำกว่าต้นทุน)", q.belowCostReason)}</div>`,
          async () =>
            run("submitQuote", { ...formValues(), id, version: q.version }),
          "ส่งอนุมัติ",
        );
        return;
      }
      case "copy-quote":
      case "revise-quote":
        return simple(
          name === "copy-quote" ? "คัดลอกใบใหม่" : "สร้างฉบับแก้ไข",
          `<div class="callout span-two">${name === "revise-quote" ? "ใบเดิมจะเก็บเป็นประวัติ และใบใหม่ต้องอนุมัติใหม่ หากมีงานหรือการเงินเชื่อมอยู่ ให้คัดลอกใบใหม่แทน" : "คัดลอกเฉพาะใบเสนอราคาและสินค้า ไม่คัดลอกการเงินหรืองานจัดซื้อ/ช่าง"}</div>`,
          name === "copy-quote" ? "copyQuote" : "reviseQuote",
          { id, version: q.version },
        );
      case "cancel-quote":
      case "reopen-quote":
        return simple(
          name === "cancel-quote" ? "ยกเลิกใบเสนอราคา" : "เปิดงานขายใหม่",
          area("reason", "เหตุผล"),
          name === "cancel-quote" ? "cancelQuote" : "reopenQuote",
          { id, version: q.version },
        );
      case "cancel-procurement":
        return simple(
          "ยกเลิกงานจัดซื้อ",
          area("reason", "เหตุผล"),
          "cancelProcurement",
          { id, version: pr.version },
        );
      case "cancel-po":
        return simple(
          "ยกเลิก PO",
          area("reason", "เหตุผล"),
          "cancelPurchaseOrder",
          { id, version: po.version },
        );
      case "customer-credit":
        return simple(
          "ปรับลดยอดลูกค้า",
          field(
            "amount",
            "ยอดปรับลดรวม VAT",
            "",
            "number",
            'min="0.01" step="0.01" required',
          ) +
            field("date", "วันที่", today(), "date", "required") +
            area("reason", "เหตุผล"),
          "customerCredit",
          { quoteId: id },
        );
      case "customer-refund":
        return simple(
          "บันทึกคืนเงินลูกค้า",
          field(
            "amount",
            "เงินที่คืนจริง",
            0,
            "number",
            'min="0" step="0.01"',
          ) +
            field(
              "withholding",
              "ยอดหัก ณ ที่จ่ายที่ยกเลิก",
              0,
              "number",
              'min="0" step="0.01"',
            ) +
            field("date", "วันที่", today(), "date", "required") +
            area("reason", "เหตุผล"),
          "refundCustomer",
          { quoteId: id },
        );
      case "vendor-refund":
        return simple(
          "บันทึกเงินคืนจากผู้ขาย",
          field(
            "amount",
            "เงินรับคืนจริง",
            0,
            "number",
            'min="0" step="0.01"',
          ) +
            field(
              "withholding",
              "ยอดหัก ณ ที่จ่ายที่ยกเลิก",
              0,
              "number",
              'min="0" step="0.01"',
            ) +
            field("date", "วันที่", today(), "date", "required") +
            area("reason", "เหตุผล"),
          "refundVendor",
          { purchaseOrderId: id },
        );
      case "po-terms":
        return simple(
          "ภาษีและเงื่อนไข PO",
          field(
            "discountPct",
            "ส่วนลด (%)",
            po.discountPct || 0,
            "number",
            'min="0" max="100" step="any"',
          ) +
            field(
              "vatPct",
              "VAT (%)",
              po.vatPct || 0,
              "number",
              'min="0" max="100" step="any"',
            ) +
            field(
              "creditDays",
              "เครดิต (วัน)",
              po.creditDays || 0,
              "number",
              'min="0"',
            ) +
            field("dueDate", "ครบกำหนดจ่าย", po.dueDate || "", "date") +
            field(
              "depositPct",
              "มัดจำ (%)",
              po.depositPct || 0,
              "number",
              'min="0" max="100" step="any"',
            ) +
            area("paymentTerms", "เงื่อนไขชำระเงิน", po.paymentTerms),
          "setPOTerms",
          { id, version: po.version },
        );
      case "vendor-payment":
        return simple(
          "บันทึกจ่ายเงินผู้ขาย",
          field(
            "amount",
            "ยอดจ่ายจริง",
            "",
            "number",
            'min="0.01" step="0.01" required',
          ) +
            field(
              "withholding",
              "หัก ณ ที่จ่าย (บาท)",
              0,
              "number",
              'min="0" step="0.01"',
            ) +
            field("date", "วันที่", today(), "date", "required") +
            field("reference", "เลขอ้างอิง") +
            area("note", "หมายเหตุ"),
          "payVendor",
          { purchaseOrderId: id },
        );
      case "return-item": {
        const items = data("PurchaseOrderItems").filter(
          (x) => x.purchaseOrderId === id && x.received > 0,
        );
        openModal(
          "คืนสินค้าให้ผู้ขาย",
          `<div class="form-grid">${select(
            "id",
            "สินค้า",
            items.map((i) => [i.id, i.name + " · รับแล้ว " + i.received]),
          )}${field("qty", "จำนวนคืน", 1, "number", 'min="0.001" step="any" required')}${field("date", "วันที่คืน", today(), "date", "required")}${area("reason", "เหตุผล")}</div>`,
          async () => {
            const v = formValues(),
              i = row("PurchaseOrderItems", v.id);
            await run("returnPurchaseItem", { ...v, version: i.version });
          },
        );
        return;
      }
      case "cancel-job":
      case "reopen-job":
      case "reassign-job":
        return simple(
          name === "cancel-job"
            ? "ยกเลิกงานช่าง"
            : name === "reopen-job"
              ? "เปิดงานช่างใหม่"
              : "เปลี่ยนผู้รับผิดชอบ",
          (name === "reassign-job"
            ? select(
                "techEmail",
                "ช่าง",
                data("Users")
                  .filter((x) =>
                    x.roles.some((r) => ["tech", "admin"].includes(r)),
                  )
                  .map((x) => [x.email, x.name]),
              )
            : "") + area("reason", "เหตุผล"),
          {
            "cancel-job": "cancelJob",
            "reopen-job": "reopenJob",
            "reassign-job": "reassignJob",
          }[name],
          { id, version: job.version },
        );
      case "rfq": {
        const items = data("ProcurementItems").filter(
          (x) => x.procurementId === id,
        );
        openModal(
          "ใบขอราคาผู้ขาย",
          `<div class="form-grid">${select(
            "vendorId",
            "ผู้ขาย",
            data("Vendors")
              .filter((v) => v.active)
              .map((v) => [v.id, v.name]),
          )}${field("replyDue", "ขอราคาภายใน", today(), "date", "required")}${area("note", "หมายเหตุ")}<div class="span-two">${items.map((i) => `<label class="check"><input type="checkbox" name="itemId" value="${i.id}" checked>${esc(i.name)} · ${i.qty} ${esc(i.unit)}</label>`).join("")}</div><label class="check span-two"><input name="sendEmail" type="checkbox">ส่งอีเมลขอราคาไปยังอีเมลผู้ขายที่ระบุ</label></div>`,
          async () =>
            run("createRFQ", {
              ...formValues(),
              procurementId: id,
              itemIds: $$("[name=itemId]:checked").map((e) => e.value),
              sendEmail: $("[name=sendEmail]").checked,
            }),
        );
        return;
      }
      case "document-print":
        return printIssued(id);
      case "issue-rfq":
        return issue("rfq", { rfqId: id });
      case "print-quote":
        return issue("quotation", { quoteId: id });
      case "print-invoice":
        return issue("invoice", { quoteId: id });
      case "print-temp-delivery":
        return issue("tempDelivery", { quoteId: id });
      case "print-job-delivery":
        return issue("tempDelivery", { jobId: id });
      case "print-po":
        return issue("purchaseOrder", { purchaseOrderId: id });
      case "print-receipt": {
        const payment = row("Payments", id);
        openModal(
          "ออกเอกสารรับเงิน",
          `<div class="form-grid">${select(
            "kind",
            "ประเภท",
            [
              ["receipt", "ใบเสร็จรับเงิน"],
              ["taxInvoice", "ใบเสร็จรับเงิน / ใบกำกับภาษี"],
            ],
            "receipt",
          )}${field("date", "วันที่เอกสาร", today(), "date", "required")}</div>`,
          async () => {
            const result = await run("issueDocument", {
              ...formValues(),
              quoteId: payment.quoteId,
              paymentId: id,
            });
            if (result) await printIssued(result.id);
          },
          "ออกเลขและพิมพ์",
        );
        return;
      }
      case "branding": {
        const c = row("Company", id),
          images = data("Attachments").filter(
            (a) =>
              a.entity === "Company" &&
              a.entityId === id &&
              a.mimeType.startsWith("image/"),
          );
        return simple(
          "ภาพประกอบเอกสาร",
          select("slot", "ประเภทภาพ", [
            ["logoAttachmentId", "โลโก้"],
            ["signatureAttachmentId", "ลายเซ็น"],
            ["stampAttachmentId", "ตราประทับ"],
          ]) +
            select(
              "attachmentId",
              "รูปที่แนบไว้",
              images.map((a) => [a.id, a.name]),
            ),
          "setBranding",
          { id, version: c.version },
        );
      }
      case "email-cancel":
      case "email-retry": {
        const o = row("Outbox", id);
        return simple(
          name === "email-cancel" ? "ยกเลิกอีเมล" : "ส่งอีเมลใหม่หลังตรวจสอบ",
          area("reason", "ระบุผลตรวจว่าอีเมลเดิมยังไม่ส่ง เพื่อป้องกันส่งซ้ำ"),
          name === "email-cancel" ? "cancelEmail" : "retryEmail",
          { id, version: o.version },
        );
      }
      case "internal-purchase": {
        openModal(
          "จัดซื้อภายใน",
          `<div class="form-grid">${field("assetCategory", "หมวดทรัพย์สิน / ค่าใช้จ่าย", "ทั่วไป", "text", "required")}${field("requiredDate", "กำหนดรับ", "", "date")}${area("note", "วัตถุประสงค์")}</div><h3 class="form-section">รายการซื้อ</h3>${button("+ บรรทัด", "add-line")}<div class="table-wrap"><table class="line-editor"><thead><tr><th>ชนิด</th><th>สินค้า</th><th>จำนวน/หน่วย</th><th>ราคาตั้งต้น/ต้นทุน</th><th>ส่วนลด</th><th></th></tr></thead><tbody id="lines">${lineHtml()}</tbody></table></div>`,
          async () =>
            run("createProcurement", {
              ...formValues(),
              quoteId: "",
              items: collectLines().filter((i) => i.type === "item"),
            }),
        );
        return;
      }
      default:
        return baseAction(name, id, el);
    }
  }
  renderNav = function () {
    baseNav();
    const active = (location.hash.slice(1) || "dashboard").split("/")[0];
    const links = [
      ["reports", "◴", "Forecast / กำไร", has("sales", "approver", "finance")],
      [
        "documents",
        "▣",
        "ทะเบียนเอกสาร",
        has("sales", "purchase", "approver", "finance"),
      ],
      [
        "outbox",
        "✉",
        "อีเมลแจ้งเตือน",
        has("sales", "purchase", "approver", "finance", "tech"),
      ],
    ];
    links
      .filter((x) => x[3])
      .forEach(([key, icon, label]) =>
        $("#nav").insertAdjacentHTML(
          "beforeend",
          `<a href="#${key}" class="${active === key ? "active" : ""}"><span class="nav-icon">${icon}</span>${label}</a>`,
        ),
      );
  };
  render = function () {
    if (!state) return;
    const [page, id] = (location.hash.slice(1) || "dashboard").split("/");
    if (page === "Vendors" && id && row("Vendors", id)) {
      renderNav();
      $("#page-label").textContent = "เอกสารผู้ขาย";
      $("#main").innerHTML =
        head("VENDOR", row("Vendors", id).name, "เอกสารอ้างอิงผู้ขาย") +
        panel("รูป / PDF", files("Vendors", id));
      return;
    }
    if (["reports", "documents", "outbox"].includes(page)) {
      renderNav();
      $("#page-label").textContent = {
        reports: "Forecast / กำไร",
        documents: "ทะเบียนเอกสาร",
        outbox: "อีเมลแจ้งเตือน",
      }[page];
      $("#main").innerHTML =
        page === "reports"
          ? reportPage()
          : page === "documents"
            ? documentsPage()
            : outboxPage();
      return;
    }
    baseRender();
    if (page === "settings" && has("admin"))
      $("#main").insertAdjacentHTML("beforeend", settingsPanels());
    if (page === "sales" && id && row("Quotations", id))
      $("#main").insertAdjacentHTML(
        "beforeend",
        quotePanels(row("Quotations", id)),
      );
    if (page === "purchase" && id && row("Procurements", id))
      $("#main").insertAdjacentHTML(
        "beforeend",
        purchasePanels(row("Procurements", id)),
      );
    if (page === "tech" && id) {
      const j = row("TechJobs", id);
      if (
        j &&
        row("Quotations", j.quoteId) &&
        own(row("Quotations", j.quoteId))
      )
        $("#main").insertAdjacentHTML(
          "beforeend",
          panel(
            "จัดการงานช่าง",
            `<div class="actions">${j.status === "completed" ? button("เปิดงานใหม่", "reopen-job", id) : j.status !== "cancelled" ? button("เปลี่ยนช่าง", "reassign-job", id) + button("ยกเลิกงาน", "cancel-job", id, "danger") : ""}</div>`,
          ),
        );
    }
  };
  action = featureAction;
  contractForm = function (id) {
    baseContract(id);
    const c = row("Contracts", id) || {};
    $("#modal-body .form-grid").insertAdjacentHTML(
      "beforeend",
      field(
        "alertDays",
        "แจ้งเตือนล่วงหน้า (วัน)",
        c.alertDays || 30,
        "number",
        'min="1" max="365"',
      ) +
        `<div class="span-two"><h3>ผู้รับแจ้งเตือน (ว่าง = ผู้ดูแลและการเงิน)</h3>${data(
          "Users",
        )
          .filter((u) =>
            u.roles.some((r) => ["admin", "finance", "sales"].includes(r)),
          )
          .map(
            (u) =>
              `<label class="check"><input type="checkbox" name="alertEmail" value="${esc(u.email)}" ${(c.alertEmails || []).includes(u.email) ? "checked" : ""}>${esc(u.name)}</label>`,
          )
          .join("")}</div>`,
    );
    modalSave = async () => {
      const v = formValues();
      v.quoteIds = $$("[name=quoteIds]:checked").map((e) => e.value);
      v.alertEmails = $$("[name=alertEmail]:checked").map((e) => e.value);
      await run("saveContract", { ...v, id: id || "", version: c.version });
    };
  };
  return { printIssued };
})();
