/* Company document library. Server enforces admin editing and admin/finance reading. */
(() => {
  const baseNav = renderNav,
    baseRender = render,
    baseAction = action;
  const defaultCategories = [
    "หนังสือรับรองและจดทะเบียน",
    "ภาษีและบัญชี",
    "ธนาคารและการเงิน",
    "ใบอนุญาตและมาตรฐาน",
    "สัญญาและข้อตกลง",
    "แบบฟอร์มบริษัท",
    "คู่มือและนโยบาย",
    "อื่น ๆ",
  ];
  let selectedCategory = "",
    query = "",
    statusFilter = "active";
  const categories = () => [
    ...new Set([
      ...defaultCategories,
      ...data("CompanyFiles").map((d) => d.category),
    ]),
  ];
  const fileRows = (id) =>
    data("Attachments")
      .filter((a) => a.entity === "CompanyFiles" && a.entityId === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  function expiry(d) {
    if (!d.expiresDate) return "";
    const days = Math.round(
      (new Date(d.expiresDate + "T00:00:00Z") -
        new Date(today() + "T00:00:00Z")) /
        86400000,
    );
    return days < 0 ? "expired" : days <= 30 ? "soon" : "";
  }
  function badges(d) {
    return d.archived
      ? '<span class="badge">แฟ้มเก่า</span>'
      : expiry(d) === "expired"
        ? '<span class="badge red">หมดอายุ</span>'
        : expiry(d) === "soon"
          ? '<span class="badge amber">ใกล้หมดอายุ</span>'
          : !d.currentAttachmentId
            ? '<span class="badge amber">ยังไม่มีไฟล์</span>'
            : '<span class="badge green">ใช้งาน</span>';
  }
  function categoryCards() {
    const active = data("CompanyFiles").filter((d) => !d.archived);
    return `<div class="library-categories">${["", ...categories()].map((c) => `<button type="button" data-action="library-category" data-id="${esc(c)}" class="library-category ${c === selectedCategory ? "selected" : ""}"><span>▱ ${esc(c || "ทุกหมวดหมู่")}</span><strong>${active.filter((d) => !c || d.category === c).length}</strong></button>`).join("")}</div>`;
  }
  function results() {
    let list = data("CompanyFiles").filter(
      (d) =>
        (!selectedCategory || d.category === selectedCategory) &&
        (statusFilter === "archived" ? d.archived : !d.archived) &&
        (statusFilter === "expired"
          ? expiry(d) === "expired"
          : statusFilter === "soon"
            ? expiry(d) === "soon"
            : true),
    );
    const term = query.trim().toLowerCase();
    list = list
      .filter((d) =>
        [
          d.title,
          d.documentNo,
          d.category,
          d.note,
          ...fileRows(d.id).map((a) => a.name),
        ]
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
      .sort((a, b) => a.title.localeCompare(b.title, "th"));
    return list.length
      ? table(
          ["เอกสาร", "หมวดหมู่", "วันหมดอายุ", "สถานะ", ""],
          list.map(
            (d) =>
              `<tr><td><strong>${link(d.title, "company-library/" + d.id)}</strong><small>${esc(d.documentNo || "ไม่ระบุเลขที่")} · ${fileRows(d.id).length} ไฟล์</small></td><td>${esc(d.category)}</td><td>${displayDate(d.expiresDate)}</td><td>${badges(d)}</td><td>${d.currentAttachmentId ? button("ดาวน์โหลดล่าสุด", "download", d.currentAttachmentId) : ""}${button("รายละเอียด", "library-open", d.id)}</td></tr>`,
          ),
        )
      : empty("ไม่พบเอกสาร", "เพิ่มเอกสารหรือเปลี่ยนคำค้นและตัวกรอง");
  }
  function page() {
    return (
      head(
        "COMPANY LIBRARY",
        "คลังเอกสารบริษัท",
        "สำหรับผู้ดูแลและฝ่ายบัญชี · เก็บไฟล์เป็นหมวดหมู่ พร้อมประวัติฉบับเดิม",
        has("admin")
          ? button("+ เพิ่มเอกสาร", "library-edit", "", "primary")
          : "",
      ) +
      categoryCards() +
      `<div class="toolbar library-filters"><label>ค้นหา<input id="library-search" value="${esc(query)}" placeholder="ชื่อเอกสาร เลขที่ หรือชื่อไฟล์"></label><label>สถานะ<select id="library-status">${[
        ["active", "เอกสารใช้งานทั้งหมด"],
        ["soon", "ใกล้หมดอายุใน 30 วัน"],
        ["expired", "หมดอายุแล้ว"],
        ["archived", "แฟ้มเอกสารเก่า"],
      ]
        .map(
          ([k, l]) =>
            `<option value="${k}" ${statusFilter === k ? "selected" : ""}>${l}</option>`,
        )
        .join(
          "",
        )}</select></label></div><div id="library-results">${results()}</div>`
    );
  }
  function detail(id) {
    const d = row("CompanyFiles", id);
    if (!d) return empty("ไม่พบเอกสาร", "เอกสารนี้อาจอยู่นอกสิทธิ์ของบัญชี");
    const files = fileRows(id);
    return (
      head(
        "COMPANY LIBRARY / " + esc(d.category),
        esc(d.title),
        esc(d.documentNo || "ไม่ระบุเลขที่เอกสาร"),
        badges(d),
      ) +
      `<div class="actions">${link("← คลังเอกสาร", "company-library")}${has("admin") ? button("แก้ไขรายละเอียด", "library-edit", id) + (d.archived ? "" : button("+ แนบไฟล์ฉบับใหม่", "upload", "CompanyFiles:" + id, "primary")) + button(d.archived ? "คืนเอกสารมาใช้งาน" : "เก็บเข้าฉบับเก่า", "library-archive", id) : ""}</div>` +
      panel(
        "ข้อมูลเอกสาร",
        `<div class="detail-meta"><span>วันที่ออก<strong>${displayDate(d.issuedDate)}</strong></span><span>วันหมดอายุ<strong>${displayDate(d.expiresDate)}</strong></span><span>ปรับปรุงล่าสุด<strong>${displayDate(d.updatedAt)}</strong></span></div><p class="pre-line">${esc(d.note || "ไม่มีหมายเหตุ")}</p>`,
      ) +
      panel(
        "ไฟล์และประวัติฉบับเดิม",
        files.length
          ? table(
              ["ไฟล์", "ฉบับ", "เพิ่มเมื่อ", "ขนาด", ""],
              files.map(
                (a) =>
                  `<tr><td><strong>${esc(a.name)}</strong></td><td>${a.id === d.currentAttachmentId ? '<span class="badge green">ล่าสุด</span>' : "ฉบับก่อนหน้า"}</td><td>${displayDate(a.createdAt)}</td><td>${(Number(a.size) / 1024).toFixed(1)} KB</td><td>${button("ดาวน์โหลด", "download", a.id)}</td></tr>`,
              ),
            )
          : empty("ยังไม่มีไฟล์แนบ", "กดแนบไฟล์ฉบับใหม่เพื่อเพิ่มเอกสาร"),
      ) +
      '<p class="muted">PDF, PNG, JPG, WebP, DOCX, XLSX, PPTX, TXT และ CSV · ไม่เกิน 5 MB ต่อไฟล์ · การแนบฉบับใหม่เก็บไฟล์เดิมไว้</p>'
    );
  }
  function edit(id) {
    const d = row("CompanyFiles", id) || {};
    openModal(
      id ? "แก้ไขเอกสารบริษัท" : "เพิ่มเอกสารบริษัท",
      `<div class="form-grid">${field("title", "ชื่อเอกสาร", d.title, "text", 'required maxlength="200"')}${field("category", "หมวดหมู่", d.category || defaultCategories[0], "text", 'required maxlength="80" list="library-category-options"')}<datalist id="library-category-options">${categories()
        .map((c) => `<option value="${esc(c)}">`)
        .join(
          "",
        )}</datalist>${field("documentNo", "เลขที่เอกสาร", d.documentNo, "text", 'maxlength="100"')}${field("issuedDate", "วันที่ออกเอกสาร", d.issuedDate, "date")}${field("expiresDate", "วันหมดอายุ (ถ้ามี)", d.expiresDate, "date")}${area("note", "หมายเหตุ / รายละเอียด", d.note)}<p class="muted span-two">พิมพ์ชื่อหมวดหมู่ใหม่ได้ · ผู้ดูแลจัดการเอกสาร ส่วนฝ่ายบัญชีเปิดดูและดาวน์โหลดได้</p></div>`,
      async () => {
        const out = await run("saveCompanyFile", {
          ...formValues(),
          id: id || "",
          version: d.version,
        });
        if (out) {
          location.hash = "company-library/" + out.id;
          if (!id) await action("upload", "CompanyFiles:" + out.id);
        }
      },
      id ? "บันทึก" : "บันทึกและแนบไฟล์",
    );
  }
  renderNav = function () {
    baseNav();
    if (has("admin", "finance"))
      document
        .querySelector("#nav")
        .insertAdjacentHTML(
          "beforeend",
          `<a href="#company-library" class="${location.hash.startsWith("#company-library") ? "active" : ""}"><span class="nav-icon">▱</span>คลังเอกสารบริษัท</a>`,
        );
    const libraryLink = document.querySelector(
      '#nav a[href="#company-library"]',
    );
    const split = document.querySelector("#nav .nav-split");
    if (libraryLink && split) split.before(libraryLink);
  };
  render = function () {
    const [pageName, id] = (location.hash.slice(1) || "dashboard").split("/");
    if (pageName !== "company-library") return baseRender();
    if (!state) return;
    renderNav();
    document.querySelector("#page-label").textContent = "คลังเอกสารบริษัท";
    document.querySelector("#main").innerHTML = has("admin", "finance")
      ? id
        ? detail(id)
        : page()
      : empty("ไม่มีสิทธิ์เข้าถึง", "คลังเอกสารนี้สำหรับผู้ดูแลและฝ่ายบัญชี");
  };
  action = async function (name, id, el) {
    if (!name.startsWith("library-")) return baseAction(name, id, el);
    if (!has("admin", "finance"))
      throw new Error("ไม่มีสิทธิ์เข้าถึงคลังเอกสาร");
    if (name === "library-open") {
      location.hash = "company-library/" + id;
      return;
    }
    if (name === "library-category") {
      selectedCategory = id;
      render();
      return;
    }
    if (!has("admin")) throw new Error("เฉพาะผู้ดูแลจัดการเอกสารได้");
    if (name === "library-edit") return edit(id);
    if (name === "library-archive") {
      const d = row("CompanyFiles", id);
      return simple(
        d.archived ? "คืนเอกสารมาใช้งาน" : "เก็บเข้าฉบับเก่า",
        `<p>${esc(d.title)}</p><p>เก็บไฟล์และประวัติไว้ สามารถนำกลับมาใช้งานได้</p>`,
        "archiveCompanyFile",
        { id, version: d.version, archived: !d.archived },
        "ยืนยัน",
      );
    }
  };
  document.addEventListener("input", (e) => {
    if (e.target.id === "library-search") {
      query = e.target.value;
      document.querySelector("#library-results").innerHTML = results();
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "library-status") {
      statusFilter = e.target.value;
      document.querySelector("#library-results").innerHTML = results();
    }
  });
})();
