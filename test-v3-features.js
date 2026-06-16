const http = require('http');

function api(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const safePath = new URL(path, 'http://127.0.0.1').pathname + new URL(path, 'http://127.0.0.1').search;
    const options = {
      hostname: '127.0.0.1', port: 3000, path: safePath, method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', (e) => { console.error('API ERROR path=', path, e.message); reject(e); });
    if (postData) req.write(postData);
    req.end();
  });
}

async function assert(cond, msg) {
  if (cond) console.log('  √ ' + msg);
  else { console.log('  ✗ ' + msg); process.exitCode = 1; }
}

(async () => {
  try {
    console.log('\n=== 验证1: 部分退货功能 ===\n');

    // 先开一单（张师傅买3个M8螺丝+2个铜合页）
    const products = (await api('GET', '/api/products')).data;
    const m8Screw = products.find(p => p.id === 3);
    const hinge = products.find(p => p.id === 7);
    const beforeStock = { m8: m8Screw.stock, hinge: hinge.stock };
    console.log(`  开单前库存: M8螺丝=${beforeStock.m8}, 铜合页=${beforeStock.hinge} 价格=(${m8Screw.sell_price},${hinge.sell_price})`);

    const orderResp = await api('POST', '/api/sales', {
      customer_name: '张师傅', customer_phone: '13900008888',
      items: [
        { product_id: m8Screw.id, quantity: 3, unit_price: m8Screw.sell_price },
        { product_id: hinge.id, quantity: 2, unit_price: hinge.sell_price }
      ]
    });
    console.log('  开单HTTP状态:', orderResp.status, JSON.stringify(orderResp.data).slice(0,200));
    if (orderResp.status !== 200) { console.log('  开单失败:', orderResp.data); throw new Error('开单失败'); }
    const order = orderResp.data;
    const orderId = order.orderId;
    console.log(`  已开订单: #${orderId} 合计¥${order.total_amount} 利润¥${order.total_profit}`);

    const orderDetail = (await api('GET', `/api/sales/${orderId}`)).data;
    console.log(`  订单项: ${orderDetail.items.map(i => i.product_name+'x'+i.quantity+'剩'+i.remaining_quantity).join(', ')}`);
    assert(orderDetail.items.find(i => i.product_id === m8Screw.id).remaining_quantity === 3, 'M8螺丝剩余可退=3');
    assert(orderDetail.items.find(i => i.product_id === hinge.id).remaining_quantity === 2, '铜合页剩余可退=2');

    const screwItem = orderDetail.items.find(i => i.product_id === m8Screw.id);
    const refund1 = (await api('POST', `/api/sales/${orderId}/refund-item`, {
      sales_item_id: screwItem.id, quantity: 1,
      unit_price: screwItem.unit_price, reason: '太大不合适'
    })).data;
    console.log(`  退货1个螺丝: 退款¥${refund1.refund_amount} 全部退完?=${refund1.fully_refunded}`);
    assert(refund1.fully_refunded === false, '未全退完');
    assert(Math.abs(refund1.refund_amount - screwItem.unit_price) < 0.01, '退款金额正确');

    const orderDetail2 = (await api('GET', `/api/sales/${orderId}`)).data;
    const screwRemaining = orderDetail2.items.find(i => i.product_id === m8Screw.id).remaining_quantity;
    console.log(`  螺丝最新剩余可退: ${screwRemaining}`);
    assert(screwRemaining === 2, '螺丝剩2个可退');

    const afterScrew = (await api('GET', `/api/products/${m8Screw.id}`)).data;
    console.log(`  库存检查: M8螺丝 原${beforeStock.m8}-3+1=${beforeStock.m8-2}, 实际=${afterScrew.stock}`);
    assert(afterScrew.stock === beforeStock.m8 - 2, '库存正确：扣3加1');

    console.log('\n=== 验证2: 日期范围报表 ===\n');

    const todayD = new Date();
    const today = `${todayD.getFullYear()}-${String(todayD.getMonth()+1).padStart(2,'0')}-${String(todayD.getDate()).padStart(2,'0')}`;
    const reportResp = await api('GET', `/api/sales/range?start=${today}&end=${today}`);
    console.log('  区间报表HTTP状态:', reportResp.status);
    console.log('  区间报表字段:', Object.keys(reportResp.data));
    const report = reportResp.data;
    console.log(`  今日区间报表: 销售额¥${report.totalSales} 利润¥${report.totalProfit} 退货¥${report.totalRefund}`);
    console.log(`  分类汇总: ${report.categorySummary.slice(0,2).map(c => c.category+'¥'+c.profit).join(', ')}...`);
    assert(report.totalSales > 0, '区间销售额>0');
    assert(report.totalRefund >= refund1.refund_amount, '退货金额>=部分退款');
    assert(report.categorySummary.length >= 2, '分类汇总至少2类');

    console.log('\n=== 验证3: 供应商对账 ===\n');

    await api('POST', '/api/purchases', {
      product_id: m8Screw.id, quantity: 50, unit_cost: 0.45,
      supplier: '张师傅五金批发', purchase_date: today
    });
    await api('POST', '/api/purchases', {
      product_id: hinge.id, quantity: 30, unit_cost: 3.2,
      supplier: '张师傅五金批发', purchase_date: today
    });

    const suppliers = (await api('GET', '/api/purchases/suppliers')).data;
    const zsf = suppliers.find(s => s.supplier && s.supplier.includes('张师傅'));
    console.log(`  张师傅五金: 供货${zsf.purchase_count}次 总金额¥${zsf.total_cost}`);
    assert(zsf.purchase_count >= 2, '供货次数>=2');

    const detail = (await api('GET', '/api/purchases/supplier/' + encodeURIComponent('张师傅五金批发'))).data;
    console.log(`  供应商商品汇总: ${detail.productSummary.map(p => p.product_name+'x'+p.quantity+'¥'+p.total_cost).join(', ')}`);
    assert(detail.productSummary.length >= 2, '供货商品>=2种');
    assert(detail.totalCost > 0, '供应商总进货成本>0');

    console.log('\n=== 验证4: 客户历史含退货记录 ===\n');

    const customers = (await api('GET', '/api/customers?keyword=' + encodeURIComponent('张师傅'))).data;
    const zsfCust = customers[0];
    const history = (await api('GET', `/api/customers/${zsfCust.id}/history`)).data;
    console.log(`  张师傅累计消费: ¥${history.totalSpent}  累计退货: ¥${history.totalRefund}`);
    console.log(`  历史订单数: ${history.orders.length}  退货记录数: ${history.refunds.length}`);
    assert(history.refunds.length >= 1, '至少1条退货记录');
    assert(history.totalSpent < (order.total_amount + 100), '累计消费因退货而比原订单少或合理');
    assert(history.totalRefund >= refund1.refund_amount, '累计退货金额>=本次部分退款');

    console.log('\n=== 验证5: 按条件查进货记录 ===\n');
    const filtered = (await api('GET', `/api/purchases?supplier=${encodeURIComponent('张师傅五金批发')}&startDate=${today}&endDate=${today}`)).data;
    console.log(`  筛选进货记录: 找到${filtered.length}条`);
    assert(filtered.length >= 2, '按供应商+日期筛选正确');

    console.log('\n========================================');
    if (process.exitCode === 1) console.log('部分断言失败！');
    else console.log('所有验证通过 ✓');
    console.log('========================================\n');

  } catch (e) {
    console.error('测试出错:', e.message);
    process.exit(1);
  }
})();
