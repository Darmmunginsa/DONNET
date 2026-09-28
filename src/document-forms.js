/* Quotation layout adapted from the supplied SalePro js/pages/pdf.js.
   Pure renderers: trusted layout, escaped user values, no external data reads. */
var DocumentForms = (() => {
  const fmtP = (n) =>
    Number(n || 0).toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const fmtDate = (v) =>
    v
      ? new Date(v).toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok" })
      : "—";
  function bahtText(amount) {
    const num = [
      "ศูนย์",
      "หนึ่ง",
      "สอง",
      "สาม",
      "สี่",
      "ห้า",
      "หก",
      "เจ็ด",
      "แปด",
      "เก้า",
    ];
    const unit = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];
    function readInt(s) {
      s = String(s).replace(/^0+/, "");
      if (s === "") return "";
      const len = s.length;
      if (len > 6) {
        return (
          readInt(s.slice(0, len - 6)) + "ล้าน" + readInt(s.slice(len - 6))
        );
      }
      let res = "";
      for (let i = 0; i < len; i++) {
        const d = +s[i],
          pos = len - i - 1;
        if (d === 0) continue;
        if (pos === 0 && d === 1 && len > 1) res += "เอ็ด";
        else if (pos === 1 && d === 2) res += "ยี่";
        else if (pos === 1 && d === 1) res += "";
        else res += num[d];
        res += unit[pos];
      }
      return res;
    }
    let n = Math.abs(Number(amount) || 0);
    const cents = Math.round(n * 100);
    const baht = Math.floor(cents / 100);
    const satang = cents % 100;
    if (baht === 0 && satang === 0) return "ศูนย์บาทถ้วน";
    let t = "";
    if (baht > 0) t += readInt(String(baht)) + "บาท";
    t +=
      satang > 0 ? readInt(String(satang)) + "สตางค์" : baht > 0 ? "ถ้วน" : "";
    return (Number(amount) < 0 ? "ลบ" : "") + t;
  }
  const escHtml = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function quotation(doc, assets = {}) {
    const q = doc.snapshot.quote,
      c = doc.snapshot.company || {},
      p = q.presentation || {},
      party = doc.snapshot.party || {};
    const safe = (o) =>
      Object.fromEntries(
        Object.entries(o).map(([k, v]) => [
          k,
          typeof v === "string" ? escHtml(v) : v,
        ]),
      );
    const companySettings = safe({
      CompanyName: c.name,
      Address: c.address,
      Phone: c.phone,
      Email: c.email,
      TaxID: c.taxId,
    });
    Object.assign(companySettings, {
      PrimaryColor: p.color || "#1a3a5c",
      LogoBase64: assets.logo || "",
      SignatureBase64: assets.signature || "",
    });
    const zoneFont = p.fonts || { info: 12, items: 12, totals: 12, notes: 12 };
    const d = {
      q: safe({
        Title: q.number,
        QuoteDate: q.date,
        ContractEndDate: p.expires,
        SaleName: p.saleName || q.ownerEmail,
        SaleTel: p.salePhone,
        SaleEmail: p.saleEmail || q.ownerEmail,
        ClientName: party.name,
        ContactPerson: party.contact,
        CustomerTel: party.phone,
        CustomerAddress: party.address,
        Email: party.email,
        Terms: q.terms,
        Note: q.note,
        VatPct: q.vatPct,
      }),
      sub: q.subtotal,
      discAmt: q.discount,
      after: q.subtotal - q.discount,
      vat: q.vat,
      grand: q.total,
      zoneFonts: zoneFont,
      cols: p.columns,
      rowSpacing: { pad: p.pad ?? 4, lineH: p.lineHeight ?? 1.35 },
      colLines: p.colLines,
      pricePeriod: p.pricePeriod,
      customerFax: p.customerFax,
      approverName: escHtml(q.approverEmail || ""),
      items: (doc.snapshot.items || []).map((i) => ({
        __group: i.type === "group",
        __blank: i.type === "blank",
        __note: i.type === "note",
        __pagebreak: i.type === "pagebreak",
        groupTitle: i.name,
        noteText: i.description || i.name,
        rowH: i.rowHeight,
        No: i.displayNo,
        Title: i.name,
        PartNumber: i.partNo,
        Description: i.description,
        Quantity: i.qty,
        Unit: escHtml(i.unit),
        UnitPrice: i.price,
        PriceRaw: i.priceText || i.price,
        DiscountPct: i.discountPct,
      })),
    };
    d.q.Terms = q.terms;
    d.q.Note = q.note;
    function _renderTermsHtml(text, lh) {
      const lines = String(text || "").split(/\r?\n/);
      const rows = lines
        .map((ln) => {
          const m = ln.match(/^\s*([^:]{1,40}?)\s*:\s*(.*)$/);
          if (m)
            return `<tr><td style="padding:1px 14px 1px 0;font-weight:600;color:#333;white-space:nowrap;vertical-align:top;line-height:${lh}">${escHtml(m[1])}</td><td style="padding:1px 10px 1px 0;color:#333;vertical-align:top;line-height:${lh}">:</td><td style="padding:1px 0;color:#444;vertical-align:top;line-height:${lh};width:100%">${escHtml(m[2])}</td></tr>`;
          if (!ln.trim())
            return `<tr><td colspan="3" style="height:5px;line-height:5px">&nbsp;</td></tr>`;
          return `<tr><td colspan="3" style="padding:1px 0;color:#444;line-height:${lh}">${escHtml(ln)}</td></tr>`;
        })
        .join("");
      return `<table style="border-collapse:collapse;width:auto">${rows}</table>`;
    }

    function renderPDFHTML(d) {
      const s = companySettings || {};
      const primaryColor = s.PrimaryColor || "#1a3a5c";
      const q = d.q;
      // font scale — 4 zones (per-quote; falls back to current editor state)
      const zf = d.zoneFonts || zoneFont;
      const mkScale = (b) => ({
        s: Math.max(7, b - 2) + "px",
        m: b + "px",
        l: b + 2 + "px",
        xl: b + 4 + "px",
      });
      const Zi = mkScale(zf.info); // header (right side) + customer info
      const Zt = mkScale(zf.items); // items table
      const Zo = mkScale(zf.totals); // totals
      const Zn = mkScale(zf.notes); // notes/terms + signatures
      // company identity block — controlled from Company Settings (ไม่ผูกกับ Zone)
      const hb = +s.HeaderFontSize || 10;
      const hbName = hb + 6 + "px"; // ชื่อบริษัท
      const hbLine = hb + "px"; // ที่อยู่ / เลขภาษีเรา
      // ── HEADER (ซ้ำทุกหน้า) ──
      const headBlock = `
    <div style="display:flex;align-items:stretch;justify-content:space-between;margin-bottom:6px;padding-bottom:8px;border-bottom:2px solid ${primaryColor}">
      <div style="flex:1;max-width:50%;word-break:break-word">
        ${s.LogoBase64 || s.LogoURL ? `<img src="${s.LogoBase64 || s.LogoURL}" style="max-height:81px;max-width:225px;object-fit:contain;margin-bottom:5px;display:block">` : ""}
        <div style="font-size:${hbName};font-weight:700;color:${primaryColor}">${s.CompanyName || "บริษัท"}</div>
        <div style="font-size:${hbLine};color:#666;line-height:1.5;margin-top:3px">
          ${s.Address ? s.Address + "<br>" : ""}
          ${s.Phone ? "Tel: " + s.Phone : ""}${s.Phone && s.Email ? " &nbsp;|&nbsp; " : ""}${s.Email ? "Email: " + s.Email : ""}<br>
          ${s.TaxID ? "Tax ID: " + s.TaxID : ""}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;text-align:right;width:282px;flex-shrink:0;overflow:hidden">
        <div style="background:${primaryColor};color:#fff;padding:5px 12px;border-radius:5px;margin-bottom:8px;display:inline-block">
          <div style="font-size:${Zi.s};opacity:0.8">Quotation No.</div>
          <div style="font-size:${Zi.l};font-weight:700;letter-spacing:0.5px">${q.Title || ""}</div>
        </div>
        <table style="font-size:${Zi.m};width:100%;border-collapse:collapse;text-align:left;color:#1a1a2e">
          <tr><td style="color:#666;padding:1.5px 8px 1.5px 0;white-space:nowrap;width:84px;vertical-align:top">Quotation Date:</td><td style="font-weight:600;color:#1a1a2e">${fmtDate(q.QuoteDate)}</td></tr>
          ${q.ContractEndDate ? `<tr><td style="color:#666;padding:1.5px 8px 1.5px 0;white-space:nowrap;vertical-align:top">Expire:</td><td style="font-weight:600;color:#1a1a2e">${fmtDate(q.ContractEndDate)}</td></tr>` : ""}
          <tr><td style="color:#666;padding:1.5px 8px 1.5px 0;white-space:nowrap;vertical-align:top">Sale Name:</td><td style="font-weight:600;color:#1a1a2e">${q.SaleName || ""}</td></tr>
          <tr><td style="color:#666;padding:1.5px 8px 1.5px 0;white-space:nowrap;vertical-align:top">Tel No.:</td><td style="font-weight:600;color:#1a1a2e">${q.SaleTel || ""}</td></tr>
          <tr><td style="color:#666;padding:1.5px 8px 1.5px 0;white-space:nowrap;vertical-align:top">Email:</td><td style="font-weight:600;color:#1a1a2e;word-break:break-all;overflow-wrap:anywhere">${q.SaleEmail || ""}</td></tr>
        </table>
      </div>
    </div>`;

      // ── CUSTOMER INFO (หน้าแรกเท่านั้น) ──
      const custBlock = `
    <div style="background:#f8fafc;border-radius:8px;padding:7px 14px;margin-bottom:6px;display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:${Zi.m}">
      <div>
        <div style="font-size:${Zi.s};color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">Attention</div>
        <div style="font-size:${Zi.l};font-weight:700;color:${primaryColor};margin-bottom:3px">${q.ClientName || ""}</div>
        ${q.ContactPerson ? `<div style="color:#555">Contact: ${q.ContactPerson}</div>` : ""}
        ${q.CustomerTel || q.Phone || d.customerFax ? `<div style="color:#555">${q.CustomerTel || q.Phone ? "Tel: " + (q.CustomerTel || q.Phone || "") : ""}${(q.CustomerTel || q.Phone) && d.customerFax ? " &nbsp;&nbsp; " : ""}${d.customerFax ? "Fax: " + escHtml(d.customerFax) : ""}</div>` : ""}
      </div>
      <div>
        <div style="font-size:${Zi.s};color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">Address</div>
        <div style="color:#555;line-height:1.5;white-space:pre-line">${q.CustomerAddress || ""}</div>
        ${q.Email ? `<div style="color:#555;margin-top:3px">Email: ${q.Email}</div>` : ""}
      </div>
    </div>`;

      // ── ITEMS TABLE helpers ──
      const c = d.cols || {
        pn: true,
        qty: true,
        unit: true,
        price: true,
        disc: true,
        total: true,
      };
      const colspan =
        2 +
        ["pn", "qty", "unit", "price", "disc", "total"].filter((k) => c[k])
          .length;
      // ราคา/ยอด รองรับข้อความ (Included): ใช้ PriceRaw ถ้าเป็นข้อความ
      const _isNum = (v) =>
        v !== "" &&
        v !== null &&
        v !== undefined &&
        !isNaN(parseFloat(v)) &&
        isFinite(v);
      const cellPrice = (it) => {
        const r =
          it.PriceRaw !== undefined
            ? it.PriceRaw
            : it.UnitPrice !== undefined
              ? it.UnitPrice
              : it.price;
        return _isNum(r) ? fmtP(parseFloat(r)) : escHtml(String(r || ""));
      };
      const cellTotal = (it) => {
        const r =
          it.PriceRaw !== undefined
            ? it.PriceRaw
            : it.UnitPrice !== undefined
              ? it.UnitPrice
              : it.price;
        if (!_isNum(r)) return escHtml(String(r || ""));
        return fmtP(
          (it.Quantity || it.qty || 1) *
            parseFloat(r) *
            (1 - (it.DiscountPct || it.disc || 0) / 100),
        );
      };
      const sp = d.rowSpacing || { pad: 4, lineH: 1.35 };
      const rpT = +sp.pad || 0;
      const rpB = rpT;
      const lh = +sp.lineH || 1.35;
      const vline = d.colLines ? "border-right:0.5px solid #e5e7eb;" : ""; // #7 เส้นแบ่งคอลัมน์แนวตั้ง
      const cellPad = `padding:${rpT}px 10px ${rpB}px;`;
      const cellBase = `padding:${rpT}px 7px ${rpB}px;border-bottom:0.5px solid #e5e7eb;${vline}vertical-align:top;line-height:${lh};word-wrap:break-word;`;
      const thPad = `padding:8px 7px;${vline}`;
      const th2 = (th, en) =>
        th +
        '<br><span style="font-weight:400;font-size:0.82em;opacity:0.9">' +
        en +
        "</span>";
      const tableHead = `<thead><tr style="background:${primaryColor};color:#fff">
        <th style="${thPad}text-align:center;width:52px">${th2("ลำดับ", "Item")}</th>
        ${c.pn ? '<th style="' + thPad + 'text-align:center;width:112px">' + th2("รหัสสินค้า", "Part No.") + "</th>" : ""}
        <th style="${thPad}text-align:center">${th2("รายการ", "Description")}</th>
        ${c.qty ? '<th style="' + thPad + 'text-align:center;width:60px;white-space:nowrap">' + th2("จำนวน", "Qty") + "</th>" : ""}
        ${c.unit ? '<th style="' + thPad + 'text-align:center;width:54px">' + th2("หน่วย", "Unit") + "</th>" : ""}
        ${c.price ? '<th style="' + thPad + 'text-align:center;width:112px;white-space:nowrap">' + th2(d.pricePeriod === "month" ? "ราคา/เดือน" : d.pricePeriod === "year" ? "ราคา/ปี" : "ราคาต่อหน่วย", d.pricePeriod === "month" ? "Price/Month" : d.pricePeriod === "year" ? "Price/Year" : "Unit Price") + "</th>" : ""}
        ${c.disc ? '<th style="' + thPad + 'text-align:center;width:56px">' + th2("ส่วนลด", "Discount") + "</th>" : ""}
        ${c.total ? '<th style="' + thPad + 'text-align:center;width:100px">' + th2("จำนวนเงิน", "Amount") + "</th>" : ""}
      </tr></thead>`;
      // render rows for one page; numbering continues via counter object
      const renderRows = (arr, ctr) =>
        arr
          .map((it) => {
            const rh = it.rowH ? `height:${it.rowH}px;` : "";
            if (it.__group) {
              // หัวข้อกลุ่ม: ชื่ออยู่กึ่งกลางในคอลัมน์ Description เท่านั้น เซลล์คอลัมน์อื่นยังอยู่ครบ (เส้นตารางต่อเนื่อง)
              const gBg = `background:${primaryColor}0d;`;
              const gEmpty = `<td style="${cellBase}${gBg}">&nbsp;</td>`;
              const cells = [];
              cells.push(gEmpty); // Item
              if (c.pn) cells.push(gEmpty); // Part No.
              cells.push(
                `<td style="${cellBase}${gBg}text-align:left;font-weight:700;color:${primaryColor};font-size:${Zt.l};letter-spacing:0.04em">${escHtml(it.groupTitle || "")}</td>`,
              ); // Description
              if (c.qty) cells.push(gEmpty);
              if (c.unit) cells.push(gEmpty);
              if (c.price) cells.push(gEmpty);
              if (c.disc) cells.push(gEmpty);
              if (c.total) cells.push(gEmpty);
              return `<tr style="${rh}">${cells.join("")}</tr>`;
            }
            if (it.__blank)
              return `<tr style="${rh}"><td colspan="${colspan}" style="${cellPad}border-bottom:0.5px solid #e5e7eb">&nbsp;</td></tr>`;
            if (it.__note)
              return `<tr><td colspan="${colspan}" style="padding:${rpT}px 10px ${rpB}px;border-bottom:0.5px solid #e5e7eb;color:#555;font-style:italic;white-space:pre-line;line-height:${lh}">${escHtml(it.noteText || "")}</td></tr>`;
            ctr.n++;
            return `<tr style="${rh}background:${ctr.n % 2 === 0 ? "#fff" : "#f8fafc"};color:#1a1a2e">
      <td style="${cellBase}text-align:center;color:#666;background:inherit;white-space:nowrap;word-wrap:normal">${escHtml(String(it.No || it.no || ctr.n))}</td>
      ${c.pn ? `<td style="${cellBase}color:#444;font-family:'Tahoma','Segoe UI',sans-serif;font-size:${Zt.m}">${escHtml(it.PartNumber || "")}</td>` : ""}
      <td style="${cellBase}color:#1a1a2e">
        <div style="font-weight:600;color:#1a1a2e;line-height:${lh}">${escHtml(it.Title || it.name || "-")}</div>
        ${it.Description || it.desc ? `<div style="font-size:${Zt.s};color:#666;margin-top:0.2em;white-space:pre-line;line-height:${lh}">${escHtml(it.Description || it.desc || "")}</div>` : ""}
      </td>
      ${c.qty ? `<td style="${cellBase}text-align:center;color:#1a1a2e">${it.Quantity || it.qty || 1}</td>` : ""}
      ${c.unit ? `<td style="${cellBase}text-align:center;color:#1a1a2e">${it.Unit || it.unit || ""}</td>` : ""}
      ${c.price ? `<td style="${cellBase}text-align:right;font-family:'Tahoma','Segoe UI',sans-serif;color:#1a1a2e">${cellPrice(it)}</td>` : ""}
      ${c.disc ? `<td style="${cellBase}text-align:center;color:#1a1a2e">${it.DiscountPct || it.disc || 0 ? (it.DiscountPct || it.disc) + "%" : "–"}</td>` : ""}
      ${c.total ? `<td style="${cellBase}text-align:right;font-family:'Tahoma','Segoe UI',sans-serif;font-weight:500;color:#1a1a2e">${cellTotal(it)}</td>` : ""}
    </tr>`;
          })
          .join("");

      // ── SUMMARY (หน้าสุดท้าย) ──
      const termsText = [
        q.Terms,
        q.Note,
        s.FooterText && s.FooterText !== q.Terms ? s.FooterText : "",
      ]
        .map((x) => (x || "").trim())
        .filter(Boolean)
        .join("\n");
      const summaryBlock = `
    <div class="pdf-summary-row" style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:0;margin-top:14px">
      <div style="flex:1;text-align:center;font-weight:600;color:${primaryColor};font-size:${Zo.m}">
        <div style="border-top:1.5px solid ${primaryColor};border-bottom:1.5px solid ${primaryColor};background:${primaryColor}0d;padding:8px 14px;border-radius:4px">${bahtText(d.grand)}</div>
      </div>
      <table style="width:240px;flex-shrink:0;border-collapse:collapse;color:#1a1a2e;font-size:${Zo.m};table-layout:fixed">
        <tr><td style="padding:4px 16px 4px 0;color:#444">SUB TOTAL</td><td style="text-align:right;font-family:'Tahoma','Segoe UI',sans-serif;padding:4px 0;color:#1a1a2e;white-space:nowrap">${fmtP(d.sub)}</td></tr>
        ${
          d.discAmt > 0
            ? `<tr><td style="padding:4px 16px 4px 0;color:#444">DISCOUNT</td><td style="text-align:right;font-family:'Tahoma','Segoe UI',sans-serif;padding:4px 0;color:#e74c3c;white-space:nowrap">(${fmtP(d.discAmt)})</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#444">TOTAL</td><td style="text-align:right;font-family:'Tahoma','Segoe UI',sans-serif;padding:4px 0;color:#1a1a2e;white-space:nowrap">${fmtP(d.after)}</td></tr>`
            : ""
        }
        <tr><td style="padding:4px 16px 4px 0;color:#444">VAT ${q.VatPct ?? 7}%</td><td style="text-align:right;font-family:'Tahoma','Segoe UI',sans-serif;padding:4px 0;color:#1a1a2e;white-space:nowrap">${fmtP(d.vat)}</td></tr>
        <tr style="border-top:2px solid ${primaryColor}">
          <td style="padding:8px 16px 4px 0;font-size:${Zo.l};font-weight:700;color:${primaryColor}">GRAND TOTAL</td>
          <td style="text-align:right;font-family:'Tahoma','Segoe UI',sans-serif;font-size:${Zo.xl};font-weight:700;color:${primaryColor};padding:8px 0 4px;white-space:nowrap">${fmtP(d.grand)}</td>
        </tr>
      </table>
    </div>
    ${
      termsText
        ? `<div class="pdf-summary-row" style="margin-top:14px">
      <div style="background:${primaryColor};color:#fff;padding:5px 12px;font-weight:600;font-size:${Zn.m}">Term & Conditions</div>
      <div style="padding:8px 12px;font-size:${Zn.s};color:#444;line-height:1.7;border:0.5px solid #e5e7eb;border-top:none">${_renderTermsHtml(termsText, lh)}</div>
    </div>`
        : ""
    }
    <div class="pdf-footer-block" style="margin-top:20px;font-size:${Zn.m}">
    <div style="font-weight:600;color:#1a1a2e;padding-bottom:8px">Confirm to purchase all quoted items.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;text-align:center;font-size:${Zn.m}">
      <div>
        <div style="font-size:${Zn.s};color:#888;margin-bottom:4px">Acceptance By Customer</div>
        <div style="height:48px"></div>
        <div style="border-top:0.5px solid #ccc;padding-top:8px">
          <div style="font-size:${Zn.s};color:#888;margin-top:6px;line-height:1.5">Signature and seal of the company's behalf.</div>
        </div>
      </div>
      <div>
        <div style="font-size:${Zn.s};color:#888;margin-bottom:4px">Quoted By</div>
        ${d.signatureBase64 || s.SignatureBase64 || s.SignatureURL ? `<img src="${d.signatureBase64 || s.SignatureBase64 || s.SignatureURL}" style="max-height:44px;object-fit:contain;display:block;margin:0 auto 4px">` : '<div style="height:44px"></div>'}
        <div style="border-top:0.5px solid #ccc;padding-top:8px">
          <div style="color:#333;font-weight:500">${q.SaleName || "................................................"}</div>
          <div style="font-size:${Zn.s};color:#888;margin-top:4px">ผู้เสนอราคา</div>
          <div style="font-size:${Zn.s};color:#888">${fmtDate(q.QuoteDate)}</div>
        </div>
      </div>
      <div>
        <div style="font-size:${Zn.s};color:#888;margin-bottom:4px">Approved By</div>
        ${
          d.approverSignatureBase64
            ? `<img src="${d.approverSignatureBase64}" style="max-height:44px;object-fit:contain;display:block;margin:0 auto 4px">`
            : '<div style="height:44px"></div>'
        }
        <div style="border-top:0.5px solid #ccc;padding-top:8px">
          <div style="color:#333;font-weight:500">${d.approverName || "................................................"}</div>
          <div style="font-size:${Zn.s};color:#888;margin-top:4px">ผู้อนุมัติ</div>
          <div style="font-size:${Zn.s};color:#888"></div>
          <div style="font-size:${Zn.s};color:#888"></div>
        </div>
      </div>
    </div></div>`;

      // ── แบ่งรายการเป็นหน้าตาม __pagebreak ──
      const pageGroups = [[]];
      (d.items || []).forEach((it) => {
        if (it.__pagebreak) pageGroups.push([]);
        else pageGroups[pageGroups.length - 1].push(it);
      });
      const lastIdx = pageGroups.length - 1;
      const ctr = { n: 0 };
      const pagesHTML = pageGroups
        .map((arr, pi) => {
          const isLast = pi === lastIdx;
          const rows = renderRows(arr, ctr);
          // หน้าสุดท้าย: เติมแถว filler ที่ยืดเต็มพื้นที่ (height:100%) เพื่อดันยอดรวมไปชิดล่างแบบ Invoice
          // ยืดเต็มพื้นที่ "เฉพาะหน้าสุดท้าย" เท่านั้น — หน้าอื่น (ก่อนตัวแบ่งหน้า) คงขนาดบรรทัดเดิม
          const fillerRow = isLast
            ? `<tr class="pdf-filler" style="height:100%"><td colspan="${colspan}" style="border-bottom:0.5px solid #e5e7eb"></td></tr>`
            : "";
          const tableFlex = isLast ? "flex:1;" : "";
          const tbl = (rowsInner) =>
            `<table style="width:100%;border-collapse:collapse;${tableFlex}font-size:${Zt.m};table-layout:fixed">${tableHead}<tbody>${rowsInner}</tbody></table>`;
          const itemsTable = arr.length
            ? tbl(rows + fillerRow)
            : isLast
              ? '<div style="flex:1"></div>'
              : tbl(
                  `<tr><td colspan="${colspan}" style="text-align:center;padding:20px;color:#aaa">ไม่มีรายการ</td></tr>`,
                );
          // เลขหน้า — รูปแบบ page 1/2 (ซ่อนถ้ามีหน้าเดียว)
          const pageLabel =
            lastIdx === 0
              ? ""
              : `<div class="pdf-continued" style="text-align:right;color:#888;font-size:${Zn.s};font-weight:500;border-top:0.5px solid #e5e7eb;margin-top:10px;padding-top:6px">page ${pi + 1}/${lastIdx + 1}</div>`;
          const tail = (isLast ? summaryBlock : "") + pageLabel;
          // wrap ยืด (flex:1) เฉพาะหน้าสุดท้าย; หน้าอื่นเป็น block ปกติ (ไม่ยืด)
          const wrapStyle = isLast
            ? "flex:1;display:flex;flex-direction:column;margin-bottom:12px"
            : "flex:0 0 auto;margin-bottom:12px";
          return `<div class="pdf-page">${headBlock}${pi === 0 ? custBlock : ""}<div class="pdf-items-wrap" style="${wrapStyle}">${itemsTable}</div>${tail}</div>`;
        })
        .join("");

      return `<div class="pdf-preview" id="pdf-printable" style="font-family:'Sarabun','IBM Plex Sans Thai',sans-serif;font-size:${Zi.m};color:#1a1a2e;background:transparent;padding:0">${pagesHTML}</div>`;
    }

    return renderPDFHTML(d);
  }
  function accounting(doc, assets = {}) {
    const s = doc.snapshot,
      c = s.company || {},
      party = s.party || {},
      q = s.quote || s.po || s.rfq || {},
      p = q.presentation || {},
      pay = s.payment;
    const titles = {
      invoice: [
        "ใบส่งสินค้า / ใบแจ้งหนี้ / ใบวางบิล",
        "DELIVERY ORDER / INVOICE",
      ],
      receipt: ["ใบเสร็จรับเงิน", "RECEIPT"],
      taxInvoice: ["ใบเสร็จรับเงิน / ใบกำกับภาษี", "RECEIPT / TAX INVOICE"],
      purchaseOrder: ["ใบสั่งซื้อ", "PURCHASE ORDER"],
      rfq: ["ใบขอราคา", "REQUEST FOR QUOTATION"],
    };
    const title = titles[doc.kind] || ["เอกสาร", "DOCUMENT"],
      rfq = doc.kind === "rfq",
      po = doc.kind === "purchaseOrder";
    let items = s.items || [],
      sub = q.subtotal ?? q.total ?? 0,
      discount = q.discount || 0,
      vat = q.vat || 0,
      total = q.total || 0;
    if (pay) {
      total = Number(pay.amount) + Number(pay.withholding);
      sub = Math.round((total / (1 + Number(q.vatPct || 0) / 100)) * 100) / 100;
      vat = Math.round((total - sub) * 100) / 100;
      discount = 0;
      items = [
        {
          name: "รับชำระตาม " + q.number + " วันที่ " + fmtDate(pay.date),
          qty: 1,
          unit: "งวด",
          price: sub,
          total: sub,
        },
      ];
    }
    const groups = [[]];
    for (const i of items) {
      if (i.type === "pagebreak") groups.push([]);
      else groups[groups.length - 1].push(i);
    }
    const img = (key) =>
      assets[key]
        ? '<img class="form-' +
          key +
          '" src="' +
          escHtml(assets[key]) +
          '" alt="' +
          key +
          '">'
        : "";
    let num = 0;
    return groups
      .map(
        (rows, page) => `<section class="pdf-page legacy-accounting">
 <header class="legacy-head"><div>${img("logo")}<h2>${escHtml(c.name || "บริษัท")}</h2><div class="pre-line">${escHtml(c.address)}</div><div>TEL: ${escHtml(c.phone)} · ${escHtml(c.email)}</div><div>เลขประจำตัวผู้เสียภาษี ${escHtml(c.taxId)} · ${escHtml(c.branch || "สำนักงานใหญ่")}</div></div><div class="legacy-title"><strong>${title[0]}</strong><div>${title[1]}</div><h3>${escHtml(doc.number)}</h3><div>วันที่ / DATE: ${fmtDate(doc.date)}</div></div></header>
 ${doc.kind === "invoice" || doc.kind === "receipt" ? '<p class="non-tax">ไม่ใช่ใบกำกับภาษี</p>' : ""}
 <div class="legacy-parties"><div><b>${po || rfq ? "ผู้ขาย / SUPPLIER" : "ลูกค้า / CUSTOMER"}: ${escHtml(party.name)}</b><p class="pre-line">${escHtml(party.address)}</p><div>ผู้ติดต่อ: ${escHtml(party.contact)} · TEL: ${escHtml(party.phone)}</div><div>TAX ID: ${escHtml(party.taxId)}</div></div><div><div>อ้างอิง / REF: ${escHtml(q.number)}</div><div>PO: ${escHtml(p.customerPO)}</div><div>SALESMAN: ${escHtml(p.saleName || q.ownerEmail)}</div><div>TERMS: ${escHtml(q.paymentTerms || p.paymentMethod)}</div>${q.deliveryDate ? "<div>DELIVERY: " + fmtDate(q.deliveryDate) + "</div>" : ""}</div></div>
 <table class="legacy-items"><thead><tr>${["ลำดับ<br>NO.", "รายการสินค้า / รายละเอียด<br>DESCRIPTION", "จำนวน<br>QTY", "หน่วย<br>UNIT", "ราคาต่อหน่วย<br>UNIT PRICE", "จำนวนเงิน<br>AMOUNT"].map((x) => "<th>" + x + "</th>").join("")}</tr></thead><tbody>${rows.map((i) => (i.type && i.type !== "item" ? `<tr style="height:${Number(i.rowHeight) || 24}px"><td colspan="6" class="${i.type === "group" ? "group" : ""}">${i.type === "blank" ? "&nbsp;" : escHtml(i.name || i.description)}</td></tr>` : `<tr style="height:${Number(i.rowHeight) || 32}px"><td>${escHtml(i.displayNo || ++num)}</td><td><b>${escHtml(i.name)}</b><div>${escHtml(i.partNo)}</div><div class="pre-line">${escHtml(i.description)}</div></td><td>${Number(i.qty)}</td><td>${escHtml(i.unit)}</td><td>${rfq ? "" : i.priceText ? escHtml(i.priceText) : fmtP(i.price ?? i.unitPrice)}</td><td>${rfq ? "" : i.priceText ? escHtml(i.priceText) : fmtP(i.total)}</td></tr>`)).join("")}<tr class="legacy-filler"><td></td><td>E. &amp; O. E.</td><td></td><td></td><td></td><td></td></tr></tbody></table>
 ${page === groups.length - 1 ? `<div class="legacy-bottom"><div><b>หมายเหตุ / REMARK</b><p class="pre-line">${escHtml(q.note)}</p>${rfq ? "" : "<strong>(" + bahtText(total) + ")</strong>"}</div>${rfq ? "" : `<table class="legacy-totals"><tr><th>รวม / SUB TOTAL</th><td>${fmtP(sub)}</td></tr><tr><th>ส่วนลด / DISCOUNT</th><td>${fmtP(discount)}</td></tr><tr><th>ภาษีมูลค่าเพิ่ม / VAT ${Number(q.vatPct || 0)}%</th><td>${fmtP(vat)}</td></tr><tr><th>รวมสุทธิ / GRAND TOTAL</th><td>${fmtP(total)}</td></tr>${pay ? "<tr><th>หัก ณ ที่จ่าย</th><td>" + fmtP(pay.withholding) + "</td></tr><tr><th>รับเงินสุทธิ</th><td>" + fmtP(pay.amount) + "</td></tr>" : ""}</table>`}</div><div class="pre-line legacy-terms">${escHtml(q.terms || q.paymentTerms)}</div><footer class="legacy-sign"><div><div class="signature-space"></div>${po ? "ผู้สั่งซื้อ / ORDERED BY" : rfq ? "ผู้ขอราคา / REQUESTED BY" : "ผู้รับสินค้า / RECEIVED BY"}<p>วันที่ / DATE ...........................</p></div><div>${img("signature")}${img("stamp")}<div class="signature-space"></div>${po ? "ผู้อนุมัติ / AUTHORIZED BY" : pay ? "ผู้รับเงิน / COLLECTOR" : "ผู้ส่งมอบ / DELIVERED BY"}<p>วันที่ / DATE ...........................</p></div></footer>` : ""}<div class="legacy-page">${page + 1} / ${groups.length}</div></section>`,
      )
      .join("");
  }
  function delivery(doc, assets = {}) {
    const s = doc.snapshot,
      c = s.company || {},
      q = s.quote || {},
      party = s.party || {},
      pages = [[]];
    for (const i of s.items || [])
      i.type === "pagebreak" ? pages.push([]) : pages[pages.length - 1].push(i);
    let n = 0;
    return pages
      .map(
        (rows, pi) =>
          `<section class="pdf-page legacy-delivery"><header class="legacy-head"><div>${assets.logo ? '<img class="form-logo" src="' + escHtml(assets.logo) + '">' : ""}<h2>${escHtml(c.name || "บริษัท")}</h2><div class="pre-line">${escHtml(c.address)}</div><div>โทร ${escHtml(c.phone)} · เลขภาษี ${escHtml(c.taxId)}</div></div><div><h2>ใบส่งของชั่วคราว</h2><div>TEMPORARY DELIVERY NOTE</div><p>เลขที่ ${escHtml(doc.number)}</p><p>วันที่ ${fmtDate(doc.date)}</p></div></header><div class="legacy-parties"><div><b>${escHtml(party.name)}</b><p class="pre-line">${escHtml(party.address)}</p><p>ผู้ติดต่อ ${escHtml(party.contact)} · ${escHtml(party.phone)}</p></div><div>อ้างอิงใบเสนอราคา<br>${escHtml(q.number)}</div></div><table class="legacy-items"><thead><tr><th>#</th><th>รายการ / DESCRIPTION</th><th>จำนวน / QTY</th></tr></thead><tbody>${rows.map((i) => (i.type && i.type !== "item" ? '<tr><td colspan="3" style="height:' + (Number(i.rowHeight) || 24) + 'px">' + (i.type === "blank" ? "&nbsp;" : escHtml(i.name || i.description)) + "</td></tr>" : "<tr><td>" + escHtml(i.displayNo || ++n) + "</td><td><b>" + escHtml(i.name) + '</b><div class="pre-line">' + escHtml(i.description) + "</div></td><td>" + Number(i.qty) + " " + escHtml(i.unit) + "</td></tr>")).join("")}</tbody></table>${pi === pages.length - 1 ? '<p class="pre-line legacy-terms">' + escHtml(q.note) + '</p><footer class="legacy-sign"><div><div class="signature-space"></div>_______________________<p>ผู้ส่งของ</p></div><div><div class="signature-space"></div>_______________________<p>ผู้รับของ / วันที่</p></div></footer>' : ""}<div class="legacy-page">${pi + 1} / ${pages.length}</div></section>`,
      )
      .join("");
  }
  function render(doc, assets = {}) {
    const copies = doc.snapshot.copies || [
      { label: "ต้นฉบับ", color: "#1a3a5c" },
    ];
    return copies
      .map(
        (copy) =>
          `<article class="legacy-copy"><div class="legacy-copy-label" style="color:${/^#[0-9a-f]{6}$/i.test(copy.color) ? copy.color : "#1a3a5c"}">${escHtml(copy.label)}</div>${doc.kind === "quotation" ? quotation(doc, assets) : doc.kind === "tempDelivery" ? delivery(doc, assets) : accounting(doc, assets)}</article>`,
      )
      .join("");
  }
  return { quotation, accounting, render, bahtText };
})();
if (typeof module !== "undefined") module.exports = DocumentForms;
