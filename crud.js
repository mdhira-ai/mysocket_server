// crud.js
// Reusable CRUD functions for SQLite

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, 'my.db');

function getDb() {
    return new sqlite3.Database(DB_PATH);
}

// Create
function create(table, data, callback) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => '?').join(', ');
    // Escape column names with square brackets to handle reserved keywords
    const escapedKeys = keys.map(key => `[${key}]`).join(', ');
    const sql = `INSERT INTO ${table} (${escapedKeys}) VALUES (${placeholders})`;
    const db = getDb();
    db.run(sql, values, function(err) {
        db.close();
        callback(err, this ? this.lastID : null);
    });
}

// Read (all or by condition)
function read(table, where = '', params = [], callback) {
    const sql = `SELECT * FROM ${table} ${where}`;
    const db = getDb();
    db.all(sql, params, (err, rows) => {
        db.close();
        callback(err, rows);
    });
}

// Update
function update(table, data, where, params, callback) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    // Escape column names with square brackets to handle reserved keywords
    const setClause = keys.map(k => `[${k}] = ?`).join(', ');
    const sql = `UPDATE ${table} SET ${setClause} ${where}`;
    const db = getDb();
    db.run(sql, [...values, ...params], function(err) {
        db.close();
        callback(err, this ? this.changes : null);
    });
}

// Delete
function remove(table, where, params, callback) {
    const sql = `DELETE FROM ${table} ${where}`;
    const db = getDb();
    db.run(sql, params, function(err) {
        db.close();
        callback(err, this ? this.changes : null);
    });
}







module.exports = {
    create,
    read,
    update,
    remove
};
