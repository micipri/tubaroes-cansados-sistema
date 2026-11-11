const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// Carregar variáveis de ambiente do arquivo .env local se existir (zero dependências)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const idx = trimmed.indexOf('=');
                const key = trimmed.slice(0, idx).trim();
                let val = trimmed.slice(idx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        });
    } catch (e) {
        console.warn('Aviso ao carregar .env:', e.message);
    }
}

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
let db;

if (connectionString) {
    // ================================================================
    // MODO SUPABASE / POSTGRESQL
    // ================================================================
    console.log('⚡ [DB] Configuração de Supabase/PostgreSQL detectada.');
    const { Pool, types } = require('pg');

    // Parse numeric/decimal (1700) as float, bigint (20) as integer
    types.setTypeParser(1700, val => (val === null ? null : parseFloat(val)));
    types.setTypeParser(20, val => (val === null ? null : parseInt(val, 10)));

    const pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    pool.on('error', (err) => {
        console.error('❌ [Supabase/PG Pool Error]:', err.message);
    });

    // Helper: Converte SQL do formato SQLite (?) para PostgreSQL ($1, $2, ...)
    function adaptSql(sql) {
        if (!sql) return '';
        let index = 0;
        let adapted = sql.replace(/\?/g, () => `$${++index}`);
        
        // Converte datetime('now', 'localtime')
        adapted = adapted.replace(/datetime\('now',\s*'localtime'\)/gi, "TO_CHAR(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS')");
        adapted = adapted.replace(/datetime\('now'\)/gi, "TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')");
        
        // Converte MAX(0, stock ...) para GREATEST(0, stock ...)
        adapted = adapted.replace(/\bMAX\s*\(\s*0\s*,\s*stock/gi, "GREATEST(0, stock");

        return adapted;
    }

    db = {
        isPostgres: true,
        pool,
        
        // db.get: Retorna 1 registro ou undefined
        get(sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            params = params || [];
            const pgSql = adaptSql(sql);

            pool.query(pgSql, params)
                .then(res => {
                    const row = (res.rows && res.rows.length > 0) ? res.rows[0] : undefined;
                    if (callback) callback(null, row);
                })
                .catch(err => {
                    if (callback) callback(err);
                });
        },

        // db.all: Retorna todos os registros em array
        all(sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            params = params || [];
            const pgSql = adaptSql(sql);

            pool.query(pgSql, params)
                .then(res => {
                    if (callback) callback(null, res.rows || []);
                })
                .catch(err => {
                    if (callback) callback(err);
                });
        },

        // db.run: Executa INSERT / UPDATE / DELETE com context { lastID, changes }
        run(sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            params = params || [];
            let pgSql = adaptSql(sql);

            // Se for INSERT sem RETURNING, anexa RETURNING id para capturar lastID
            const isInsert = /^\s*insert\s+into/i.test(pgSql);
            if (isInsert && !/returning/i.test(pgSql)) {
                pgSql = `${pgSql.trim().replace(/;$/, '')} RETURNING id`;
            }

            pool.query(pgSql, params)
                .then(res => {
                    const lastID = (res.rows && res.rows[0] && (res.rows[0].id !== undefined))
                        ? res.rows[0].id
                        : null;
                    const changes = res.rowCount || 0;
                    const context = { lastID, changes };

                    if (callback) callback.call(context, null);
                })
                .catch(err => {
                    const context = { lastID: null, changes: 0 };
                    if (callback) callback.call(context, err);
                });
        },

        // db.serialize: compatibilidade de fluxo
        serialize(callback) {
            if (callback) callback();
        }
    };

    // Inicialização do Supabase / PostgreSQL (verificação de tabelas e seeds)
    (async () => {
        try {
            const client = await pool.connect();
            console.log('✅ [Supabase] Conectado com sucesso ao banco PostgreSQL!');

            // Executa schema base se existir
            const schemaFile = path.join(__dirname, 'supabase_schema.sql');
            if (fs.existsSync(schemaFile)) {
                const schemaSql = fs.readFileSync(schemaFile, 'utf8');
                await client.query(schemaSql);
                console.log('✅ [Supabase] Tabelas e seeds verificados/atualizados.');
            }

            client.release();
        } catch (err) {
            console.error('❌ [Supabase] Falha ao conectar/inicializar tabelas:', err.message);
        }
    })();

} else {
    // ================================================================
    // MODO LOCAL SQLITE (FALLBACK PADRÃO)
    // ================================================================
    console.log('📦 [DB] Nenhuma DATABASE_URL encontrada. Utilizando SQLite local.');
    const sqlite3 = require('sqlite3').verbose();

    let dbPath;
    if (process.env.DB_PATH) {
        const targetDir = path.dirname(path.resolve(process.env.DB_PATH));
        if (!fs.existsSync(targetDir)) {
            try { fs.mkdirSync(targetDir, { recursive: true }); dbPath = path.resolve(process.env.DB_PATH); }
            catch (e) { console.warn(`Cannot create DB dir ${targetDir}, using app dir:`, e.message); }
        } else {
            dbPath = path.resolve(process.env.DB_PATH);
        }
    }
    if (!dbPath) {
        const volumeDir = '/app/data';
        const fallbackDir = __dirname;
        const chosenDir = fs.existsSync(volumeDir) ? volumeDir : (() => {
            try { fs.mkdirSync(volumeDir, { recursive: true }); return volumeDir; } catch(e) { return fallbackDir; }
        })();
        dbPath = path.join(chosenDir, 'database.sqlite');
    }
    console.log('Database path:', dbPath);

    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Error connecting to database:', err.message);
        } else {
            console.log('Connected to the SQLite database.');
            createSqliteTables(db);
        }
    });
}

