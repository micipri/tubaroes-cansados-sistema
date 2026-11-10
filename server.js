const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Multer
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ─── Session Setup ────────────────────────────────────────────────────────────
// Use /app/data/sessions if the volume is mounted, otherwise fall back to app dir
const volumeDataDir = '/app/data';
const baseSessionDir = fs.existsSync(volumeDataDir) ? volumeDataDir : (() => {
    try { fs.mkdirSync(volumeDataDir, { recursive: true }); return volumeDataDir; } catch(e) { return __dirname; }
})();
const sessionsDir = path.join(baseSessionDir, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
console.log('Sessions dir:', sessionsDir);

let sessionStore;
try {
    sessionStore = new FileStore({ path: sessionsDir, retries: 0, logFn: () => {} });
} catch(e) {
    console.warn('FileStore failed, using MemoryStore:', e.message);
}


// Middleware
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: '200mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'tubaroes-cansados-secret-2026',
    resave: false,
    saveUninitialized: false,
    ...(sessionStore ? { store: sessionStore } : {}),
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

// ─── TEMP: diagnóstico de filesystem (remover após debug) ────────────────────
app.get('/debug-fs', (req, res) => {
    const fs = require('fs');
    const check = (p) => { try { return fs.readdirSync(p); } catch(e) { return 'ERR: ' + e.message; } };
    res.json({
        __dirname,
        cwd: process.cwd(),
        public:       check(path.join(__dirname, 'public')),
        publicAdmin:  check(path.join(__dirname, 'public', 'admin')),
        cwdPublic:    check(path.join(process.cwd(), 'public')),
        cwdAdmin:     check(path.join(process.cwd(), 'public', 'admin')),
    });
});

// ─── Landing page, Inscrição & Confirmação ──────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile('landing.html', { root: path.join(__dirname, 'public') });
});

app.get('/inscricao', (req, res) => {
    res.sendFile('inscricao.html', { root: path.join(__dirname, 'public') });
});

app.get('/confirmacao-inscricao', (req, res) => {
    res.sendFile('confirmacao.html', { root: path.join(__dirname, 'public') });
});



// ─── Public static assets (CSS, JS, images) ──────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─── Admin area ───────────────────────────────────────────────────────────────
// Auth middleware: blocks /admin and /admin/index.html, allows everything else
// (login.html, CSS, JS, images needed by the login page)
app.use('/admin', (req, res, next) => {
    // Public assets and login page — always allowed
    const pub = ['/login.html', '/login', ''];
    const isPublicAsset = /\.(css|js|jpg|jpeg|png|ico|svg|woff2?)$/i.test(req.path);
    if (pub.includes(req.path) || isPublicAsset) return next();

    // Everything else (index.html, /, '') requires auth
    if (!req.session || !req.session.userId) {
        return res.redirect('/admin/login.html');
    }
    next();
});

// Serve all admin files (index.html served for / and /index.html)
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin'), {
    index: 'index.html'
}));



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

// ─── Event Categories & Inscrições ──────────────────────────────────────────
const EVENT_CATEGORIES = {
    // ── PROVAS DE 2 KM (Principal) ──
    'adulto_2k': {
        id: 'adulto_2k',
        name: 'Travessia de Adultos (2 km)',
        distance: '2 km',
        price: 149.00,
        description: 'Prova de 2 km em águas abertas para adultos. Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.'
    },
    'adulto_assessoria_2k': {
        id: 'adulto_assessoria_2k',
        name: 'Travessia de Adultos (2 km) — Alunos de Assessorias',
        distance: '2 km',
        price: 119.00,
        description: 'Desconto exclusivo com cupom para alunos de assessorias parceiras (2 km). Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.',
        requires_coupon: true
    },
    'promocional_2k': {
        id: 'promocional_2k',
        name: 'Travessia de Adultos (2 km) — Promocional de Largada',
        distance: '2 km',
        price: 99.00,
        description: 'Lote promocional limitado de largada (2 km). Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.'
    },
    'pcd_2k': {
        id: 'pcd_2k',
        name: 'Travessia de Adultos (2 km) — PCD',
        distance: '2 km',
        price: 79.00,
        description: 'Inscrição e apoio especializado para atletas com deficiência (2 km). Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.'
    },

    // ── PROVAS DE 1 KM (Nova Prova) ──
    'adulto_1k': {
        id: 'adulto_1k',
        name: 'Travessia de Adultos (1 km)',
        distance: '1 km',
        price: 149.00,
        description: 'Prova de 1 km em águas abertas para adultos. Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.'
    },
    'adulto_assessoria_1k': {
        id: 'adulto_assessoria_1k',
        name: 'Travessia de Adultos (1 km) — Alunos de Assessorias',
        distance: '1 km',
        price: 119.00,
        description: 'Desconto exclusivo com cupom para alunos de assessorias parceiras (1 km). Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.',
        requires_coupon: true
    },
    'promocional_1k': {
        id: 'promocional_1k',
        name: 'Travessia de Adultos (1 km) — Promocional de Largada',
        distance: '1 km',
        price: 99.00,
        description: 'Lote promocional limitado de largada (1 km). Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.'
    },
    'pcd_1k': {
        id: 'pcd_1k',
        name: 'Travessia de Adultos (1 km) — PCD',
        distance: '1 km',
        price: 79.00,
        description: 'Inscrição e apoio especializado para atletas com deficiência (1 km). Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.'
    },

    // ── PROVA KIDS ──
    'kids': {
        id: 'kids',
        name: 'Travessia Kids',
        distance: 'Kids',
        price: 79.00,
        description: 'Percurso adaptado e seguro para as crianças. Inclui Kit Kids: Bolsa, Touca, Medalha e Brindes.'
    },

    // ── ALIASES DE COMPATIBILIDADE ──
    'adulto_25k': {
        id: 'adulto_2k',
        name: 'Travessia de Adultos (2 km)',
        distance: '2 km',
        price: 149.00,
        description: 'Prova de 2 km em águas abertas para adultos. Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.'
    },
    'adulto_assessoria': {
        id: 'adulto_assessoria_2k',
        name: 'Travessia de Adultos (2 km) — Alunos de Assessorias',
        distance: '2 km',
        price: 119.00,
        description: 'Desconto exclusivo com cupom para alunos de assessorias parceiras (2 km). Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.',
        requires_coupon: true
    },
    'pcd': {
        id: 'pcd_2k',
        name: 'Travessia de Adultos (2 km) — PCD',
        distance: '2 km',
        price: 79.00,
        description: 'Inscrição e apoio especializado para atletas com deficiência (2 km). Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.'
    },
    'promocional': {
        id: 'promocional_2k',
        name: 'Travessia de Adultos (2 km) — Promocional de Largada',
        distance: '2 km',
        price: 99.00,
        description: 'Lote promocional limitado de largada (2 km). Inclui Kit Atleta: Touca, Camisa oficial, Bolsa, Medalha e Brindes.'
    }
};

// Public endpoint: List Categories
app.get('/api/public/categories', (req, res) => {
    const unique = Object.values(EVENT_CATEGORIES).filter((cat, idx, arr) => arr.findIndex(c => c.id === cat.id) === idx);
    res.json(unique);
});

// Public endpoint: Validar Cupom de Assessoria (Formato: 5 letras e 2 números)
app.get('/api/public/validate-coupon', (req, res) => {
    const rawCode = req.query.code;
    if (!rawCode) {
        return res.status(400).json({ valid: false, error: 'Código do cupom não informado.' });
    }

    const code = String(rawCode).trim().toUpperCase();

    // Validação estrita: 5 letras seguidas de 2 números
    if (!/^[A-Z]{5}[0-9]{2}$/.test(code)) {
        return res.status(400).json({
            valid: false,
            error: 'O cupom deve conter exatamente 5 letras e 2 números (Exemplo: TUBAS01).'
        });
    }

    const sql = `
        SELECT c.id, c.code, c.discount_price, c.active, a.id as assessoria_id, a.name as assessoria_name
        FROM coupons c
        JOIN assessorias a ON c.assessoria_id = a.id
        WHERE c.code = ? AND c.active = 1
    `;

    db.get(sql, [code], (err, row) => {
        if (err) return res.status(500).json({ valid: false, error: err.message });
        if (!row) {
            return res.status(404).json({ valid: false, error: 'Cupom não encontrado ou inativo.' });
        }
        res.json({
            valid: true,
            code: row.code,
            assessoria_name: row.assessoria_name,
            assessoria_id: row.assessoria_id,
            discount_price: row.discount_price || 119.00
        });
    });
});

