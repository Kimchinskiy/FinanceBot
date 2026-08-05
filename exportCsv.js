// ===================================================================
// FinanceBot — exportCsv.js
// Выгрузка данных пользователя в CSV (открывается в Excel/Google Таблицах).
// Без сторонних библиотек — CSV собирается вручную по RFC 4180.
// ===================================================================
const express = require('express');
const router = express.Router();

const TABLES = {
  incomes: { table: 'incomes', columns: ['datetime', 'amount', 'category', 'description', 'source'] },
  expenses: { table: 'expenses', columns: ['datetime', 'amount', 'category', 'description', 'source'] },
  mandatory: { table: 'mandatory_payments', columns: ['name', 'amount', 'category', 'day', 'type', 'status', 'source'] },
  debts: { table: 'debts', columns: ['person', 'amount', 'direction', 'status', 'due_date', 'note', 'source'] },
  'credit-cards': { table: 'credit_cards', columns: ['name', 'limit_amount', 'balance', 'closing_date', 'payment_date'] },
  goals: { table: 'goals', columns: ['title', 'target_amount', 'current_amount', 'deadline'] },
};

function csvEscape(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // Защита от formula injection: если значение начинается с =,+,-,@, Excel/Sheets
  // может интерпретировать его как формулу при открытии файла. Ведущий апостроф
  // помечает содержимое как текст и не влияет на визуальное отображение в таблицах.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map(c => csvEscape(row[c])).join(','));
  }
  return lines.join('\r\n');
}

router.get('/:type', async (req, res) => {
  const { query } = req.app.locals.db;
  const spec = TABLES[req.params.type];
  if (!spec) return res.status(404).json({ error: 'Неизвестный тип экспорта' });
  try {
    const result = await query(`SELECT * FROM ${spec.table} WHERE user_id = ?`, [req.userId]);
    const csv = toCsv(result.rows, spec.columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.csv"`);
    res.send('﻿' + csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
