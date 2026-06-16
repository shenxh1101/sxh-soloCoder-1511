const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'data.db'));

try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      sales_item_id INTEGER,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      refund_amount REAL NOT NULL,
      refund_profit REAL NOT NULL,
      reason TEXT,
      refund_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (order_id) REFERENCES sales_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `).run();
  console.log('✅ refunds 表已创建');
} catch(e) { console.log('⚠️  refunds:', e.message); }

try {
  const cols = db.prepare("PRAGMA table_info(purchases)").all().map(c => c.name);
  if (!cols.includes('supplier')) {
    db.prepare(`ALTER TABLE purchases ADD COLUMN supplier TEXT`).run();
    console.log('✅ purchases.supplier 字段已添加');
  }
} catch(e) { console.log('⚠️  purchases:', e.message); }

console.log('✅ 数据库迁移完成');
db.close();