// Helper: Obter contagem de vagas, lotes promocionais e limites das provas
function getRaceVacancies(callback) {
    const LIMIT_RACE = 50;
    const LIMIT_PROMO = 10;
    const LIMIT_KIDS = 20;

    const query = `
        SELECT 
            id,
            category,
            distance,
            payment_status
        FROM athletes
        WHERE payment_status != 'Cancelado'
    `;

    db.all(query, [], (err, rows) => {
        if (err) return callback(err);
        
        let total_2k = 0;
        let promo_2k = 0;
        let total_1k = 0;
        let promo_1k = 0;
        let total_kids = 0;

        (rows || []).forEach(r => {
            const cat = (r.category || '').toLowerCase();
            const dist = (r.distance || '').toLowerCase();

            if (dist.includes('kid') || cat.includes('kid')) {
                total_kids++;
            } else if (dist.includes('2') || cat.includes('2')) {
                total_2k++;
                if (cat.includes('promocional')) {
                    promo_2k++;
                }
            } else if (dist.includes('1') || cat.includes('1')) {
                total_1k++;
                if (cat.includes('promocional')) {
                    promo_1k++;
                }
            }
        });

        const promo_sold_out_2k = promo_2k >= LIMIT_PROMO;
        const promo_sold_out_1k = promo_1k >= LIMIT_PROMO;

        callback(null, {
            '2 km': {
                limit: LIMIT_RACE,
                registered: total_2k,
                available: Math.max(0, LIMIT_RACE - total_2k),
                is_sold_out: total_2k >= LIMIT_RACE,
                promo: {
                    limit: LIMIT_PROMO,
                    registered: promo_2k,
                    available: Math.max(0, LIMIT_PROMO - promo_2k),
                    is_sold_out: promo_sold_out_2k,
                    active: !promo_sold_out_2k
                },
                regular_unlocked: promo_sold_out_2k
            },
            '1 km': {
                limit: LIMIT_RACE,
                registered: total_1k,
                available: Math.max(0, LIMIT_RACE - total_1k),
                is_sold_out: total_1k >= LIMIT_RACE,
                promo: {
                    limit: LIMIT_PROMO,
                    registered: promo_1k,
                    available: Math.max(0, LIMIT_PROMO - promo_1k),
                    is_sold_out: promo_sold_out_1k,
                    active: !promo_sold_out_1k
                },
                regular_unlocked: promo_sold_out_1k
            },
            'kids': {
                limit: LIMIT_KIDS,
                registered: total_kids,
                available: Math.max(0, LIMIT_KIDS - total_kids),
                is_sold_out: total_kids >= LIMIT_KIDS
            }
        });
    });
}

// Public endpoint: Vagas Disponíveis nas Provas (Limite de 50 para 1 km e 2 km, Lotes Promo de 10, e 20 para Kids)
app.get('/api/public/race-vacancies', (req, res) => {
    getRaceVacancies((err, vacancies) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(vacancies);
    });
});

// Public endpoint: Estoque das Camisas Oficiais (M, G, XG)
app.get('/api/public/tshirt-stock', (req, res) => {
    db.all("SELECT id, name, stock, tshirt_size FROM store_products WHERE tshirt_size IN ('M', 'G', 'XG')", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const stockMap = {
            M: { stock: 0, available: false },
            G: { stock: 0, available: false },
            XG: { stock: 0, available: false }
        };
        (rows || []).forEach(r => {
            if (r.tshirt_size) {
                stockMap[r.tshirt_size] = {
                    id: r.id,
                    name: r.name,
                    stock: r.stock,
                    available: r.stock > 0
                };
            }
        });
        res.json(stockMap);
    });
});

