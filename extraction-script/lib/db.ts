
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

        // Table: scraped_pages - Enhanced with AI enrichment tracking
        await pool.query(`
          CREATE TABLE IF NOT EXISTS scraped_pages (
            url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_general_ci PRIMARY KEY,
            full_url TEXT,
            title VARCHAR(512),
            last_scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            ai_enrichment_status ENUM('none', 'partial', 'full') DEFAULT 'none',
            enriched_at TIMESTAMP NULL,
            element_count INT DEFAULT 0,
            enriched_element_count INT DEFAULT 0,
            first_scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            scrape_count INT DEFAULT 1,
            notes TEXT
          )
        `);

        // Table: elements
        await pool.query(`
          CREATE TABLE IF NOT EXISTS elements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            page_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_general_ci,
            type VARCHAR(50),
            content JSON,
            selectors JSON,
            attributes JSON,
            geometry JSON,
            llm_context TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (page_url) REFERENCES scraped_pages(url) ON DELETE CASCADE
          )
        `);

        // Table: context - Persistent AI context storage
        await pool.query(`
          CREATE TABLE IF NOT EXISTS context (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255),
            data JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `);

        // Table: scraping_history - Track all scraping events
        await pool.query(`
          CREATE TABLE IF NOT EXISTS scraping_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            page_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_general_ci,
            action VARCHAR(50) NOT NULL,
            element_count INT DEFAULT 0,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (page_url) REFERENCES scraped_pages(url) ON DELETE CASCADE
          )
        `);

        // Table: ai_analysis_log - Track AI enrichment runs
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ai_analysis_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            page_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_general_ci,
            elements_processed INT DEFAULT 0,
            elements_enriched INT DEFAULT 0,
            model_used VARCHAR(100),
            success BOOLEAN DEFAULT true,
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (page_url) REFERENCES scraped_pages(url) ON DELETE CASCADE
          )
        `);

        // Migration: Add new columns to scraped_pages if they don't exist
        const columnsToAdd = [
            { name: 'ai_enrichment_status', def: "ENUM('none', 'partial', 'full') DEFAULT 'none'" },
            { name: 'enriched_at', def: 'TIMESTAMP NULL' },
            { name: 'element_count', def: 'INT DEFAULT 0' },
            { name: 'enriched_element_count', def: 'INT DEFAULT 0' },
            { name: 'first_scraped_at', def: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
            { name: 'scrape_count', def: 'INT DEFAULT 1' },
            { name: 'notes', def: 'TEXT' }
        ];

        for (const col of columnsToAdd) {
            try {
                await pool.query(`ALTER TABLE scraped_pages ADD COLUMN ${col.name} ${col.def}`);
            } catch (e: any) {
                // Ignore duplicate column errors
                if (!e.message.includes("Duplicate column name") && e.code !== 'ER_DUP_FIELDNAME') {
                    console.error(`Column add warning for ${col.name}:`, e.message);
                }
            }
        }

        // Ensure llm_context column exists in elements (for migration safety)
        try {
            await pool.query(`ALTER TABLE elements ADD COLUMN llm_context TEXT`);
        } catch (e: any) {
            if (!e.message.includes("Duplicate column name") && e.code !== 'ER_DUP_FIELDNAME') {
                console.error("Column add warning:", e.message);
            }
        }

        // Ensure created_at column exists in elements
        try {
            await pool.query(`ALTER TABLE elements ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        } catch (e: any) {
            if (!e.message.includes("Duplicate column name") && e.code !== 'ER_DUP_FIELDNAME') {
                console.error("Column add warning:", e.message);
            }
        }

        // Ensure updated_at column exists in context
        try {
            await pool.query(`ALTER TABLE context ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
        } catch (e: any) {
            if (!e.message.includes("Duplicate column name") && e.code !== 'ER_DUP_FIELDNAME') {
                // Ignore
            }
        }

        // Migration: widen URL columns so long URLs (e.g. search result pages)
        // fit. utf8mb4 VARCHAR(768) is the maximum for an indexed column
        // (3072 bytes); ascii uses 1 byte per char, allowing up to 3072 chars.
        try {
            const [fkRows]: any = await pool.query(`
                SELECT TABLE_NAME, CONSTRAINT_NAME
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE REFERENCED_TABLE_SCHEMA = DATABASE()
                  AND REFERENCED_TABLE_NAME = 'scraped_pages'
                  AND REFERENCED_COLUMN_NAME = 'url'
            `);
            for (const row of fkRows) {
                try {
                    await pool.query(`ALTER TABLE \`${row.TABLE_NAME}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``);
                } catch (e: any) {
                    // Ignore if the constraint is already gone
                }
            }

            await pool.query(`ALTER TABLE scraped_pages MODIFY url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL`);

            const referencingTables = ['elements', 'scraping_history', 'ai_analysis_log'];
            for (const table of referencingTables) {
                try {
                    await pool.query(`ALTER TABLE \`${table}\` MODIFY page_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_general_ci`);
                } catch (e: any) {
                    console.error(`URL column migration warning for ${table}:`, e.message);
                }
            }

            const fkDefs = [
                { table: 'elements', name: 'fk_elements_page_url' },
                { table: 'scraping_history', name: 'fk_scraping_history_page_url' },
                { table: 'ai_analysis_log', name: 'fk_ai_analysis_log_page_url' }
            ];
            for (const fk of fkDefs) {
                try {
                    await pool.query(`ALTER TABLE \`${fk.table}\` ADD CONSTRAINT \`${fk.name}\` FOREIGN KEY (page_url) REFERENCES scraped_pages(url) ON DELETE CASCADE`);
                } catch (e: any) {
                    // Ignore duplicate constraint / missing table
                }
            }
        } catch (e: any) {
            console.error("URL column migration warning:", e.message);
        }

        schemaChecked = true;
        console.log("Database schema verified and migrated.");

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
