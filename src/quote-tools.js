/* Legacy-style quotation controls; all financial values are recalculated on the server. */
(() => {
  const originalQuote = quoteForm,
    originalLine = lineHtml,
    originalAction = action;
  const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const isQuote = () =>
    document.querySelector("#modal")?.open &&
    !!document.querySelector("#quote-workbench");
  function quoteLine(i = {}) {
    let html = originalLine(i);
    html = html.replace(
      /<input data-key="description"[^>]*>/,
      `<textarea data-key="description" aria-label="รายละเอียด" placeholder="รายละเอียดหลายบรรทัด">${esc(i.description)}</textarea>`,
    );
    html = html.replace(
      /<input data-key="price"[^>]*>/,
      `<input data-key="price" aria-label="ราคา หรือ Included" value="${esc(i.priceText || i.price || 0)}" placeholder="ราคา หรือ Included">`,
    );
    html = html.replace("<tr data-line>", '<tr data-line draggable="true">');
    html = html.replace(
      '<td class="kind-col">',
      `<td class="kind-col"><input data-key="displayNo" aria-label="เลขลำดับกำหนดเอง" placeholder="ลำดับอัตโนมัติ" value="${esc(i.displayNo)}">`,
    );
    html = html.replace(
      '<td class="delete-col">',
      `<td class="delete-col"><output class="quote-line-total"></output><label>สูง (px)<input data-key="rowHeight" aria-label="ความสูงแถว" type="number" min="0" max="600" value="${Number(i.rowHeight) || 0}"></label><button type="button" data-action="qt-up" aria-label="เลื่อนขึ้น">↑</button><button type="button" data-action="qt-down" aria-label="เลื่อนลง">↓</button><button type="button" data-action="qt-copy">ทำซ้ำ</button>`,
    );
    return html;
  }
  lineHtml = function (i) {
    return isQuote() ? quoteLine(i) : originalLine(i);
  };
  function quoteItems() {
    return collectLines().map((i) => {
      const text = String(i.price).trim().replace(/,/g, "");
      return {
        ...i,
        price:
          text !== "" && Number.isFinite(Number(text))
            ? round(Number(text))
            : 0,
        priceText:
          text !== "" && !Number.isFinite(Number(text))
            ? String(i.price).trim()
            : "",
      };
    });
  }
  function presentation() {
    const f = formValues(),
      old = {};
    for (const k of [
      "tag",
      "source",
      "saleName",
      "salePhone",
      "saleEmail",
      "customerFax",
      "customerPO",
      "validity",
      "expires",
      "paymentMethod",
      "pricePeriod",
      "color",
    ])
      old[k] = f["qt_" + k] || "";
    old.fonts = {};
    for (const k of ["info", "items", "totals", "notes"])
      old.fonts[k] = Number(f["qt_font_" + k]);
    old.columns = {};
    for (const k of ["pn", "qty", "unit", "price", "disc", "total"])
      old.columns[k] = document.querySelector(
        '[name="qt_col_' + k + '"]',
      ).checked;
    old.pad = Number(f.qt_pad);
    old.lineHeight = Number(f.qt_lineHeight);
    old.colLines = document.querySelector("[name=qt_colLines]").checked;
    old.discountMode = f.qt_discountMode;
    old.discountAmount = Number(f.qt_discountAmount);
    return old;
  }
  function amounts(items) {
    const f = formValues();
    let subtotal = 0;
    for (const i of items)
      if (i.type === "item")
        subtotal += round(
          Number(i.qty) * i.price * (1 - Number(i.discountPct) / 100),
        );
    subtotal = round(subtotal);
    const discount = round(
      f.qt_discountMode === "amount"
        ? Math.min(subtotal, Math.max(0, Number(f.qt_discountAmount) || 0))
        : (subtotal * Number(f.discountPct)) / 100,
    );
    const vat = round(((subtotal - discount) * Number(f.vatPct)) / 100);
    return {
      subtotal,
      discount,
      discountPct: subtotal ? (discount / subtotal) * 100 : 0,
      vatPct: Number(f.vatPct),
      vat,
      total: round(subtotal - discount + vat),
    };
  }
  function recalc() {
    if (!isQuote()) return;
    const items = quoteItems(),
      a = amounts(items);
    document.querySelector("[name=discountPct]").readOnly =
      formValues().qt_discountMode === "amount";
    document.querySelector("[name=qt_discountAmount]").readOnly =
      formValues().qt_discountMode !== "amount";
    document.querySelectorAll("#lines [data-line]").forEach((tr, n) => {
      const i = items[n],
        sum = round(
          Number(i.qty) * i.price * (1 - Number(i.discountPct) / 100),
        );
      tr.querySelector(".quote-line-total").textContent =
        i.type === "item" ? money(sum) : "—";
      tr.classList.toggle(
        "below-cost",
        i.type === "item" &&
          i.price * (1 - Number(i.discountPct) / 100) < Number(i.cost),
      );
      tr.classList.toggle("special-line", i.type !== "item");
      for (const input of tr.querySelectorAll(
        "[data-key=qty],[data-key=price],[data-key=cost],[data-key=discountPct]",
      ))
        input.disabled = i.type !== "item";
    });
    document.querySelector("#quote-live-totals").innerHTML =
      `<span>รวมสินค้า ${money(a.subtotal)}</span><span>ส่วนลด ${money(a.discount)}</span><span>VAT ${money(a.vat)}</span><strong>รวมสุทธิ ${money(a.total)}</strong>`;
  }
  async function draftPreview(q) {
    if (!document.querySelector("#editor").reportValidity()) return;
    const v = formValues(),
      items = quoteItems(),
      p = presentation(),
      c = data("Company")[0] || {},
      party = row("Customers", v.customerId) || {},
      a = amounts(items);
    const assets = {};
    for (const key of ["logo", "signature", "stamp"])
      if (c[key + "AttachmentId"]) {
        const f = await rpc(
          "downloadAttachment",
          token,
          c[key + "AttachmentId"],
        );
        if (/^image\/(png|jpeg|gif|webp)$/.test(f.mimeType))
          assets[key] = "data:" + f.mimeType + ";base64," + f.base64;
      }
    const html = DocumentForms.render(
      {
        kind: "quotation",
        number: q.number || "ร่าง",
        date: v.date,
        snapshot: {
          company: c,
          party,
          quote: {
            ...q,
            ...v,
            ...a,
            number: q.number || "DRAFT — ยังไม่ออกเลข",
            presentation: p,
          },
          items,
          copies: [{ label: "ตัวอย่างก่อนบันทึก", color: "#1a3a5c" }],
        },
      },
      assets,
    );
    showDocumentPreview(html, "ตัวอย่างใบเสนอราคา");
  }
  quoteForm = function (id) {
    originalQuote(id);
    if (!document.querySelector("#lines")) return;
    const q = row("Quotations", id) || {},
      p = q.presentation || {};
    document
      .querySelector("#modal-body")
      .insertAdjacentHTML(
        "afterbegin",
        '<div id="quote-workbench" class="callout">จัดรูปแบบตามใบเสนอราคาเดิม · ลากแถวหรือใช้ ↑ ↓ เพื่อเรียงรายการ · ราคาข้อความ เช่น Included มีมูลค่า 0</div>',
      );
    const items = data("QuoteItems").filter((i) => i.quoteId === id);
    document.querySelector("#lines").innerHTML = (
      items.length ? items : [{}, {}]
    )
      .map(quoteLine)
      .join("");
    document.querySelector(
      ".line-editor thead tr",
    ).lastElementChild.textContent = "ยอด / จัดแถว";
    document
      .querySelector("#lines")
      .closest(".table-wrap")
      .insertAdjacentHTML(
        "beforebegin",
        `<div class="toolbar quote-tools">${[
          ["item", "+ สินค้า"],
          ["group", "+ หัวข้อ"],
          ["note", "+ หมายเหตุ"],
          ["blank", "+ เว้นบรรทัด"],
          ["pagebreak", "+ ขึ้นหน้าใหม่"],
        ]
          .map(
            ([k, l]) =>
              `<button type="button" data-action="qt-add" data-id="${k}">${l}</button>`,
          )
          .join(
            "",
          )}<button type="button" id="qt-preview">ดูตัวอย่างเอกสาร</button></div>`,
      );
    document.querySelector("#modal-body").insertAdjacentHTML(
      "beforeend",
      `<div id="quote-live-totals" aria-live="polite"></div><p class="muted">แถวสีแดง: ราคาหลังส่วนลดรายการต่ำกว่าต้นทุน</p><details open><summary>ข้อมูลเพิ่มเติมบนใบเสนอราคา</summary><div class="form-grid">${[
        ["saleName", "ชื่อผู้เสนอราคา"],
        ["salePhone", "โทรศัพท์ผู้เสนอราคา"],
        ["saleEmail", "อีเมลผู้เสนอราคา"],
        ["customerFax", "Fax ลูกค้า"],
        ["customerPO", "PO ลูกค้า"],
        ["tag", "Tag"],
        ["source", "แหล่งที่มา"],
        ["paymentMethod", "วิธีชำระเงิน"],
      ]
        .map(([k, l]) =>
          field("qt_" + k, l, p[k] || "", k === "saleEmail" ? "email" : "text"),
        )
        .join(
          "",
        )}${field("qt_validity", "ยืนราคา (วัน)", p.validity || 30, "number", 'min="0" max="3650"')}${field("qt_expires", "วันหมดอายุ", p.expires || "", "date")}</div></details><details><summary>รูปแบบเอกสาร / คอลัมน์ / ฟอนต์</summary><div class="form-grid">${select(
        "qt_discountMode",
        "ส่วนลดท้ายเอกสาร",
        [
          ["pct", "เปอร์เซ็นต์"],
          ["amount", "จำนวนเงิน"],
        ],
        p.discountMode || "pct",
      )}${field("qt_discountAmount", "ส่วนลดจำนวนเงิน", p.discountAmount || 0, "number", 'min="0" step="0.01"')}${["info", "items", "totals", "notes"].map((k, n) => field("qt_font_" + k, ["ฟอนต์หัวเอกสาร", "ฟอนต์รายการ", "ฟอนต์ยอดรวม", "ฟอนต์เงื่อนไข"][n], p.fonts?.[k] || 12, "number", 'min="8" max="20"')).join("")}${field("qt_pad", "ระยะห่างในแถว", p.pad ?? 4, "number", 'min="0" max="16"')}${field("qt_lineHeight", "ระยะบรรทัด", p.lineHeight ?? 1.35, "number", 'min="1" max="2.5" step="0.05"')}${field("qt_color", "สีหลัก", p.color || "#1a3a5c", "color")}${select(
        "qt_pricePeriod",
        "ราคาต่อรอบ",
        [
          ["", "ทั่วไป"],
          ["month", "ต่อเดือน"],
          ["year", "ต่อปี"],
        ],
        p.pricePeriod || "",
        false,
      )}</div><div class="toolbar">${[
        ["pn", "Part No."],
        ["qty", "จำนวน"],
        ["unit", "หน่วย"],
        ["price", "ราคา"],
        ["disc", "ส่วนลด"],
        ["total", "ยอดรวม"],
      ]
        .map(
          ([k, l]) =>
            `<label class="check"><input type="checkbox" name="qt_col_${k}" ${p.columns?.[k] !== false ? "checked" : ""}>${l}</label>`,
        )
        .join(
          "",
        )}<label class="check"><input type="checkbox" name="qt_colLines" ${p.colLines ? "checked" : ""}>เส้นแนวตั้ง</label></div></details>`,
    );
    document.querySelector("#qt-preview").onclick = () =>
      draftPreview(q).catch((e) => toast(errorMessage(e), true));
    const catalog = document.querySelector("[name=catalogPicker]");
    catalog.insertAdjacentHTML(
      "beforebegin",
      '<input id="qt-catalog-search" aria-label="ค้นหาสินค้า" placeholder="ค้นหาชื่อ / Part No.">',
    );
    document.querySelector("#qt-catalog-search").oninput = (e) => {
      const term = e.target.value.toLowerCase();
      catalog.innerHTML =
        '<option value="">เลือก…</option>' +
        data("Catalog")
          .filter(
            (c) =>
              c.active &&
              (c.name + " " + c.partNo).toLowerCase().includes(term),
          )
          .map(
            (c) =>
              `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.partNo)}</option>`,
          )
          .join("");
    };
    function expiry() {
      const date = document.querySelector("[name=date]").value,
        days = Number(document.querySelector("[name=qt_validity]").value);
      if (date && Number.isFinite(days)) {
        const d = new Date(date + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + days);
        document.querySelector("[name=qt_expires]").value = d
          .toISOString()
          .slice(0, 10);
      }
    }
    document.querySelector("[name=qt_validity]").onchange = expiry;
    document.querySelector("[name=date]").onchange = expiry;
    if (!p.expires) expiry();
    modalSave = async () => {
      const v = formValues(),
        p = presentation();
      for (const k of Object.keys(v))
        if (k.startsWith("qt_") || k === "catalogPicker") delete v[k];
      const out = await run("saveQuote", {
        ...v,
        id: id || "",
        version: q.version,
        presentation: p,
        discountMode: p.discountMode,
        discountAmount: p.discountAmount,
        items: quoteItems(),
      });
      if (out) location.hash = "sales/" + out.id;
    };
    recalc();
  };
  action = async function (name, id, el) {
    if (!isQuote() || !name.startsWith("qt-")) {
      const out = await originalAction(name, id, el);
      if (isQuote()) recalc();
      return out;
    }
    const tr = el.closest("[data-line]");
    if (name === "qt-add")
      document
        .querySelector("#lines")
        .insertAdjacentHTML("beforeend", quoteLine({ type: id }));
    if (name === "qt-up" && tr.previousElementSibling)
      tr.previousElementSibling.before(tr);
    if (name === "qt-down" && tr.nextElementSibling)
      tr.nextElementSibling.after(tr);
    if (name === "qt-copy") {
      const i = Object.fromEntries(
        Array.from(tr.querySelectorAll("[data-key]")).map((e) => [
          e.dataset.key,
          e.value,
        ]),
      );
      tr.insertAdjacentHTML("afterend", quoteLine(i));
    }
    recalc();
  };
  document.addEventListener("input", (e) => {
    if (e.target.closest("#editor")) recalc();
  });
  document.addEventListener("change", (e) => {
    if (e.target.closest("#editor")) recalc();
  });
  let dragged;
  document.addEventListener("dragstart", (e) => {
    if (isQuote() && e.target.matches("[data-line]")) {
      dragged = e.target;
      e.dataTransfer.effectAllowed = "move";
    }
  });
  document.addEventListener("dragover", (e) => {
    if (dragged && e.target.closest("#lines [data-line]")) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    const target = e.target.closest("#lines [data-line]");
    if (dragged && target && target !== dragged) {
      e.preventDefault();
      target.before(dragged);
      recalc();
    }
    dragged = null;
  });
  document.addEventListener("dragend", () => {
    dragged = null;
  });
})();

function showDocumentPreview(html, title = "ตัวอย่างเอกสาร") {
  let dialog = document.querySelector("#quote-preview");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "quote-preview";
    document.body.append(dialog);
  }
  dialog.innerHTML =
    '<div class="preview-toolbar"><b>' +
    esc(title) +
    '</b><button type="button" id="preview-print">พิมพ์ / บันทึก PDF</button><button type="button" id="preview-close">กลับไปแก้ไข</button></div><div class="preview-paper">' +
    html +
    "</div>";
  dialog.querySelector("#preview-close").onclick = () => dialog.close();
  dialog.querySelector("#preview-print").onclick = async () => {
    document.querySelector("#print-area").innerHTML = html;
    await Promise.all(
      Array.from(document.querySelectorAll("#print-area img")).map((i) =>
        i.decode().catch(() => {}),
      ),
    );
    window.print();
  };
  dialog.showModal();
}