// Public endpoint: Listar Produtos da Loja com Estoque Disponível para Compra Adicional
app.get('/api/public/store-products', (req, res) => {
    db.all("SELECT id, name, stock, sell_price FROM store_products WHERE stock > 0 AND (is_system = 0 OR is_system IS NULL OR sell_price > 0) ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// Helper: Validar vagas, lotes promocionais (10 vagas) e estoque de camisas
function validateVacanciesAndTshirt(cat, cleanTshirt, existingAthlete, callback) {
    const dist = cat.distance;
    const catId = cat.id || '';

    // 1. Verificação de Limites de Vagas e Lotes Promocionais
    const checkVac = (cbVac) => {
        // Prova Kids: Limite de 20 inscrições
        if (catId === 'kids' || dist === 'Kids') {
            const excludeClause = existingAthlete ? 'AND id != ' + existingAthlete.id : '';
            db.get(`
                SELECT COUNT(*) as count 
                FROM athletes 
                WHERE payment_status != 'Cancelado' 
                AND (distance LIKE '%Kid%' OR category LIKE '%Kid%')
                ${excludeClause}
            `, [], (errK, rowK) => {
                if (errK) return cbVac(errK);
                if (rowK && rowK.count >= 20) {
                    return cbVac(new Error('As inscrições para a Travessia Kids estão esgotadas (limite máximo de 20 vagas atingido).'));
                }
                cbVac(null);
            });
            return;
        }

        // Provas de 1 km e 2 km (Limite de 50 vagas no total; 10 destinadas ao lote promocional de largada)
        if (dist === '1 km' || dist === '2 km') {
            const excludeClause = existingAthlete ? 'AND id != ' + existingAthlete.id : '';
            const patternDist = `%${dist}%`;

            db.all(`
                SELECT category, distance
                FROM athletes
                WHERE payment_status != 'Cancelado'
                AND (distance = ? OR category LIKE ?)
                ${excludeClause}
            `, [dist, patternDist], (errRows, rows) => {
                if (errRows) return cbVac(errRows);
                
                const totalCount = (rows || []).length;
                let promoCount = 0;
                (rows || []).forEach(r => {
                    const cName = (r.category || '').toLowerCase();
                    if (cName.includes('promocional')) promoCount++;
                });

                // Teto global da prova: 50 vagas
                if (totalCount >= 50) {
                    return cbVac(new Error(`As inscrições para a prova de ${dist} estão esgotadas (limite máximo de 50 vagas preenchido).`));
                }

                const isPromoCategory = catId.includes('promocional');
                const isPcdCategory = catId.includes('pcd');

                // Se o atleta escolheu categoria Promocional de Largada
                if (isPromoCategory) {
                    if (promoCount >= 10) {
                        return cbVac(new Error(`O lote promocional de largada para a prova de ${dist} está esgotado (limite de 10 vagas preenchido). Por favor, selecione as inscrições regulares.`));
                    }
                } 
                // Se escolheu inscrições regulares (Adulto ou Assessoria), PCD não é bloqueada
                else if (!isPcdCategory) {
                    // Só libera regular/assessoria se o lote promocional de 10 vagas já tiver acabado
                    if (promoCount < 10) {
                        return cbVac(new Error(`As inscrições regulares e de assessorias para a prova de ${dist} só estarão disponíveis após o término do Lote Promocional de Largada (ainda restam ${10 - promoCount} vagas promocionais). Aproveite o valor promocional!`));
                    }
                }

                cbVac(null);
            });
        } else {
            cbVac(null);
        }
    };

    // 2. Verificação de Estoque da Camisa
    const checkTshirt = (cbTshirt) => {
        const isAdultOrPcd = catId !== 'kids' && dist !== 'Kids';
        const size = (cleanTshirt || '').trim().toUpperCase();
        if (isAdultOrPcd && ['M', 'G', 'XG'].includes(size)) {
            db.get("SELECT id, name, stock FROM store_products WHERE tshirt_size = ?", [size], (errT, rowT) => {
                if (errT) return cbTshirt(errT);
                const isSameSize = existingAthlete && existingAthlete.tshirt_size === size;
                if (!isSameSize && (!rowT || rowT.stock <= 0)) {
                    return cbTshirt(new Error(`A camisa oficial no tamanho "${size}" está esgotada no estoque. Por favor, escolha outro tamanho.`));
                }
                cbTshirt(null, { size, isSameSize });
            });
        } else {
            cbTshirt(null, null);
        }
    };

    checkVac((errVac) => {
        if (errVac) return callback(errVac);
        checkTshirt((errT, tResult) => {
            if (errT) return callback(errT);
            callback(null, tResult);
        });
    });
}

// Helper: Ajustar estoque da camisa oficial após confirmação de inscrição
function adjustTshirtStock(cleanTshirt, existingAthlete) {
    const size = (cleanTshirt || '').trim().toUpperCase();
    if (['M', 'G', 'XG'].includes(size)) {
        const isSameSize = existingAthlete && existingAthlete.tshirt_size === size;
        if (!isSameSize) {
            db.run("UPDATE store_products SET stock = MAX(0, stock - 1) WHERE tshirt_size = ?", [size]);
            if (existingAthlete && existingAthlete.tshirt_size && existingAthlete.tshirt_size !== size) {
                db.run("UPDATE store_products SET stock = stock + 1 WHERE tshirt_size = ?", [existingAthlete.tshirt_size]);
            }
        }
    }
}

// Public endpoint: Concluir Inscrição com Validação, Produtos da Loja e Escolha de Pagamento
app.post('/api/public/complete-registration', (req, res) => {
    const { athlete, store_items = [], payment_method } = req.body;

    if (!athlete) {
        return res.status(400).json({ error: 'Dados do atleta não fornecidos.' });
    }

    const {
        name,
        cpf,
        email,
        phone,
        birth_date,
        gender,
        category_id,
        coupon_code,
        tshirt_size,
        emergency_contact_name,
        emergency_contact_phone,
        medical_notes
    } = athlete;

    if (!name || !cpf || !email || !phone || !category_id) {
        return res.status(400).json({ error: 'Preencha todos os campos obrigatórios (Nome, CPF, E-mail, Celular e Modalidade).' });
    }

    const cleanCpf = String(cpf).replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
        return res.status(400).json({ error: 'CPF inválido. Deve conter 11 dígitos numéricos.' });
    }

    const cat = EVENT_CATEGORIES[category_id];
    if (!cat) {
        return res.status(400).json({ error: 'Modalidade de prova inválida selecionada.' });
    }

    if (!payment_method || (payment_method !== 'Pix' && payment_method !== 'Cartão')) {
        return res.status(400).json({ error: 'Selecione uma forma de pagamento válida (Pix ou Cartão).' });
    }

    // 1. Validar cupom caso seja modalidade com assessoria
    const validateCouponPromise = new Promise((resolve, reject) => {
        if (cat.requires_coupon || category_id.includes('assessoria')) {
            if (!coupon_code) {
                return reject(new Error('Para a modalidade de assessorias, informe um cupom válido (5 letras e 2 números).'));
            }
            const cleanCode = String(coupon_code).trim().toUpperCase();
            if (!/^[A-Z]{5}[0-9]{2}$/.test(cleanCode)) {
                return reject(new Error('O cupom deve conter exatamente 5 letras e 2 números (Ex: TUBAS01).'));
            }

            const sql = `
                SELECT c.id, c.code, c.discount_price, a.name as assessoria_name
                FROM coupons c
                JOIN assessorias a ON c.assessoria_id = a.id
                WHERE c.code = ? AND c.active = 1
            `;
            db.get(sql, [cleanCode], (err, row) => {
                if (err) return reject(err);
                if (!row) return reject(new Error('Cupom não encontrado ou inativo.'));
                resolve({
                    price: row.discount_price || cat.price || 119.00,
                    assessoria_name: row.assessoria_name,
                    coupon_code: cleanCode
                });
            });
        } else {
            resolve({
                price: cat.price,
                assessoria_name: null,
                coupon_code: null
            });
        }
    });

    validateCouponPromise.then(catResult => {
        // 2. Verificar se já existe atleta com CPF confirmado
        db.get("SELECT id, name, payment_status, tshirt_size FROM athletes WHERE cpf = ?", [cleanCpf], (err, existing) => {
            if (err) return res.status(500).json({ error: err.message });
            if (existing && existing.payment_status === 'Confirmado') {
                return res.status(400).json({ error: `O CPF informado já possui uma inscrição confirmada (${existing.name}).` });
            }

            // Validar limite de 50 vagas e estoque da camisa
            validateVacanciesAndTshirt(cat, tshirt_size, existing, (valErr) => {
                if (valErr) {
                    return res.status(400).json({ error: valErr.message });
                }

                // 3. Processar produtos da loja
                db.all("SELECT * FROM store_products", [], (err2, allProducts) => {
                    if (err2) return res.status(500).json({ error: err2.message });

                    const prodMap = new Map((allProducts || []).map(p => [p.id, p]));
                    let storeAmount = 0;
                    const purchasedItems = [];

                    if (Array.isArray(store_items)) {
                        for (const item of store_items) {
                            const qty = parseInt(item.quantity, 10);
                            if (qty > 0) {
                                const p = prodMap.get(parseInt(item.id, 10));
                                if (!p) {
                                    return res.status(400).json({ error: `Produto #${item.id} não encontrado na loja.` });
                                }
                                if (p.stock < qty) {
                                    return res.status(400).json({ error: `Estoque insuficiente para o produto "${p.name}". Restam ${p.stock} unidades.` });
                                }
                                const itemTotal = p.sell_price * qty;
                                storeAmount += itemTotal;
                                purchasedItems.push({
                                    id: p.id,
                                    name: p.name,
                                    unit_price: p.sell_price,
                                    quantity: qty,
                                    subtotal: itemTotal
                                });
                            }
                        }
                    }

                    // Decrementar estoque dos produtos comprados
                    purchasedItems.forEach(pItem => {
                        db.run("UPDATE store_products SET stock = MAX(0, stock - ?) WHERE id = ?", [pItem.quantity, pItem.id]);
                    });

                    // Decrementar estoque da camisa do evento
                    adjustTshirtStock(tshirt_size, existing);

                const inscriptionPrice = catResult.price;
                const totalAmount = inscriptionPrice + storeAmount;
                const storeItemsJson = JSON.stringify(purchasedItems);

                const defaultPixKey = 'ostubaroescansados@gmail.com';
                const defaultPixPayload = '00020126850014br.gov.bcb.pix0128ostubaroescansados@gmail.com0231Pagamento aos Tubarões Cansados5204000053039865802BR5918Michel C. M. Alves6002NA62070503***6304E5D9';
                const defaultPixReceiver = 'Michel C. M. Alves';
                const defaultPixQrImage = '/pix_qrcode.jpg';
                const defaultCardLink = 'https://mpago.la/tubaroescansados';

                if (existing) {
                    const sqlUpdate = `UPDATE athletes SET
                        name = ?, email = ?, phone = ?, birth_date = ?, gender = ?,
                        category = ?, distance = ?, price = ?, coupon_code = ?, assessoria_name = ?,
                        tshirt_size = ?, emergency_contact_name = ?, emergency_contact_phone = ?,
                        medical_notes = ?, payment_method = ?, store_items = ?, store_amount = ?, total_amount = ?
                        WHERE id = ?`;
                    db.run(sqlUpdate, [
                        name.trim(), email.trim(), phone.trim(), birth_date || null, gender || null,
                        cat.name, cat.distance, inscriptionPrice, catResult.coupon_code,
                        catResult.assessoria_name, tshirt_size || 'M', emergency_contact_name ? emergency_contact_name.trim() : null,
                        emergency_contact_phone ? emergency_contact_phone.trim() : null,
                        medical_notes ? medical_notes.trim() : null, payment_method,
                        storeItemsJson, storeAmount, totalAmount, existing.id
                    ], function(err3) {
                        if (err3) return res.status(500).json({ error: err3.message });
                        return res.json({
                            success: true,
                            athlete_id: existing.id,
                            athlete_name: name.trim(),
                            cpf: cleanCpf,
                            category: cat.name,
                            inscription_price: inscriptionPrice,
                            store_items: purchasedItems,
                            store_amount: storeAmount,
                            total_amount: totalAmount,
                            payment_method,
                            pix_key: defaultPixKey,
                            pix_payload: defaultPixPayload,
                            pix_receiver: defaultPixReceiver,
                            pix_qr_image: defaultPixQrImage,
                            card_payment_link: defaultCardLink,
                            message: 'Inscrição confirmada com sucesso!'
                        });
                    });
                } else {
                    const sqlInsert = `INSERT INTO athletes (
                        name, cpf, email, phone, birth_date, gender,
                        category, distance, price, coupon_code, assessoria_name,
                        tshirt_size, emergency_contact_name, emergency_contact_phone,
                        medical_notes, payment_status, payment_method, store_items, store_amount, total_amount
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendente', ?, ?, ?, ?)`;

                    db.run(sqlInsert, [
                        name.trim(), cleanCpf, email.trim(), phone.trim(), birth_date || null, gender || null,
                        cat.name, cat.distance, inscriptionPrice, catResult.coupon_code,
                        catResult.assessoria_name, tshirt_size || 'M', emergency_contact_name ? emergency_contact_name.trim() : null,
                        emergency_contact_phone ? emergency_contact_phone.trim() : null,
                        medical_notes ? medical_notes.trim() : null, payment_method,
                        storeItemsJson, storeAmount, totalAmount
                    ], function(err3) {
                        if (err3) return res.status(500).json({ error: err3.message });
                        const newId = this.lastID;
                        return res.json({
                            success: true,
                            athlete_id: newId,
                            athlete_name: name.trim(),
                            cpf: cleanCpf,
                            category: cat.name,
                            inscription_price: inscriptionPrice,
                            store_items: purchasedItems,
                            store_amount: storeAmount,
                            total_amount: totalAmount,
                            payment_method,
                            pix_key: defaultPixKey,
                            pix_payload: defaultPixPayload,
                            pix_receiver: defaultPixReceiver,
                            pix_qr_image: defaultPixQrImage,
                            card_payment_link: defaultCardLink,
                            message: 'Inscrição confirmada com sucesso!'
                        });
                    });
                }
            });
        });
        });
    }).catch(err => {
        return res.status(400).json({ error: err.message });
    });
});

// Public endpoint: Register Athlete
app.post('/api/public/register-athlete', (req, res) => {
    const {
        name,
        cpf,
        email,
        phone,
        birth_date,
        gender,
        category_id,
        coupon_code,
        assessoria_name,
        tshirt_size,
        emergency_contact_name,
        emergency_contact_phone,
        medical_notes
    } = req.body;

    if (!name || !cpf || !email || !phone || !category_id) {
        return res.status(400).json({ error: 'Preencha todos os campos obrigatórios (Nome, CPF, E-mail, Celular e Modalidade).' });
    }

    const cleanCpf = String(cpf).replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
        return res.status(400).json({ error: 'CPF inválido. Deve conter 11 dígitos numéricos.' });
    }

    const cat = EVENT_CATEGORIES[category_id];
    if (!cat) {
        return res.status(400).json({ error: 'Modalidade de prova inválida selecionada.' });
    }

    // Check if athlete already registered
    db.get("SELECT id, name, payment_status, tshirt_size FROM athletes WHERE cpf = ?", [cleanCpf], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existing && existing.payment_status === 'Confirmado') {
            return res.status(400).json({ error: `O CPF informado já possui uma inscrição confirmada (${existing.name}). Em caso de dúvidas, contate os organizadores.` });
        }

        // Validar limite de 50 vagas e estoque da camisa
        validateVacanciesAndTshirt(cat, tshirt_size, existing, (valErr) => {
            if (valErr) {
                return res.status(400).json({ error: valErr.message });
            }

            const categoryName = cat.name;
            const distance = cat.distance;
            const price = cat.price;

            // Ajustar estoque da camisa oficial
            adjustTshirtStock(tshirt_size, existing);

            if (existing) {
                // Update existing pending registration
                const sqlUpdate = `UPDATE athletes SET
                    name = ?, email = ?, phone = ?, birth_date = ?, gender = ?,
                    category = ?, distance = ?, price = ?, coupon_code = ?, assessoria_name = ?,
                    tshirt_size = ?, emergency_contact_name = ?, emergency_contact_phone = ?,
                    medical_notes = ?
                    WHERE id = ?`;
                db.run(sqlUpdate, [
                    name.trim(), email.trim(), phone.trim(), birth_date || null, gender || null,
                    categoryName, distance, price, coupon_code ? coupon_code.trim().toUpperCase() : null,
                    assessoria_name ? assessoria_name.trim() : null,
                    tshirt_size || 'M', emergency_contact_name ? emergency_contact_name.trim() : null,
                    emergency_contact_phone ? emergency_contact_phone.trim() : null,
                    medical_notes ? medical_notes.trim() : null,
                    existing.id
                ], function(err2) {
                    if (err2) return res.status(500).json({ error: err2.message });
                    return res.json({
                        success: true,
                        athlete_id: existing.id,
                        updated: true,
                        message: 'Inscrição atualizada com sucesso!',
                        athlete: {
                            id: existing.id,
                            name: name.trim(),
                            cpf: cleanCpf,
                            category: categoryName,
                            distance,
                            price,
                            payment_status: 'Pendente'
                        }
                    });
                });
            } else {
                // Insert new athlete
                const sqlInsert = `INSERT INTO athletes (
                    name, cpf, email, phone, birth_date, gender,
                    category, distance, price, coupon_code, assessoria_name,
                    tshirt_size, emergency_contact_name, emergency_contact_phone,
                    medical_notes, payment_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendente')`;

                db.run(sqlInsert, [
                    name.trim(), cleanCpf, email.trim(), phone.trim(), birth_date || null, gender || null,
                    categoryName, distance, price, coupon_code ? coupon_code.trim().toUpperCase() : null,
                    assessoria_name ? assessoria_name.trim() : null,
                    tshirt_size || 'M', emergency_contact_name ? emergency_contact_name.trim() : null,
                    emergency_contact_phone ? emergency_contact_phone.trim() : null,
                    medical_notes ? medical_notes.trim() : null
                ], function(err2) {
                    if (err2) return res.status(500).json({ error: err2.message });
                    const newId = this.lastID;
                    return res.json({
                        success: true,
                        athlete_id: newId,
                        message: 'Inscrição realizada com sucesso!',
                        athlete: {
                            id: newId,
                            name: name.trim(),
                            cpf: cleanCpf,
                            category: categoryName,
                            distance,
                            price,
                            payment_status: 'Pendente'
                        }
                    });
                });
            }
        });
    });
});

