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

app.get('/api/products/:id/purchases', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM purchases WHERE product_id = ? ORDER BY purchase_date DESC'
  ).all(req.params.id);
  res.json(rows);
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

app.post('/api/purchases', (req, res) => {
  const { product_id, quantity, unit_cost, supplier } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '商品和数量必填' });
  }
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: '商品不存在' });
  const cost = Number(unit_cost) || product.cost_price;
  const total_cost = Number((quantity * cost).toFixed(2));
  const tx = db.transaction(() => {
    db.prepare('UPDATE products SET stock = stock + ?, cost_price = ? WHERE id = ?')
      .run(quantity, cost, product_id);
    const info = db.prepare(
      `INSERT INTO purchases (product_id, product_name, quantity, unit_cost, total_cost, supplier)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(product_id, product.name, quantity, cost, total_cost, supplier || '');
    return {
      id: info.lastInsertRowid,
      product_id, product_name: product.name,
      quantity, unit_cost: cost, total_cost,
      supplier: supplier || ''
    };
  });
  res.json(tx());
});

app.get('/api/purchases', (req, res) => {
  const { supplier, startDate, endDate } = req.query;
  let sql = 'SELECT * FROM purchases WHERE 1=1';
  const params = [];
  if (supplier) {
    sql += ' AND supplier LIKE ?';
    params.push(`%${supplier}%`);
  }
  if (startDate) {
    sql += ' AND substr(purchase_date,1,10) >= ?';
    params.push(startDate);
  }
  if (endDate) {
    sql += ' AND substr(purchase_date,1,10) <= ?';
    params.push(endDate);
  }
  sql += ' ORDER BY purchase_date DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/purchases/suppliers', (req, res) => {
  const rows = db.prepare(`
    SELECT supplier,
           COUNT(*) as purchase_count,
           SUM(quantity) as total_quantity,
           SUM(total_cost) as total_cost
    FROM purchases
    WHERE supplier IS NOT NULL AND supplier != ''
    GROUP BY supplier
    ORDER BY total_cost DESC
  `).all();
  res.json(rows);
});

app.get('/api/purchases/supplier/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const records = db.prepare(
    'SELECT * FROM purchases WHERE supplier = ? ORDER BY purchase_date DESC'
  ).all(name);
  const productSummary = {};
  for (const r of records) {
    if (!productSummary[r.product_id]) {
      productSummary[r.product_id] = {
        product_name: r.product_name,
        quantity: 0, total_cost: 0, unit_cost_list: []
      };
    }
    productSummary[r.product_id].quantity += r.quantity;
    productSummary[r.product_id].total_cost += r.total_cost;
    productSummary[r.product_id].unit_cost_list.push(r.unit_cost);
  }
  const summary = Object.values(productSummary).map(p => ({
    ...p,
    avg_cost: Number((p.total_cost / p.quantity).toFixed(2))
  })).sort((a, b) => b.total_cost - a.total_cost);
  const totalCost = records.reduce((s, r) => s + r.total_cost, 0);
  const totalQty = records.reduce((s, r) => s + r.quantity, 0);
  res.json({ supplier: name, records, productSummary: summary, totalCost, totalQty });
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
  const existing = db.prepare('SELECT * FROM customers WHERE name = ?').get(name);
  if (existing) {
    if (phone && !existing.phone) {
      db.prepare('UPDATE customers SET phone = ? WHERE id = ?').run(phone, existing.id);
      existing.phone = phone;
    }
    return res.json(existing);
  }
  const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(name, phone || '');
  res.json({ id: info.lastInsertRowid, name, phone: phone || '' });
});

app.get('/api/customers/:id/history', (req, res) => {
  const orders = db.prepare(
    `SELECT id, total_amount, total_profit, order_date, customer_name, status
     FROM sales_orders WHERE customer_id = ? ORDER BY order_date DESC`
  ).all(req.params.id);
  const orderIds = orders.map(o => o.id);
  let items = [], refunds = [];
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    items = db.prepare(
      `SELECT si.* FROM sales_items si WHERE si.order_id IN (${placeholders})`
    ).all(...orderIds);
    refunds = db.prepare(
      `SELECT r.* FROM refunds r WHERE r.order_id IN (${placeholders})`
    ).all(...orderIds);
  }
  const validOrders = orders.filter(o => o.status !== 'refunded');
  const totalRefund = refunds.reduce((s, r) => s + r.refund_amount, 0);
  const totalSpent = validOrders.reduce((s, o) => s + o.total_amount, 0);
  const totalProfit = validOrders.reduce((s, o) => s + o.total_profit, 0);
  res.json({
    orders, items, refunds,
    totalSpent: Number(totalSpent.toFixed(2)),
    totalProfit: Number(totalProfit.toFixed(2)),
    totalRefund: Number(totalRefund.toFixed(2)),
    orderCount: validOrders.length
  });
});

app.post('/api/sales/check-stock', (req, res) => {
  const { items } = req.body;
  const warnings = [];
  for (const it of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!product) continue;
    if (it.quantity > product.stock) {
      warnings.push({
        product_id: product.id, product_name: product.name,
        requested: it.quantity, available: product.stock,
        message: `库存只剩 ${product.stock} 个了，你要 ${it.quantity} 个`
      });
    } else if (product.stock - it.quantity < product.low_stock_threshold) {
      warnings.push({
        product_id: product.id, product_name: product.name,
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
    let finalCustomerId = customer_id || null;
    let finalCustomerName = '散客';
    if (customer_name && customer_name.trim()) {
      const name = customer_name.trim();
      let cust = db.prepare('SELECT * FROM customers WHERE name = ?').get(name);
      if (!cust) {
        const info = db.prepare('INSERT INTO customers (name) VALUES (?)').run(name);
        cust = { id: info.lastInsertRowid, name };
      }
      finalCustomerId = cust.id;
      finalCustomerName = cust.name;
    } else if (customer_id) {
      const cust = db.prepare('SELECT name FROM customers WHERE id = ?').get(customer_id);
      if (cust) finalCustomerName = cust.name;
    }

    let total_amount = 0, total_profit = 0;
    const savedItems = [];
    for (const it of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (!product) throw new Error(`商品不存在: ${it.product_id}`);
      if (it.quantity > product.stock) {
        throw new Error(`${product.name} 库存不足，只剩 ${product.stock} 个`);
      }
      const subtotal = Number((it.quantity * it.unit_price).toFixed(2));
      const profit = Number(((it.unit_price - product.cost_price) * it.quantity).toFixed(2));
      total_amount += subtotal; total_profit += profit;
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(it.quantity, it.product_id);
      savedItems.push({
        product_id: it.product_id, product_name: product.name,
        quantity: it.quantity, unit_price: it.unit_price,
        cost_price: product.cost_price, subtotal, profit
      });
    }
    total_amount = Number(total_amount.toFixed(2));
    total_profit = Number(total_profit.toFixed(2));
    const info = db.prepare(
      `INSERT INTO sales_orders (customer_id, customer_name, total_amount, total_profit, status)
       VALUES (?, ?, ?, ?, 'normal')`
    ).run(finalCustomerId, finalCustomerName, total_amount, total_profit);
    const insertItem = db.prepare(
      `INSERT INTO sales_items (order_id, product_id, product_name, quantity, unit_price, cost_price, subtotal, profit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const si of savedItems) {
      insertItem.run(info.lastInsertRowid, si.product_id, si.product_name, si.quantity,
        si.unit_price, si.cost_price, si.subtotal, si.profit);
    }
    return {
      orderId: info.lastInsertRowid, customer_id: finalCustomerId,
      customer_name: finalCustomerName, total_amount, total_profit,
      items: savedItems, order_date: new Date().toLocaleString('zh-CN')
    };
  });
  try { res.json(tx()); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

function aggregateReport(dateStrStart, dateStrEnd) {
  const orders = db.prepare(
    `SELECT * FROM sales_orders
     WHERE substr(order_date,1,10) >= ? AND substr(order_date,1,10) <= ?
     ORDER BY order_date DESC`
  ).all(dateStrStart, dateStrEnd);
  const orderIds = orders.map(o => o.id);
  let items = [], refunds = [];
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    items = db.prepare(
      `SELECT si.*, p.category FROM sales_items si
       LEFT JOIN products p ON si.product_id = p.id
       WHERE si.order_id IN (${placeholders})`
    ).all(...orderIds);
    refunds = db.prepare(
      `SELECT r.* FROM refunds r WHERE r.order_id IN (${placeholders})`
    ).all(...orderIds);
  }
  const validOrders = orders.filter(o => o.status !== 'refunded');
  const validOrderIds = validOrders.map(o => o.id);

  const totalSales = validOrders.reduce((s, o) => s + o.total_amount, 0);
  const totalProfit = validOrders.reduce((s, o) => s + o.total_profit, 0);
  const totalRefund = refunds.reduce((s, r) => s + r.refund_amount, 0);
  const netSales = Number((totalSales).toFixed(2));

  const productSummary = {};
  for (const it of items) {
    if (!validOrderIds.includes(it.order_id)) continue;
    const refunded = refunds.filter(r => r.sales_item_id === it.id).reduce((s, r) => s + r.quantity, 0);
    const qty = it.quantity - refunded;
    const unitProfit = it.quantity > 0 ? it.profit / it.quantity : 0;
    const unitSubtotal = it.quantity > 0 ? it.subtotal / it.quantity : 0;
    if (!productSummary[it.product_id]) {
      productSummary[it.product_id] = { product_name: it.product_name, quantity: 0, total: 0, profit: 0 };
    }
    productSummary[it.product_id].quantity += qty;
    productSummary[it.product_id].total += Number((qty * unitSubtotal).toFixed(2));
    productSummary[it.product_id].profit += Number((qty * unitProfit).toFixed(2));
  }

  const categorySummary = {};
  for (const it of items) {
    if (!validOrderIds.includes(it.order_id)) continue;
    const refunded = refunds.filter(r => r.sales_item_id === it.id).reduce((s, r) => s + r.quantity, 0);
    const qty = it.quantity - refunded;
    const cat = it.category || '其他';
    const unitProfit = it.quantity > 0 ? it.profit / it.quantity : 0;
    const unitSubtotal = it.quantity > 0 ? it.subtotal / it.quantity : 0;
    if (!categorySummary[cat]) {
      categorySummary[cat] = { category: cat, quantity: 0, total: 0, profit: 0 };
    }
    categorySummary[cat].quantity += qty;
    categorySummary[cat].total += Number((qty * unitSubtotal).toFixed(2));
    categorySummary[cat].profit += Number((qty * unitProfit).toFixed(2));
  }

  return {
    dateRange: `${dateStrStart} ~ ${dateStrEnd}`,
    orderCount: validOrders.length,
    refundedOrderCount: orders.length - validOrders.length,
    totalSales: netSales,
    totalProfit: Number(totalProfit.toFixed(2)),
    totalRefund: Number(totalRefund.toFixed(2)),
    orders, items, refunds,
    productSummary: Object.values(productSummary).sort((a, b) => b.quantity - a.quantity),
    categorySummary: Object.values(categorySummary).sort((a, b) => b.profit - a.profit)
  };
}

app.get('/api/sales/today', (req, res) => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  res.json(aggregateReport(today, today));
});

