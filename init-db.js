const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data.db');
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new Database(dbPath);

db.exec(`
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  shelf TEXT,
  cost_price REAL NOT NULL DEFAULT 0,
  sell_price REAL NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  customer_name TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  total_profit REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'normal',
  order_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  total_cost REAL NOT NULL,
  supplier TEXT,
  purchase_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE refunds (
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
);

CREATE TABLE sales_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  cost_price REAL NOT NULL,
  subtotal REAL NOT NULL,
  profit REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES sales_orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
`);

const insertProduct = db.prepare(
  `INSERT INTO products (name, category, stock, shelf, cost_price, sell_price, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const sampleProducts = [
  ['M4螺丝(100颗/包)', '螺丝', 50, 'A1-01', 8.5, 15.0, 10],
  ['M6螺丝(50颗/包)', '螺丝', 35, 'A1-02', 12.0, 22.0, 10],
  ['M8螺丝(30颗/包)', '螺丝', 8, 'A1-03', 15.0, 28.0, 10],
  ['钢钉3cm(500g)', '钉子', 42, 'A2-01', 6.0, 12.0, 10],
  ['钢钉5cm(500g)', '钉子', 5, 'A2-02', 8.0, 16.0, 10],
  ['水泥钉(100颗)', '钉子', 28, 'A2-03', 10.0, 18.0, 10],
  ['普通合页4寸(副)', '合页', 60, 'B1-01', 5.0, 12.0, 10],
  ['不锈钢合页4寸(副)', '合页', 15, 'B1-02', 12.0, 25.0, 10],
  ['柜门拉手(单个)', '拉手', 80, 'B2-01', 3.5, 8.0, 15],
  ['大门拉手(副)', '拉手', 22, 'B2-02', 25.0, 55.0, 10],
  ['冲击钻头6mm', '钻头', 3, 'C1-01', 4.0, 10.0, 10],
  ['冲击钻头8mm', '钻头', 18, 'C1-02', 5.0, 12.0, 10],
  ['冲击钻头10mm', '钻头', 12, 'C1-03', 7.0, 15.0, 10],
  ['麻花钻套装(13件)', '钻头', 7, 'C1-04', 35.0, 75.0, 5],
];

for (const p of sampleProducts) {
  insertProduct.run(...p);
}

const insertCustomer = db.prepare(
  `INSERT INTO customers (name, phone) VALUES (?, ?)`
);
insertCustomer.run('王先生', '13800138001');
insertCustomer.run('李女士', '13900139002');
insertCustomer.run('张师傅', '13700137003');

console.log('数据库初始化完成！');
console.log(`已导入 ${sampleProducts.length} 个商品，3 个客户示例数据。`);
db.close();
