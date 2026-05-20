const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const db = require('../database'); // PostgreSQL pool

const app = express();

// Middleware
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());

// Serverless cookie-based session management
app.use(cookieSession({
    name: 'session',
    keys: [process.env.SESSION_SECRET || 'tubaroes-cansados-secret-2026'],
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
}));

// ─── Auth Middleware ────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    if (req.accepts('html')) {
        return res.redirect('/admin/login.html');
    }
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
}

function requireMaster(req, res, next) {
    if (req.session && req.session.isMaster) {
        return next();
    }
    return res.status(403).json({ error: 'Acesso negado. Apenas o usuário master pode realizar esta ação.' });
}

// ─── TEMP: diagnóstico de filesystem ─────────────────────────────────────────
app.get('/debug-fs', (req, res) => {
    res.json({
        __dirname,
        cwd: process.cwd(),
        env: {
            NODE_ENV: process.env.NODE_ENV,
            DB_CONNECTED: !!db
        }
    });
});

// ─── Auth Routes ────────────────────────────────────────────────────────────

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }
    try {
        const { rows } = await db.query("SELECT * FROM users WHERE LOWER(username) = $1", [username.toLowerCase()]);
        const user = rows[0];
        if (!user) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.isMaster = user.is_master === 1;
        res.json({ ok: true, username: user.username, isMaster: user.is_master === 1 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/auth/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
});

app.get('/auth/me', requireAuth, (req, res) => {
    res.json({ username: req.session.username, isMaster: req.session.isMaster });
});

// ─── User Management (master only) ─────────────────────────────────────────

app.get('/api/users', requireAuth, requireMaster, async (req, res) => {
    try {
        const { rows } = await db.query("SELECT id, username, is_master, created_at FROM users ORDER BY id ASC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', requireAuth, requireMaster, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });

    const hash = bcrypt.hashSync(password, 10);
    try {
        const { rows } = await db.query(
            "INSERT INTO users (username, password_hash, is_master) VALUES ($1, $2, 0) RETURNING id",
            [username.toLowerCase(), hash]
        );
        res.json({ id: rows[0].id, username: username.toLowerCase(), is_master: 0 });
    } catch (err) {
        if (err.message.includes('unique') || err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Esse usuário já existe.' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/users/:id', requireAuth, requireMaster, async (req, res) => {
    const id = parseInt(req.params.id);
    if (id === req.session.userId) {
        return res.status(400).json({ error: 'Você não pode excluir sua própria conta.' });
    }
    try {
        const { rowCount } = await db.query("DELETE FROM users WHERE id = $1 AND is_master = 0", [id]);
        if (rowCount === 0) return res.status(400).json({ error: 'Usuário não encontrado ou não pode ser excluído.' });
        res.json({ deleted: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── API Routes (all protected) ─────────────────────────────────────────────

// --- Registrations (Batches) ---
app.get('/api/registrations', requireAuth, async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM registrations ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/registrations', requireAuth, async (req, res) => {
    const { name, quantity, unit_amount, date } = req.body;
    const total_amount = quantity * unit_amount;
    try {
        const { rows } = await db.query(
            "INSERT INTO registrations (name, quantity, unit_amount, total_amount, date) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [name, quantity, unit_amount, total_amount, date]
        );
        res.json({ id: rows[0].id, name, quantity, unit_amount, total_amount, date });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/registrations/:id', requireAuth, async (req, res) => {
    try {
        const { rowCount } = await db.query("DELETE FROM registrations WHERE id = $1", [req.params.id]);
        res.json({ deleted: rowCount > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Registrations Modality 2 ---
app.get('/api/registrations_mod2', requireAuth, async (req, res) => {
    const sortBy = req.query.sort || 'id_desc';
    let query = "SELECT * FROM registrations_mod2";
    if (sortBy === 'name_asc') {
        query += " ORDER BY LOWER(name) ASC";
    } else if (sortBy === 'cap_asc') {
        query += " ORDER BY LOWER(cap_name) ASC";
    } else if (sortBy === 'receipt_ok') {
        query += " ORDER BY has_receipt DESC, id DESC";
    } else {
        query += " ORDER BY id DESC";
    }
    try {
        const { rows } = await db.query(query);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/registrations_mod2', requireAuth, async (req, res) => {
    const { name, email, cap_name, amount, has_receipt, is_confirmed, date } = req.body;
    try {
        const { rows } = await db.query(
            "INSERT INTO registrations_mod2 (name, email, cap_name, amount, has_receipt, is_confirmed, date) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
            [name, email, cap_name, amount, has_receipt ? true : false, is_confirmed ? true : false, date]
        );
        res.json({ id: rows[0].id, name, email, cap_name, amount, has_receipt, is_confirmed, date });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/registrations_mod2/:id', requireAuth, async (req, res) => {
    try {
        const { rowCount } = await db.query("DELETE FROM registrations_mod2 WHERE id = $1", [req.params.id]);
        res.json({ deleted: rowCount > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/registrations_mod2/:id/toggle', requireAuth, async (req, res) => {
    const { field, value } = req.body;
    if (field !== 'has_receipt' && field !== 'is_confirmed') {
        return res.status(400).json({ error: "Invalid field" });
    }
    try {
        const { rowCount } = await db.query(
            `UPDATE registrations_mod2 SET ${field} = $1 WHERE id = $2`,
            [value ? true : false, req.params.id]
        );
        res.json({ updated: rowCount > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/registrations_mod2/:id/cap_name', requireAuth, async (req, res) => {
    const { cap_name } = req.body;
    try {
        const { rowCount } = await db.query(
            "UPDATE registrations_mod2 SET cap_name = $1 WHERE id = $2",
            [cap_name, req.params.id]
        );
        res.json({ updated: rowCount > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Party Tickets ---
app.get('/api/party_tickets', requireAuth, async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM party_tickets ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/party_tickets', requireAuth, async (req, res) => {
    const { name, amount, date } = req.body;
    try {
        const { rows } = await db.query(
            "INSERT INTO party_tickets (name, amount, date) VALUES ($1, $2, $3) RETURNING id",
            [name, amount, date]
        );
        res.json({ id: rows[0].id, name, amount, date });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/party_tickets/:id', requireAuth, async (req, res) => {
    try {
        const { rowCount } = await db.query("DELETE FROM party_tickets WHERE id = $1", [req.params.id]);
        res.json({ deleted: rowCount > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Store Products ---
app.get('/api/store_products', requireAuth, async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM store_products ORDER BY name ASC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/store_products', requireAuth, async (req, res) => {
    const { name, stock, cost_price, sell_price } = req.body;
    try {
        const { rows } = await db.query(
            "INSERT INTO store_products (name, stock, cost_price, sell_price) VALUES ($1, $2, $3, $4) RETURNING id",
            [name, stock, cost_price, sell_price]
        );
        res.json({ id: rows[0].id, name, stock, cost_price, sell_price });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/store_products/:id', requireAuth, async (req, res) => {
    try {
        const { rowCount } = await db.query("DELETE FROM store_products WHERE id = $1", [req.params.id]);
        res.json({ deleted: rowCount > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/store_products/:id/stock', requireAuth, async (req, res) => {
    const { stock } = req.body;
    try {
        const { rowCount } = await db.query(
            "UPDATE store_products SET stock = stock + $1 WHERE id = $2",
            [stock, req.params.id]
        );
        res.json({ updated: rowCount > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Store Sales ---
app.get('/api/store_sales', requireAuth, async (req, res) => {
    const query = `
        SELECT s.id, p.name as product_name, s.quantity, s.total_amount, s.date
        FROM store_sales s
        JOIN store_products p ON s.product_id = p.id
        ORDER BY s.id DESC
    `;
    try {
        const { rows } = await db.query(query);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/store_sales', requireAuth, async (req, res) => {
    const { product_id, quantity, date } = req.body;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const { rows } = await client.query(
            "SELECT sell_price, stock FROM store_products WHERE id = $1 FOR UPDATE",
            [product_id]
        );
        const product = rows[0];
        if (!product) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Product not found" });
        }
        if (product.stock < quantity) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Insufficient stock" });
        }

        const total_amount = product.sell_price * quantity;
        
        await client.query(
            "INSERT INTO store_sales (product_id, quantity, total_amount, date) VALUES ($1, $2, $3, $4)",
            [product_id, quantity, total_amount, date]
        );
        await client.query(
            "UPDATE store_products SET stock = stock - $1 WHERE id = $2",
            [quantity, product_id]
        );
        
        await client.query('COMMIT');
        res.json({ success: true, total_amount });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// --- Costs ---
app.get('/api/costs/:type', requireAuth, async (req, res) => {
    const table = req.params.type === 'party' ? 'party_costs' : 'event_costs';
    try {
        const { rows } = await db.query(`SELECT * FROM ${table} ORDER BY id DESC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/costs/:type', requireAuth, async (req, res) => {
    const table = req.params.type === 'party' ? 'party_costs' : 'event_costs';
    const { description, amount, date } = req.body;
    try {
        const { rows } = await db.query(
            `INSERT INTO ${table} (description, amount, date) VALUES ($1, $2, $3) RETURNING id`,
            [description, amount, date]
        );
        res.json({ id: rows[0].id, description, amount, date });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/costs/:type/:id', requireAuth, async (req, res) => {
    const table = req.params.type === 'party' ? 'party_costs' : 'event_costs';
    try {
        const { rowCount } = await db.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
        res.json({ deleted: rowCount > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Sponsors ---
app.get('/api/sponsors', requireAuth, async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM sponsors ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sponsors', requireAuth, async (req, res) => {
    const { name, amount, date } = req.body;
    try {
        const { rows } = await db.query(
            "INSERT INTO sponsors (name, amount, date) VALUES ($1, $2, $3) RETURNING id",
            [name, amount, date]
        );
        res.json({ id: rows[0].id, name, amount, date });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/sponsors/:id', requireAuth, async (req, res) => {
    try {
        const { rowCount } = await db.query("DELETE FROM sponsors WHERE id = $1", [req.params.id]);
        res.json({ deleted: rowCount > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Dashboard Summary ---
app.get('/api/summary', requireAuth, async (req, res) => {
    const summary = {
        income: { registrations: 0, registrations_mod2: 0, party_tickets: 0, store_sales: 0, sponsors: 0 },
        expenses: { event_costs: 0, party_costs: 0, store_costs: 0 }
    };

    const getSum = async (query) => {
        try {
            const { rows } = await db.query(query);
            return parseFloat(rows[0].s || 0);
        } catch (e) {
            console.error('Error fetching sum:', e.message);
            return 0;
        }
    };

    try {
        const [
            regSum, regMod2Sum, ticketSum, saleSum, sponsorSum,
            eventCostSum, partyCostSum, storeCostSum
        ] = await Promise.all([
            getSum("SELECT SUM(total_amount) as s FROM registrations"),
            getSum("SELECT SUM(amount) as s FROM registrations_mod2"),
            getSum("SELECT SUM(amount) as s FROM party_tickets"),
            getSum("SELECT SUM(total_amount) as s FROM store_sales"),
            getSum("SELECT SUM(amount) as s FROM sponsors"),
            getSum("SELECT SUM(amount) as s FROM event_costs"),
            getSum("SELECT SUM(amount) as s FROM party_costs"),
            getSum("SELECT SUM(stock * cost_price) as s FROM store_products")
        ]);

        summary.income.registrations = regSum;
        summary.income.registrations_mod2 = regMod2Sum;
        summary.income.party_tickets = ticketSum;
        summary.income.store_sales = saleSum;
        summary.income.sponsors = sponsorSum;
        
        summary.expenses.event_costs = eventCostSum;
        summary.expenses.party_costs = partyCostSum;
        summary.expenses.store_costs = storeCostSum;

        const total_income = Object.values(summary.income).reduce((a, b) => a + b, 0);
        const total_expenses = Object.values(summary.expenses).reduce((a, b) => a + b, 0);
        summary.total_balance = total_income - total_expenses;

        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Local fallback routing for static files (used only in local dev)
if (process.env.NODE_ENV !== 'production') {
    app.get('/', (req, res) => {
        res.sendFile('landing.html', { root: path.join(__dirname, '..', 'public') });
    });
    
    app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

    app.use('/admin', (req, res, next) => {
        const pub = ['/login.html', '/login', ''];
        const isPublicAsset = /\.(css|js|jpg|jpeg|png|ico|svg|woff2?)$/i.test(req.path);
        if (pub.includes(req.path) || isPublicAsset) return next();

        if (!req.session || !req.session.userId) {
            return res.redirect('/admin/login.html');
        }
        next();
    });

    app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin'), {
        index: 'index.html'
    }));
}

// Global error handlers
process.on('uncaughtException',  (err)    => console.error('[CRASH] uncaughtException:', err));
process.on('unhandledRejection', (reason) => console.error('[CRASH] unhandledRejection:', reason));

module.exports = app;