// ─── Protected Athlete Management Routes (Área dos Organizadores) ───────────
app.get('/api/athletes', requireAuth, (req, res) => {
    let sql = "SELECT * FROM athletes WHERE 1=1";
    const params = [];

    if (req.query.status && req.query.status !== 'all') {
        sql += " AND payment_status = ?";
        params.push(req.query.status);
    }
    if (req.query.checkin !== undefined && req.query.checkin !== 'all' && req.query.checkin !== '') {
        sql += " AND checkin_status = ?";
        params.push(parseInt(req.query.checkin, 10));
    }
    if (req.query.search) {
        sql += " AND (name LIKE ? OR cpf LIKE ? OR email LIKE ? OR assessoria_name LIKE ?)";
        const term = `%${req.query.search.trim()}%`;
        params.push(term, term, term, term);
    }

    sql += " ORDER BY id DESC";

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/athletes/:id', requireAuth, (req, res) => {
    db.get("SELECT * FROM athletes WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Atleta não encontrado.' });
        res.json(row);
    });
});

// Confirm Payment (Cartão ou Pix)
app.put('/api/athletes/:id/confirm-payment', requireAuth, (req, res) => {
    const { payment_method, price } = req.body;
    if (!payment_method || (payment_method !== 'Pix' && payment_method !== 'Cartão')) {
        return res.status(400).json({ error: 'Forma de confirmação inválida. Escolha "Pix" ou "Cartão".' });
    }

    const confirmedBy = req.session && req.session.userId ? (req.session.username || 'Organizador') : 'Organizador';

    let sql = `UPDATE athletes SET
        payment_status = 'Confirmado',
        payment_method = ?,
        payment_date = datetime('now', 'localtime'),
        confirmed_by = ?`;
    const params = [payment_method, confirmedBy];

    if (price !== undefined && price !== null && !isNaN(price)) {
        sql += `, price = ?, total_amount = COALESCE(total_amount, ?)`;
        params.push(parseFloat(price), parseFloat(price));
    }

    sql += ` WHERE id = ?`;
    params.push(req.params.id);

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Atleta não encontrado.' });

        db.get("SELECT * FROM athletes WHERE id = ?", [req.params.id], (err2, updated) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ success: true, message: `Pagamento via ${payment_method} confirmado com sucesso!`, athlete: updated });
        });
    });
});

