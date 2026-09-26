const Domain = require("../src/domain.js");
function seed() {
  const db = Domain.empty();
  const accounts = [
    ["admin", "ผู้ดูแลระบบ"],
    ["sales", "ฝ่ายขาย"],
    ["approver", "ผู้อนุมัติ"],
    ["purchase", "ฝ่ายจัดซื้อ"],
    ["tech", "ทีมช่าง"],
    ["finance", "การเงิน"],
  ];
  for (const [role, name] of accounts)
    db.Users.push({
      id: role,
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      name,
      email: role + "@example.test",
      roles: [role],
      active: true,
    });
  return db;
}
module.exports = { seed };