function createSqliteTables(dbInstance) {
    dbInstance.serialize(() => {
        // Athletes
        dbInstance.run(`CREATE TABLE IF NOT EXISTS athletes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            cpf TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            birth_date TEXT,
            gender TEXT,
            category TEXT NOT NULL,
            distance TEXT NOT NULL DEFAULT '2 km',
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

        dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_athletes_cpf ON athletes(cpf)`);
        dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_athletes_status ON athletes(payment_status)`);

        // Migration: add store_items, store_amount, total_amount to athletes
        dbInstance.all("PRAGMA table_info(athletes)", (err, columns) => {
            if (!err && columns) {
                if (!columns.some(c => c.name === 'store_items')) {
                    dbInstance.run("ALTER TABLE athletes ADD COLUMN store_items TEXT DEFAULT '[]'");
                }
                if (!columns.some(c => c.name === 'store_amount')) {
                    dbInstance.run("ALTER TABLE athletes ADD COLUMN store_amount REAL DEFAULT 0");
                }
                if (!columns.some(c => c.name === 'total_amount')) {
                    dbInstance.run("ALTER TABLE athletes ADD COLUMN total_amount REAL DEFAULT 0");
                }
            }
        });

        // Assessorias
        dbInstance.run(`CREATE TABLE IF NOT EXISTS assessorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            responsible_name TEXT,
            phone TEXT,
            email TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )`);

        // Cupons vinculados às Assessorias
        dbInstance.run(`CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            assessoria_id INTEGER NOT NULL,
            discount_price REAL NOT NULL DEFAULT 119.00,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (assessoria_id) REFERENCES assessorias (id) ON DELETE CASCADE
        )`);
        dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code)`);

        // Registrations (Batches)
        dbInstance.run(`CREATE TABLE IF NOT EXISTS registrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_amount REAL NOT NULL,
            total_amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Registrations Modality 2 (Individual)
        dbInstance.run(`CREATE TABLE IF NOT EXISTS registrations_mod2 (
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
        dbInstance.run(`CREATE TABLE IF NOT EXISTS party_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            amount REAL NOT NULL,
            has_store_coupon BOOLEAN NOT NULL DEFAULT 0,
            has_beer_voucher BOOLEAN NOT NULL DEFAULT 0,
            date TEXT NOT NULL
        )`, () => {
            dbInstance.all("PRAGMA table_info(party_tickets)", (err, columns) => {
                if (!err && columns) {
                    const hasCoupon = columns.some(col => col.name === 'has_store_coupon');
                    if (!hasCoupon) {
                        dbInstance.run("ALTER TABLE party_tickets ADD COLUMN has_store_coupon BOOLEAN NOT NULL DEFAULT 0");
                    }
                    const hasVoucher = columns.some(col => col.name === 'has_beer_voucher');
                    if (!hasVoucher) {
                        dbInstance.run("ALTER TABLE party_tickets ADD COLUMN has_beer_voucher BOOLEAN NOT NULL DEFAULT 0");
                    }
                }
            });
        });

        // Store Products
        dbInstance.run(`CREATE TABLE IF NOT EXISTS store_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            stock INTEGER NOT NULL DEFAULT 0,
            cost_price REAL NOT NULL,
            sell_price REAL NOT NULL,
            tshirt_size TEXT DEFAULT NULL,
            is_system INTEGER DEFAULT 0
        )`, () => {
            dbInstance.all("PRAGMA table_info(store_products)", (err, columns) => {
                if (!err && columns) {
                    const hasTshirtSize = columns.some(c => c.name === 'tshirt_size');
                    if (!hasTshirtSize) {
                        dbInstance.run("ALTER TABLE store_products ADD COLUMN tshirt_size TEXT DEFAULT NULL");
                    }
                    const hasIsSystem = columns.some(c => c.name === 'is_system');
                    if (!hasIsSystem) {
                        dbInstance.run("ALTER TABLE store_products ADD COLUMN is_system INTEGER DEFAULT 0");
                    }
                    const hasShowInCheckout = columns.some(c => c.name === 'show_in_checkout');
                    if (!hasShowInCheckout) {
                        dbInstance.run("ALTER TABLE store_products ADD COLUMN show_in_checkout INTEGER NOT NULL DEFAULT 0");
                    }
                }

                const defaultShirts = [
                    { size: 'M', name: 'Camisa Oficial do Evento (Tamanho M)', stock: 30 },
                    { size: 'G', name: 'Camisa Oficial do Evento (Tamanho G)', stock: 30 },
                    { size: 'XG', name: 'Camisa Oficial do Evento (Tamanho XG)', stock: 30 }
                ];

                defaultShirts.forEach(shirt => {
                    dbInstance.get("SELECT id FROM store_products WHERE tshirt_size = ? OR name = ?", [shirt.size, shirt.name], (err, row) => {
                        if (!err && !row) {
                            dbInstance.run(
                                "INSERT INTO store_products (name, stock, cost_price, sell_price, tshirt_size, is_system) VALUES (?, ?, 0, 0, ?, 1)",
                                [shirt.name, shirt.stock, shirt.size],
                                (insertErr) => {
                                    if (insertErr) console.error(`Error inserting shirt ${shirt.size}:`, insertErr.message);
                                    else console.log(`Seeded shirt ${shirt.size} with stock ${shirt.stock}`);
                                }
                            );
                        }
                    });
                });
            });
        });

        // Store Sales
        dbInstance.run(`CREATE TABLE IF NOT EXISTS store_sales (
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
            dbInstance.all("PRAGMA table_info(store_sales)", (err, columns) => {
                if (!err && columns) {
                    const hasDiscount = columns.some(col => col.name === 'discount');
                    if (!hasDiscount) {
                        dbInstance.run("ALTER TABLE store_sales ADD COLUMN discount REAL NOT NULL DEFAULT 0");
                    }
                    const hasPaymentMethod = columns.some(col => col.name === 'payment_method');
                    if (!hasPaymentMethod) {
                        dbInstance.run("ALTER TABLE store_sales ADD COLUMN payment_method TEXT DEFAULT 'Não informado'");
                    }
                    const hasBuyerName = columns.some(col => col.name === 'buyer_name');
                    if (!hasBuyerName) {
                        dbInstance.run("ALTER TABLE store_sales ADD COLUMN buyer_name TEXT DEFAULT 'Anônimo'");
                    }
                    const hasPackageId = columns.some(col => col.name === 'package_id');
                    if (!hasPackageId) {
                        dbInstance.run("ALTER TABLE store_sales ADD COLUMN package_id INTEGER DEFAULT NULL");
                    }
                }
            });
        });

        // Store Packages
        dbInstance.run(`CREATE TABLE IF NOT EXISTS store_packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_name TEXT NOT NULL,
            status TEXT DEFAULT 'Pendente',
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )`);

        // Party Costs
        dbInstance.run(`CREATE TABLE IF NOT EXISTS party_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Online Orders
        dbInstance.run(`CREATE TABLE IF NOT EXISTS online_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buyer_name TEXT NOT NULL,
            total_amount REAL NOT NULL,
            receipt_image_path TEXT NOT NULL,
            selected_products TEXT NOT NULL, 
            status TEXT DEFAULT 'Pendente',
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )`);

        // Event Costs
        dbInstance.run(`CREATE TABLE IF NOT EXISTS event_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Secret Survey
        dbInstance.run(`CREATE TABLE IF NOT EXISTS secret_survey (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            will_go BOOLEAN NOT NULL,
            companions INTEGER NOT NULL DEFAULT 0,
            suggestion TEXT,
            date TEXT NOT NULL
        )`);

        // Sponsors
        dbInstance.run(`CREATE TABLE IF NOT EXISTS sponsors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Users
        dbInstance.run(`CREATE TABLE IF NOT EXISTS users (
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
            dbInstance.get("SELECT id FROM users WHERE username = 'michel'", (err, row) => {
                if (!row) {
                    const hash = bcrypt.hashSync('tubaroes2026', 10);
                    dbInstance.run(
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
