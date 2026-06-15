const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// Resolve database path — default to /app/data (Volume mount) with fallback
let dbPath;
if (process.env.DB_PATH) {
    // Explicit env var takes precedence
    const targetDir = path.dirname(path.resolve(process.env.DB_PATH));
    if (!fs.existsSync(targetDir)) {
        try { fs.mkdirSync(targetDir, { recursive: true }); dbPath = path.resolve(process.env.DB_PATH); }
        catch (e) { console.warn(`Cannot create DB dir ${targetDir}, using app dir:`, e.message); }
    } else {
        dbPath = path.resolve(process.env.DB_PATH);
    }
}
if (!dbPath) {
    // Default: try /app/data (Railway Volume), fall back to __dirname
    const volumeDir = '/app/data';
    const fallbackDir = __dirname;
    const chosenDir = fs.existsSync(volumeDir) ? volumeDir : (() => {
        try { fs.mkdirSync(volumeDir, { recursive: true }); return volumeDir; } catch(e) { return fallbackDir; }
    })();
    dbPath = path.join(chosenDir, 'database.sqlite');
}
console.log('Database path:', dbPath);
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
            has_store_coupon BOOLEAN NOT NULL DEFAULT 0,
            has_beer_voucher BOOLEAN NOT NULL DEFAULT 0,
            date TEXT NOT NULL
        )`, () => {
            db.all("PRAGMA table_info(party_tickets)", (err, columns) => {
                if (!err && columns) {
                    const hasCoupon = columns.some(col => col.name === 'has_store_coupon');
                    if (!hasCoupon) {
                        db.run("ALTER TABLE party_tickets ADD COLUMN has_store_coupon BOOLEAN NOT NULL DEFAULT 0");
                    }
                    const hasVoucher = columns.some(col => col.name === 'has_beer_voucher');
                    if (!hasVoucher) {
                        db.run("ALTER TABLE party_tickets ADD COLUMN has_beer_voucher BOOLEAN NOT NULL DEFAULT 0");
                    }
                }
            });
        });

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
            buyer_name TEXT DEFAULT 'Anônimo',
            quantity INTEGER NOT NULL,
            discount REAL NOT NULL DEFAULT 0,
            payment_method TEXT DEFAULT 'Não informado',
            total_amount REAL NOT NULL,
            date TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES store_products (id)
        )`, () => {
            // Migration: Add discount, payment_method, and buyer_name columns to existing online databases
            db.all("PRAGMA table_info(store_sales)", (err, columns) => {
                if (!err && columns) {
                    const hasDiscount = columns.some(col => col.name === 'discount');
                    if (!hasDiscount) {
                        db.run("ALTER TABLE store_sales ADD COLUMN discount REAL NOT NULL DEFAULT 0", (err) => {
                            if (err) console.error("Migration Error (store_sales discount):", err.message);
                            else console.log("Migration: Added 'discount' column to store_sales.");
                        });
                    }
                    const hasPaymentMethod = columns.some(col => col.name === 'payment_method');
                    if (!hasPaymentMethod) {
                        db.run("ALTER TABLE store_sales ADD COLUMN payment_method TEXT DEFAULT 'Não informado'", (err) => {
                            if (err) console.error("Migration Error (store_sales payment_method):", err.message);
                            else console.log("Migration: Added 'payment_method' column to store_sales.");
                        });
                    }
                    const hasBuyerName = columns.some(col => col.name === 'buyer_name');
                    if (!hasBuyerName) {
                        db.run("ALTER TABLE store_sales ADD COLUMN buyer_name TEXT DEFAULT 'Anônimo'", (err) => {
                            if (err) console.error("Migration Error (store_sales buyer_name):", err.message);
                            else console.log("Migration: Added 'buyer_name' column to store_sales.");
                        });
                    }
                }
            });
        });

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

        // Secret Survey
        db.run(`CREATE TABLE IF NOT EXISTS secret_survey (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            will_go BOOLEAN NOT NULL,
            companions INTEGER NOT NULL DEFAULT 0,
            suggestion TEXT,
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
