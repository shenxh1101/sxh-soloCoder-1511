const http = require('http');
const fs = require('fs');
function api(method, path, cb) {
  http.request({hostname:'127.0.0.1', port:3000, path, method}, r=>{
    let b='';r.on('data',c=>b+=c);r.on('end',()=>cb(b));
  }).end();
}
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
console.log('local today:', today);
api('GET', `/api/sales/range?start=${today}&end=${today}`, b=>{
  fs.writeFileSync('debug-report.json', b);
  const data = JSON.parse(b);
  console.log('totalSales=', data.totalSales, 'orders=', data.orders.length);
  data.orders.forEach(o=>console.log('  order', o.id, o.order_date, 'status=', o.status, 'amt=', o.total_amount));
});
