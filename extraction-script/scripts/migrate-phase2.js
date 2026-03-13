/**
 * Migration Script for Phase 2 Enhancement
 * 
 * This script migrates existing data to the new schema while preserving all old data.
 * Run with: node scripts/migrate-phase2.js
 * 
 * What it does:
 * 1. Creates new tables (scraping_history, ai_analysis_log)
 * 2. Adds new columns to scraped_pages (if not exists)
 * 3. Backfills element counts from existing elements
 * 4. Sets enrichment status based on existing llm_context data
 */

const mysql = require('mysql2/promise');

async function migrate() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'admin',
        database: 'interact_gen'
    });

    console.log('🔄 Starting Phase 2 Migration...\n');

    try {
        // Step 1: Create new tables
        console.log('📦 Step 1: Creating new tables...');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS scraping_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                page_url VARCHAR(768),
                action VARCHAR(50) NOT NULL,
                element_count INT DEFAULT 0,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (page_url) REFERENCES scraped_pages(url) ON DELETE CASCADE
            )
        `);
        console.log('   ✓ scraping_history table created');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS ai_analysis_log (
                id INT AUTO_INCREMENT PRIMARY KEY,
                page_url VARCHAR(768),
                elements_processed INT DEFAULT 0,
                elements_enriched INT DEFAULT 0,
                model_used VARCHAR(100),
                success BOOLEAN DEFAULT true,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (page_url) REFERENCES scraped_pages(url) ON DELETE CASCADE
            )
        `);
        console.log('   ✓ ai_analysis_log table created\n');

        // Step 2: Add new columns to scraped_pages (safe migration)
        console.log('📦 Step 2: Adding new columns to scraped_pages...');

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
                await connection.query(`ALTER TABLE scraped_pages ADD COLUMN ${col.name} ${col.def}`);
                console.log(`   ✓ Added column: ${col.name}`);
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME' || e.message.includes('Duplicate column')) {
                    console.log(`   ⏭️  Column already exists: ${col.name}`);
                } else {
                    throw e;
                }
            }
        }

        // Add created_at to elements if not exists
        try {
            await connection.query(`ALTER TABLE elements ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
            console.log('   ✓ Added created_at to elements');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME' || e.message.includes('Duplicate column')) {
                console.log('   ⏭️  created_at already exists in elements');
            } else {
                throw e;
            }
        }

        // Add updated_at to context if not exists
        try {
            await connection.query(`ALTER TABLE context ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
            console.log('   ✓ Added updated_at to context');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME' || e.message.includes('Duplicate column')) {
                console.log('   ⏭️  updated_at already exists in context');
            } else {
                throw e;
            }
        }
        console.log('');

        // Step 3: Backfill element counts
        console.log('📦 Step 3: Backfilling element counts...');
        
        const [pages] = await connection.query('SELECT url FROM scraped_pages');
        
        for (const page of pages) {
            // Count total elements
            const [countResult] = await connection.query(
                'SELECT COUNT(*) as count FROM elements WHERE page_url = ?',
                [page.url]
            );
            const elementCount = countResult[0].count;

            // Count enriched elements (those with llm_context)
            const [enrichedResult] = await connection.query(
                "SELECT COUNT(*) as count FROM elements WHERE page_url = ? AND llm_context IS NOT NULL AND llm_context != ''",
                [page.url]
            );
            const enrichedCount = enrichedResult[0].count;

            // Determine enrichment status
            let enrichmentStatus = 'none';
            if (enrichedCount > 0) {
                enrichmentStatus = enrichedCount >= elementCount ? 'full' : 'partial';
            }

            // Update scraped_pages
            await connection.query(
                `UPDATE scraped_pages 
                 SET element_count = ?, enriched_element_count = ?, ai_enrichment_status = ?
                 WHERE url = ?`,
                [elementCount, enrichedCount, enrichmentStatus, page.url]
            );
        }
        console.log(`   ✓ Updated ${pages.length} pages with element counts\n`);

        // Step 4: Create history entries for existing pages
        console.log('📦 Step 4: Creating initial history entries...');
        
        for (const page of pages) {
            // Check if history already exists
            const [existingHistory] = await connection.query(
                'SELECT id FROM scraping_history WHERE page_url = ? LIMIT 1',
                [page.url]
            );
            
            if (existingHistory.length === 0) {
                // Get element count
                const [countResult] = await connection.query(
                    'SELECT element_count FROM scraped_pages WHERE url = ?',
                    [page.url]
                );
                
                await connection.query(
                    `INSERT INTO scraping_history (page_url, action, element_count, notes)
                     VALUES (?, 'scrape', ?, 'Migrated from existing data')`,
                    [page.url, countResult[0]?.element_count || 0]
                );
            }
        }
        console.log(`   ✓ Created history entries for ${pages.length} pages\n`);

        // Step 5: Summary
        console.log('✅ Migration Complete!\n');
        
        const [stats] = await connection.query(`
            SELECT 
                COUNT(*) as total_pages,
                SUM(CASE WHEN ai_enrichment_status = 'full' THEN 1 ELSE 0 END) as fully_enriched,
                SUM(CASE WHEN ai_enrichment_status = 'partial' THEN 1 ELSE 0 END) as partially_enriched,
                SUM(CASE WHEN ai_enrichment_status = 'none' THEN 1 ELSE 0 END) as not_enriched
            FROM scraped_pages
        `);
        
        console.log('📊 Database Summary:');
        console.log(`   Total Pages: ${stats[0].total_pages}`);
        console.log(`   Fully Enriched: ${stats[0].fully_enriched}`);
        console.log(`   Partially Enriched: ${stats[0].partially_enriched}`);
        console.log(`   Not Enriched: ${stats[0].not_enriched}`);
        console.log('\n🎉 All your data has been preserved and migrated!');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        throw error;
    } finally {
        await connection.end();
    }
}

migrate().catch(console.error);
