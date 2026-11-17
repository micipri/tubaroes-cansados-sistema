const fs = require('fs');
const path = require('path');

function syncProductionDatabase(db, callback) {
    console.log('🚀 [DB Sync] Iniciando sincronização e limpeza da base de produção...');

    // 1. Fazer backup de segurança do SQLite se for SQLite
    if (!db.isPostgres) {
        try {
            const dataDir = '/app/data';
            const dbFile = path.join(dataDir, 'database.sqlite');
            if (fs.existsSync(dbFile)) {
                const bakFile = path.join(dataDir, `database.sqlite.bak_pre_wipe_${Date.now()}`);
                fs.copyFileSync(dbFile, bakFile);
                console.log(`📦 [DB Sync] Backup de segurança criado em: ${bakFile}`);
            }
        } catch (e) {
            console.warn('Aviso ao criar backup de segurança:', e.message);
        }
    }

    // 2. Tabelas para zerar histórico antigo
    const tablesToClear = [
        'athletes',
        'store_sales',
        'online_orders',
        'event_costs',
        'party_costs',
        'registrations',
        'registrations_mod2',
        'party_tickets',
        'sponsors',
        'secret_survey',
        'coupons',
        'assessorias',
        'store_products',
        'store_packages'
    ];

    const clearPromises = tablesToClear.map(table => {
        return new Promise((resolve) => {
            db.run(`DELETE FROM ${table}`, [], (err) => {
                if (err) console.warn(`Aviso ao limpar ${table}:`, err.message);
                else console.log(`🧹 [DB Sync] Tabela ${table} limpa com sucesso.`);
                resolve();
            });
        });
    });

    Promise.all(clearPromises).then(() => {
        // 3. Dados Oficiais dos 10 Anos (extraídos da base local configurada)
        const assessorias = [
            { id: 1, name: 'Assessoria Águas Abertas', responsible_name: 'Treinador Carlos', phone: '27999998888', email: null },
            { id: 2, name: 'Tubarões Cansados Clube', responsible_name: 'Michel Cipriano', phone: '27999990000', email: 'contato@tubaroescansados.com.br' },
            { id: 3, name: 'Equipe Mar Aberto', responsible_name: 'Prof. Ricardo', phone: '27988881122', email: 'maraberto@email.com' }
        ];

        const coupons = [
            { id: 1, code: 'AGUAS01', assessoria_id: 1, discount_price: 119.00, active: 1 },
            { id: 2, code: 'TUBAS01', assessoria_id: 2, discount_price: 119.00, active: 1 },
            { id: 3, code: 'ABERT01', assessoria_id: 3, discount_price: 119.00, active: 1 }
        ];

        const products = [
            { id: 4, name: 'Touca Silicone Tubarões 10 Anos', stock: 13, cost_price: 0, sell_price: 35.0, tshirt_size: null, is_system: 0, show_in_checkout: 1 },
            { id: 7, name: 'Boné Trucker', stock: 12, cost_price: 0, sell_price: 39.0, tshirt_size: null, is_system: 0, show_in_checkout: 1 },
            { id: 8, name: 'Boné de Pano Azul', stock: 19, cost_price: 0, sell_price: 39.0, tshirt_size: null, is_system: 0, show_in_checkout: 1 },
            { id: 9, name: 'Chapéu de Pano', stock: 24, cost_price: 0, sell_price: 39.0, tshirt_size: null, is_system: 0, show_in_checkout: 1 },
            { id: 10, name: 'Bóia Especial com Compartimento', stock: 13, cost_price: 0, sell_price: 49.0, tshirt_size: null, is_system: 0, show_in_checkout: 1 },
            { id: 11, name: 'Caneca Especial 10 anos 150ml', stock: 60, cost_price: 0, sell_price: 10.0, tshirt_size: null, is_system: 0, show_in_checkout: 1 },
            { id: 12, name: 'Camisa Oficial do Evento (Tamanho M)', stock: 44, cost_price: 0, sell_price: 0.0, tshirt_size: 'M', is_system: 1, show_in_checkout: 0 },
            { id: 13, name: 'Camisa Oficial do Evento (Tamanho G)', stock: 41, cost_price: 0, sell_price: 0.0, tshirt_size: 'G', is_system: 1, show_in_checkout: 0 },
            { id: 14, name: 'Camisa Oficial do Evento (Tamanho XG)', stock: 15, cost_price: 0, sell_price: 0.0, tshirt_size: 'XG', is_system: 1, show_in_checkout: 0 }
        ];

        // Inserir assessorias
        assessorias.forEach(a => {
            db.run(
                "INSERT INTO assessorias (id, name, responsible_name, phone, email) VALUES (?, ?, ?, ?, ?)",
                [a.id, a.name, a.responsible_name, a.phone, a.email]
            );
        });

        // Inserir cupons
        coupons.forEach(c => {
            db.run(
                "INSERT INTO coupons (id, code, assessoria_id, discount_price, active) VALUES (?, ?, ?, ?, ?)",
                [c.id, c.code, c.assessoria_id, c.discount_price, c.active]
            );
        });

        // Inserir produtos
        products.forEach(p => {
            db.run(
                "INSERT INTO store_products (id, name, stock, cost_price, sell_price, tshirt_size, is_system, show_in_checkout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [p.id, p.name, p.stock, p.cost_price, p.sell_price, p.tshirt_size, p.is_system, p.show_in_checkout]
            );
        });

        // Garantir usuários admin
        db.get("SELECT id FROM users WHERE username = 'michel'", (err, u1) => {
            if (!u1) {
                db.run("INSERT INTO users (username, password_hash, is_master) VALUES ('michel', '$2b$10$f5bayEjSwdsyKo4120RCAer/C9AIHKMezK09IH4twqKfY72kdx7e.', 1)");
            }
        });
        db.get("SELECT id FROM users WHERE username = 'marcelo'", (err, u2) => {
            if (!u2) {
                db.run("INSERT INTO users (username, password_hash, is_master) VALUES ('marcelo', '$2b$10$Lzx0HM14E1rrZGQn3kVOxuKEg4dNgRojok7P04wmM.fAFrU9JtbF.', 0)");
            }
        });

        console.log('✅ [DB Sync] Sincronização e carga inicial concluídas com sucesso!');
        if (callback) callback(null, { success: true, message: 'Base de produção limpa e sincronizada com sucesso!' });
    });
}

