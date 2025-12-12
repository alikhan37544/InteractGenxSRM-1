
const mysql = require('mysql2/promise');

async function initDB() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'admin',
    });

    try {
        console.log('Connected to MySQL server.');

        await connection.query('CREATE DATABASE IF NOT EXISTS interact_gen');
        console.log('Database interact_gen created or already exists.');

        await connection.query('USE interact_gen');

        // Table: context (Empty as requested)
        await connection.query(`
      CREATE TABLE IF NOT EXISTS context (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        console.log('Table context created.');

        // Table: scraped_pages
        await connection.query(`
      CREATE TABLE IF NOT EXISTS scraped_pages (
        url VARCHAR(768) PRIMARY KEY,
        full_url TEXT,
        title VARCHAR(512),
        last_scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
        console.log('Table scraped_pages created.');

        // Table: elements
        await connection.query(`
      CREATE TABLE IF NOT EXISTS elements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        page_url VARCHAR(768),
        type VARCHAR(50),
        content JSON,
        selectors JSON,
        attributes JSON,
        geometry JSON,
        FOREIGN KEY (page_url) REFERENCES scraped_pages(url) ON DELETE CASCADE
      )
    `);
        console.log('Table elements created.');

    } catch (err) {
        console.error('Error initializing database:', err);
    } finally {
        await connection.end();
    }
}

initDB();
