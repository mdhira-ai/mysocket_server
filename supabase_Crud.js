const supabase = require("./supaconnection");


// Create
async function create_sup(table, data, callback) {
    const { data: result, error } = await supabase.from(table).insert(data);
    callback(error, result ? result[0].id : null);
}

// Read (all or by condition)
async function read_sup(table, where = '', params = [], callback) {
    let query = supabase.from(table).select('*');
    if (where) {
        // Simple parser for where clause like "WHERE column = ?"
        const match = where.match(/WHERE\s+(\w+)\s*=\s*\?/i);
        if (match) {
            query = query.eq(match[1], params[0]);
        }
    }
    const { data: rows, error } = await query;
    callback(error, rows);
}

// Update
async function update_sup(table, data, where, params, callback) {
    let query = supabase.from(table);   
    if (where) {
        const match = where.match(/WHERE\s+(\w+)\s*=\s*\?/i);
        if (match) {
            query = query.update(data).eq(match[1], params[0]);
        }
    }
    const { error, count } = await query;
    callback(error, count);
}

// Delete
async function remove_sup(table, where, params, callback) {
    let query = supabase.from(table);   
    if (where) {
        const match = where.match(/WHERE\s+(\w+)\s*=\s*\?/i);
        if (match) {
            query = query.eq(match[1], params[0]);
        }
    }
    const { error, count } = await query.delete();
    callback(error, count);
}

module.exports = {
    create_sup,
    read_sup,
    update_sup,
    remove_sup
};