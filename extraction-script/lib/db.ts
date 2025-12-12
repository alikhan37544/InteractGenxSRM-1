
import mysql from 'mysql2/promise';


const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'admin',
    database: 'interact_gen',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

let schemaChecked = false;

async function ensureSchema() {
    if (schemaChecked) return;

    // We need a separate connection to check/create DB if it doesn't exist
    // But pool is already configured with database 'interact_gen'.
    // Use a temp connection for DB creation check.
    const tempConnection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'admin'
    });

    try {
        await tempConnection.query(`CREATE DATABASE IF NOT EXISTS interact_gen`);

        // Now ensure tables exist within the pool's DB
        // We can use the pool now that DB exists (or should)

        // Table: scraped_pages
        await pool.query(`
          CREATE TABLE IF NOT EXISTS scraped_pages (
            url VARCHAR(768) PRIMARY KEY,
            full_url TEXT,
            title VARCHAR(512),
            last_scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `);

        // Table: elements
        await pool.query(`
          CREATE TABLE IF NOT EXISTS elements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            page_url VARCHAR(768),
            type VARCHAR(50),
            content JSON,
            selectors JSON,
            attributes JSON,
            geometry JSON,
            llm_context TEXT,
            FOREIGN KEY (page_url) REFERENCES scraped_pages(url) ON DELETE CASCADE
          )
        `);

        // Table: context
        await pool.query(`
          CREATE TABLE IF NOT EXISTS context (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255),
            data JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Ensure llm_context column exists (for migration safety if table existed but column didn't)
        try {
            await pool.query(`ALTER TABLE elements ADD COLUMN llm_context TEXT`);
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') {
                // Ignore duplicate column error, rethrow others
                if (!e.message.includes("Duplicate column name")) {
                    // console.error("Column add warning:", e.message); 
                }
            }
        }

        schemaChecked = true;
        console.log("Database schema verified.");

    } catch (error) {
        console.error("Schema initialization failed:", error);
    } finally {
        await tempConnection.end();
    }
}

export async function query(sql: string, params: any[] = []) {
    if (!schemaChecked) await ensureSchema();

    try {
        const [results] = await pool.execute(sql, params);
        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

export default pool;