// Revert Payment to Pending
app.put('/api/athletes/:id/cancel-payment', requireAuth, (req, res) => {
    db.run(`UPDATE athletes SET
        payment_status = 'Pendente',
        payment_method = NULL,
        payment_date = NULL,
        confirmed_by = NULL
        WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Atleta não encontrado.' });
        res.json({ success: true, message: 'Status de pagamento revertido para Pendente.' });
    });
});

// Check-in Athlete
app.put('/api/athletes/:id/checkin', requireAuth, (req, res) => {
    const { kit_retrieved_by, cap_number, tshirt_size, checkin_photo } = req.body;
    db.run(`UPDATE athletes SET
        checkin_status = 1,
        checkin_date = datetime('now', 'localtime'),
        kit_retrieved_by = COALESCE(?, kit_retrieved_by, 'Próprio atleta'),
        cap_number = COALESCE(?, cap_number),
        tshirt_size = COALESCE(?, tshirt_size),
        checkin_photo = COALESCE(?, checkin_photo)
        WHERE id = ?`,
        [kit_retrieved_by || null, cap_number || null, tshirt_size || null, checkin_photo || null, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Atleta não encontrado.' });
            res.json({ success: true, message: 'Check-in realizado com sucesso!' });
        }
    );
});

// Undo Check-in
app.put('/api/athletes/:id/undo-checkin', requireAuth, (req, res) => {
    db.run(`UPDATE athletes SET
        checkin_status = 0,
        checkin_date = NULL,
        cap_number = NULL,
        kit_retrieved_by = NULL
        WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Atleta não encontrado.' });
        res.json({ success: true, message: 'Check-in cancelado.' });
    });
});

// Update Athlete Details
app.put('/api/athletes/:id', requireAuth, (req, res) => {
    const { name, email, phone, tshirt_size, category, price, cap_number, notes } = req.body;
    db.run(`UPDATE athletes SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        tshirt_size = COALESCE(?, tshirt_size),
        category = COALESCE(?, category),
        price = COALESCE(?, price),
        cap_number = COALESCE(?, cap_number),
        notes = COALESCE(?, notes)
        WHERE id = ?`,
        [name, email, phone, tshirt_size, category, price, cap_number, notes, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Atleta não encontrado.' });
            res.json({ success: true, message: 'Cadastro do atleta atualizado com sucesso!' });
        }
    );
});

// Delete Athlete Registration (Restores allocated t-shirt and store items)
app.delete('/api/athletes/:id', requireAuth, (req, res) => {
    db.get("SELECT id, tshirt_size, store_items FROM athletes WHERE id = ?", [req.params.id], (err, athlete) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!athlete) return res.status(404).json({ error: 'Atleta não encontrado.' });

        // Devolver camisa ao estoque
        if (athlete.tshirt_size && ['M', 'G', 'XG'].includes(athlete.tshirt_size.trim().toUpperCase())) {
            db.run("UPDATE store_products SET stock = stock + 1 WHERE tshirt_size = ?", [athlete.tshirt_size.trim().toUpperCase()]);
        }

        // Devolver produtos comprados da loja
        if (athlete.store_items) {
            try {
                const items = JSON.parse(athlete.store_items);
                if (Array.isArray(items)) {
                    items.forEach(it => {
                        db.run("UPDATE store_products SET stock = stock + ? WHERE id = ?", [it.quantity, it.id]);
                    });
                }
            } catch (e) {}
        }

        db.run("DELETE FROM athletes WHERE id = ?", [req.params.id], function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ deleted: true });
        });
    });
});

// Upload Check-in Photo
app.post('/api/athletes/:id/photo', requireAuth, (req, res) => {
    const { photo } = req.body;
    if (!photo) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });

    const photoDir = path.join(__dirname, 'public', 'uploads', 'checkin');
    if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });

    const matches = photo.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        return res.status(400).json({ error: 'Formato de imagem base64 inválido.' });
    }

    const ext = matches[1].includes('png') ? 'png' : 'jpg';
    const buffer = Buffer.from(matches[2], 'base64');
    const fileName = `atleta_${req.params.id}_${Date.now()}.${ext}`;
    const filePath = path.join(photoDir, fileName);
    const photoUrl = `/uploads/checkin/${fileName}`;

    fs.writeFile(filePath, buffer, (err) => {
        if (err) {
            console.error('Erro ao salvar foto de check-in:', err);
            return res.status(500).json({ error: 'Erro ao salvar arquivo da foto.' });
        }
        db.run("UPDATE athletes SET checkin_photo = ? WHERE id = ?", [photoUrl, req.params.id], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ success: true, photoUrl });
        });
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
    const { name, amount, has_store_coupon, has_beer_voucher, date } = req.body;
    db.run(
        "INSERT INTO party_tickets (name, amount, has_store_coupon, has_beer_voucher, date) VALUES (?, ?, ?, ?, ?)",
        [name, amount, has_store_coupon ? 1 : 0, has_beer_voucher ? 1 : 0, date],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name, amount, has_store_coupon, has_beer_voucher, date });
        }
    );
});
app.put('/api/party_tickets/:id/:field', requireAuth, (req, res) => {
    const allowedFields = ['has_store_coupon', 'has_beer_voucher'];
    const field = req.params.field;
    if (!allowedFields.includes(field)) return res.status(400).json({ error: "Invalid field" });
    
    const { value } = req.body;
    db.run(`UPDATE party_tickets SET ${field} = ? WHERE id = ?`, [value ? 1 : 0, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes > 0 });
    });
});
app.delete('/api/party_tickets/:id', requireAuth, (req, res) => {
    db.run("DELETE FROM party_tickets WHERE id = ?", req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes > 0 });
    });
});

// ─── Assessorias & Cupons (Área Administrativa) ────────────────────────────

