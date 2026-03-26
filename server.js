const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'tubaroes-cansados-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 } // 8 hours
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

// ─── Protect /admin/index.html BEFORE any static middleware ──────────────────
// This must be first: express.static would otherwise serve it unauthenticated
app.use('/admin/index.html', (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.redirect('/admin/login.html');
    }
    next();
});

// ─── Public static assets (images, CSS, fonts etc.) ─────────────────────────
// Note: index:false prevents auto-serving any index.html from public/
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─── Public landing page at root ─────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// ─── Admin static assets (CSS/JS/images for login page — no auth needed) ────
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin'), { index: false }));

// ─── Admin login page (public) ───────────────────────────────────────────────
app.get('/admin/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

// ─── Auth Routes ────────────────────────────────────────────────────────────

app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }
    db.get("SELECT * FROM users WHERE username = ?", [username.toLowerCase()], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.isMaster = user.is_master === 1;
        res.json({ ok: true, username: user.username, isMaster: user.is_master === 1 });
    });
});

app.post('/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ ok: true });
    });
});

app.get('/auth/me', requireAuth, (req, res) => {
    res.json({ username: req.session.username, isMaster: req.session.isMaster });
});

// ─── User Management (master only) ─────────────────────────────────────────

app.get('/api/users', requireAuth, requireMaster, (req, res) => {
    db.all("SELECT id, username, is_master, created_at FROM users ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', requireAuth, requireMaster, (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });

    const hash = bcrypt.hashSync(password, 10);
    db.run(
        "INSERT INTO users (username, password_hash, is_master) VALUES (?, ?, 0)",
        [username.toLowerCase(), hash],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Esse usuário já existe.' });
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, username: username.toLowerCase(), is_master: 0 });
        }
    );
});

app.delete('/api/users/:id', requireAuth, requireMaster, (req, res) => {
    const id = req.params.id;
    // Prevent deleting yourself
    if (parseInt(id) === req.session.userId) {
        return res.status(400).json({ error: 'Você não pode excluir sua própria conta.' });
    }
    db.run("DELETE FROM users WHERE id = ? AND is_master = 0", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(400).json({ error: 'Usuário não encontrado ou não pode ser excluído.' });
        res.json({ deleted: true });
    });
});

// ─── API Routes (all protected) ─────────────────────────────────────────────

// --- Registrations (Batches) ---
app.get('/api/registrations', requireAuth, (req, res) => {
    db.all("SELECT * FROM registrations ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/registrations', requireAuth, (req, res) => {
    const { name, quantity, unit_amount, date } = req.body;
    const total_amount = quantity * unit_amount;
    db.run("INSERT INTO registrations (name, quantity, unit_amount, total_amount, date) VALUES (?, ?, ?, ?, ?)",
    [name, quantity, unit_amount, total_amount, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, quantity, unit_amount, total_amount, date });
    });
});
app.delete('/api/registrations/:id', requireAuth, (req, res) => {
    db.run("DELETE FROM registrations WHERE id = ?", req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes > 0 });
    });
});

// --- Registrations Modality 2 ---
app.get('/api/registrations_mod2', requireAuth, (req, res) => {
    db.all("SELECT * FROM registrations_mod2 ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/registrations_mod2', requireAuth, (req, res) => {
    const { name, email, cap_name, amount, has_receipt, is_confirmed, date } = req.body;
    db.run("INSERT INTO registrations_mod2 (name, email, cap_name, amount, has_receipt, is_confirmed, date) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [name, email, cap_name, amount, has_receipt ? 1 : 0, is_confirmed ? 1 : 0, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, email, cap_name, amount, has_receipt, is_confirmed, date });
    });
});
app.delete('/api/registrations_mod2/:id', requireAuth, (req, res) => {
    db.run("DELETE FROM registrations_mod2 WHERE id = ?", req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes > 0 });
    });
});
app.put('/api/registrations_mod2/:id/toggle', requireAuth, (req, res) => {
    const { field, value } = req.body;
    if (field !== 'has_receipt' && field !== 'is_confirmed') {
        return res.status(400).json({ error: "Invalid field" });
    }
    db.run(`UPDATE registrations_mod2 SET ${field} = ? WHERE id = ?`, [value ? 1 : 0, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes > 0 });
    });
});
app.put('/api/registrations_mod2/:id/cap_name', requireAuth, (req, res) => {
    const { cap_name } = req.body;
    db.run(`UPDATE registrations_mod2 SET cap_name = ? WHERE id = ?`, [cap_name, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes > 0 });
    });
});

// --- Party Tickets ---
app.get('/api/party_tickets', requireAuth, (req, res) => {
    db.all("SELECT * FROM party_tickets ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/party_tickets', requireAuth, (req, res) => {
    const { name, amount, date } = req.body;
    db.run("INSERT INTO party_tickets (name, amount, date) VALUES (?, ?, ?)", [name, amount, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, amount, date });
    });
});
app.delete('/api/party_tickets/:id', requireAuth, (req, res) => {
    db.run("DELETE FROM party_tickets WHERE id = ?", req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes > 0 });
    });
});

