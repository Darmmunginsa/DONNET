/** Public RPC surface. All helpers end in underscore and are not RPC-callable. */
function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("D On Net · Workspace")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
function config_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("ผู้ดูแลต้องติดตั้งระบบก่อน");
  return { id: id, folder: p.getProperty("ATTACHMENT_FOLDER_ID") };
}
function locked_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000))
    throw new Error("มีรายการกำลังบันทึก กรุณาลองอีกครั้ง");
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
function hash_(value) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      value,
      Utilities.Charset.UTF_8,
    ),
  );
}
function readDb_() {
  var id = config_().id,
    names = Object.keys(Domain.SCHEMA);
  var response = Sheets.Spreadsheets.Values.batchGet(id, {
    ranges: names.map(function (n) {
      return "'" + n + "'!A:AZ";
    }),
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  var db = Domain.empty();
  names.forEach(function (name, i) {
    var rows = (response.valueRanges[i] || {}).values || [],
      headers = rows.shift() || [];
    if (JSON.stringify(headers) !== JSON.stringify(Domain.SCHEMA[name]))
      throw new Error("โครงสร้างตาราง " + name + " ไม่ตรง กรุณาติดต่อผู้ดูแล");
    db[name] = rows
      .filter(function (r) {
        return r[0];
      })
      .map(function (cells) {
        var obj = {};
        headers.forEach(function (h, j) {
          var value = cells[j] === undefined ? "" : cells[j];
          if (Domain.JSON_FIELDS.indexOf(h) >= 0 && value !== "")
            value = JSON.parse(value);
          obj[h] = value;
        });
        return obj;
      });
  });
  return db;
}
function cell_(value, key) {
  if (value === undefined || value === null) return {};
  if (Domain.JSON_FIELDS.indexOf(key) >= 0) value = JSON.stringify(value);
  // Explicit stringValue prevents formula injection from user-entered content.
  return {
    userEnteredValue:
      typeof value === "number"
        ? { numberValue: value }
        : typeof value === "boolean"
          ? { boolValue: value }
          : { stringValue: String(value) },
  };
}
function commit_(before, after) {
  var id = config_().id,
    meta = Sheets.Spreadsheets.get(id, { fields: "sheets.properties" }),
    ids = {};
  meta.sheets.forEach(function (s) {
    ids[s.properties.title] = s.properties;
  });
  var requests = [];
  Object.keys(Domain.SCHEMA).forEach(function (name) {
    if (JSON.stringify(before[name]) === JSON.stringify(after[name])) return;
    var headers = Domain.SCHEMA[name],
      rows = after[name],
      height = Math.max(before[name].length, rows.length);
    var current = ids[name].gridProperties.rowCount;
    if (height + 1 > current)
      requests.push({
        appendDimension: {
          sheetId: ids[name].sheetId,
          dimension: "ROWS",
          length: height + 1 - current,
        },
      });
    // Replace affected tables together in one atomic Sheets batch. No partially saved handoff.
    requests.push({
      updateCells: {
        range: {
          sheetId: ids[name].sheetId,
          startRowIndex: 1,
          endRowIndex: height + 1,
          startColumnIndex: 0,
          endColumnIndex: headers.length,
        },
        rows: rows.map(function (r) {
          return {
            values: headers.map(function (h) {
              return cell_(r[h], h);
            }),
          };
        }),
        fields: "userEnteredValue",
      },
    });
  });
  if (requests.length)
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, id);
}
function sessionEmail_(token) {
  if (typeof token !== "string" || token.length < 40 || token.length > 200)
    throw new Error("SESSION_EXPIRED");
  var mail = CacheService.getScriptCache().get("session:" + hash_(token));
  if (!mail) throw new Error("SESSION_EXPIRED");
  return mail;
}
function beginLogin(address) {
  return locked_(function () {
    var mail = String(address || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail.length > 254)
      throw new Error("อีเมลไม่ถูกต้อง");
    var cache = CacheService.getScriptCache(),
      key = hash_(mail);
    var generic = {
      message: "หากอีเมลอยู่ในรายชื่อผู้ใช้ ระบบจะส่งรหัสให้ รหัสมีอายุ 5 นาที",
    };
    if (cache.get("cooldown:" + key)) return generic;
    cache.put("cooldown:" + key, "1", 60);
    var db = readDb_();
    if (
      !db.Users.some(function (u) {
        return u.email === mail && u.active === true;
      })
    )
      return generic;
    // Global daily cap preserves email quota and prevents unlimited login mail.
    var props = PropertiesService.getScriptProperties(),
      day = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
    var count = JSON.parse(props.getProperty("LOGIN_MAIL_COUNT") || "{}");
    if (count.day !== day) count = { day: day, n: 0 };
    if (count.n >= 80 || MailApp.getRemainingDailyQuota() < 1)
      throw new Error("โควตาอีเมลวันนี้หมด กรุณาติดต่อผู้ดูแล");
    var code = String(
      parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 12), 16) %
        100000000,
    ).padStart(8, "0");
    cache.put(
      "otp:" + key,
      JSON.stringify({
        hash: hash_(mail + ":" + code),
        attempts: 0,
        expiresAt: Date.now() + 300000,
      }),
      300,
    );
    count.n++;
    props.setProperty("LOGIN_MAIL_COUNT", JSON.stringify(count));
    MailApp.sendEmail({
      to: mail,
      subject: "รหัสเข้าใช้งาน D On Net",
      body:
        "รหัสยืนยัน: " +
        code +
        "\nรหัสมีอายุ 5 นาที ใช้ได้ครั้งเดียว\nหากไม่ได้ขอรหัสนี้ ไม่ต้องดำเนินการใด ๆ",
    });
    return generic;
  });
}
function verifyLogin(address, code) {
  return locked_(function () {
    var mail = String(address || "")
        .trim()
        .toLowerCase(),
      cache = CacheService.getScriptCache(),
      key = "otp:" + hash_(mail),
      raw = cache.get(key);
    if (!raw) throw new Error("รหัสไม่ถูกต้องหรือหมดอายุ");
    var entry = JSON.parse(raw);
    if (!entry.expiresAt || Date.now() >= entry.expiresAt) {
      cache.remove(key);
      throw new Error("รหัสไม่ถูกต้องหรือหมดอายุ");
    }
    if (entry.hash !== hash_(mail + ":" + String(code || "").trim())) {
      entry.attempts++;
      if (entry.attempts >= 5) cache.remove(key);
      else
        cache.put(
          key,
          JSON.stringify(entry),
          Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000)),
        );
      throw new Error("รหัสไม่ถูกต้องหรือหมดอายุ");
    }
    Domain.user(readDb_(), mail);
    cache.remove(key);
    var token = Utilities.getUuid() + Utilities.getUuid();
    cache.put("session:" + hash_(token), mail, 3600);
    return { token: token };
  });
}
function logout(token) {
  if (typeof token === "string")
    CacheService.getScriptCache().remove("session:" + hash_(token));
  return { ok: true };
}
function loadWorkspace(token) {
  return locked_(function () {
    var mail = sessionEmail_(token),
      db = readDb_();
    return Domain.snapshot(db, Domain.user(db, mail));
  });
}
function executeCommand(token, request) {
  return locked_(function () {
    var mail = sessionEmail_(token),
      db = readDb_(),
      u = Domain.user(db, mail);
    var out = Domain.execute(db, u, request, {
      now: new Date().toISOString(),
      uuid: function () {
        return Utilities.getUuid();
      },
    });
    if (!out.replayed) commit_(db, out.db);
    return out.result;
  });
}
function uploadAttachment(token, request, file) {
  return locked_(function () {
    var mail = sessionEmail_(token),
      db = readDb_(),
      u = Domain.user(db, mail);
    if (!request || request.action !== "attachFile" || !request.payload)
      throw new Error("คำขอไม่ถูกต้อง");
    Domain.visibleEntity(
      db,
      u,
      request.payload.entity,
      request.payload.entityId,
      true,
    );
    if (
      !file ||
      typeof file.base64 !== "string" ||
      file.base64.length > 7000000
    )
      throw new Error("ไฟล์ใหญ่เกิน 5 MB");
    if (!Domain.allowedAttachmentType(request.payload.entity, file.mimeType))
      throw new Error(
        "ชนิดไฟล์ไม่รองรับ (คลังบริษัทรับ PDF รูปภาพ DOCX XLSX PPTX TXT CSV)",
      );
    var bytes = Utilities.base64Decode(file.base64);
    if (!bytes.length || bytes.length > 5 * 1024 * 1024)
      throw new Error("ไฟล์ว่างหรือใหญ่เกิน 5 MB");
    request.payload.fileHash = hash_(file.base64);
    request.payload.fileName = String(file.name || "attachment").slice(0, 200);
    request.payload.mimeType = file.mimeType;
    var context = {
      now: new Date().toISOString(),
      uuid: function () {
        return Utilities.getUuid();
      },
      file: {
        id: "pending",
        name: request.payload.fileName,
        mimeType: file.mimeType,
        url: "",
        size: bytes.length,
      },
    };
    // Validate before creating any Drive file, including idempotency replay.
    var preliminary = Domain.execute(db, u, request, context);
    if (preliminary.replayed) return preliminary.result;
    var folder = config_().folder;
    if (!folder) throw new Error("ยังไม่ได้ตั้งค่าโฟลเดอร์ไฟล์แนบ");
    var created = DriveApp.getFolderById(folder).createFile(
      Utilities.newBlob(bytes, file.mimeType, context.file.name),
    );
    context.file.id = created.getId();
    var out = Domain.execute(db, u, request, context);
    // A failed/ambiguous batch may already be committed: keep the private file for recovery.
    commit_(db, out.db);
    return out.result;
  });
}
function downloadAttachment(token, id) {
  var mail = sessionEmail_(token),
    db = readDb_(),
    u = Domain.user(db, mail);
  var a = db.Attachments.find(function (x) {
    return x.id === id;
  });
  if (!a) throw new Error("ไม่พบไฟล์");
  Domain.visibleEntity(db, u, a.entity, a.entityId, false);
  var blob = DriveApp.getFileById(a.fileId).getBlob();
  return {
    name: a.name,
    mimeType: a.mimeType,
    base64: Utilities.base64Encode(blob.getBytes()),
  };
}
/** Run this private function ONLY in the Apps Script editor after setting ADMIN_EMAIL. */
function setup_() {
  return locked_(function () {
    var props = PropertiesService.getScriptProperties(),
      mail = (props.getProperty("ADMIN_EMAIL") || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail))
      throw new Error("ตั้ง Script property ADMIN_EMAIL ก่อน");
    if (props.getProperty("SPREADSHEET_ID"))
      throw new Error("ติดตั้งแล้ว: ไม่สร้างทับข้อมูลเดิม");
    var ss = SpreadsheetApp.create("D On Net · Database"),
      folder = DriveApp.createFolder("D On Net · Private attachments");
    props.setProperties({
      SPREADSHEET_ID: ss.getId(),
      ATTACHMENT_FOLDER_ID: folder.getId(),
    });
    Object.keys(Domain.SCHEMA).forEach(function (name, index) {
      var sheet =
          index === 0 ? ss.getSheets()[0].setName(name) : ss.insertSheet(name),
        columns = Domain.SCHEMA[name];
      if (sheet.getMaxColumns() < columns.length)
        sheet.insertColumnsAfter(
          sheet.getMaxColumns(),
          columns.length - sheet.getMaxColumns(),
        );
      sheet
        .getRange(1, 1, 1, columns.length)
        .setValues([columns])
        .setFontWeight("bold")
        .setBackground("#e7f3ee");
      sheet.setFrozenRows(1);
    });
    SpreadsheetApp.flush();
    var db = Domain.empty(),
      now = new Date().toISOString();
    db.Users.push({
      id: Utilities.getUuid(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      email: mail,
      name: "ผู้ดูแลระบบ",
      roles: ["admin"],
      active: true,
    });
    commit_(Domain.empty(), db);
    console.log("Database: " + ss.getUrl());
    console.log("Folder: " + folder.getUrl());
    return { spreadsheetUrl: ss.getUrl(), folderUrl: folder.getUrl() };
  });
}