// Listar todas as Assessorias com contagem de cupons e atletas inscritos
app.get('/api/assessorias', requireAuth, (req, res) => {
    const sql = `
        SELECT a.*, 
            (SELECT COUNT(*) FROM coupons c WHERE c.assessoria_id = a.id) as coupons_count,
            (SELECT COUNT(*) FROM athletes ath WHERE ath.assessoria_name = a.name) as athletes_count
        FROM assessorias a 
        ORDER BY a.name ASC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// Cadastrar Assessoria
app.post('/api/assessorias', requireAuth, (req, res) => {
    const { name, responsible_name, phone, email } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'O nome da assessoria é obrigatório.' });
    }

    db.run(
        "INSERT INTO assessorias (name, responsible_name, phone, email) VALUES (?, ?, ?, ?)",
        [name.trim(), responsible_name ? responsible_name.trim() : null, phone ? phone.trim() : null, email ? email.trim() : null],
        function(err) {
            if (err) {
                if (err.message && err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Já existe uma assessoria cadastrada com este nome.' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, name: name.trim(), responsible_name, phone, email });
        }
    );
});

// Excluir Assessoria (e seus cupons)
app.delete('/api/assessorias/:id', requireAuth, (req, res) => {
    db.run("DELETE FROM coupons WHERE assessoria_id = ?", [req.params.id], () => {
        db.run("DELETE FROM assessorias WHERE id = ?", [req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ deleted: this.changes > 0 });
        });
    });
});

// Listar Cupons com Nome da Assessoria e Quantidade de Usos
app.get('/api/coupons', requireAuth, (req, res) => {
    const sql = `
        SELECT c.*, a.name as assessoria_name,
            (SELECT COUNT(*) FROM athletes ath WHERE ath.coupon_code = c.code) as uses_count
        FROM coupons c
        JOIN assessorias a ON c.assessoria_id = a.id
        ORDER BY c.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// Cadastrar Cupom (Validação: 5 letras seguidas de 2 números)
app.post('/api/coupons', requireAuth, (req, res) => {
    const { assessoria_id, code } = req.body;
    if (!assessoria_id || !code) {
        return res.status(400).json({ error: 'Selecione a assessoria e informe o código do cupom.' });
    }

    const cleanCode = String(code).trim().toUpperCase();

    // Validação estrita: 5 letras e 2 números (ex: TUBAS01)
    if (!/^[A-Z]{5}[0-9]{2}$/.test(cleanCode)) {
        return res.status(400).json({
            error: 'O código do cupom deve conter exatamente 5 letras seguidas de 2 números (Exemplo: TUBAS01, RUNVV26).'
        });
    }

    db.run(
        "INSERT INTO coupons (code, assessoria_id, discount_price) VALUES (?, ?, 119.00)",
        [cleanCode, assessoria_id],
        function(err) {
            if (err) {
                if (err.message && err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: `O cupom "${cleanCode}" já foi cadastrado no sistema.` });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, code: cleanCode, assessoria_id, discount_price: 119.00 });
        }
    );
});

// Excluir Cupom
app.delete('/api/coupons/:id', requireAuth, (req, res) => {
    db.run("DELETE FROM coupons WHERE id = ?", [req.params.id], function(err) {
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
app.get('/api/public/store_products', (req, res) => {
    db.all("SELECT id, name, stock, sell_price FROM store_products WHERE stock > 0 ORDER BY name ASC", [], (err, rows) => {
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
    db.get("SELECT id, name, is_system, tshirt_size FROM store_products WHERE id = ?", [req.params.id], (err, prod) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!prod) return res.status(404).json({ error: "Produto não encontrado." });
        if (prod.is_system === 1 || prod.tshirt_size) {
            return res.status(400).json({ error: "Este produto é um item fixo do estoque (camisa oficial do evento) e não pode ser excluído." });
        }
        db.run("DELETE FROM store_products WHERE id = ?", [req.params.id], function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ deleted: this.changes > 0 });
        });
    });
});
app.put('/api/store_products/:id', requireAuth, (req, res) => {
    db.get("SELECT * FROM store_products WHERE id = ?", [req.params.id], (err, current) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!current) return res.status(404).json({ error: "Produto não encontrado." });

        const name = req.body.name !== undefined ? req.body.name : current.name;
        const stock = req.body.stock !== undefined ? parseInt(req.body.stock, 10) : current.stock;
        const cost_price = req.body.cost_price !== undefined ? parseFloat(req.body.cost_price) : current.cost_price;
        const sell_price = req.body.sell_price !== undefined ? parseFloat(req.body.sell_price) : current.sell_price;

        db.run(
            "UPDATE store_products SET name = ?, stock = ?, cost_price = ?, sell_price = ? WHERE id = ?",
            [name, Math.max(0, stock), cost_price, sell_price, req.params.id],
            function(err2) {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ updated: this.changes > 0, id: req.params.id, name, stock: Math.max(0, stock), sell_price });
            }
        );
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
        SELECT s.id, p.name as product_name, s.buyer_name, s.quantity, s.discount, s.total_amount, s.date, s.payment_method, s.package_id
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
    const { product_id, buyer_name, quantity, discount, date, payment_method } = req.body;
    db.get("SELECT sell_price, stock FROM store_products WHERE id = ?", [product_id], (err, product) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!product) return res.status(404).json({ error: "Product not found" });
        if (product.stock < quantity) return res.status(400).json({ error: "Insufficient stock" });

        const total_amount = (product.sell_price * quantity) - (parseFloat(discount) || 0);
        
        db.run("INSERT INTO store_sales (product_id, buyer_name, quantity, discount, payment_method, total_amount, date) VALUES (?, ?, ?, ?, ?, ?, ?)", 
        [product_id, buyer_name || 'Anônimo', quantity, parseFloat(discount) || 0, payment_method || 'Não informado', total_amount, date], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Only update stock if the insert was successful
            db.run("UPDATE store_products SET stock = stock - ? WHERE id = ?", [quantity, product_id], function(errStock) {
                if (errStock) return res.status(500).json({ error: errStock.message });
                res.json({ success: true, total_amount });
            });
        });
    });
});
app.delete('/api/store_sales/:id', requireAuth, (req, res) => {
    db.get("SELECT product_id, quantity FROM store_sales WHERE id = ?", [req.params.id], (err, sale) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!sale) return res.status(404).json({ error: "Sale not found" });
        db.serialize(() => {
            db.run("DELETE FROM store_sales WHERE id = ?", [req.params.id]);
            db.run("UPDATE store_products SET stock = stock + ? WHERE id = ?", [sale.quantity, sale.product_id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ deleted: true });
            });
        });
    });
});
app.put('/api/store_sales/:id/discount', requireAuth, (req, res) => {
    const { discount } = req.body;
    db.get(`
        SELECT s.quantity, p.sell_price 
        FROM store_sales s 
        JOIN store_products p ON s.product_id = p.id 
        WHERE s.id = ?
    `, [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Sale not found" });
        
        const new_total = (row.sell_price * row.quantity) - (parseFloat(discount) || 0);
        db.run("UPDATE store_sales SET discount = ?, total_amount = ? WHERE id = ?", [parseFloat(discount) || 0, new_total, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ updated: this.changes > 0, total_amount: new_total });
        });
    });
});
// --- Store Packages ---
app.get('/api/store_packages', requireAuth, (req, res) => {
    db.all("SELECT * FROM store_packages ORDER BY id DESC", [], (err, packages) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Fetch items for each package
        const pkgPromises = packages.map(pkg => {
            return new Promise((resolve, reject) => {
                db.all(`
                    SELECT s.quantity, p.name as product_name 
                    FROM store_sales s 
                    JOIN store_products p ON s.product_id = p.id 
                    WHERE s.package_id = ?
                `, [pkg.id], (err, items) => {
                    if (err) reject(err);
                    else {
                        pkg.items = items;
                        resolve(pkg);
                    }
                });
            });
        });

        Promise.all(pkgPromises)
            .then(completedPackages => res.json(completedPackages))
            .catch(err => res.status(500).json({ error: err.message }));
    });
});

app.post('/api/store_packages', requireAuth, (req, res) => {
    const { recipient_name, sale_ids } = req.body;
    if (!sale_ids || sale_ids.length === 0) return res.status(400).json({ error: "Nenhuma venda selecionada" });

    db.run("INSERT INTO store_packages (recipient_name) VALUES (?)", [recipient_name], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const packageId = this.lastID;
        
        const placeholders = sale_ids.map(() => '?').join(',');
        db.run(`UPDATE store_sales SET package_id = ? WHERE id IN (${placeholders})`, [packageId, ...sale_ids], function(errUpdate) {
            if (errUpdate) return res.status(500).json({ error: errUpdate.message });
            res.json({ success: true, package_id: packageId });
        });
    });
});

