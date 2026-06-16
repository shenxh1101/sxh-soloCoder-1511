const Database = require('better-sqlite3');
const db = new Database('./data.db');
const fs = require('fs');

const orders = db.prepare('SELECT id, order_date, date(order_date) as d, total_amount, status FROM sales_orders').all();
const last = db.prepare('SELECT datetime(\'now\',\'localtime\') as now, date(\'now\',\'localtime\') as today').get();
const result = { db_now: last.now, db_today: last.today, orders };
fs.writeFileSync('debug-db.json', JSON.stringify(result, null, 2));
console.log('written', orders.length, 'orders to debug-db.json');