// --- Store Products ---
app.get('/api/store_products', requireAuth, (req, res) => {
    db.all("SELECT * FROM store_products ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/store_products', requireAuth, (req, res) => {
    const { name, stock, cost_price, sell_price } = req.body;
    db.run("INSERT INTO store_products (name, stock, cost_price, sell_price) VALUES (?, ?, ?, ?)", [name, stock, cost_price, sell_price], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, stock, cost_price, sell_price });
    });
});
app.delete('/api/store_products/:id', requireAuth, (req, res) => {
    db.run("DELETE FROM store_products WHERE id = ?", req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes > 0 });
    });
});
app.put('/api/store_products/:id/stock', requireAuth, (req, res) => {
    const { stock } = req.body;
    db.run("UPDATE store_products SET stock = stock + ? WHERE id = ?", [stock, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes > 0 });
    });
});

// --- Store Sales ---
app.get('/api/store_sales', requireAuth, (req, res) => {
    const query = `
        SELECT s.id, p.name as product_name, s.quantity, s.total_amount, s.date
        FROM store_sales s
        JOIN store_products p ON s.product_id = p.id
        ORDER BY s.id DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/store_sales', requireAuth, (req, res) => {
    const { product_id, quantity, date } = req.body;
    db.get("SELECT sell_price, stock FROM store_products WHERE id = ?", [product_id], (err, product) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!product) return res.status(404).json({ error: "Product not found" });
        if (product.stock < quantity) return res.status(400).json({ error: "Insufficient stock" });

        const total_amount = product.sell_price * quantity;
        db.serialize(() => {
            db.run("INSERT INTO store_sales (product_id, quantity, total_amount, date) VALUES (?, ?, ?, ?)", [product_id, quantity, total_amount, date]);
            db.run("UPDATE store_products SET stock = stock - ? WHERE id = ?", [quantity, product_id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, total_amount });
            });
        });
    });
});

// --- Costs ---
app.get('/api/costs/:type', requireAuth, (req, res) => {
    const table = req.params.type === 'party' ? 'party_costs' : 'event_costs';
    db.all(`SELECT * FROM ${table} ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/costs/:type', requireAuth, (req, res) => {
    const table = req.params.type === 'party' ? 'party_costs' : 'event_costs';
    const { description, amount, date } = req.body;
    db.run(`INSERT INTO ${table} (description, amount, date) VALUES (?, ?, ?)`, [description, amount, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, description, amount, date });
    });
});
app.delete('/api/costs/:type/:id', requireAuth, (req, res) => {
    const table = req.params.type === 'party' ? 'party_costs' : 'event_costs';
    db.run(`DELETE FROM ${table} WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes > 0 });
    });
});

// --- Sponsors ---
app.get('/api/sponsors', requireAuth, (req, res) => {
    db.all("SELECT * FROM sponsors ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/sponsors', requireAuth, (req, res) => {
    const { name, amount, date } = req.body;
    db.run("INSERT INTO sponsors (name, amount, date) VALUES (?, ?, ?)", [name, amount, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, amount, date });
    });
});
app.delete('/api/sponsors/:id', requireAuth, (req, res) => {
    db.run("DELETE FROM sponsors WHERE id = ?", req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes > 0 });
    });
});

// --- Dashboard Summary ---
app.get('/api/summary', requireAuth, (req, res) => {
    const summary = {
        income: { registrations: 0, registrations_mod2: 0, party_tickets: 0, store_sales: 0, sponsors: 0 },
        expenses: { event_costs: 0, party_costs: 0, store_costs: 0 }
    };

    const queries = [
        new Promise(resolve => db.get("SELECT sum(total_amount) as s FROM registrations", (e, r) => resolve({ k: ['income', 'registrations'], r }))),
        new Promise(resolve => db.get("SELECT sum(amount) as s FROM registrations_mod2", (e, r) => resolve({ k: ['income', 'registrations_mod2'], r }))),
        new Promise(resolve => db.get("SELECT sum(amount) as s FROM party_tickets", (e, r) => resolve({ k: ['income', 'party_tickets'], r }))),
        new Promise(resolve => db.get("SELECT sum(total_amount) as s FROM store_sales", (e, r) => resolve({ k: ['income', 'store_sales'], r }))),
        new Promise(resolve => db.get("SELECT sum(amount) as s FROM sponsors", (e, r) => resolve({ k: ['income', 'sponsors'], r }))),
        new Promise(resolve => db.get("SELECT sum(amount) as s FROM event_costs", (e, r) => resolve({ k: ['expenses', 'event_costs'], r }))),
        new Promise(resolve => db.get("SELECT sum(amount) as s FROM party_costs", (e, r) => resolve({ k: ['expenses', 'party_costs'], r }))),
        new Promise(resolve => db.get("SELECT sum(stock * cost_price) as s FROM store_products", (e, r) => resolve({ k: ['expenses', 'store_costs'], r })))
    ];

    Promise.all(queries).then(results => {
        results.forEach(result => {
            if (result.r && result.r.s) {
                summary[result.k[0]][result.k[1]] = result.r.s;
            }
        });
        const total_income = Object.values(summary.income).reduce((a, b) => a + b, 0);
        const total_expenses = Object.values(summary.expenses).reduce((a, b) => a + b, 0);
        summary.total_balance = total_income - total_expenses;
        res.json(summary);
    });
});

// ─── Admin panel (protected) ─────────────────────────────────────────────────
app.get('/admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.get('/admin/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