app.put('/api/store_packages/:id/status', requireAuth, (req, res) => {
    const { status } = req.body;
    db.run("UPDATE store_packages SET status = ? WHERE id = ?", [status, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes > 0 });
    });
});
app.delete('/api/store_packages/:id', requireAuth, (req, res) => {
    const pkgId = req.params.id;
    db.all("SELECT id, product_id, quantity FROM store_sales WHERE package_id = ?", [pkgId], (err, sales) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            let hasError = false;
            
            db.run("DELETE FROM store_packages WHERE id = ?", [pkgId], (err) => { if (err) hasError = true; });
            
            sales.forEach(sale => {
                db.run("DELETE FROM store_sales WHERE id = ?", [sale.id], (err) => { if (err) hasError = true; });
                db.run("UPDATE store_products SET stock = stock + ? WHERE id = ?", [sale.quantity, sale.product_id], (err) => { if (err) hasError = true; });
            });
            
            db.run("COMMIT", (err) => {
                if (err || hasError) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: "Erro ao excluir o pacote." });
                }
                res.json({ success: true });
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
app.put('/api/costs/:type/:id', requireAuth, (req, res) => {
    const table = req.params.type === 'party' ? 'party_costs' : 'event_costs';
    const { description, amount, date } = req.body;
    db.run(
        `UPDATE ${table} SET description = ?, amount = ?, date = ? WHERE id = ?`,
        [description, amount, date, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ updated: this.changes > 0 });
        }
    );
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



// --- Dashboard Summary Integrado ---
app.get('/api/summary', requireAuth, (req, res) => {
    const summary = {
        athletes: {
            total_count: 0,
            confirmed_count: 0,
            confirmed_amount: 0,
            pix_count: 0,
            pix_amount: 0,
            card_count: 0,
            card_amount: 0,
            pending_count: 0,
            pending_amount: 0,
            checkin_count: 0,
            categories: {}
        },
        income: {
            athletes: 0,
            athletes_pix: 0,
            athletes_card: 0,
            sponsors: 0,
            store_sales: 0
        },
        expenses: {
            event_costs: 0,
            party_costs: 0,
            store_costs: 0
        },
        total_income: 0,
        total_expenses: 0,
        total_balance: 0
    };

    const qAthletes = new Promise((resolve) => {
        db.all("SELECT category, payment_status, payment_method, price, total_amount, checkin_status FROM athletes", (err, rows) => {
            if (!err && rows) {
                summary.athletes.total_count = rows.length;
                rows.forEach(r => {
                    const price = (parseFloat(r.total_amount) > 0 ? parseFloat(r.total_amount) : (parseFloat(r.price) || 0));
                    const catName = r.category || 'Não categorizado';
                    if (!summary.athletes.categories[catName]) {
                        summary.athletes.categories[catName] = { total: 0, confirmed: 0, revenue: 0 };
                    }
                    summary.athletes.categories[catName].total++;

                    if (r.payment_status === 'Confirmado') {
                        summary.athletes.confirmed_count++;
                        summary.athletes.confirmed_amount += price;
                        summary.athletes.categories[catName].confirmed++;
                        summary.athletes.categories[catName].revenue += price;

                        if (r.payment_method === 'Pix') {
                            summary.athletes.pix_count++;
                            summary.athletes.pix_amount += price;
                        } else if (r.payment_method === 'Cartão') {
                            summary.athletes.card_count++;
                            summary.athletes.card_amount += price;
                        }
                    } else {
                        summary.athletes.pending_count++;
                        summary.athletes.pending_amount += price;
                    }

                    if (r.checkin_status === 1) {
                        summary.athletes.checkin_count++;
                    }
                });
            }
            summary.income.athletes = summary.athletes.confirmed_amount;
            summary.income.athletes_pix = summary.athletes.pix_amount;
            summary.income.athletes_card = summary.athletes.card_amount;
            resolve();
        });
    });

    const qSponsors = new Promise((resolve) => {
        db.get("SELECT COALESCE(SUM(amount), 0) as s FROM sponsors", (e, r) => {
            if (r) summary.income.sponsors = r.s || 0;
            resolve();
        });
    });

    const qEventCosts = new Promise((resolve) => {
        db.get("SELECT COALESCE(SUM(amount), 0) as s FROM event_costs", (e, r) => {
            if (r) summary.expenses.event_costs = r.s || 0;
            resolve();
        });
    });

    const qPartyCosts = new Promise((resolve) => {
        db.get("SELECT COALESCE(SUM(amount), 0) as s FROM party_costs", (e, r) => {
            if (r) summary.expenses.party_costs = r.s || 0;
            resolve();
        });
    });

    Promise.all([qAthletes, qSponsors, qEventCosts, qPartyCosts]).then(() => {
        summary.total_income = summary.income.athletes + summary.income.sponsors;
        summary.total_expenses = summary.expenses.event_costs + summary.expenses.party_costs;
        summary.total_balance = summary.total_income - summary.total_expenses;
        res.json(summary);
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

// ─── Check-in Tutubas ────────────────────────────────────────────────────────
const checkinVolumeDir = path.join(baseSessionDir, 'checkin');
const checkinUploadsDir = path.join(checkinVolumeDir, 'uploads');
const checkinDataFile = path.join(checkinVolumeDir, 'data.json');

if (!fs.existsSync(checkinUploadsDir)) fs.mkdirSync(checkinUploadsDir, { recursive: true });

// --- INÍCIO PATCH DE CORREÇÃO (Desfazer check-out da Daniela) ---
try {
    if (fs.existsSync(checkinDataFile)) {
        let liveData = JSON.parse(fs.readFileSync(checkinDataFile, 'utf8'));
        let fixed = false;
        for (let a of liveData) {
            if (a.cpf === '05888502766') {
                if (a.checkout3kmRealizado || a.checkoutRealizado) {
                    a.checkout3kmRealizado = false;
                    a.checkoutRealizado = false;
                    fixed = true;
                }
            }
        }
        if (fixed) {
            fs.writeFileSync(checkinDataFile, JSON.stringify(liveData, null, 2));
            console.log("Patch executado: check-out da Daniela desfeito com sucesso.");
        }
    }
} catch(e) {
    console.error("Erro ao rodar patch:", e);
}
// --- FIM PATCH ---


const sourceDataFile = path.join(__dirname, 'checkin', 'public', 'data.json');
if (fs.existsSync(sourceDataFile)) {
    // FORCED RESET - requested by user to clear tests
    const resetMarker = path.join(checkinVolumeDir, 'reset_v5.txt');
    if (!fs.existsSync(resetMarker)) {
        fs.copyFileSync(sourceDataFile, checkinDataFile);
        fs.writeFileSync(resetMarker, 'done');
        console.log("Banco de dados resetado com sucesso para as informações originais!");
    }

    const sourceData = JSON.parse(fs.readFileSync(sourceDataFile, 'utf8'));
    let currentData = [];
    if (fs.existsSync(checkinDataFile)) {
        try { currentData = JSON.parse(fs.readFileSync(checkinDataFile, 'utf8')); } catch(e){}
    }
    
    const currentMap = new Map(currentData.map(a => [a.id, a]));
    let changed = false;
    for (const a of sourceData) {
        if (!currentMap.has(a.id)) {
            currentData.push(a);
            changed = true;
        } else {
            // Update existing athlete data but preserve their checkin status
            const existing = currentMap.get(a.id);
            if (existing.nome !== a.nome || existing.cpf !== a.cpf || existing.prova !== a.prova || existing.camisa !== a.camisa) {
                existing.nome = a.nome;
                existing.cpf = a.cpf;
                existing.prova = a.prova;
                existing.camisa = a.camisa;
                changed = true;
            }
        }
    }
    
    if (currentData.length === 0 && sourceData.length > 0) {
        currentData = sourceData;
        changed = true;
    }
    
    if (changed) {
        fs.writeFileSync(checkinDataFile, JSON.stringify(currentData, null, 2));
        console.log("Banco de dados fundido/restaurado com sucesso do arquivo public/data.json");
    }
} else if (!fs.existsSync(checkinDataFile)) {
    fs.writeFileSync(checkinDataFile, '[]');
}

// Em vez de restringir a pasta inteira para /checkin (que limitaria requests sem a barra no final), 
// montamos a pasta estática sob /checkin
app.use('/checkin', express.static(path.join(__dirname, 'checkin')));
app.use('/checkin/uploads', express.static(checkinUploadsDir));

app.get('/checkin/data.json', (req, res) => {
    db.all("SELECT * FROM athletes ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const formatted = rows.map(a => ({
            id: a.id,
            nome: a.name,
            cpf: a.cpf,
            telefone: a.phone || '',
            camisa: a.tshirt_size || 'M',
            prova: a.distance || a.category,
            categoria: a.category,
            pagamentoStatus: a.payment_status,
            pagamentoMetodo: a.payment_method,
            checkinRealizado: a.checkin_status === 1,
            fotoUrl: a.checkin_photo || null,
            kitRetiradoPor: a.kit_retrieved_by || null,
            numeroTouca: a.cap_number || null
        }));
        res.json(formatted);
    });
});

app.post('/checkin/data.json', (req, res) => {
    try {
        const incoming = req.body; // array de atletas do iPad
        if (!Array.isArray(incoming)) return res.status(400).json({ error: "Invalid data" });

        // Lê o estado atual do servidor
        let current = [];
        if (fs.existsSync(checkinDataFile)) {
            try { current = JSON.parse(fs.readFileSync(checkinDataFile, 'utf8')); } catch(e) {}
        }

        // Merge: mantém servidor como base, aplica check-ins do iPad que o servidor não tem
        const serverMap = new Map(current.map(a => [String(a.id), a]));
        let merged = 0;

        incoming.forEach(local => {
            const key = String(local.id);
            if (serverMap.has(key)) {
                const srv = serverMap.get(key);
                let changed = false;
                if (local.checkinRealizado && !srv.checkinRealizado) {
                    srv.checkinRealizado = true;
                    srv.fotoUrl = local.fotoUrl || srv.fotoUrl;
                    srv.telefone = local.telefone || srv.telefone;
                    srv.camisa = local.camisa || srv.camisa;
                    srv.prova = local.prova || srv.prova;
                    srv.kitRetiradoPor = local.kitRetiradoPor || srv.kitRetiradoPor;
                    changed = true;
                }
                
                if (local.checkoutRealizado && !srv.checkoutRealizado) {
                    srv.checkoutRealizado = true;
                    srv.checkoutProva = local.checkoutProva || srv.checkoutProva;
                    srv.checkoutTime = local.checkoutTime || srv.checkoutTime;
                    changed = true;
                }
                
                if (local.checkout1kmRealizado && !srv.checkout1kmRealizado) {
                    srv.checkout1kmRealizado = true;
                    changed = true;
                }
                if (local.checkout3kmRealizado && !srv.checkout3kmRealizado) {
                    srv.checkout3kmRealizado = true;
                    changed = true;
                }
                
                if (changed) merged++;
            }
            // Não adiciona IDs desconhecidos para evitar "fantasmas" de caches corrompidos
        });

        fs.writeFile(checkinDataFile, JSON.stringify(current, null, 2), (err) => {
            if (err) return res.status(500).json({ error: "Failed to save data" });
            console.log(`[checkin] Sync recebido: ${merged} check-ins mesclados de ${incoming.length} atletas.`);
            res.json({ success: true, merged });
        });
    } catch(e) {
        console.error('[checkin] Erro no sync:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/checkin/upload.php', (req, res) => {
    const { image, id } = req.body;
    if (!image || !id) return res.status(400).json({ error: "Missing image or ID" });

    const imageParts = image.split(";base64,");
    if (imageParts.length !== 2) return res.status(400).json({ error: "Invalid image format" });

    const imageTypeAux = imageParts[0].split("image/");
    const imageType = imageTypeAux[1] || 'jpg';
    const imageBase64 = Buffer.from(imageParts[1], 'base64');

    const sanitizedId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `atleta_${sanitizedId}.${imageType}`;
    const filePath = path.join(checkinUploadsDir, fileName);

    fs.writeFile(filePath, imageBase64, (err) => {
        if (err) return res.status(500).json({ error: "Failed to save image" });
        res.status(200).json({ success: true, url: `uploads/${fileName}` });
    });
});

// ─── Online Orders (Public Store) ──────────────────────────────────────────
app.post('/api/process-receipt', upload.single('receipt'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No image provided" });
    
    try {
        const result = await Tesseract.recognize(req.file.path, 'por');
        const text = result.data.text.toLowerCase();
        
        let extractedAmount = 0;
        // Attempt to find R$ XXX,XX
        const amountMatch = text.match(/r\$\s*(\d+[.,]\d{2})/);
        if (amountMatch) {
            extractedAmount = parseFloat(amountMatch[1].replace(',', '.'));
        }

        res.json({ 
            success: true, 
            text: result.data.text,
            extractedAmount,
            imagePath: `/uploads/${req.file.filename}`
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to process image OCR" });
    }
});

app.post('/api/online_orders', (req, res) => {
    const { buyer_name, total_amount, receipt_image_path, selected_products } = req.body;
    db.run(
        "INSERT INTO online_orders (buyer_name, total_amount, receipt_image_path, selected_products) VALUES (?, ?, ?, ?)",
        [buyer_name, total_amount, receipt_image_path, JSON.stringify(selected_products)],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.get('/api/online_orders', requireAuth, (req, res) => {
    db.all("SELECT * FROM online_orders WHERE status = 'Pendente' ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/online_orders/:id/approve', requireAuth, (req, res) => {
    db.get("SELECT * FROM online_orders WHERE id = ?", [req.params.id], (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: "Order not found" });
        if (order.status === 'Aprovado') return res.status(400).json({ error: "Order already approved" });

        const products = JSON.parse(order.selected_products);
        
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            // 1. Create store_package
            db.run("INSERT INTO store_packages (recipient_name) VALUES (?)", [order.buyer_name], function(err) {
                if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
                const packageId = this.lastID;
                
                let completedCount = 0;
                let hasError = false;

                if (products.length === 0) {
                    db.run("UPDATE online_orders SET status = 'Aprovado' WHERE id = ?", [order.id]);
                    db.run("COMMIT");
                    return res.json({ success: true });
                }

                products.forEach(prod => {
                    // 2. Decrement stock
                    db.run("UPDATE store_products SET stock = stock - ? WHERE id = ?", [prod.quantity, prod.id], (err) => {
                        if (err) hasError = true;
                        
                        // 3. Create store_sales
                        const total_amount = prod.sell_price * prod.quantity;
                        db.run("INSERT INTO store_sales (product_id, buyer_name, quantity, payment_method, total_amount, package_id, date) VALUES (?, ?, ?, 'Pix', ?, ?, datetime('now', 'localtime'))",
                            [prod.id, order.buyer_name, prod.quantity, total_amount, packageId], (err) => {
                            if (err) hasError = true;
                            
                            completedCount++;
                            if (completedCount === products.length) {
                                if (hasError) {
                                    db.run("ROLLBACK");
                                    return res.status(500).json({ error: "Failed to process items" });
                                } else {
                                    // 4. Mark online_orders as Aprovado
                                    db.run("UPDATE online_orders SET status = 'Aprovado' WHERE id = ?", [order.id], (err) => {
                                        if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
                                        db.run("COMMIT");
                                        res.json({ success: true, package_id: packageId });
                                    });
                                }
                            }
                        });
                    });
                });
            });
        });
    });
});

app.post('/api/online_orders/:id/reject', requireAuth, (req, res) => {
    db.run("UPDATE online_orders SET status = 'Rejeitado' WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});
process.on('uncaughtException',  (err)    => console.error('[CRASH] uncaughtException:', err));
process.on('unhandledRejection', (reason) => console.error('[CRASH] unhandledRejection:', reason));

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
