const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'data.db'));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/products', (req, res) => {
  const { category, lowStock } = req.query;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (lowStock === 'true') {
    sql += ' AND stock < low_stock_threshold';
  }
  sql += ' ORDER BY category, name';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '商品不存在' });
  res.json(row);
});

app.post('/api/products', (req, res) => {
  const { name, category, stock, shelf, cost_price, sell_price, low_stock_threshold } = req.body;
  if (!name || !category) return res.status(400).json({ error: '商品名称和分类必填' });
  const info = db.prepare(
    `INSERT INTO products (name, category, stock, shelf, cost_price, sell_price, low_stock_threshold)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name, category, stock || 0, shelf || '',
    Number(cost_price) || 0, Number(sell_price) || 0,
    Number(low_stock_threshold) || 10
  );
  res.json({ id: info.lastInsertRowid, ...req.body });
});

app.put('/api/products/:id', (req, res) => {
  const { name, category, stock, shelf, cost_price, sell_price, low_stock_threshold } = req.body;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '商品不存在' });
  db.prepare(
    `UPDATE products SET name=?, category=?, stock=?, shelf=?, cost_price=?, sell_price=?, low_stock_threshold=? WHERE id=?`
  ).run(
    name || existing.name, category || existing.category,
    stock !== undefined ? stock : existing.stock,
    shelf !== undefined ? shelf : existing.shelf,
    cost_price !== undefined ? Number(cost_price) : existing.cost_price,
    sell_price !== undefined ? Number(sell_price) : existing.sell_price,
    low_stock_threshold !== undefined ? Number(low_stock_threshold) : existing.low_stock_threshold,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/products/categories', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT category FROM products ORDER BY category').all();
  res.json(rows.map(r => r.category));
});

app.get('/api/customers', (req, res) => {
  const { keyword } = req.query;
  let sql = 'SELECT * FROM customers';
  const params = [];
  if (keyword) {
    sql += ' WHERE name LIKE ? OR phone LIKE ?';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/customers', (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: '客户姓名必填' });
  const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(name, phone || '');
  res.json({ id: info.lastInsertRowid, name, phone: phone || '' });
});

app.get('/api/customers/:id/history', (req, res) => {
  const orders = db.prepare(
    `SELECT id, total_amount, total_profit, order_date, customer_name
     FROM sales_orders WHERE customer_id = ? ORDER BY order_date DESC`
  ).all(req.params.id);
  const orderIds = orders.map(o => o.id);
  let items = [];
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    items = db.prepare(
      `SELECT si.* FROM sales_items si WHERE si.order_id IN (${placeholders})`
    ).all(...orderIds);
  }
  const totalSpent = orders.reduce((s, o) => s + o.total_amount, 0);
  const totalProfit = orders.reduce((s, o) => s + o.total_profit, 0);
  res.json({ orders, items, totalSpent, totalProfit, orderCount: orders.length });
});

app.post('/api/sales/check-stock', (req, res) => {
  const { items } = req.body;
  const warnings = [];
  for (const it of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!product) continue;
    if (it.quantity > product.stock) {
      warnings.push({
        product_id: product.id,
        product_name: product.name,
        requested: it.quantity,
        available: product.stock,
        message: `库存只剩 ${product.stock} 个了，你要 ${it.quantity} 个`
      });
    } else if (product.stock - it.quantity < product.low_stock_threshold) {
      warnings.push({
        product_id: product.id,
        product_name: product.name,
        available: product.stock - it.quantity,
        message: `卖完后只剩 ${product.stock - it.quantity} 个，低于阈值 ${product.low_stock_threshold}`
      });
    }
  }
  res.json({ warnings });
});

app.post('/api/sales', (req, res) => {
  const { customer_id, customer_name, items } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: '销售单不能为空' });
  }
  const tx = db.transaction(() => {
    let total_amount = 0;
    let total_profit = 0;
    const savedItems = [];
    for (const it of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (!product) throw new Error(`商品不存在: ${it.product_id}`);
      if (it.quantity > product.stock) {
        throw new Error(`${product.name} 库存不足，只剩 ${product.stock} 个`);
      }
      const subtotal = Number((it.quantity * it.unit_price).toFixed(2));
      const profit = Number(((it.unit_price - product.cost_price) * it.quantity).toFixed(2));
      total_amount += subtotal;
      total_profit += profit;
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(it.quantity, it.product_id);
      savedItems.push({
        product_id: it.product_id,
        product_name: product.name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        cost_price: product.cost_price,
        subtotal,
        profit
      });
    }
    total_amount = Number(total_amount.toFixed(2));
    total_profit = Number(total_profit.toFixed(2));
    const custName = customer_name || (customer_id
      ? (db.prepare('SELECT name FROM customers WHERE id = ?').get(customer_id)?.name || '散客')
      : '散客');
    const info = db.prepare(
      `INSERT INTO sales_orders (customer_id, customer_name, total_amount, total_profit)
       VALUES (?, ?, ?, ?)`
    ).run(customer_id || null, custName, total_amount, total_profit);
    const insertItem = db.prepare(
      `INSERT INTO sales_items (order_id, product_id, product_name, quantity, unit_price, cost_price, subtotal, profit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const si of savedItems) {
      insertItem.run(info.lastInsertRowid, si.product_id, si.product_name, si.quantity,
        si.unit_price, si.cost_price, si.subtotal, si.profit);
    }
    return { orderId: info.lastInsertRowid, total_amount, total_profit, items: savedItems, customer_name: custName };
  });
  try {
    const result = tx();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/sales/today', (req, res) => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const orders = db.prepare(
    `SELECT * FROM sales_orders WHERE date(order_date) = ? ORDER BY order_date DESC`
  ).all(dateStr);
  const orderIds = orders.map(o => o.id);
  let items = [];
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    items = db.prepare(
      `SELECT * FROM sales_items WHERE order_id IN (${placeholders})`
    ).all(...orderIds);
  }
  const totalSales = orders.reduce((s, o) => s + o.total_amount, 0);
  const totalProfit = orders.reduce((s, o) => s + o.total_profit, 0);
  const productSummary = {};
  for (const it of items) {
    if (!productSummary[it.product_id]) {
      productSummary[it.product_id] = { product_name: it.product_name, quantity: 0, total: 0, profit: 0 };
    }
    productSummary[it.product_id].quantity += it.quantity;
    productSummary[it.product_id].total += it.subtotal;
    productSummary[it.product_id].profit += it.profit;
  }
  res.json({
    date: dateStr,
    orderCount: orders.length,
    totalSales: Number(totalSales.toFixed(2)),
    totalProfit: Number(totalProfit.toFixed(2)),
    orders,
    items,
    productSummary: Object.values(productSummary).sort((a, b) => b.quantity - a.quantity)
  });
});

app.get('/api/alerts/low-stock', (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM products WHERE stock < low_stock_threshold ORDER BY stock ASC`
  ).all();
  res.json(rows);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`五金店管理系统已启动: http://localhost:${PORT}`);
});
