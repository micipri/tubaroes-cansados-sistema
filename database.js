const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Database configuration via connection string (DATABASE_URL env var)
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.warn("WARNING: DATABASE_URL environment variable is not defined!");
}

const pool = new Pool({
    connectionString,
    // Enable SSL for production database connection
    ssl: connectionString && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1') ? {
        rejectUnauthorized: false
    } : false
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
});

async function createTables() {
    if (!connectionString) {
        console.warn("Skipping table creation: DATABASE_URL is not set.");
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Registrations
        await client.query(`
            CREATE TABLE IF NOT EXISTS registrations (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                unit_amount NUMERIC(10, 2) NOT NULL,
                total_amount NUMERIC(10, 2) NOT NULL,
                date TEXT NOT NULL
            )
        `);

        // Registrations Modality 2
        await client.query(`
            CREATE TABLE IF NOT EXISTS registrations_mod2 (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                cap_name TEXT NOT NULL,
                amount NUMERIC(10, 2) NOT NULL,
                has_receipt BOOLEAN NOT NULL DEFAULT FALSE,
                is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
                date TEXT NOT NULL
            )
        `);

        // Party tickets
        await client.query(`
            CREATE TABLE IF NOT EXISTS party_tickets (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                amount NUMERIC(10, 2) NOT NULL,
                date TEXT NOT NULL
            )
        `);

        // Store products
        await client.query(`
            CREATE TABLE IF NOT EXISTS store_products (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                stock INTEGER NOT NULL DEFAULT 0,
                cost_price NUMERIC(10, 2) NOT NULL,
                sell_price NUMERIC(10, 2) NOT NULL
            )
        `);

        // Store sales
        await client.query(`
            CREATE TABLE IF NOT EXISTS store_sales (
                id SERIAL PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
                quantity INTEGER NOT NULL,
                total_amount NUMERIC(10, 2) NOT NULL,
                date TEXT NOT NULL
            )
        `);

        // Party costs
        await client.query(`
            CREATE TABLE IF NOT EXISTS party_costs (
                id SERIAL PRIMARY KEY,
                description TEXT NOT NULL,
                amount NUMERIC(10, 2) NOT NULL,
                date TEXT NOT NULL
            )
        `);

        // Event costs
        await client.query(`
            CREATE TABLE IF NOT EXISTS event_costs (
                id SERIAL PRIMARY KEY,
                description TEXT NOT NULL,
                amount NUMERIC(10, 2) NOT NULL,
                date TEXT NOT NULL
            )
        `);

        // Sponsors
        await client.query(`
            CREATE TABLE IF NOT EXISTS sponsors (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                amount NUMERIC(10, 2) NOT NULL,
                date TEXT NOT NULL
            )
        `);

        // Users
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                is_master INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Seed master user
        const { rows } = await client.query("SELECT id FROM users WHERE username = 'michel'");
        if (rows.length === 0) {
            const hash = bcrypt.hashSync('tubaroes2026', 10);
            await client.query(
                "INSERT INTO users (username, password_hash, is_master) VALUES ('michel', $1, 1)",
                [hash]
            );
            console.log('Master user "michel" created in database.');
        }

        await client.query('COMMIT');
        console.log('Database tables created/verified successfully.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error during database schema creation:', err.message);
    } finally {
        client.release();
    }
}

// Automatically create tables on import if DATABASE_URL is present
createTables().catch(err => {
    console.error('Failed to initialize database tables:', err.message);
});

module.exports = pool;
