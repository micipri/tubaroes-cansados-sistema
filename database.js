const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

// DB_PATH env var allows Railway volume persistence (ex: /data/database.sqlite)
// Falls back to local file for development
const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        createTables();
    }
});

function createTables() {
    db.serialize(() => {
        // Registrations (Batches)
        db.run(`CREATE TABLE IF NOT EXISTS registrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_amount REAL NOT NULL,
            total_amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Registrations Modality 2 (Individual)
        db.run(`CREATE TABLE IF NOT EXISTS registrations_mod2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            cap_name TEXT NOT NULL,
            amount REAL NOT NULL,
            has_receipt BOOLEAN NOT NULL DEFAULT 0,
            is_confirmed BOOLEAN NOT NULL DEFAULT 0,
            date TEXT NOT NULL
        )`);

        // Party tickets
        db.run(`CREATE TABLE IF NOT EXISTS party_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Store Products
        db.run(`CREATE TABLE IF NOT EXISTS store_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            stock INTEGER NOT NULL DEFAULT 0,
            cost_price REAL NOT NULL,
            sell_price REAL NOT NULL
        )`);

        // Store Sales
        db.run(`CREATE TABLE IF NOT EXISTS store_sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            total_amount REAL NOT NULL,
            date TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES store_products (id)
        )`);

        // Party Costs
        db.run(`CREATE TABLE IF NOT EXISTS party_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Event Costs
        db.run(`CREATE TABLE IF NOT EXISTS event_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Sponsors
        db.run(`CREATE TABLE IF NOT EXISTS sponsors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Users (for system access)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_master INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`, (err) => {
            if (err) {
                console.error('Error creating users table:', err.message);
                return;
            }
            // Seed master user if not exists
            db.get("SELECT id FROM users WHERE username = 'michel'", (err, row) => {
                if (!row) {
                    const hash = bcrypt.hashSync('tubaroes2026', 10);
                    db.run(
                        "INSERT INTO users (username, password_hash, is_master) VALUES (?, ?, 1)",
                        ['michel', hash],
                        (err) => {
                            if (err) console.error('Error seeding master user:', err.message);
                            else console.log('Master user "michel" created.');
                        }
                    );
                }
            });
        });

        console.log('Database tables created/verified successfully.');
    });
}

module.exports = db;