function ensureAthleteColumns(db) {
    if (!db || db.isPostgres) return;
    const requiredColumns = [
        { name: 'store_items', def: "TEXT DEFAULT '[]'" },
        { name: 'store_amount', def: "REAL DEFAULT 0" },
        { name: 'total_amount', def: "REAL DEFAULT 0" },
        { name: 'responsible_name', def: "TEXT DEFAULT NULL" },
        { name: 'responsible_cpf', def: "TEXT DEFAULT NULL" },
        { name: 'responsible_phone', def: "TEXT DEFAULT NULL" },
        { name: 'responsible_email', def: "TEXT DEFAULT NULL" },
        { name: 'responsible_birth', def: "TEXT DEFAULT NULL" }
    ];

    db.all("PRAGMA table_info(athletes)", (err, columns) => {
        if (!err && columns) {
            requiredColumns.forEach(col => {
                if (!columns.some(c => c.name === col.name)) {
                    db.run(`ALTER TABLE athletes ADD COLUMN ${col.name} ${col.def}`, (alterErr) => {
                        if (alterErr) console.warn(`Aviso ao adicionar coluna ${col.name}:`, alterErr.message);
                        else console.log(`✅ [Schema Migration] Coluna ${col.name} adicionada com sucesso em athletes.`);
                    });
                }
            });
        }
    });
}

function runAutoSyncIfPending(db) {
    ensureAthleteColumns(db);

    const dataDir = '/app/data';
    const markerFile = path.join(dataDir, '.synced_10anos_v2');

    // Se estiver rodando no Railway (/app/data existe) e ainda não sincronizou
    if (fs.existsSync(dataDir)) {
        if (!fs.existsSync(markerFile)) {
            console.log('⚡ [DB Sync] Primeira inicialização detectada em /app/data. Executando sincronização automática...');
            syncProductionDatabase(db, (err) => {
                if (!err) {
                    try {
                        fs.writeFileSync(markerFile, JSON.stringify({ synced_at: new Date().toISOString() }));
                        console.log('🏷️ [DB Sync] Marcador .synced_10anos_v2 gravado.');
                    } catch (e) {
                        console.warn('Erro ao gravar marcador:', e.message);
                    }
                }
            });
        } else {
            console.log('ℹ️ [DB Sync] Base de produção já sincronizada anteriormente (marcador ativo).');
        }
    }
}

module.exports = { syncProductionDatabase, runAutoSyncIfPending, ensureAthleteColumns };
