"use strict";
const $ = (s) => document.querySelector(s),
  $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (v) =>
  String(v == null ? "" : v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  Number(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const displayDate = (v) =>
  v
    ? new Date(v).toLocaleDateString("th-TH", {
        calendar: "gregory",
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
const labels = {
  cancelled: "ยกเลิกแล้ว",
  superseded: "แทนที่ด้วยฉบับใหม่",
  draft: "ฉบับร่าง",
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  assigned: "รอรับงาน",
  accepted: "รับงานแล้ว",
  inprogress: "กำลังทำงาน",
  completed: "เสร็จสิ้น",
};
const roles = {
  admin: "ผู้ดูแล",
  sales: "ฝ่ายขาย",
  approver: "ผู้อนุมัติ",
  purchase: "จัดซื้อ",
  tech: "ช่าง",
  finance: "การเงิน",
};
const masterLabels = {
  Customers: "ลูกค้า",
  Vendors: "ผู้ขาย",
  Catalog: "สินค้า",
  Company: "ข้อมูลบริษัท",
  Users: "ผู้ใช้งาน",
};
let state = null,
  token = "",
  preview = false,
  otpSent = false,
  modalSave = null,
  busy = false,
  lastRequest = null,
  filter = "",
  filterStatus = "";
function has(...r) {
  return (
    state &&
    (state.user.roles.includes("admin") ||
      r.some((x) => state.user.roles.includes(x)))
  );
}
function data(t) {
  return state?.data[t] || [];
}
function row(t, id) {
  return data(t).find((r) => r.id === id);
}
function own(q) {
  return has("admin") || (has("sales") && q.ownerEmail === state.user.email);
}
function status(s) {
  return `<span class="badge ${s === "approved" || s === "completed" ? "green" : s === "rejected" ? "red" : s === "pending" || s === "assigned" ? "amber" : s === "inprogress" ? "blue" : ""}">${esc(labels[s] || s)}</span>`;
}
function button(text, action, id = "", cls = "small") {
  return `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}">${text}</button>`;
}
function link(text, route) {
  return `<a href="#${route}">${esc(text)}</a>`;
}
function empty(title, text, action = "") {
  return `<div class="empty"><span class="empty-mark">◇</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}
function panel(title, body, extra = "") {
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${extra}</div>${body}</section>`;
}
function table(heads, rows) {
  return `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function head(kicker, title, subtitle, action = "") {
  return `<div class="page-head"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}
function paid(q) {
  return Advanced.balances(state.data, q).paid;
}
function poPaid(po) {
  return Advanced.poBalances(state.data, po).paid;
}
function toast(text, error = false) {
  $("#toast").textContent = text;
  $("#toast").className = error ? "error" : "";
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 5500);
}
async function rpc(method, ...args) {
  if (preview) {
    const r = await fetch("/api/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const v = await r.json();
    if (!r.ok) throw new Error(v.error || "เชื่อมต่อไม่สำเร็จ");
    return v;
  }
  return new Promise((resolve, reject) => {
    if (!window.google?.script?.run) {
      reject(new Error("เปิดผ่าน Apps Script หรือใช้ npm start เพื่อทดลอง"));
      return;
    }
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      [method](...args);
  });
}
function errorMessage(e) {
  const msg = e.message || String(e);
  if (msg.includes("SESSION_EXPIRED")) {
    token = "";
    state = null;
    $("#shell").hidden = true;
    $("#login").hidden = false;
    return "หมดเวลาเข้าใช้งาน กรุณาเข้าสู่ระบบใหม่";
  }
  return msg;
}
async function refresh() {
  state = await rpc("loadWorkspace", token);
  $("#login").hidden = true;
  $("#shell").hidden = false;
  $("#user-name").textContent = state.user.name;
  $("#avatar").textContent = state.user.name.slice(0, 1);
  $("#environment").textContent = preview
    ? "ทดลองในเครื่อง · ไม่ใช่ Google Sheet"
    : "Google Sheets · ข้อมูลกลาง";
  $("#preview-banner").hidden = !preview;
  renderNav();
  render();
}
function request(action, payload) {
  const key = JSON.stringify({ action, payload });
  if (lastRequest?.key === key) return lastRequest.req;
  const req = { action, payload, requestId: crypto.randomUUID() };
  lastRequest = { key, req };
  return req;
}
async function run(action, payload) {
  if (busy) return;
  busy = true;
  const req = request(action, payload);
  try {
    const out = await rpc("executeCommand", token, req);
    lastRequest = null;
    $("#modal").close();
    toast("บันทึกเรียบร้อย");
    await refresh();
    return out;
  } catch (e) {
    const msg = errorMessage(e);
    $("#form-error").textContent = msg;
    toast(msg, true);
    throw e;
  } finally {
    busy = false;
  }
}
function renderNav() {
  const entries = [
    ["dashboard", "◫", "ภาพรวม", true],
    ["sales", "▤", "SalePro", has("sales", "approver", "finance")],
    [
      "purchase",
      "▧",
      "PurchasePro",
      has("purchase", "finance", "sales", "approver"),
    ],
    ["tech", "⌘", "Tech", has("tech", "sales", "approver", "finance")],
    ["contracts", "▥", "สัญญา", has("sales", "finance", "approver")],
    ["Customers", "○", "ลูกค้า", has("sales", "finance", "approver")],
    ["Vendors", "◈", "ผู้ขาย", has("purchase", "sales", "approver", "finance")],
    ["Catalog", "▦", "สินค้า", has("purchase", "sales", "approver")],
    ["settings", "⚙", "ตั้งค่าระบบ", has("admin")],
  ];
  const page = (location.hash.slice(1) || "dashboard").split("/")[0];
  $("#nav").innerHTML = entries
    .filter((x) => x[3])
    .map(
      (x, i) =>
        (x[0] === "Customers" ? '<div class="nav-split"></div>' : "") +
        `<a class="${page === x[0] ? "active" : ""}" href="#${x[0]}"><span class="nav-icon">${x[1]}</span>${x[2]}</a>`,
    )
    .join("");
  $("#page-label").textContent =
    entries.find((x) => x[0] === page)?.[2] || "รายละเอียด";
}
function quoteRows(list) {
  return list.map(
    (q) =>
      `<tr><td><strong>${link(q.number, "sales/" + q.id)}</strong><small>${displayDate(q.date)}</small></td><td>${esc(q.customer.name)}</td><td>${q.closed ? '<span class="badge green">ปิดงานแล้ว</span>' : status(q.status)}</td><td class="right">${money(q.total)}</td><td class="right">${button("เปิด →", "open-quote", q.id)}</td></tr>`,
  );
}
function dashboard() {
  const qs = data("Quotations"),
    prs = data("Procurements"),
    jobs = data("TechJobs"),
    pending = qs.filter((q) => q.status === "pending");
  const outstanding = qs
    .filter((q) => q.status === "approved")
    .reduce((s, q) => s + Advanced.balances(state.data, q).target - paid(q), 0);
  return (
    head(
      "WORKSPACE OVERVIEW",
      "ภาพรวมการทำงาน",
      "ติดตามทุกงานตั้งแต่ใบเสนอราคา จนถึงส่งมอบ",
    ) +
    `<section class="hero"><div><div class="eyebrow">CONNECTED TOGETHER</div><h2>งานเดินต่อได้ เมื่อข้อมูลเชื่อมถึงกัน</h2><p>เริ่มจากใบเสนอราคา แล้วส่งต่องานให้ทีมจัดซื้อและทีมช่าง</p></div>${has("sales") ? button("+ สร้างใบเสนอราคา", "new-quote", "", "primary") : ""}</section><div class="stats">${[
      ["ใบเสนอราคาทั้งหมด", qs.length, "รายการในสิทธิ์ของคุณ", "▤"],
      ["รออนุมัติ", pending.length, "รอการตรวจสอบ", "◷"],
      [
        "งานจัดซื้อค้าง",
        prs.filter((p) => !p.closed).length,
        "เชื่อมต่อจาก SalePro / ซื้อภายใน",
        "▧",
      ],
      [
        "งานช่างค้าง",
        jobs.filter((j) => !["completed", "cancelled"].includes(j.status))
          .length,
        "รอรับงานและกำลังดำเนินการ",
        "⌘",
      ],
    ]
      .map(
        ([label, v, sub, icon]) =>
          `<div class="stat"><div class="stat-label">${label}<span class="stat-icon">${icon}</span></div><div class="stat-value">${v}<small> รายการ</small></div><small>${sub}</small></div>`,
      )
      .join(
        "",
      )}</div><div class="grid-two"><div>${panel("ใบเสนอราคาล่าสุด", qs.length ? table(["เลขที่เอกสาร", "ลูกค้า", "สถานะ", "ยอดรวม", ""], quoteRows(qs.slice().reverse().slice(0, 5))) : empty("ยังไม่มีใบเสนอราคา", "เพิ่มลูกค้าและสินค้า แล้วเริ่มใบเสนอราคาแรก"), link("ดูทั้งหมด →", "sales"))}${panel("ยอดค้างรับ", `<div class="stat-value">฿ ${money(outstanding)}</div><p class="muted">ยอดอนุมัติ หักเงินรับและภาษีหัก ณ ที่จ่ายที่บันทึกแล้ว</p>`)}</div><div>${panel("เส้นทางการทำงาน", `<div class="flow-row"><span class="flow-number">01</span><div class="flow-text"><strong>SalePro</strong><small>เสนอราคา · อนุมัติ · ส่งงาน</small></div><span class="flow-count">${qs.length}</span></div><div class="flow-row"><span class="flow-number">02</span><div class="flow-text"><strong>PurchasePro</strong><small>ขอราคา · สั่งซื้อ · รับสินค้า</small></div><span class="flow-count">${prs.length}</span></div><div class="flow-row"><span class="flow-number">03</span><div class="flow-text"><strong>Tech</strong><small>รับงาน · ดำเนินการ · ส่งมอบ</small></div><span class="flow-count">${jobs.length}</span></div><div class="callout">ทุกงานใช้รหัสอ้างอิงถาวร และบันทึกประวัติการเปลี่ยนแปลงร่วมกัน</div>`)}${panel("สิ่งที่ควรทำต่อ", !data("Customers").length && has("sales") ? `<p class="muted">เริ่มเตรียมข้อมูลพื้นฐานของระบบใหม่</p>${button("+ เพิ่มลูกค้า", "new-master", "Customers")}` : pending.length ? `<p>มีใบเสนอราคารออนุมัติ ${pending.length} รายการ</p>${link("ไปที่ SalePro →", "sales")}` : empty("พร้อมทำงาน", "เลือกโมดูลจากเมนูด้านซ้าย"))}</div></div>`
  );
}
function toolbar(placeholder, options = "") {
  return `<div class="toolbar"><input id="search" aria-label="ค้นหา" placeholder="${placeholder}" value="${esc(filter)}">${options ? `<select id="status-filter" aria-label="กรองสถานะ"><option value="">ทุกสถานะ</option>${options}</select>` : ""}<span class="count">ข้อมูลตามสิทธิ์ผู้ใช้งาน</span></div>`;
}
function sales() {
  const list = data("Quotations").filter(
    (q) =>
      (q.number + " " + q.customer.name)
        .toLowerCase()
        .includes(filter.toLowerCase()) &&
      (!filterStatus || q.status === filterStatus),
  );
  return (
    head(
      "SALEPRO",
      "งานขายและใบเสนอราคา",
      "เสนอราคา อนุมัติ ติดตามยอดรับเงิน และส่งต่องาน",
      has("sales")
        ? button("+ ใบเสนอราคาใหม่", "new-quote", "", "primary")
        : "",
    ) +
    toolbar(
      "ค้นหาเลขเอกสารหรือลูกค้า",
      Object.entries(labels)
        .filter(([k]) =>
          [
            "draft",
            "pending",
            "approved",
            "rejected",
            "cancelled",
            "superseded",
          ].includes(k),
        )
        .map(
          ([k, v]) =>
            `<option value="${k}" ${filterStatus === k ? "selected" : ""}>${v}</option>`,
        )
        .join(""),
    ) +
    panel(
      "รายการใบเสนอราคา",
      list.length
        ? table(
            ["เลขที่เอกสาร", "ลูกค้า", "สถานะ", "ยอดรวม", ""],
            quoteRows(list.slice().reverse()),
          )
        : empty("ไม่พบใบเสนอราคา", "เริ่มสร้างรายการใหม่ หรือเปลี่ยนคำค้นหา"),
    )
  );
}
function files(entity, id) {
  const parent = row(entity, id);
  const canAttach =
    (entity === "Vendors" && has("purchase")) ||
    has("admin") ||
    (entity === "Quotations"
      ? has("finance") || own(parent)
      : entity === "Procurements"
        ? has("purchase", "finance")
        : (has("tech") && parent.techEmail === state.user.email) ||
          (has("sales") &&
            row("Quotations", parent.quoteId)?.ownerEmail ===
              state.user.email));
  const list = data("Attachments").filter(
    (a) => a.entity === entity && a.entityId === id,
  );
  return (
    (list
      .map(
        (a) =>
          `<div class="file-row"><span>${esc(a.name)}<small class="muted"> · ${Math.ceil(a.size / 1024)} KB</small></span>${button("ดาวน์โหลด", "download", a.id)}</div>`,
      )
      .join("") || '<p class="muted">ยังไม่มีไฟล์แนบ</p>') +
    (canAttach
      ? `<div class="actions">${button("+ แนบรูป / PDF", "upload", entity + ":" + id)}</div><small class="muted">PDF, PNG, JPG, WebP · ไม่เกิน 5 MB</small>`
      : "")
  );
}
function totals(q) {
  return `<div class="totals"><div><span>รวมรายการ</span><span>${money(q.subtotal)}</span></div><div><span>ส่วนลด ${q.presentation?.discountMode === "amount" ? "(บาท)" : money(q.discountPct) + "%"}</span><span>${money(q.discount)}</span></div><div><span>VAT ${q.vatPct}%</span><span>${money(q.vat)}</span></div><div class="grand"><span>รวมสุทธิ</span><span>฿ ${money(q.total)}</span></div></div>`;
}
function quoteDetail(id) {
  const q = row("Quotations", id);
  if (!q) return empty("ไม่พบใบเสนอราคา", "อาจไม่มีสิทธิ์เข้าถึงรายการนี้");
  const items = data("QuoteItems")
      .filter((x) => x.quoteId === id)
      .sort((a, b) => a.sort - b.sort),
    prs = data("Procurements").filter((x) => x.quoteId === id),
    jobs = data("TechJobs").filter((x) => x.quoteId === id),
    payments = data("Payments").filter((x) => x.quoteId === id);
  return (
    head(
      "SALEPRO / " + esc(q.number),
      esc(q.customer.name),
      `${esc(q.number)} · ${displayDate(q.date)} · ${esc(q.ownerEmail)}`,
      status(q.status),
    ) +
    `<div class="actions">${own(q) && ["draft", "rejected"].includes(q.status) ? button("แก้ไข", "edit-quote", id) + button("ส่งอนุมัติ", "submit-quote", id, "primary") : ""}${q.status === "pending" && q.approverEmail === state.user.email ? button("อนุมัติ", "approve", id, "primary") + button("ไม่อนุมัติ", "reject", id, "danger") : ""}${own(q) && q.status === "approved" && !q.closed ? button("ส่งจัดซื้อ", "handoff", id) + button("มอบหมายช่าง", "assign-job", id) + button("ปิดงานขาย", "close-quote", id) : ""}${has("sales", "finance") && q.status === "approved" && !q.closed ? button("บันทึกรับเงิน", "payment", id) : ""}${button("พิมพ์ใบเสนอราคา", "print-quote", id)}${q.status === "approved" ? button("ใบส่งของ / แจ้งหนี้", "print-invoice", id) + button("ใบส่งของชั่วคราว", "print-temp-delivery", id) : ""}</div><div class="detail-grid"><div>${panel(
      "รายการสินค้า",
      table(
        ["รายการ", "จำนวน", "ราคา/หน่วย", "รวม"],
        items.map((i) =>
          i.type === "item"
            ? `<tr><td><strong>${esc(i.name)}</strong><small>${esc(i.partNo)} ${esc(i.description)}</small></td><td>${i.qty} ${esc(i.unit)}</td><td>${i.priceText ? esc(i.priceText) : money(i.price)}</td><td class="right">${i.priceText ? esc(i.priceText) : money(i.total)}</td></tr>`
            : `<tr><td colspan="4">${esc(i.name || i.description || "—")}</td></tr>`,
        ),
      ) +
        totals(q) +
        `<p class="muted pre-line">${esc(q.note)}</p>`,
    )}${panel(
      "งานจัดซื้อที่เชื่อมกัน",
      prs.length
        ? table(
            ["เลขที่", "สถานะ", ""],
            prs.map(
              (p) =>
                `<tr><td>${esc(p.number)}</td><td>${esc(state.stages[p.stage])}</td><td>${button("เปิด →", "open-purchase", p.id)}</td></tr>`,
            ),
          )
        : empty(
            "ยังไม่มีงานจัดซื้อ",
            "ส่งต่อสินค้าที่ต้องจัดซื้อจากใบเสนอราคานี้",
          ),
    )}${panel(
      "งานช่างที่เชื่อมกัน",
      jobs.length
        ? table(
            ["ชื่องาน", "ผู้รับผิดชอบ", "สถานะ", ""],
            jobs.map(
              (j) =>
                `<tr><td>${esc(j.title)}</td><td>${esc(j.techName)}</td><td>${status(j.status)}</td><td>${button("เปิด →", "open-job", j.id)}</td></tr>`,
            ),
          )
        : empty("ยังไม่มีงานช่าง", "มอบหมายงานให้ช่างหลังอนุมัติใบเสนอราคา"),
    )}${panel(
      "บันทึกติดตามงาน",
      `<div class="timeline">${
        data("DealNotes")
          .filter((n) => n.quoteId === id)
          .map(
            (n) =>
              `<div>${esc(n.text)}<small>${esc(n.by)} · ${displayDate(n.createdAt)}</small></div>`,
          )
          .join("") || '<p class="muted">ยังไม่มีบันทึก</p>'
      }</div>${own(q) ? button("+ เพิ่มบันทึก", "note", id) : ""}`,
    )}</div><div>${panel("ข้อมูลลูกค้า", `<h3>${esc(q.customer.name)}</h3><p class="muted pre-line">${esc(q.customer.address)}<br>${esc(q.customer.phone)}<br>${esc(q.customer.email)}</p><small class="muted">ข้อมูล ณ วันที่บันทึกใบเสนอราคา</small>`)}${panel("รับชำระเงิน", `<div class="stat-value">฿ ${money(Math.max(0, Advanced.balances(state.data, q).target - paid(q)))}</div><p class="muted">ยอดคงเหลือ · รับแล้ว ${money(paid(q))}</p>${payments.map((p) => `<div class="file-row"><span>${displayDate(p.date)}<br>รับ ${money(p.amount)} · หัก ณ ที่จ่าย ${money(p.withholding)}</span>${button("ใบรับเงิน", "print-receipt", p.id)}</div>`).join("")}`)}${panel(
      "ประวัติอนุมัติ",
      data("Approvals")
        .filter((a) => a.quoteId === id)
        .map(
          (a) =>
            `<p>${status(a.status)}<br><small>${esc(a.by)} · ${displayDate(a.createdAt)}</small><br>${esc(a.comment)}</p>`,
        )
        .join("") ||
        `<p class="muted">${q.approverEmail ? "รอ " + esc(q.approverEmail) : "ยังไม่ส่งอนุมัติ"}</p>`,
    )}${panel("เอกสารแนบ", files("Quotations", id))}</div></div>`
  );
}
function purchases() {
  let list = data("Procurements").filter((p) =>
    (p.number + " " + p.note).toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    head(
      "PURCHASEPRO",
      "งานจัดซื้อ",
      "รับงาน ขอราคา เทียบราคา สั่งซื้อ และตรวจรับสินค้า",
      has("purchase")
        ? button("+ ซื้อภายใน", "internal-purchase", "", "primary")
        : "",
    ) +
    toolbar("ค้นหาเลขที่หรือรายละเอียด") +
    panel(
      "รายการงานจัดซื้อ",
      list.length
        ? table(
            ["เลขที่", "ประเภท", "ขั้นตอน", "กำหนดรับ", ""],
            list
              .slice()
              .reverse()
              .map(
                (p) =>
                  `<tr><td><strong>${esc(p.number)}</strong><small>${esc(p.note)}</small></td><td>${p.type === "sale" ? "จากงานขาย" : "ซื้อภายใน"}</td><td><span class="badge ${p.closed ? "green" : "blue"}">${p.stage}/8 · ${esc(state.stages[p.stage])}</span></td><td>${displayDate(p.requiredDate)}</td><td>${button("เปิด →", "open-purchase", p.id)}</td></tr>`,
              ),
          )
        : empty(
            "ยังไม่มีงานจัดซื้อ",
            "รับงานจาก SalePro หรือสร้างรายการซื้อภายใน",
          ),
    )
  );
}
function purchaseDetail(id) {
  const p = row("Procurements", id);
  if (!p) return empty("ไม่พบงานจัดซื้อ", "ตรวจสอบสิทธิ์ของคุณ");
  const items = data("ProcurementItems").filter((x) => x.procurementId === id),
    offers = data("VendorQuotes").filter((x) => x.procurementId === id),
    pos = data("PurchaseOrders").filter((x) => x.procurementId === id);
  return (
    head(
      "PURCHASEPRO / " + esc(p.number),
      esc(p.number),
      "อ้างอิง " +
        esc(
          row("Quotations", p.quoteId)?.number ||
            (p.type === "internal" ? "ซื้อภายใน" : p.quoteId),
        ),
      `<span class="badge green">${state.stages[p.stage]}</span>`,
    ) +
    `<div class="progress">${Array.from({ length: 8 }, (_, i) => `<span title="${state.stages[i + 1]}" class="${i < p.stage ? "done" : ""}"></span>`).join("")}</div><div class="actions">${has("purchase") && !p.cancelled && p.stage < 8 ? button("ไปขั้น " + (p.stage + 1) + " · " + state.stages[p.stage + 1], "advance-purchase", id, "primary") : ""}${has("purchase") && !p.cancelled && p.stage < 5 ? button("+ บันทึกราคาผู้ขาย", "vendor-quote", id) : ""}${button("พิมพ์ใบขอราคา", "print-rfq", id)}</div><div class="callout">${esc(p.note || "ไม่ระบุหมายเหตุ")} · กำหนดรับ ${displayDate(p.requiredDate)}<br>ขั้นรับของครบต้องตรวจรับทุกรายการแล้ว ยอดค้างจ่ายผู้ขายติดตามแยกตาม PO</div>${panel(
      "รายการจัดซื้อและราคาผู้ขาย",
      table(
        ["สินค้า", "จำนวน", "ผู้ขาย / ราคาเสนอ", "เลือกผู้ขาย"],
        items.map(
          (i) =>
            `<tr><td><strong>${esc(i.name)}</strong><small>${esc(i.partNo)}</small></td><td>${i.qty} ${esc(i.unit)}</td><td>${
              offers
                .filter((v) => v.itemId === i.id)
                .map(
                  (v) =>
                    `${esc(row("Vendors", v.vendorId)?.name || v.vendorId)} · ฿ ${money(v.unitPrice)} / ${esc(i.unit)}${v.selected ? " ✓" : ""}<br>`,
                )
                .join("") || "ยังไม่มีราคา"
            }</td><td>${
              has("purchase") && !p.cancelled && p.stage < 5
                ? offers
                    .filter((v) => v.itemId === i.id)
                    .map((v) =>
                      button(
                        v.selected
                          ? "✓ " +
                              (row("Vendors", v.vendorId)?.name || "ผู้ขาย")
                          : "เลือก " +
                              (row("Vendors", v.vendorId)?.name || "ผู้ขาย"),
                        "select-vendor",
                        v.id,
                      ),
                    )
                    .join(" ")
                : "—"
            }</td></tr>`,
        ),
      ),
    )}${pos
      .map((po) => {
        const lines = data("PurchaseOrderItems").filter(
          (i) => i.purchaseOrderId === po.id,
        );
        return panel(
          esc(po.number) + " · " + esc(po.vendor.name),
          `<div class="detail-meta"><span>ยอดสุทธิ<strong>฿ ${money(po.total)}</strong></span><span>ชำระแล้ว<strong>฿ ${money(poPaid(po))}</strong></span><span>ค้างจ่าย<strong>฿ ${money(Advanced.poBalances(state.data, po).target - poPaid(po))}</strong></span></div><div class="actions">${has("purchase", "finance") && !po.cancelled ? button("บันทึกจ่ายเงิน", "vendor-payment", po.id) : ""}${has("purchase") && !po.cancelled ? button("บันทึกขนส่ง", "shipment", po.id) : ""}${button("พิมพ์ PO", "print-po", po.id)}</div>${table(
            ["สินค้า", "สั่ง", "รับแล้ว", "ราคา", ""],
            lines.map(
              (i) =>
                `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${i.received}</td><td>${money(i.total)}</td><td>${has("purchase") && !po.cancelled && i.received < i.qty ? button("ตรวจรับ", "receive", i.id) : "✓"}</td></tr>`,
            ),
          )}<p class="muted">${
            data("Shipments")
              .filter((s) => s.purchaseOrderId === po.id)
              .map((s) => esc(s.tracking) + " · " + displayDate(s.date))
              .join(" / ") || "ยังไม่บันทึกข้อมูลขนส่ง"
          }</p>${data("VendorPayments")
            .filter((x) => x.purchaseOrderId === po.id)
            .map(
              (x) =>
                `<p class="muted">จ่าย ${money(x.amount)} · ${displayDate(x.date)} · ${esc(x.reference)}</p>`,
            )
            .join("")}`,
        );
      })
      .join(
        "",
      )}${panel("ไฟล์จัดซื้อ / หลักฐานจ่าย / เอกสารตรวจรับ", files("Procurements", id))}`
  );
}
function tech() {
  const jobs = data("TechJobs").filter((j) =>
    (j.title + " " + j.techName).toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    head(
      "TECH",
      "งานช่างและส่งมอบ",
      "งานที่ได้รับมอบหมาย รูปหน้างาน และค่าใช้จ่าย",
    ) +
    toolbar("ค้นหาชื่องานหรือช่าง") +
    (jobs.length
      ? `<div class="job-grid">${jobs
          .slice()
          .reverse()
          .map(
            (j) =>
              `<article class="job-card">${status(j.status)}<h3>${esc(j.title)}</h3><p>${esc(j.techName)}<br>นัดหมาย ${displayDate(j.scheduledAt)}<br>${esc(j.location)}</p><div class="progress">${["assigned", "accepted", "inprogress", "completed"].map((s, i) => `<span class="${i <= ["assigned", "accepted", "inprogress", "completed"].indexOf(j.status) ? "done" : ""}"></span>`).join("")}</div>${button("เปิดงาน →", "open-job", j.id)}</article>`,
          )
          .join("")}</div>`
      : panel(
          "งานช่าง",
          empty(
            "ยังไม่มีงานที่มอบหมาย",
            "ฝ่ายขายมอบหมายงานจากใบเสนอราคาที่อนุมัติแล้ว",
          ),
        ))
  );
}
function jobDetail(id) {
  const j = row("TechJobs", id);
  if (!j) return empty("ไม่พบงานช่าง", "ตรวจสอบสิทธิ์ของคุณ");
  const can = has("admin") || (has("tech") && j.techEmail === state.user.email),
    expenses = data("TechExpenses").filter((e) => e.jobId === id);
  return (
    head(
      "TECH / " + esc(j.id.slice(0, 8)),
      esc(j.title),
      esc(j.techName) + " · นัดหมาย " + displayDate(j.scheduledAt),
      status(j.status),
    ) +
    `<div class="actions">${j.status !== "cancelled" ? button("ใบส่งของชั่วคราว", "print-job-delivery", id) : ""}${can && !["completed", "cancelled"].includes(j.status) ? button({ assigned: "รับงาน", accepted: "เริ่มดำเนินการ", inprogress: "บันทึกส่งมอบงาน" }[j.status], "advance-job", id, "primary") + button("+ ค่าใช้จ่าย", "expense", id) : ""}</div><div class="detail-grid"><div>${panel("รายละเอียดหน้างาน", `<div class="detail-meta"><span>ผู้ติดต่อ<strong>${esc(j.contact || "—")}</strong></span><span>โทรศัพท์<strong>${esc(j.phone || "—")}</strong></span></div><h3 class="form-section">สถานที่</h3><p class="pre-line">${esc(j.location)}</p><h3>อุปกรณ์ / สิ่งที่ต้องเตรียม</h3><p class="pre-line">${esc(j.materials || "—")}</p><h3>หมายเหตุ</h3><p class="pre-line">${esc(j.note || "—")}</p>${j.completionNote ? `<h3>สรุปการส่งมอบ</h3><p class="pre-line">${esc(j.completionNote)}</p>` : ""}`)}${panel("รูปหน้างานและหลักฐาน", files("TechJobs", id))}</div><div>${panel(
      "ค่าใช้จ่ายของงาน",
      `<div class="stat-value">฿ ${money(expenses.reduce((s, e) => s + e.amount, 0))}</div>` +
        (expenses.length
          ? table(
              ["ประเภท", "จำนวนเงิน"],
              expenses.map(
                (e) =>
                  `<tr><td>${esc(e.category)}<small>${esc(e.note)} · ${displayDate(e.date)}</small></td><td>${money(e.amount)}</td></tr>`,
              ),
            )
          : empty(
              "ยังไม่มีค่าใช้จ่าย",
              "บันทึกค่าเดินทาง วัสดุ หรือค่าใช้จ่ายอื่น",
            )),
    )}</div></div>`
  );
}
function master(t) {
  const list = data(t).filter((r) =>
    (r.name + " " + (r.email || "") + " " + (r.partNo || ""))
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const can = t === "Customers" ? has("sales") : has("purchase");
  return (
    head(
      "SHARED DIRECTORY",
      masterLabels[t],
      "ข้อมูลพื้นฐานที่ใช้ร่วมกันทั้งสามโมดูล",
      can
        ? button("+ เพิ่ม" + masterLabels[t], "new-master", t, "primary")
        : "",
    ) +
    toolbar("ค้นหา" + masterLabels[t]) +
    panel(
      "รายการ" + masterLabels[t],
      list.length
        ? table(
            [
              "ชื่อ",
              t === "Catalog" ? "Part No. / ราคา" : "ติดต่อ",
              "สถานะ",
              "",
            ],
            list.map(
              (r) =>
                `<tr><td><strong>${esc(r.name)}</strong><small>${esc(r.address || r.unit || "")}</small></td><td>${esc(t === "Catalog" ? (r.partNo || "—") + " · ฿ " + money(r.price) : r.email || r.phone || "—")}</td><td><span class="badge ${r.active ? "green" : ""}">${r.active ? "ใช้งาน" : "ปิดใช้งาน"}</span></td><td>${can ? button("แก้ไข", "edit-master", t + ":" + r.id) : ""}${t === "Vendors" ? link("เอกสาร", "Vendors/" + r.id) : ""}</td></tr>`,
            ),
          )
        : empty(
            "ยังไม่มี" + masterLabels[t],
            "เพิ่มรายการเพื่อใช้ในเอกสารและงานใหม่",
          ),
    )
  );
}
function contracts() {
  const list = data("Contracts");
  return (
    head(
      "CONTRACTS",
      "ทะเบียนสัญญา",
      "เชื่อมหลายใบเสนอราคา และรวมยอดรับเงินของสัญญา",
      has("sales", "finance")
        ? button("+ เพิ่มสัญญา", "contract", "", "primary")
        : "",
    ) +
    panel(
      "สัญญาทั้งหมด",
      list.length
        ? table(
            ["เลขที่ / ชื่อ", "คู่สัญญา", "วันสิ้นสุด", "มูลค่า / รับแล้ว", ""],
            list.map((c) => {
              const ids = data("ContractQuotes")
                .filter((l) => l.contractId === c.id)
                .map((l) => l.quoteId);
              const got = data("Payments")
                .filter((p) => ids.includes(p.quoteId))
                .reduce((s, p) => s + p.amount + p.withholding, 0);
              return `<tr><td><strong>${esc(c.number)}</strong><small>${esc(c.name)} · ${ids.length} ใบเสนอราคา</small></td><td>${esc(c.party)}</td><td>${displayDate(c.end)} ${c.end < today() ? '<span class="badge red">หมดอายุ</span>' : ""}</td><td>${money(c.value)}<small>รับแล้ว ${money(got)}</small></td><td>${has("sales", "finance") ? button("แก้ไข", "contract", c.id) : ""}</td></tr>`;
            }),
          )
        : empty("ยังไม่มีสัญญา", "เพิ่มสัญญาและเลือกใบเสนอราคาที่เกี่ยวข้อง"),
    )
  );
}
function settings() {
  if (!has("admin")) return empty("ไม่มีสิทธิ์", "หน้านี้สำหรับผู้ดูแลระบบ");
  const c = data("Company")[0];
  return (
    head(
      "ADMINISTRATION",
      "ตั้งค่าระบบ",
      "ข้อมูลบริษัท ผู้ใช้งาน และประวัติการเปลี่ยนแปลง",
    ) +
    panel(
      "ข้อมูลบริษัท",
      `<h3>${esc(c?.name || "ยังไม่ได้ตั้งค่าบริษัท")}</h3><p class="muted">${esc(c?.address || "ข้อมูลนี้ใช้เป็นหัวเอกสารใหม่")}</p>${button("ตั้งค่าบริษัท", "edit-master", "Company:" + (c?.id || ""))}`,
    ) +
    panel(
      "ผู้ใช้งาน",
      table(
        ["ชื่อ", "อีเมล", "บทบาท", "สถานะ", ""],
        data("Users").map(
          (u) =>
            `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.roles.map((r) => esc(roles[r])).join(", ")}</td><td>${u.active ? "ใช้งาน" : "ปิดใช้งาน"}</td><td>${button("แก้ไข", "edit-master", "Users:" + u.id)}</td></tr>`,
        ),
      ),
      button("+ เพิ่มผู้ใช้", "new-master", "Users"),
    ) +
    panel(
      "ประวัติการเปลี่ยนแปลงล่าสุด",
      data("AuditLog").length
        ? table(
            ["วันที่", "ผู้ทำรายการ", "คำสั่ง", "อ้างอิง"],
            data("AuditLog")
              .slice(0, 30)
              .map(
                (a) =>
                  `<tr><td>${displayDate(a.createdAt)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.summary)}</td></tr>`,
              ),
          )
        : empty("ยังไม่มีประวัติ", "ทุกการบันทึกจะเพิ่มประวัติอัตโนมัติ"),
    )
  );
}
function render() {
  if (!state) return;
  renderNav();
  const [page, id] = (location.hash.slice(1) || "dashboard").split("/");
  let html;
  try {
    html =
      page === "dashboard"
        ? dashboard()
        : page === "sales"
          ? id
            ? quoteDetail(id)
            : sales()
          : page === "purchase"
            ? id
              ? purchaseDetail(id)
              : purchases()
            : page === "tech"
              ? id
                ? jobDetail(id)
                : tech()
              : page === "contracts"
                ? contracts()
                : page === "settings"
                  ? settings()
                  : masterLabels[page]
                    ? master(page)
                    : empty("ไม่พบหน้า", "เลือกเมนูเพื่อเริ่มทำงาน");
  } catch (e) {
    html = empty("แสดงข้อมูลไม่สำเร็จ", e.message);
  }
  $("#main").innerHTML = html;
}
function field(name, label, value = "", type = "text", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function area(name, label, value = "") {
  return `<label class="span-two">${label}<textarea name="${name}">${esc(value)}</textarea></label>`;
}
function select(name, label, options, value = "", required = true) {
  return `<label>${label}<select name="${name}" ${required ? "required" : ""}><option value="">เลือก…</option>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
}
function formValues() {
  return Object.fromEntries(new FormData($("#editor")).entries());
}
function openModal(title, html, save, label = "บันทึก") {
  modalSave = save;
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  $("#form-error").textContent = "";
  $("#save-button").textContent = label;
  $("#modal").showModal();
}
function masterForm(t, id) {
  const r = row(t, id) || {};
  const common = field("name", "ชื่อ", r.name, "text", "required");
  let html = common;
  if (t === "Catalog")
    html +=
      field("partNo", "Part No.", r.partNo) +
      field("unit", "หน่วย", r.unit) +
      field(
        "price",
        "ราคาขาย",
        r.price || 0,
        "number",
        'min="0" step="0.01" required',
      ) +
      field(
        "cost",
        "ต้นทุนตั้งต้น",
        r.cost || 0,
        "number",
        'min="0" step="0.01" required',
      ) +
      select(
        "vendorId",
        "ผู้ขายหลัก",
        data("Vendors")
          .filter((v) => v.active)
          .map((v) => [v.id, v.name]),
        r.vendorId,
        false,
      );
  else if (t === "Users")
    html +=
      field("email", "Gmail", r.email, "email", "required") +
      `<div class="span-two"><h3>บทบาท</h3>${Object.entries(roles)
        .map(
          ([k, v]) =>
            `<label class="check"><input type="checkbox" name="role" value="${k}" ${(r.roles || []).includes(k) ? "checked" : ""}>${v}</label>`,
        )
        .join("")}</div>`;
  else
    html +=
      field("email", "อีเมล", r.email, "email") +
      field("phone", "โทรศัพท์", r.phone) +
      (t !== "Company"
        ? field("contact", "ผู้ติดต่อ", r.contact)
        : field("branch", "สาขา", r.branch)) +
      field("taxId", "เลขประจำตัวผู้เสียภาษี", r.taxId) +
      area("address", "ที่อยู่", r.address);
  if (t !== "Company")
    html += `<label class="check span-two"><input type="checkbox" name="active" ${r.active !== false ? "checked" : ""}>เปิดใช้งาน</label>`;
  openModal(
    (id ? "แก้ไข" : "เพิ่ม") + masterLabels[t],
    `<div class="form-grid">${html}</div>`,
    async () => {
      const v = formValues();
      v.active = $("[name=active]")?.checked;
      if (t === "Users")
        v.roles = $$("[name=role]:checked").map((e) => e.value);
      await run("saveMaster", {
        table: t,
        id: id || "",
        version: r.version,
        data: v,
      });
    },
  );
}
function lineHtml(i = {}) {
  return `<tr data-line><td class="kind-col"><select data-key="type">${[
    ["item", "สินค้า"],
    ["group", "หัวข้อ"],
    ["note", "หมายเหตุ"],
    ["blank", "เว้นบรรทัด"],
    ["pagebreak", "ขึ้นหน้าใหม่"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${(i.type || "item") === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></td><td class="name-col"><input data-key="name" aria-label="ชื่อสินค้า" placeholder="สินค้า / หัวข้อ" value="${esc(i.name)}"><input data-key="partNo" placeholder="Part No." aria-label="Part No." value="${esc(i.partNo)}"><input data-key="description" placeholder="รายละเอียด" aria-label="รายละเอียด" value="${esc(i.description)}"><input type="hidden" data-key="catalogId" value="${esc(i.catalogId)}"></td><td class="number-col"><input data-key="qty" aria-label="จำนวน" type="number" min="0.001" step="any" value="${i.qty || 1}"><input data-key="unit" aria-label="หน่วย" placeholder="หน่วย" value="${esc(i.unit)}"></td><td class="number-col"><input data-key="price" aria-label="ราคา" type="number" min="0" step="0.01" value="${i.price || 0}"><input data-key="cost" aria-label="ต้นทุน" placeholder="ต้นทุน" type="number" min="0" step="0.01" value="${i.cost || 0}"></td><td class="number-col"><input data-key="discountPct" aria-label="ส่วนลดเปอร์เซ็นต์" type="number" min="0" max="100" step="any" value="${i.discountPct || 0}"></td><td class="delete-col"><button type="button" data-action="remove-line" aria-label="ลบบรรทัด">×</button></td></tr>`;
}
function collectLines() {
  return $$("[data-line]").map((tr) =>
    Object.fromEntries(
      Array.from(tr.querySelectorAll("[data-key]")).map((e) => [
        e.dataset.key,
        e.value,
      ]),
    ),
  );
}
function quoteForm(id) {
  if (!data("Customers").some((c) => c.active)) {
    toast("เพิ่มลูกค้าก่อนสร้างใบเสนอราคา");
    return masterForm("Customers");
  }
  const q = row("Quotations", id) || {},
    items = data("QuoteItems").filter((i) => i.quoteId === id);
  openModal(
    id ? "แก้ไขใบเสนอราคา" : "ใบเสนอราคาใหม่",
    `<div class="form-grid">${select(
      "customerId",
      "ลูกค้า",
      data("Customers")
        .filter((c) => c.active)
        .map((c) => [c.id, c.name]),
      q.customerId,
    )}${field("date", "วันที่", q.date || today(), "date", "required")}</div><h3 class="form-section">รายการสินค้า</h3><div class="toolbar">${select(
      "catalogPicker",
      "เพิ่มจากสินค้า",
      data("Catalog")
        .filter((c) => c.active)
        .map((c) => [c.id, c.name]),
      "",
      false,
    )}${button("+ บรรทัด", "add-line")}</div><div class="table-wrap"><table class="line-editor"><thead><tr><th>ชนิด</th><th>รายการ</th><th>จำนวน/หน่วย</th><th>ราคา/ต้นทุน</th><th>ส่วนลด %</th><th></th></tr></thead><tbody id="lines">${(items.length ? items : [{}]).map(lineHtml).join("")}</tbody></table></div><div class="form-grid" style="margin-top:20px">${field("discountPct", "ส่วนลดท้ายเอกสาร (%)", q.discountPct || 0, "number", 'min="0" max="100" step="any"')}${field("vatPct", "VAT (%)", q.vatPct == null ? 7 : q.vatPct, "number", 'min="0" max="100" step="any"')}${area("note", "หมายเหตุ", q.note)}${area("terms", "เงื่อนไข", q.terms)}</div>`,
    async () => {
      const v = formValues();
      delete v.catalogPicker;
      const out = await run("saveQuote", {
        ...v,
        id: id || "",
        version: q.version,
        items: collectLines(),
      });
      if (out) location.hash = "sales/" + out.id;
    },
  );
}
function simple(title, html, action, base = {}, label) {
  openModal(
    title,
    `<div class="form-grid">${html}</div>`,
    async () => run(action, { ...base, ...formValues() }),
    label,
  );
}
function handoff(id) {
  const q = row("Quotations", id),
    items = data("QuoteItems")
      .filter((i) => i.quoteId === id && i.type === "item")
      .map((i) => ({
        ...i,
        remaining:
          i.qty -
          data("ProcurementItems")
            .filter(
              (x) =>
                x.quoteItemId === i.id &&
                !data("Procurements").find((p) => p.id === x.procurementId)
                  ?.cancelled,
            )
            .reduce((s, x) => s + Advanced.reservedQty(state.data, x), 0),
      }))
      .filter((i) => i.remaining > 0);
  if (!items.length) return toast("ส่งจัดซื้อครบทุกรายการแล้ว");
  openModal(
    "ส่งงานให้ PurchasePro",
    `<div class="callout">${esc(q.number)} · เลือกจำนวนที่ต้องการส่งจัดซื้อ แบ่งส่งได้หลายครั้ง</div>${table(
      ["เลือก", "สินค้า", "คงเหลือ", "จำนวนส่ง"],
      items.map(
        (i) =>
          `<tr data-proc-item="${i.id}"><td><input type="checkbox" aria-label="เลือก ${esc(i.name)}" checked></td><td>${esc(i.name)}</td><td>${i.remaining}</td><td><input type="number" aria-label="จำนวน ${esc(i.name)}" min="0.001" max="${i.remaining}" step="any" value="${i.remaining}"></td></tr>`,
      ),
    )}<div class="form-grid">${field("requiredDate", "กำหนดรับ", "", "date")}${area("note", "หมายเหตุ")}</div>`,
    async () =>
      run("createProcurement", {
        ...formValues(),
        quoteId: id,
        items: $$("[data-proc-item]")
          .filter((e) => e.querySelector("[type=checkbox]").checked)
          .map((e) => ({
            quoteItemId: e.dataset.procItem,
            qty: e.querySelector("[type=number]").value,
          })),
      }),
  );
}
function contractForm(id) {
  const c = row("Contracts", id) || {},
    selected = data("ContractQuotes")
      .filter((x) => x.contractId === id)
      .map((x) => x.quoteId);
  openModal(
    "ทะเบียนสัญญา",
    `<div class="form-grid">${field("number", "เลขสัญญา", c.number, "text", "required")}${field("name", "ชื่อสัญญา", c.name, "text", "required")}${field("party", "คู่สัญญา", c.party, "text", "required")}${field("value", "มูลค่าสัญญา", c.value || 0, "number", 'min="0" step="0.01" required')}${field("start", "วันเริ่ม", c.start || today(), "date", "required")}${field("end", "วันสิ้นสุด", c.end || today(), "date", "required")}${area("note", "หมายเหตุ", c.note)}<div class="span-two"><h3>ใบเสนอราคาที่เชื่อมกัน</h3>${
      data("Quotations")
        .map(
          (q) =>
            `<label class="check"><input name="quoteIds" type="checkbox" value="${q.id}" ${selected.includes(q.id) ? "checked" : ""}>${esc(q.number)} · ${esc(q.customer.name)}</label>`,
        )
        .join("") || "ยังไม่มีใบเสนอราคา"
    }</div></div>`,
    async () => {
      const v = formValues();
      v.quoteIds = $$("[name=quoteIds]:checked").map((e) => e.value);
      await run("saveContract", { ...v, id: id || "", version: c.version });
    },
  );
}
async function action(name, id, el) {
  const q = row("Quotations", id),
    p = row("Procurements", id),
    j = row("TechJobs", id);
  switch (name) {
    case "new-master":
      return masterForm(id);
    case "edit-master": {
      const [t, rid] = id.split(":");
      return masterForm(t, rid);
    }
    case "new-quote":
      return quoteForm();
    case "edit-quote":
      return quoteForm(id);
    case "open-quote":
      location.hash = "sales/" + id;
      return;
    case "open-purchase":
      location.hash = "purchase/" + id;
      return;
    case "open-job":
      location.hash = "tech/" + id;
      return;
    case "add-line":
      $("#lines").insertAdjacentHTML("beforeend", lineHtml());
      return;
    case "remove-line":
      el.closest("tr").remove();
      return;
    case "submit-quote":
      return simple(
        "ส่งใบเสนอราคาอนุมัติ",
        select(
          "approverEmail",
          "ผู้อนุมัติ",
          data("Users")
            .filter(
              (u) =>
                u.email !== q.ownerEmail &&
                u.roles.some((r) => ["admin", "approver"].includes(r)),
            )
            .map((u) => [u.email, u.name + " · " + u.email]),
        ),
        "submitQuote",
        { id, version: q.version },
        "ส่งอนุมัติ",
      );
    case "approve":
    case "reject":
      return simple(
        name === "approve" ? "อนุมัติใบเสนอราคา" : "ไม่อนุมัติใบเสนอราคา",
        area("comment", "เหตุผล / ความเห็น"),
        "approveQuote",
        {
          id,
          version: q.version,
          status: name === "approve" ? "approved" : "rejected",
        },
      );
    case "payment":
      return simple(
        "บันทึกรับเงิน",
        field(
          "amount",
          "ยอดเงินเข้าจริง",
          "",
          "number",
          'min="0.01" step="0.01" required',
        ) +
          field(
            "withholding",
            "ภาษีหัก ณ ที่จ่าย (บาท)",
            0,
            "number",
            'min="0" step="0.01"',
          ) +
          field("date", "วันที่รับ", today(), "date", "required") +
          field("method", "วิธีชำระ", "โอนเงิน") +
          field("reference", "เลขอ้างอิง") +
          area("note", "หมายเหตุ"),
        "addPayment",
        { quoteId: id },
      );
    case "note":
      return simple("บันทึกติดตามงาน", area("text", "ข้อความ"), "addNote", {
        quoteId: id,
      });
    case "handoff":
      return handoff(id);
    case "close-quote":
      return simple(
        "ปิดงานขาย",
        `<div class="callout span-two">ระบบจะตรวจว่างานจัดซื้อและงานช่างเสร็จแล้ว พร้อมรับเงินครบ ${money(Advanced.balances(state.data, q).target)} บาท</div>`,
        "closeQuote",
        { id, version: q.version },
        "ตรวจสอบและปิดงาน",
      );
    case "assign-job":
      return simple(
        "มอบหมายงานช่าง",
        field("title", "ชื่องาน", "", "text", "required") +
          select(
            "techEmail",
            "ช่างผู้รับผิดชอบ",
            data("Users")
              .filter((u) => u.roles.some((r) => ["admin", "tech"].includes(r)))
              .map((u) => [u.email, u.name]),
          ) +
          field("scheduledAt", "วันนัดหมาย", today(), "date", "required") +
          field("contact", "ผู้ติดต่อ", q.customer.contact) +
          field("phone", "โทรศัพท์", q.customer.phone) +
          field("location", "สถานที่", q.customer.address) +
          area("materials", "อุปกรณ์ / สิ่งที่ต้องเตรียม") +
          area("note", "รายละเอียดงาน"),
        "assignJob",
        { quoteId: id },
      );
    case "internal-purchase":
      return simple(
        "จัดซื้อภายใน",
        field("name", "สินค้า", "", "text", "required") +
          field(
            "qty",
            "จำนวน",
            1,
            "number",
            'min="0.001" step="any" required',
          ) +
          field("unit", "หน่วย", "ชิ้น") +
          field("requiredDate", "กำหนดรับ", "", "date") +
          area("note", "วัตถุประสงค์"),
        null,
      ); // custom handler installed below
    case "vendor-quote": {
      const its = data("ProcurementItems").filter(
        (i) => i.procurementId === id,
      );
      openModal(
        "บันทึกราคาผู้ขาย",
        `<div class="form-grid">${select(
          "itemId",
          "รายการสินค้า",
          its.map((i) => [i.id, i.name]),
        )}${select(
          "vendorId",
          "ผู้ขาย",
          data("Vendors")
            .filter((v) => v.active)
            .map((v) => [v.id, v.name]),
        )}${field("unitPrice", "ราคาต่อหน่วย (ก่อนภาษี)", "", "number", 'min="0" step="0.01" required')}${field("leadDays", "ระยะเวลาส่ง (วัน)", 0, "number", 'min="0" max="3650"')}${area("note", "เงื่อนไขราคา")}</div>`,
        async () => {
          const v = formValues(),
            old = data("VendorQuotes").find(
              (x) => x.itemId === v.itemId && x.vendorId === v.vendorId,
            );
          await run("saveVendorQuote", {
            ...v,
            procurementId: id,
            version: old?.version,
          });
        },
      );
      return;
    }
    case "select-vendor": {
      const v = row("VendorQuotes", id),
        pr = row("Procurements", v.procurementId);
      return run("selectVendor", { id, version: pr.version });
    }
    case "advance-purchase":
      return simple(
        "เปลี่ยนขั้นตอนจัดซื้อ",
        `<div class="callout span-two">${state.stages[p.stage]} → ${state.stages[p.stage + 1]}${p.stage === 4 ? "<br>ระบบจะสร้าง PO แยกตามผู้ขายที่เลือก ราคาจะถูกล็อกหลังออก PO" : ""}</div>`,
        "advancePurchase",
        { id, version: p.version },
        "ยืนยันขั้นตอน",
      );
    case "vendor-payment":
      return simple(
        "บันทึกจ่ายเงินผู้ขาย",
        field(
          "amount",
          "จำนวนเงิน",
          "",
          "number",
          'min="0.01" step="0.01" required',
        ) +
          field("date", "วันที่จ่าย", today(), "date", "required") +
          field("reference", "เลขอ้างอิง") +
          area("note", "หมายเหตุ"),
        "payVendor",
        { purchaseOrderId: id },
      );
    case "shipment":
      return simple(
        "บันทึกขนส่ง",
        field("date", "วันที่ส่ง", today(), "date", "required") +
          field("tracking", "เลขติดตาม / บริษัทขนส่ง", "", "text", "required") +
          area("note", "หมายเหตุ"),
        "addShipment",
        { purchaseOrderId: id },
      );
    case "receive": {
      const i = row("PurchaseOrderItems", id);
      return simple(
        "ตรวจรับสินค้า · " + i.name,
        field(
          "qty",
          "จำนวนที่รับ",
          i.qty - i.received,
          "number",
          `min="0.001" max="${i.qty - i.received}" step="any" required`,
        ) +
          field("date", "วันที่รับ", today(), "date", "required") +
          area("note", "ผลตรวจรับ / QC"),
        "receiveItem",
        { id, version: i.version },
      );
    }
    case "advance-job":
      return simple(
        "อัปเดตงานช่าง",
        j.status === "inprogress"
          ? area("completionNote", "สรุปผลการทำงาน (จำเป็น)")
          : `<div class="callout span-two">${j.status === "assigned" ? "ยืนยันรับงานนี้" : "เริ่มดำเนินการงานนี้"}</div>`,
        "advanceJob",
        { id, version: j.version },
      );
    case "expense":
      return simple(
        "ค่าใช้จ่ายหน้างาน",
        select("category", "ประเภท", [
          ["เดินทาง", "เดินทาง"],
          ["วัสดุ", "วัสดุ"],
          ["อื่น ๆ", "อื่น ๆ"],
        ]) +
          field(
            "amount",
            "จำนวนเงิน",
            "",
            "number",
            'min="0.01" step="0.01" required',
          ) +
          field("date", "วันที่", today(), "date", "required") +
          area("note", "รายละเอียด"),
        "addExpense",
        { jobId: id },
      );
    case "contract":
      return contractForm(id);
    case "upload": {
      const [entity, entityId] = id.split(":");
      const references = [];
      if (entity === "Quotations")
        data("Payments")
          .filter((x) => x.quoteId === entityId)
          .forEach((x) =>
            references.push([
              "Payments:" + x.id,
              "รับเงิน " + money(x.amount) + " · " + displayDate(x.date),
            ]),
          );
      if (entity === "TechJobs")
        data("TechExpenses")
          .filter((x) => x.jobId === entityId)
          .forEach((x) =>
            references.push([
              "TechExpenses:" + x.id,
              x.category + " " + money(x.amount),
            ]),
          );
      if (entity === "Procurements") {
        const ids = new Set(
          data("PurchaseOrders")
            .filter((x) => x.procurementId === entityId)
            .map((x) => x.id),
        );
        data("VendorPayments")
          .filter((x) => ids.has(x.purchaseOrderId))
          .forEach((x) =>
            references.push([
              "VendorPayments:" + x.id,
              "จ่ายผู้ขาย " + money(x.amount),
            ]),
          );
        data("Receipts")
          .filter((x) => ids.has(x.purchaseOrderId))
          .forEach((x) =>
            references.push([
              "Receipts:" + x.id,
              "รับสินค้า " + x.qty + " · " + displayDate(x.date),
            ]),
          );
        data("RFQs")
          .filter((x) => x.procurementId === entityId)
          .forEach((x) => references.push(["RFQs:" + x.id, x.number]));
      }
      openModal(
        "แนบรูป / เอกสาร",
        `<label>เลือกไฟล์ (ไม่เกิน 5 MB)<input name="file" type="file" accept="${entity === "CompanyFiles" ? ".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.txt,.csv" : "image/png,image/jpeg,image/webp,application/pdf"}" required></label>${references.length ? select("relatedReference", "เชื่อมหลักฐานกับรายการ (ไม่บังคับ)", references, "", false) : ""}`,
        async () => {
          const f = $("[name=file]").files[0];
          if (!f || f.size > 5 * 1024 * 1024)
            throw new Error("เลือกไฟล์ไม่เกิน 5 MB");
          const b64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(f);
          });
          const req = request("attachFile", {
            entity,
            entityId,
            version:
              entity === "CompanyFiles"
                ? row("CompanyFiles", entityId).version
                : undefined,
            fileName: f.name,
            fileSize: f.size,
            fileStamp: f.lastModified,
            relatedTable:
              (formValues().relatedReference || "").split(":")[0] || "",
            relatedId:
              (formValues().relatedReference || "").split(":")[1] || "",
          });
          await rpc("uploadAttachment", token, req, {
            name: f.name,
            mimeType:
              (f.name.toLowerCase().endsWith(".csv") &&
              f.type === "application/vnd.ms-excel"
                ? "text/csv"
                : f.type) ||
              {
                docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                txt: "text/plain",
                csv: "text/csv",
              }[f.name.split(".").pop().toLowerCase()] ||
              "application/octet-stream",
            base64: b64,
          });
          lastRequest = null;
          $("#modal").close();
          await refresh();
          toast("แนบไฟล์แล้ว");
        },
      );
      return;
    }
    case "download": {
      const f = await rpc("downloadAttachment", token, id);
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
        url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType })),
        a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      return;
    }
    case "print-quote":
    case "print-invoice":
    case "print-receipt":
    case "print-po":
    case "print-rfq":
      return printDocument(name, id);
  }
}
function printDocument(kind, id) {
  let title,
    number,
    company,
    party,
    items,
    total,
    extra = "",
    note = "";
  if (kind === "print-po") {
    const po = row("PurchaseOrders", id);
    title = "ใบสั่งซื้อ";
    number = po.number;
    company = po.company;
    party = po.vendor;
    items = data("PurchaseOrderItems")
      .filter((i) => i.purchaseOrderId === id)
      .map((i) => ({ ...i, price: i.unitPrice, type: "item" }));
    total = po.total;
    note = po.note;
  } else if (kind === "print-rfq") {
    const pr = row("Procurements", id);
    title = "ใบขอราคา";
    number = pr.number;
    company = data("Company")[0] || {};
    party = { name: "ผู้ขาย / ผู้เสนอราคา" };
    items = data("ProcurementItems")
      .filter((i) => i.procurementId === id)
      .map((i) => ({ ...i, type: "item", price: null, total: null }));
    total = null;
    note = pr.note;
  } else {
    const payment = kind === "print-receipt" ? row("Payments", id) : null,
      q = row("Quotations", payment ? payment.quoteId : id);
    title =
      kind === "print-quote"
        ? "ใบเสนอราคา"
        : kind === "print-invoice"
          ? "ใบส่งสินค้า / ใบแจ้งหนี้"
          : "หลักฐานการรับชำระเงิน";
    number = q.number + (payment ? " / " + payment.id.slice(0, 8) : "");
    company = q.company;
    party = q.customer;
    items = data("QuoteItems")
      .filter((i) => i.quoteId === q.id)
      .sort((a, b) => a.sort - b.sort);
    total = q.total;
    extra = totals(q);
    note = q.note + "\n" + q.terms;
    if (payment) {
      items = [];
      extra = `<p>รับเงิน ${money(payment.amount)} บาท · ภาษีหัก ณ ที่จ่าย ${money(payment.withholding)} บาท<br>วันที่ ${displayDate(payment.date)} · ${esc(payment.reference)}</p>`;
      total = payment.amount;
      note = "เอกสารรับชำระเงิน ไม่ใช่ใบกำกับภาษี";
    }
  }
  $("#print-area").innerHTML =
    `<article class="document"><div class="document-head"><div><h2>${esc(company.name || "กรุณาตั้งค่าบริษัท")}</h2><p class="pre-line">${esc(company.address)}<br>เลขผู้เสียภาษี ${esc(company.taxId)}<br>${esc(company.phone)}</p></div><div><h1>${title}</h1><p>${esc(number)}</p></div></div><h3>${esc(party.name)}</h3><p class="pre-line">${esc(party.address || "")}</p>${
      items.length
        ? table(
            ["รายการ", "จำนวน", "ราคา/หน่วย", "จำนวนเงิน"],
            items.map((i) =>
              i.type === "pagebreak"
                ? '<tr class="print-break"><td colspan="4"></td></tr>'
                : i.type !== "item"
                  ? `<tr><td colspan="4">${esc(i.name || i.description)}</td></tr>`
                  : `<tr><td>${esc(i.name)}<small>${esc(i.description || "")}</small></td><td>${i.qty} ${esc(i.unit)}</td><td>${i.price == null ? "" : money(i.price)}</td><td>${i.total == null ? "" : money(i.total)}</td></tr>`,
            ),
          )
        : ""
    }${extra || (total == null ? "" : `<h3 class="right">รวม ${money(total)} บาท</h3>`)}<p class="pre-line">${esc(note)}</p><div class="document-sign"><p>ผู้จัดทำ / ผู้ส่งมอบ</p><p>ผู้รับเอกสาร / ผู้รับมอบ</p></div></article>`;
  window.print();
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  try {
    await action(el.dataset.action, el.dataset.id || "", el);
  } catch (err) {
    toast(errorMessage(err), true);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.name === "catalogPicker" && e.target.value) {
    const c = row("Catalog", e.target.value);
    $("#lines").insertAdjacentHTML(
      "beforeend",
      lineHtml({ ...c, catalogId: c.id, qty: 1 }),
    );
    e.target.value = "";
  }
  if (e.target.id === "status-filter") {
    filterStatus = e.target.value;
    render();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    filter = e.target.value;
    const position = e.target.selectionStart;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(position, position);
  }
});
$("#editor").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("#save-button").disabled) return;
  $("#save-button").disabled = true;
  $("#form-error").textContent = "";
  try {
    await modalSave();
  } catch (err) {
    $("#form-error").textContent = errorMessage(err);
  } finally {
    $("#save-button").disabled = false;
  }
});
$("#close-modal").onclick = $("#cancel-modal").onclick = () =>
  $("#modal").close();
$("#refresh").onclick = async () => {
  try {
    await refresh();
    toast("โหลดข้อมูลล่าสุดแล้ว");
  } catch (e) {
    toast(errorMessage(e), true);
  }
};
$("#sign-out").onclick = async () => {
  try {
    await rpc("logout", token);
  } finally {
    token = "";
    state = null;
    otpSent = false;
    $("#shell").hidden = true;
    $("#login").hidden = false;
    if ($("#otp-label")) $("#otp-label").hidden = true;
    $("#resend").hidden = true;
    $("#login-submit").textContent = preview ? "เข้าทดลอง" : "ส่งรหัสยืนยัน";
    $("#login-message").textContent = "";
  }
};
$("#resend").onclick = () => {
  otpSent = false;
  $("#otp-label").hidden = true;
  $("#login-submit").textContent = "ส่งรหัสยืนยัน";
  $("#resend").hidden = true;
};
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-submit").disabled = true;
  try {
    const v = Object.fromEntries(new FormData(e.target));
    if (preview) {
      token = (await rpc("previewLogin", v.email)).token;
      await refresh();
    } else if (!otpSent) {
      const r = await rpc("beginLogin", v.email);
      $("#login-message").textContent = r.message;
      otpSent = true;
      $("#otp-label").hidden = false;
      $("#login-submit").textContent = "ยืนยันและเข้าสู่ระบบ";
      $("#resend").hidden = false;
    } else {
      token = (await rpc("verifyLogin", v.email, v.code)).token;
      await refresh();
    }
  } catch (err) {
    $("#login-message").textContent = errorMessage(err);
  } finally {
    $("#login-submit").disabled = false;
  }
});
window.addEventListener("hashchange", () => {
  filter = "";
  filterStatus = "";
  render();
});
(async () => {
  preview =
    !window.google?.script?.run &&
    ["127.0.0.1", "localhost"].includes(location.hostname);
  if (preview) {
    try {
      const r = await rpc("previewUsers");
      $("#login-fields").innerHTML = select(
        "email",
        "บทบาทที่ใช้ทดลอง",
        r.users.map((u) => [
          u.email,
          u.name + " · " + u.roles.map((x) => roles[x]).join(", "),
        ]),
        r.users[0].email,
      );
      $("#login-submit").textContent = "เข้าทดลอง";
      $("#login-message").textContent =
        "โหมดทดลองในเครื่อง · ไม่ส่งอีเมลและไม่เชื่อม Google Sheet";
    } catch (e) {
      $("#login-message").textContent = e.message;
    }
  }
})();
