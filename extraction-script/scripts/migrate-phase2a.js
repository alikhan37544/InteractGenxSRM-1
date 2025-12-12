
const mysql = require('mysql2/promise');

async function migrate() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'admin',
        database: 'interact_gen',
    });

    try {
        console.log('Connected to MySQL server.');

        // Check if column exists or just run ALTER TABLE and ignore duplicate column error if lazy, 
        // but better to be safe.
        // For simplicity with mysql, we can try ADD COLUMN and catch error if it exists.

        try {
            await connection.query(`
            ALTER TABLE elements
            ADD COLUMN llm_context TEXT
        `);
            console.log("Added column 'llm_context' to 'elements' table.");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("Column 'llm_context' already exists.");
            } else {
                throw e;
            }
        }

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await connection.end();
    }
}

migrate();