app.get('/api/sales/range', (req, res) => {
  let { start, end } = req.query;
  if (!start || !end) {
    const d = new Date();
    end = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const s = new Date(); s.setDate(s.getDate() - 29);
    start = `${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}`;
  }
  res.json(aggregateReport(start, end));
});

app.get('/api/sales/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const items = db.prepare('SELECT * FROM sales_items WHERE order_id = ?').all(req.params.id);
  const refunds = db.prepare('SELECT * FROM refunds WHERE order_id = ?').all(req.params.id);
  for (const it of items) {
    const refundedQty = refunds.filter(r => r.sales_item_id === it.id).reduce((s, r) => s + r.quantity, 0);
    it.remaining_quantity = it.quantity - refundedQty;
    it.refunded_quantity = refundedQty;
  }
  res.json({ ...order, items, refunds });
});

app.post('/api/sales/:id/refund-item', (req, res) => {
  const { sales_item_id, quantity, unit_price, reason } = req.body;
  if (!sales_item_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '请选择退货商品和数量' });
  }
  const order = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.status === 'refunded') return res.status(400).json({ error: '订单已完全退货' });
  const item = db.prepare('SELECT * FROM sales_items WHERE id = ? AND order_id = ?')
    .get(sales_item_id, req.params.id);
  if (!item) return res.status(400).json({ error: '商品不属于此订单' });
  const alreadyRefunded = db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) as q FROM refunds WHERE sales_item_id = ?'
  ).get(sales_item_id).q;
  const remaining = item.quantity - alreadyRefunded;
  if (quantity > remaining) {
    return res.status(400).json({ error: `${item.product_name} 最多只能退 ${remaining} 个` });
  }
  const refundPrice = Number(unit_price) || item.unit_price;
  if (refundPrice > item.unit_price) {
    return res.status(400).json({ error: '退款单价不能超过原售价' });
  }
  const refundAmount = Number((refundPrice * quantity).toFixed(2));
  const refundProfit = Number(((refundPrice - item.cost_price) * quantity).toFixed(2));

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO refunds (order_id, sales_item_id, product_id, product_name, quantity, refund_amount, refund_profit, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.params.id, sales_item_id, item.product_id, item.product_name,
          quantity, refundAmount, refundProfit, reason || '');
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(quantity, item.product_id);
    db.prepare(
      `UPDATE sales_orders SET total_amount = total_amount - ?, total_profit = total_profit - ? WHERE id = ?`
    ).run(refundAmount, refundProfit, req.params.id);

    const allItems = db.prepare('SELECT * FROM sales_items WHERE order_id = ?').all(req.params.id);
    let allDone = true;
    for (const it of allItems) {
      const ref = db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM refunds WHERE sales_item_id = ?').get(it.id).q;
      if (ref < it.quantity) { allDone = false; break; }
    }
    if (allDone) {
      db.prepare("UPDATE sales_orders SET status = 'refunded', total_amount = 0, total_profit = 0 WHERE id = ?")
        .run(req.params.id);
    }
    return {
      id: db.prepare('SELECT last_insert_rowid() as id').get().id,
      product_name: item.product_name,
      quantity, refund_amount: refundAmount, refund_profit: refundProfit,
      fully_refunded: allDone
    };
  });
  try { res.json(tx()); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/sales/:id/refund', (req, res) => {
  const order = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.status === 'refunded') return res.status(400).json({ error: '该订单已退货' });
  const items = db.prepare('SELECT * FROM sales_items WHERE order_id = ?').all(req.params.id);
  let totalRefunded = 0, totalProfitBack = 0;
  const tx = db.transaction(() => {
    for (const it of items) {
      const alreadyRefunded = db.prepare(
        'SELECT COALESCE(SUM(quantity),0) q FROM refunds WHERE sales_item_id = ?'
      ).get(it.id).q;
      const remaining = it.quantity - alreadyRefunded;
      if (remaining > 0) {
        const refundAmount = Number((remaining * it.unit_price).toFixed(2));
        const refundProfit = Number(((it.unit_price - it.cost_price) * remaining).toFixed(2));
        db.prepare(
          `INSERT INTO refunds (order_id, sales_item_id, product_id, product_name, quantity, refund_amount, refund_profit, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, '整单作废')`
        ).run(req.params.id, it.id, it.product_id, it.product_name,
              remaining, refundAmount, refundProfit);
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(remaining, it.product_id);
        totalRefunded += refundAmount;
        totalProfitBack += refundProfit;
      }
    }
    db.prepare("UPDATE sales_orders SET status = 'refunded', total_amount = 0, total_profit = 0 WHERE id = ?")
      .run(req.params.id);
  });
  tx();
  res.json({ ok: true, orderId: order.id, refunded: totalRefunded });
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
