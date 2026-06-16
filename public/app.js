let editingProductId = null;
let purchasingProductId = null;
let refundingOrderId = null;
let refundQueue = [];
let saleItems = [];
let productCache = [];

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'inventory') loadProducts();
    if (btn.dataset.tab === 'sales') { loadProductsForSale(); loadCustomersForSale(); }
    if (btn.dataset.tab === 'customers') loadCustomers();
    if (btn.dataset.tab === 'daily') loadDailyReport();
    if (btn.dataset.tab === 'range') initRangeDefaults();
    if (btn.dataset.tab === 'suppliers') { loadSupplierSummary(); loadPurchaseList(); }
    if (btn.dataset.tab === 'alerts') loadAlerts();
  };
});

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' }, ...opts
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}
function fmt(n) { return '¥' + Number(n).toFixed(2); }

function todayStr(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function initRangeDefaults() {
  const s = document.getElementById('rangeStart');
  const e = document.getElementById('rangeEnd');
  if (!s.value) { s.value = todayStr(-29); }
  if (!e.value) { e.value = todayStr(0); }
  loadRangeReport();
}

async function loadCategories() {
  try {
    const cats = await api('/api/products/categories');
    const sel = document.getElementById('filterCategory');
    const current = sel.value;
    sel.innerHTML = '<option value="">全部分类</option>';
    cats.forEach(c => sel.innerHTML += `<option value="${c}">${c}</option>`);
    sel.value = current;
  } catch(e) {}
}

async function loadProducts() {
  await loadCategories();
  const cat = document.getElementById('filterCategory').value;
  const kw = document.getElementById('searchProduct').value.trim().toLowerCase();
  const products = await api('/api/products' + (cat ? '?category=' + cat : ''));
  const filtered = kw ? products.filter(p => p.name.toLowerCase().includes(kw)) : products;
  const tbody = document.getElementById('productList');
  tbody.innerHTML = '';
  filtered.forEach(p => {
    const low = p.stock < p.low_stock_threshold;
    tbody.innerHTML += `
      <tr>
        <td>${p.id}</td><td>${p.category}</td><td>${p.name}</td>
        <td class="${low ? 'low-stock' : 'ok-stock'}">${p.stock}</td>
        <td>${p.shelf || '-'}</td><td>${fmt(p.cost_price)}</td><td>${fmt(p.sell_price)}</td>
        <td>${p.low_stock_threshold}</td>
        <td>
          <button class="btn-small" onclick="openPurchaseModal(${p.id})">进货</button>
          <button class="btn-small" onclick="showPurchaseHistory(${p.id}, '${p.name.replace(/'/g,"\\'")}')">记录</button>
          <button class="btn-small" onclick="editProduct(${p.id})">编辑</button>
          <button class="btn-danger" onclick="deleteProduct(${p.id})">删除</button>
        </td>
      </tr>`;
  });
}
document.getElementById('filterCategory').onchange = loadProducts;
document.getElementById('searchProduct').oninput = loadProducts;

function openProductModal() {
  editingProductId = null;
  document.getElementById('productModalTitle').textContent = '新增商品';
  ['pName','pStock','pShelf','pCost','pSell','pThreshold'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pStock').value = 0;
  document.getElementById('pThreshold').value = 10;
  document.getElementById('pCategory').value = '螺丝';
  document.getElementById('productModal').style.display = 'flex';
}
function closeProductModal() { document.getElementById('productModal').style.display = 'none'; }

async function editProduct(id) {
  const p = await api('/api/products/' + id);
  editingProductId = id;
  document.getElementById('productModalTitle').textContent = '编辑商品';
  document.getElementById('pName').value = p.name;
  document.getElementById('pCategory').value = p.category;
  document.getElementById('pStock').value = p.stock;
  document.getElementById('pShelf').value = p.shelf || '';
  document.getElementById('pCost').value = p.cost_price;
  document.getElementById('pSell').value = p.sell_price;
  document.getElementById('pThreshold').value = p.low_stock_threshold;
  document.getElementById('productModal').style.display = 'flex';
}

async function saveProduct() {
  const data = {
    name: document.getElementById('pName').value.trim(),
    category: document.getElementById('pCategory').value,
    stock: parseInt(document.getElementById('pStock').value) || 0,
    shelf: document.getElementById('pShelf').value.trim(),
    cost_price: parseFloat(document.getElementById('pCost').value) || 0,
    sell_price: parseFloat(document.getElementById('pSell').value) || 0,
    low_stock_threshold: parseInt(document.getElementById('pThreshold').value) || 10
  };
  if (!data.name) { alert('请填写商品名称'); return; }
  try {
    if (editingProductId) {
      await api('/api/products/' + editingProductId, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await api('/api/products', { method: 'POST', body: JSON.stringify(data) });
    }
    closeProductModal();
    loadProducts();
  } catch(e) { alert(e.message); }
}

async function deleteProduct(id) {
  if (!confirm('确定删除这个商品吗？')) return;
  await api('/api/products/' + id, { method: 'DELETE' });
  loadProducts();
}

async function openPurchaseModal(id) {
  const p = await api('/api/products/' + id);
  purchasingProductId = id;
  document.getElementById('purchaseProductInfo').innerHTML =
    `<strong>${p.name}</strong>（${p.category}） · 当前库存：<b>${p.stock}</b> · 当前进价：${fmt(p.cost_price)}`;
  document.getElementById('purQuantity').value = 10;
  document.getElementById('purUnitCost').value = p.cost_price;
  document.getElementById('purSupplier').value = '';
  updatePurTotal();
  document.getElementById('purchaseModal').style.display = 'flex';
}
function closePurchaseModal() {
  document.getElementById('purchaseModal').style.display = 'none';
  purchasingProductId = null;
}
function updatePurTotal() {
  const qty = parseInt(document.getElementById('purQuantity').value) || 0;
  const price = parseFloat(document.getElementById('purUnitCost').value) || 0;
  document.getElementById('purTotalHint').textContent = '合计：' + fmt(qty * price);
}
document.addEventListener('DOMContentLoaded', () => {
  const purQty = document.getElementById('purQuantity');
  const purCost = document.getElementById('purUnitCost');
  if (purQty) purQty.oninput = updatePurTotal;
  if (purCost) purCost.oninput = updatePurTotal;
});

async function submitPurchase() {
  if (!purchasingProductId) return;
  const quantity = parseInt(document.getElementById('purQuantity').value);
  const unit_cost = parseFloat(document.getElementById('purUnitCost').value);
  const supplier = document.getElementById('purSupplier').value.trim();
  if (!quantity || quantity <= 0) { alert('请输入进货数量'); return; }
  if (isNaN(unit_cost) || unit_cost < 0) { alert('请输入正确的单价'); return; }
  try {
    const result = await api('/api/purchases', {
      method: 'POST', body: JSON.stringify({ product_id: purchasingProductId, quantity, unit_cost, supplier })
    });
    alert(`✅ 入库成功！\n${result.product_name} x ${result.quantity}\n合计成本：${fmt(result.total_cost)}`);
    closePurchaseModal();
    loadProducts();
  } catch(e) { alert(e.message); }
}

async function showPurchaseHistory(id, name) {
  const records = await api(`/api/products/${id}/purchases`);
  const div = document.getElementById('purchaseHistory');
  div.innerHTML = `
    <h3>📥 ${name} 的进货记录</h3>
    ${records.length === 0 ? '<p style="color:#888;">暂无进货记录</p>' : `
    <table class="data-table">
      <thead><tr><th>时间</th><th>数量</th><th>单价</th><th>合计</th><th>供应商</th></tr></thead>
      <tbody>
        ${records.map(r => `<tr>
          <td>${r.purchase_date}</td><td>${r.quantity}</td><td>${fmt(r.unit_cost)}</td>
          <td>${fmt(r.total_cost)}</td><td>${r.supplier || '-'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`}
  `;
  div.scrollIntoView({ behavior: 'smooth' });
}

async function loadProductsForSale() {
  productCache = await api('/api/products');
  const sel = document.getElementById('saleProductSelect');
  sel.innerHTML = '';
  productCache.forEach(p => {
    sel.innerHTML += `<option value="${p.id}" data-price="${p.sell_price}" data-stock="${p.stock}">
      ${p.category} - ${p.name} (库存:${p.stock})
    </option>`;
  });
  sel.onchange = () => {
    const opt = sel.options[sel.selectedIndex];
    document.getElementById('saleUnitPrice').value = opt.dataset.price;
  };
  if (sel.options.length > 0) {
    document.getElementById('saleUnitPrice').value = sel.options[0].dataset.price;
  }
}

async function loadCustomersForSale() {
  const customers = await api('/api/customers');
  const sel = document.getElementById('saleCustomerSelect');
  sel.innerHTML = '<option value="">-- 新客户/散客 --</option>';
  customers.forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${c.name} ${c.phone ? '('+c.phone+')' : ''}</option>`;
  });
}

function addSaleItem() {
  const pid = document.getElementById('saleProductSelect').value;
  if (!pid) { alert('请选择商品'); return; }
  const qty = parseInt(document.getElementById('saleQuantity').value);
  const price = parseFloat(document.getElementById('saleUnitPrice').value);
  if (!qty || qty < 1) { alert('数量必须大于0'); return; }
  if (isNaN(price)) { alert('请输入单价'); return; }
  const product = productCache.find(p => p.id == pid);
  const existing = saleItems.find(i => i.product_id == pid);
  if (existing) {
    existing.quantity += qty;
    existing.subtotal = Number((existing.quantity * existing.unit_price).toFixed(2));
  } else {
    saleItems.push({
      product_id: parseInt(pid), product_name: product.name,
      quantity: qty, unit_price: price,
      subtotal: Number((qty * price).toFixed(2))
    });
  }
  renderSaleItems();
}

function removeSaleItem(idx) { saleItems.splice(idx, 1); renderSaleItems(); }

function renderSaleItems() {
  const tbody = document.getElementById('saleItemsBody');
  tbody.innerHTML = '';
  let total = 0;
  saleItems.forEach((it, i) => {
    total += it.subtotal;
    tbody.innerHTML += `
      <tr>
        <td>${it.product_name}</td><td>${it.quantity}</td>
        <td>${fmt(it.unit_price)}</td><td>${fmt(it.subtotal)}</td>
        <td><button class="btn-danger" onclick="removeSaleItem(${i})">删除</button></td>
      </tr>`;
  });
  document.getElementById('saleTotal').textContent = fmt(total);
}

function clearSale() {
  saleItems = [];
  renderSaleItems();
  document.getElementById('saleWarnings').innerHTML = '';
  document.getElementById('saleCustomerName').value = '';
  document.getElementById('saleCustomerSelect').value = '';
}

async function checkStockAndSubmit() {
  if (saleItems.length === 0) { alert('请先添加商品'); return; }
  document.getElementById('saleWarnings').innerHTML = '';
  try {
    const check = await api('/api/sales/check-stock', {
      method: 'POST', body: JSON.stringify({ items: saleItems })
    });
    if (check.warnings.length > 0) {
      const goAhead = confirm(
        '⚠️ 库存警告：\n\n' + check.warnings.map(w => '• ' + w.message).join('\n')
        + '\n\n确定还要开单吗？'
      );
      if (!goAhead) return;
    }
    const customer_id = document.getElementById('saleCustomerSelect').value;
    const customer_name = document.getElementById('saleCustomerName').value.trim();
    const result = await api('/api/sales', {
      method: 'POST', body: JSON.stringify({
        customer_id: customer_id ? parseInt(customer_id) : null,
        customer_name: customer_name || null,
        items: saleItems
      })
    });
    document.getElementById('lastOrderResult').innerHTML = `
      <div class="success-box">
        <h4>✅ 开单成功</h4>
        <p><strong>订单号：</strong>#${result.orderId} &nbsp; <strong>客户：</strong>${result.customer_name}
           ${result.customer_id ? '（已保存到客户列表）' : ''} &nbsp; <strong>时间：</strong>${result.order_date}</p>
        <table class="data-table" style="margin-top:10px;">
          <thead><tr><th>商品</th><th>数量</th><th>单价</th><th>小计</th></tr></thead>
          <tbody>
            ${result.items.map(i => `<tr><td>${i.product_name}</td><td>${i.quantity}</td><td>${fmt(i.unit_price)}</td><td>${fmt(i.subtotal)}</td></tr>`).join('')}
          </tbody>
          <tfoot><tr><td colspan="3" style="text-align:right;font-weight:bold;">合计 / 利润</td>
            <td style="font-weight:bold;">${fmt(result.total_amount)} / <span style="color:#27ae60;">${fmt(result.total_profit)}</span></td></tr></tfoot>
        </table>
      </div>`;
    saleItems = [];
    renderSaleItems();
    document.getElementById('saleCustomerName').value = '';
    document.getElementById('saleCustomerSelect').value = '';
    loadProductsForSale();
    loadCustomersForSale();
  } catch(e) {
    document.getElementById('saleWarnings').innerHTML = `
      <div class="warning-box"><h4>❌ 开单失败</h4><p>${e.message}</p></div>`;
  }
}

async function loadCustomers() {
  const kw = document.getElementById('customerSearch').value.trim();
  const customers = await api('/api/customers' + (kw ? '?keyword=' + kw : ''));
  const tbody = document.getElementById('customerList');
  tbody.innerHTML = '';
  customers.forEach(c => {
    tbody.innerHTML += `
      <tr>
        <td>${c.id}</td><td>${c.name}</td><td>${c.phone || '-'}</td><td>${c.created_at}</td>
        <td><button class="btn-small" onclick="showCustomerHistory(${c.id}, '${c.name.replace(/'/g,"\\'")}')">查看记录</button></td>
      </tr>`;
  });
}
document.getElementById('customerSearch').oninput = loadCustomers;

async function addCustomer() {
  const name = prompt('请输入客户姓名：');
  if (!name) return;
  const phone = prompt('请输入客户电话（可选）：') || '';
  try {
    await api('/api/customers', { method: 'POST', body: JSON.stringify({ name, phone }) });
    loadCustomers();
  } catch(e) { alert(e.message); }
}

async function showCustomerHistory(id, name) {
  const hist = await api(`/api/customers/${id}/history`);
  const div = document.getElementById('customerHistory');
  div.innerHTML = `
    <h3>📋 ${name} 的消费记录</h3>
    <div class="summary-cards">
      <div class="summary-card"><div class="label">有效订单数</div><div class="value">${hist.orderCount}</div></div>
      <div class="summary-card sales"><div class="label">累计消费</div><div class="value">${fmt(hist.totalSpent)}</div></div>
      <div class="summary-card profit"><div class="label">贡献利润</div><div class="value">${fmt(hist.totalProfit)}</div></div>
      ${hist.totalRefund > 0 ? `<div class="summary-card"><div class="label">累计退货</div><div class="value" style="color:#e74c3c;">${fmt(hist.totalRefund)}</div></div>` : ''}
    </div>
    ${hist.orders.length === 0 ? '<p style="color:#888;">暂无消费记录</p>' :
      hist.orders.map(o => {
        const its = hist.items.filter(i => i.order_id === o.id);
        const refs = hist.refunds.filter(r => r.order_id === o.id);
        const isRefund = o.status === 'refunded';
        return `<div class="order-card ${isRefund ? 'order-refunded' : ''}">
          <div class="order-header">
            <span>
              订单 #${o.id} · ${o.order_date}
              ${isRefund ? '<span class="status-badge status-danger">已退货</span>' : ''}
              ${!isRefund ? `<button class="btn-danger" style="margin-left:8px;" onclick="openRefundModal(${o.id}, true, ${id}, '${name.replace(/'/g,"\\'")}')">退货</button>` : ''}
            </span>
            <span>${isRefund ? '已退款' : `合计 ${fmt(o.total_amount)} (利润 ${fmt(o.total_profit)})`}</span>
          </div>
          <div class="order-items">${its.map(i => `${i.product_name} x${i.quantity}`).join('，')}</div>
          ${refs.length > 0 ? `<div style="margin-top:6px;color:#e74c3c;font-size:13px;">↩️ 退货记录：${refs.map(r => `${r.product_name} x${r.quantity}(${fmt(r.refund_amount)})`).join('，')}</div>` : ''}
        </div>`;
      }).join('')}
  `;
  div.scrollIntoView({ behavior: 'smooth' });
}

async function openRefundModal(orderId, fromCustomer = false, customerId = null, customerName = null) {
  try {
    const order = await api(`/api/sales/${orderId}`);
    if (order.status === 'refunded') { alert('该订单已完全退货'); return; }
    refundingOrderId = orderId;
    refundQueue = [];
    window._refundCtx = { fromCustomer, customerId, customerName };
    document.getElementById('refundOrderInfo').innerHTML = `
      <strong>订单 #${order.id}</strong> · 客户：${order.customer_name} · 下单时间：${order.order_date}
      <br>当前订单金额：${fmt(order.total_amount)} &nbsp; 当前利润：${fmt(order.total_profit)}
    `;
    const list = document.getElementById('refundItemsList');
    list.innerHTML = '';
    order.items.forEach(it => {
      if (it.remaining_quantity <= 0) return;
      refundQueue.push({ sales_item_id: it.id, product_id: it.product_id, product_name: it.product_name, unit_price: it.unit_price, max_qty: it.remaining_quantity, qty: 0 });
      const idx = refundQueue.length - 1;
      list.innerHTML += `
        <div style="border:1px solid #eee;padding:10px;border-radius:6px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <strong>${it.product_name}</strong>
            <span style="color:#666;font-size:13px;">已买 ${it.quantity} 个，已退 ${it.refunded_quantity} 个，最多可退 <b style="color:#e74c3c;">${it.remaining_quantity}</b> 个，原售价：${fmt(it.unit_price)}</span>
          </div>
          <div class="form-row" style="margin-top:8px;margin-bottom:0;">
            <label>退货数量</label>
            <input type="number" min="0" max="${it.remaining_quantity}" value="0" id="rqty${idx}" oninput="updateRefundQueue(${idx})">
            <label>退款单价</label>
            <input type="number" step="0.01" min="0" max="${it.unit_price}" value="${it.unit_price}" id="rprice${idx}" oninput="updateRefundQueue(${idx})">
            <span id="rsub${idx}" style="color:#666;">小计：¥0.00</span>
          </div>
        </div>
      `;
    });
    document.getElementById('refundReason').value = '';
    if (list.innerHTML === '') {
      list.innerHTML = '<p style="color:#888;">此订单所有商品都已退完</p>';
    }
    document.getElementById('refundModal').style.display = 'flex';
  } catch(e) { alert(e.message); }
}

function closeRefundModal() {
  document.getElementById('refundModal').style.display = 'none';
  refundingOrderId = null;
  refundQueue = [];
}

function updateRefundQueue(idx) {
  const q = parseInt(document.getElementById('rqty' + idx).value) || 0;
  const p = parseFloat(document.getElementById('rprice' + idx).value) || 0;
  refundQueue[idx].qty = q;
  refundQueue[idx].refund_price = p;
  document.getElementById('rsub' + idx).textContent = '小计：' + fmt(q * p);
}

async function submitRefundItems() {
  const todo = refundQueue.filter(r => r.qty > 0 && r.qty <= r.max_qty);
  if (todo.length === 0) { alert('请至少选择一个退货商品并填写数量'); return; }
  const reason = document.getElementById('refundReason').value.trim();
  let totalRefund = 0;
  try {
    for (const r of todo) {
      const res = await api(`/api/sales/${refundingOrderId}/refund-item`, {
        method: 'POST',
        body: JSON.stringify({
          sales_item_id: r.sales_item_id,
          quantity: r.qty,
          unit_price: r.refund_price || r.unit_price,
          reason
        })
      });
      totalRefund += res.refund_amount;
    }
    closeRefundModal();
    alert(`✅ 退货完成！共退款 ${fmt(totalRefund)}`);
    const ctx = window._refundCtx || {};
    if (ctx.fromCustomer && ctx.customerId) {
      showCustomerHistory(ctx.customerId, ctx.customerName);
    } else {
      loadDailyReport();
    }
  } catch(e) { alert(e.message); }
}

async function refundOrder(id) {
  openRefundModal(id, false);
}

function renderReportCards(containerId, data) {
  document.getElementById(containerId).innerHTML = `
    <div class="summary-card"><div class="label">统计区间</div><div class="value" style="font-size:16px;">${data.dateRange || data.date}</div></div>
    <div class="summary-card"><div class="label">有效订单</div><div class="value">${data.orderCount}</div></div>
    ${data.refundedOrderCount > 0 ? `<div class="summary-card"><div class="label">整单退货</div><div class="value" style="color:#e74c3c;">${data.refundedOrderCount}</div></div>` : ''}
    <div class="summary-card sales"><div class="label">销售额</div><div class="value">${fmt(data.totalSales)}</div></div>
    <div class="summary-card profit"><div class="label">利润</div><div class="value">${fmt(data.totalProfit)}</div></div>
    ${data.totalRefund > 0 ? `<div class="summary-card"><div class="label">退货金额</div><div class="value" style="color:#e74c3c;">${fmt(data.totalRefund)}</div></div>` : ''}
  `;
}

function renderCategoryTable(tbodyId, summary) {
  document.getElementById(tbodyId).innerHTML = summary.length === 0
    ? '<tr><td colspan="5" style="color:#888;text-align:center;">暂无数据</td></tr>'
    : summary.map(c => {
        const rate = c.total > 0 ? ((c.profit / c.total) * 100).toFixed(1) + '%' : '-';
        return `<tr>
          <td><strong>${c.category}</strong></td>
          <td>${c.quantity}</td><td>${fmt(c.total)}</td>
          <td style="color:#27ae60;font-weight:bold;">${fmt(c.profit)}</td><td>${rate}</td>
        </tr>`;
      }).join('');
}

function renderProductTable(tbodyId, summary) {
  document.getElementById(tbodyId).innerHTML = summary.length === 0
    ? '<tr><td colspan="4" style="color:#888;text-align:center;">暂无数据</td></tr>'
    : summary.map(p => `<tr><td>${p.product_name}</td><td>${p.quantity}</td><td>${fmt(p.total)}</td><td>${fmt(p.profit)}</td></tr>`).join('');
}

function renderOrderList(containerId, orders, items, showRefundBtn = true) {
  document.getElementById(containerId).innerHTML = orders.length === 0
    ? '<p style="color:#888;">暂无订单</p>'
    : orders.map(o => {
        const its = items.filter(i => i.order_id === o.id);
        const isRefund = o.status === 'refunded';
        return `<div class="order-card ${isRefund ? 'order-refunded' : ''}">
          <div class="order-header">
            <span>#${o.id} · ${o.customer_name} · ${o.order_date}
              ${isRefund ? '<span class="status-badge status-danger">已退货</span>' : ''}
            </span>
            <span>
              ${isRefund ? '<span style="color:#e74c3c;">已退款</span>' :
                `${fmt(o.total_amount)} (利润 ${fmt(o.total_profit)})`}
              ${!isRefund && showRefundBtn ? `<button class="btn-danger" style="margin-left:8px;" onclick="openRefundModal(${o.id})">退货</button>` : ''}
            </span>
          </div>
          <div class="order-items">${its.map(i => `${i.product_name} x${i.quantity}(${fmt(i.subtotal)})`).join('，')}</div>
        </div>`;
      }).join('');
}

async function loadDailyReport() {
  const data = await api('/api/sales/today');
  renderReportCards('dailySummary', data);
  renderCategoryTable('categoryRankList', data.categorySummary);
  renderProductTable('productRankList', data.productSummary);
  renderOrderList('dailyOrders', data.orders, data.items, true);
}

async function loadRangeReport() {
  const s = document.getElementById('rangeStart').value;
  const e = document.getElementById('rangeEnd').value;
  const data = await api(`/api/sales/range?start=${s}&end=${e}`);
  renderReportCards('rangeSummary', data);
  renderCategoryTable('rangeCategoryList', data.categorySummary);
  renderProductTable('rangeProductList', data.productSummary);
  const tbody = document.getElementById('rangeRefundList');
  tbody.innerHTML = data.refunds.length === 0
    ? '<tr><td colspan="6" style="color:#888;text-align:center;">此区间暂无退货</td></tr>'
    : data.refunds.map(r => `<tr>
        <td>${r.refund_date}</td><td>#${r.order_id}</td>
        <td>${r.product_name}</td><td>${r.quantity}</td>
        <td style="color:#e74c3c;">${fmt(r.refund_amount)}</td><td>${r.reason || '-'}</td>
      </tr>`).join('');
}

async function loadSupplierSummary() {
  const rows = await api('/api/purchases/suppliers');
  const tbody = document.getElementById('supplierSummaryList');
  tbody.innerHTML = rows.length === 0
    ? '<tr><td colspan="5" style="color:#888;text-align:center;">暂无供应商数据，进货时填写供应商名称即可对账</td></tr>'
    : rows.map(r => `<tr>
        <td><strong>${r.supplier}</strong></td>
        <td>${r.purchase_count}</td><td>${r.total_quantity}</td>
        <td style="font-weight:bold;">${fmt(r.total_cost)}</td>
        <td><button class="btn-small" onclick="showSupplierDetail('${encodeURIComponent(r.supplier)}')">查看明细</button></td>
      </tr>`).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('supplierFilter').oninput = loadPurchaseList;
  document.getElementById('purchaseStart').onchange = loadPurchaseList;
  document.getElementById('purchaseEnd').onchange = loadPurchaseList;
});

async function loadPurchaseList() {
  const params = [];
  const kw = document.getElementById('supplierFilter').value.trim();
  const s = document.getElementById('purchaseStart').value;
  const e = document.getElementById('purchaseEnd').value;
  if (kw) params.push('supplier=' + encodeURIComponent(kw));
  if (s) params.push('startDate=' + s);
  if (e) params.push('endDate=' + e);
  const records = await api('/api/purchases' + (params.length ? '?' + params.join('&') : ''));
  const tbody = document.getElementById('purchaseList');
  const total = records.reduce((s, r) => s + r.total_cost, 0);
  tbody.innerHTML = records.length === 0
    ? '<tr><td colspan="6" style="color:#888;text-align:center;">暂无进货记录</td></tr>'
    : records.map(r => `<tr>
        <td>${r.purchase_date}</td><td>${r.product_name}</td>
        <td>${r.quantity}</td><td>${fmt(r.unit_cost)}</td>
        <td>${fmt(r.total_cost)}</td><td>${r.supplier || '-'}</td>
      </tr>`).join('') +
      (records.length > 0 ? `<tr style="background:#f8f9fa;font-weight:bold;">
        <td colspan="4" style="text-align:right;">合计：</td>
        <td>${fmt(total)}</td><td></td></tr>` : '');
}

async function showSupplierDetail(encodedName) {
  const data = await api('/api/purchases/supplier/' + encodedName);
  const name = decodeURIComponent(encodedName);
  const div = document.getElementById('supplierDetail');
  div.innerHTML = `
    <h3>🏭 ${name} 供货明细</h3>
    <div class="summary-cards">
      <div class="summary-card"><div class="label">采购次数</div><div class="value">${data.records.length}</div></div>
      <div class="summary-card"><div class="label">总件数</div><div class="value">${data.totalQty}</div></div>
      <div class="summary-card profit"><div class="label">总进货成本</div><div class="value">${fmt(data.totalCost)}</div></div>
    </div>
    <h4 style="margin-top:16px;">📦 供货商品汇总（按金额排序）</h4>
    <table class="data-table">
      <thead><tr><th>商品</th><th>总数量</th><th>总成本</th><th>平均单价</th></tr></thead>
      <tbody>
        ${data.productSummary.map(p => `<tr>
          <td>${p.product_name}</td><td>${p.quantity}</td>
          <td>${fmt(p.total_cost)}</td><td>${fmt(p.avg_cost)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <h4 style="margin-top:16px;">📝 每次进货记录</h4>
    <table class="data-table">
      <thead><tr><th>时间</th><th>商品</th><th>数量</th><th>单价</th><th>合计</th></tr></thead>
      <tbody>
        ${data.records.map(r => `<tr>
          <td>${r.purchase_date}</td><td>${r.product_name}</td>
          <td>${r.quantity}</td><td>${fmt(r.unit_cost)}</td><td>${fmt(r.total_cost)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  `;
  div.scrollIntoView({ behavior: 'smooth' });
}

async function loadAlerts() {
  const alerts = await api('/api/alerts/low-stock');
  document.getElementById('alertCount').innerHTML = alerts.length === 0
    ? '✅ 所有商品库存充足，无需进货'
    : `⚠️ 有 <strong style="color:#e74c3c;">${alerts.length}</strong> 个商品库存不足，需要进货：`;
  const tbody = document.getElementById('alertList');
  tbody.innerHTML = alerts.length === 0
    ? '<tr><td colspan="6" style="color:#888;text-align:center;">暂无预警</td></tr>'
    : alerts.map(p => {
        const pct = p.stock / p.low_stock_threshold;
        const status = pct < 0.5
          ? '<span class="status-badge status-danger">严重不足</span>'
          : '<span class="status-badge status-warning">库存偏低</span>';
        return `<tr>
          <td>${p.category}</td><td>${p.name}</td>
          <td class="low-stock">${p.stock}</td><td>${p.low_stock_threshold}</td>
          <td>${p.shelf || '-'}</td><td>${status}</td>
        </tr>`;
      }).join('');
}

loadProducts();
