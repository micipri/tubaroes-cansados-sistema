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
        // Athletes (Inscrições do Novo Evento)
        db.run(`CREATE TABLE IF NOT EXISTS athletes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            cpf TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            birth_date TEXT,
            gender TEXT,
            category TEXT NOT NULL,
            distance TEXT NOT NULL DEFAULT '2,5 km',
            price REAL NOT NULL,
            coupon_code TEXT,
            assessoria_name TEXT,
            tshirt_size TEXT,
            emergency_contact_name TEXT,
            emergency_contact_phone TEXT,
            medical_notes TEXT,
            payment_status TEXT NOT NULL DEFAULT 'Pendente',
            payment_method TEXT,
            payment_date TEXT,
            confirmed_by TEXT,
            checkin_status INTEGER NOT NULL DEFAULT 0,
            checkin_date TEXT,
            checkin_photo TEXT,
            kit_retrieved_by TEXT,
            cap_number TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_athletes_cpf ON athletes(cpf)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_athletes_status ON athletes(payment_status)`);

        // Migration: add store_items, store_amount, total_amount to athletes
        db.all("PRAGMA table_info(athletes)", (err, columns) => {
            if (!err && columns) {
                if (!columns.some(c => c.name === 'store_items')) {
                    db.run("ALTER TABLE athletes ADD COLUMN store_items TEXT DEFAULT '[]'");
                }
                if (!columns.some(c => c.name === 'store_amount')) {
                    db.run("ALTER TABLE athletes ADD COLUMN store_amount REAL DEFAULT 0");
                }
                if (!columns.some(c => c.name === 'total_amount')) {
                    db.run("ALTER TABLE athletes ADD COLUMN total_amount REAL DEFAULT 0");
                }
            }
        });

        // Assessorias
        db.run(`CREATE TABLE IF NOT EXISTS assessorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            responsible_name TEXT,
            phone TEXT,
            email TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )`);

        // Cupons vinculados às Assessorias (Formato: 5 letras e 2 números)
        db.run(`CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            assessoria_id INTEGER NOT NULL,
            discount_price REAL NOT NULL DEFAULT 119.00,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (assessoria_id) REFERENCES assessorias (id) ON DELETE CASCADE
        )`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code)`);

        // Registrations (Batches) - mantido para retrocompatibilidade
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
                    const hasPackageId = columns.some(col => col.name === 'package_id');
                    if (!hasPackageId) {
                        db.run("ALTER TABLE store_sales ADD COLUMN package_id INTEGER DEFAULT NULL", (err) => {
                            if (err) console.error("Migration Error (store_sales package_id):", err.message);
                            else console.log("Migration: Added 'package_id' column to store_sales.");
                        });
                    }
                }
            });
        });

        // Store Packages
        db.run(`CREATE TABLE IF NOT EXISTS store_packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_name TEXT NOT NULL,
            status TEXT DEFAULT 'Pendente',
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )`);

        // Party Costs
        db.run(`CREATE TABLE IF NOT EXISTS party_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Online Orders
        db.run(`CREATE TABLE IF NOT EXISTS online_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buyer_name TEXT NOT NULL,
            total_amount REAL NOT NULL,
            receipt_image_path TEXT NOT NULL,
            selected_products TEXT NOT NULL, 
            status TEXT DEFAULT 'Pendente',
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
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
