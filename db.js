// ===================================================================
// FinanceBot — db.js  (SQLite через встроенный node:sqlite)
// Предоставляет pg-совместимый интерфейс: db.query(sql, params)
// возвращает { rows }. Плейсхолдеры $1,$2… автоматически преобразуются в ?.
// ===================================================================
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'financebot.sqlite');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Преобразуем pg-плейсхолдеры $1,$2,… в позиционные ? и собираем параметры
function toSqliteParams(sql, params) {
  if (!params || !params.length) return { sql, params: [] };
  const out = sql.replace(/\$(\d+)/g, (m, n) => {
    const idx = parseInt(n, 10) - 1;
    return idx >= 0 && idx < params.length ? '?' : m;
  });
  return { sql: out, params: params.slice() };
}

// Совместимый с pg метод query. Поддерживает SELECT/INSERT/UPDATE/DELETE.
async function query(sql, params = []) {
  const { sql: sSql, params: sParams } = toSqliteParams(sql, params);
  const stmt = db.prepare(sSql);

  const upper = sSql.trim().toUpperCase();
  if (upper.startsWith('SELECT') || upper.startsWith('WITH') || upper.startsWith('PRAGMA')) {
    const rows = stmt.all(...sParams);
    return { rows };
  }
  // INSERT / UPDATE / DELETE
  const info = stmt.run(...sParams);
  let rows = [];
  if (/RETURNING/i.test(sSql)) {
    // node:sqlite run не возвращает строки; эмулируем через lastInsertRowid если нужно
    rows = [];
  }
  return { rows, rowCount: info.changes, lastID: info.lastInsertRowid };
}

// Для миграций: выполнить произвольный DDL/DML без обёртки
function exec(sql) {
  db.exec(sql);
}

module.exports = { db, query, exec, DB_PATH };