/** Add only missing tables/columns; refuse a reordered or incompatible existing schema. */
function upgrade_() {
  return locked_(function () {
    var id = config_().id,
      ss = SpreadsheetApp.openById(id);
    Object.keys(Domain.SCHEMA).forEach(function (name) {
      var cols = Domain.SCHEMA[name],
        sheet = ss.getSheetByName(name);
      if (!sheet) sheet = ss.insertSheet(name);
      var existing = sheet.getLastColumn()
        ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
        : [];
      if (
        existing.some(function (h, i) {
          return h !== cols[i];
        })
      )
        throw new Error(
          "โครงสร้าง " + name + " ไม่ตรง หยุดโดยไม่เขียนทับตารางนี้",
        );
      if (sheet.getMaxColumns() < cols.length)
        sheet.insertColumnsAfter(
          sheet.getMaxColumns(),
          cols.length - sheet.getMaxColumns(),
        );
      sheet
        .getRange(1, 1, 1, cols.length)
        .setValues([cols])
        .setFontWeight("bold")
        .setBackground("#e7f3ee");
      sheet.setFrozenRows(1);
    });
    SpreadsheetApp.flush();
  });
}
function installTriggers_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === "runScheduledTasks_";
  });
  if (!exists)
    ScriptApp.newTrigger("runScheduledTasks_")
      .timeBased()
      .everyMinutes(15)
      .create();
}
function systemRow_(values) {
  var now = new Date().toISOString();
  return Object.assign(
    { id: Utilities.getUuid(), version: 1, createdAt: now, updatedAt: now },
    values,
  );
}
function scheduleReminders_() {
  return locked_(function () {
    var db = readDb_(),
      settings = Advanced.config(db);
    if (!settings.emailEnabled) return;
    var next = JSON.parse(JSON.stringify(db)),
      day = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd"),
      today = Date.parse(day),
      admins = db.Users.filter(function (u) {
        return (
          u.active &&
          u.roles.some(function (r) {
            return r === "admin" || r === "finance";
          })
        );
      }).map(function (u) {
        return u.email;
      });
    function queue(to, subject, body, entity, id, key) {
      if (
        next.Outbox.some(function (o) {
          return o.dedupeKey === key;
        })
      )
        return;
      next.Outbox.push(
        systemRow_({
          to: to,
          subject: subject,
          body: body,
          entity: entity,
          entityId: id,
          ownerEmail: "system",
          status: "pending",
          attempts: 0,
          sentAt: "",
          error: "",
          dedupeKey: key,
        }),
      );
    }
    db.Contracts.forEach(function (c) {
      var days = Math.ceil((Date.parse(c.end) - today) / 86400000);
      if (days < 0 || days > Number(c.alertDays || settings.reminderDays || 30))
        return;
      var emails =
        Array.isArray(c.alertEmails) && c.alertEmails.length
          ? c.alertEmails
          : admins;
      emails.forEach(function (mail) {
        if (
          !db.Users.some(function (u) {
            return u.email === mail && u.active;
          })
        )
          return;
        queue(
          mail,
          "สัญญาใกล้หมดอายุ " + c.number,
          c.name + "\nสิ้นสุด " + c.end + "\nกรุณาเข้าระบบเพื่อตรวจสอบ",
          "Contracts",
          c.id,
          "contract:" + c.id + ":" + c.end + ":" + mail,
        );
      });
    });
    db.PurchaseOrders.forEach(function (po) {
      if (
        po.cancelled ||
        !po.dueDate ||
        po.dueDate > day ||
        Advanced.poBalances(db, po).paid >= Advanced.poBalances(db, po).target
      )
        return;
      admins.forEach(function (mail) {
        queue(
          mail,
          "ครบกำหนดจ่าย " + po.number,
          "กำหนดจ่าย " + po.dueDate + "\nกรุณาเข้าระบบเพื่อตรวจสอบยอดคงเหลือ",
          "Procurements",
          po.procurementId,
          "due:" + po.id + ":" + po.dueDate + ":" + mail,
        );
      });
    });
    commit_(db, next);
  });
}
function runMailQueue_() {
  for (var n = 0; n < 10; n++) {
    if (MailApp.getRemainingDailyQuota() < 1) return;
    var item = locked_(function () {
      var db = readDb_();
      if (!Advanced.config(db).emailEnabled) return null;
      var next = JSON.parse(JSON.stringify(db)),
        now = new Date().toISOString();
      next.Outbox.forEach(function (o) {
        if (
          o.status === "sending" &&
          Date.now() - Date.parse(o.updatedAt) > 15 * 60 * 1000
        ) {
          o.status = "uncertain";
          o.error = "การส่งรอบก่อนหยุดกลางทาง ตรวจอีเมลที่ส่งแล้วก่อนลองใหม่";
          o.updatedAt = now;
          o.version++;
        }
      });
      var o = next.Outbox.find(function (x) {
        return x.status === "pending";
      });
      if (o) {
        o.status = "sending";
        o.attempts = Number(o.attempts || 0) + 1;
        o.updatedAt = now;
        o.version++;
      }
      commit_(db, next);
      return o || null;
    });
    if (!item) return;
    var sent = false,
      error = "";
    try {
      var url =
        PropertiesService.getScriptProperties().getProperty("WEB_APP_URL") ||
        "";
      MailApp.sendEmail({
        to: item.to,
        subject: item.subject,
        body: item.body + (url ? "\n\nเปิดระบบ: " + url : ""),
      });
      sent = true;
    } catch (e) {
      error = String(e.message || e).slice(0, 1000);
    }
    locked_(function () {
      var db = readDb_(),
        next = JSON.parse(JSON.stringify(db)),
        o = next.Outbox.find(function (x) {
          return x.id === item.id;
        });
      if (!o) return;
      o.status = sent ? "sent" : "uncertain";
      o.sentAt = sent ? new Date().toISOString() : "";
      o.error = error;
      o.version++;
      o.updatedAt = new Date().toISOString();
      commit_(db, next);
    });
  }
}
function requestBackup(token) {
  var mail = sessionEmail_(token),
    db = readDb_();
  if (!Domain.has(Domain.user(db, mail), [])) throw new Error("เฉพาะผู้ดูแล");
  startBackup_(true);
  continueBackup_();
  return { ok: true, message: "เริ่มสำรองข้อมูลแล้ว ตรวจสถานะได้ในตั้งค่า" };
}
function startBackup_(manual) {
  return locked_(function () {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty("BACKUP_MANIFEST_ID")) return;
    var db = readDb_(),
      day = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
    if (
      !manual &&
      (!Advanced.config(db).backupEnabled ||
        props.getProperty("LAST_BACKUP_DAY") === day)
    )
      return;
    var rootId = props.getProperty("BACKUP_FOLDER_ID");
    if (!rootId) {
      rootId = DriveApp.createFolder("D On Net · Backups").getId();
      props.setProperty("BACKUP_FOLDER_ID", rootId);
    }
    var name = "D On Net " + new Date().toISOString().replace(/[:.]/g, "-"),
      folder = DriveApp.getFolderById(rootId).createFolder(name);
    var copy = DriveApp.getFileById(config_().id).makeCopy("Database", folder);
    var entries = db.Attachments.map(function (a) {
      return { id: a.fileId, name: a.name };
    });
    var manifest = folder.createFile(
      "manifest.json",
      JSON.stringify({
        createdAt: new Date().toISOString(),
        folderId: folder.getId(),
        spreadsheetCopyId: copy.getId(),
        entries: entries,
        index: 0,
      }),
      MimeType.PLAIN_TEXT,
    );
    props.setProperty("BACKUP_MANIFEST_ID", manifest.getId());
    props.setProperty("LAST_BACKUP_DAY", day);
    var next = JSON.parse(JSON.stringify(db));
    next.BackupLog.push(
      systemRow_({
        name: name,
        fileId: folder.getId(),
        status: "running",
        note: "สำรองตารางแล้ว รอไฟล์ " + entries.length + " รายการ",
      }),
    );
    commit_(db, next);
  });
}
function continueBackup_() {
  return locked_(function () {
    var props = PropertiesService.getScriptProperties(),
      id = props.getProperty("BACKUP_MANIFEST_ID");
    if (!id) return;
    var file = DriveApp.getFileById(id),
      job = JSON.parse(file.getBlob().getDataAsString()),
      folder = DriveApp.getFolderById(job.folderId),
      count = 0;
    job.error = "";
    try {
      while (job.index < job.entries.length && count < 10) {
        var entry = job.entries[job.index],
          name = entry.id + "__" + entry.name;
        if (!folder.getFilesByName(name).hasNext())
          DriveApp.getFileById(entry.id).makeCopy(name, folder);
        job.index++;
        count++;
        file.setContent(JSON.stringify(job));
      }
    } catch (e) {
      job.error = String(e.message || e).slice(0, 1000);
      file.setContent(JSON.stringify(job));
    }
    var db = readDb_(),
      next = JSON.parse(JSON.stringify(db)),
      log = next.BackupLog.find(function (x) {
        return x.fileId === job.folderId;
      });
    if (log) {
      log.status =
        job.index === job.entries.length
          ? "complete"
          : job.error
            ? "partial"
            : "running";
      log.note =
        job.index +
        "/" +
        job.entries.length +
        " ไฟล์" +
        (job.error ? " · " + job.error : "");
      log.version++;
      log.updatedAt = new Date().toISOString();
      commit_(db, next);
    }
    if (job.index === job.entries.length)
      props.deleteProperty("BACKUP_MANIFEST_ID");
  });
}
function runScheduledTasks_() {
  scheduleReminders_();
  runMailQueue_();
  startBackup_(false);
  continueBackup_();
}
