/**
 * Script de Migração: SQLite Local -> Supabase (PostgreSQL)
 * Tubarões Cansados - 10 Anos
 * 
 * Uso:
 * DATABASE_URL="postgresql://postgres:[SENHA]@db.[PROJECT_REF].supabase.co:5432/postgres" node migrate_sqlite_to_supabase.js
 */

const sqlite3 = require('sqlite3').verbose();
const { Pool, types } = require('pg');
const path = require('path');
const fs = require('fs');

types.setTypeParser(1700, val => (val === null ? null : parseFloat(val)));
types.setTypeParser(20, val => (val === null ? null : parseInt(val, 10)));

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!connectionString) {
    console.error('❌ ERRO: Nenhuma URL de conexão com o Supabase fornecida!');
    console.log('\nComo usar:');
    console.log('DATABASE_URL="postgresql://postgres:SUA_SENHA@db.xxxx.supabase.co:5432/postgres" node migrate_sqlite_to_supabase.js\n');
    process.exit(1);
}

const sqliteDbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
if (!fs.existsSync(sqliteDbPath)) {
    console.error(`❌ ERRO: Arquivo SQLite não encontrado em: ${sqliteDbPath}`);
    process.exit(1);
}

console.log('📂 Conectando ao SQLite local:', sqliteDbPath);
const sqlite = new sqlite3.Database(sqliteDbPath);

console.log('☁️ Conectando ao Supabase (PostgreSQL)...');
const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

const sqliteAll = (sql, params = []) => new Promise((resolve, reject) => {
    sqlite.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
    });
});

async function migrate() {
    try {
        const client = await pool.connect();
        console.log('✅ Conexão com Supabase estabelecida com sucesso!\n');

        // 1. Executa criação do schema caso ainda não tenha sido rodado
        const schemaPath = path.join(__dirname, 'supabase_schema.sql');
        if (fs.existsSync(schemaPath)) {
            console.log('📜 Verificando e criando tabelas no Supabase...');
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            await client.query(schemaSql);
            console.log('✅ Tabelas e índices verificados.\n');
        }

        const tables = [
            'users',
            'store_products',
            'assessorias',
            'coupons',
            'athletes',
            'store_packages',
            'store_sales',
            'online_orders',
            'registrations',
            'registrations_mod2',
            'party_tickets',
            'party_costs',
            'event_costs',
            'secret_survey',
            'sponsors'
        ];

        for (const table of tables) {
            try {
                const rows = await sqliteAll(`SELECT * FROM ${table}`);
                if (rows.length === 0) {
                    console.log(`ℹ️ Tabela ${table}: nenhum registro no SQLite (pulando).`);
                    continue;
                }

                console.log(`🔄 Migrando ${rows.length} registros para ${table}...`);
                let inserted = 0;

                for (const row of rows) {
                    const columns = Object.keys(row);
                    const values = Object.values(row);
                    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
                    const colNames = columns.join(', ');

                    const insertSql = `
                        INSERT INTO public.${table} (${colNames})
                        VALUES (${placeholders})
                        ON CONFLICT DO NOTHING
                    `;

                    const res = await client.query(insertSql, values);
                    if (res.rowCount > 0) inserted++;
                }

                // Atualizar sequência do serial
                try {
                    await client.query(`SELECT setval(pg_get_serial_sequence('public.${table}', 'id'), COALESCE((SELECT MAX(id) FROM public.${table}), 1))`);
                } catch (seqErr) {
                    // Algumas tabelas podem não ter coluna id ou sequência
                }

                console.log(`   ✅ Tabela ${table}: ${inserted} novos inseridos (${rows.length} totais processados).`);
            } catch (tableErr) {
                console.warn(`   ⚠️ Aviso ao migrar ${table}:`, tableErr.message);
            }
        }

        console.log('\n🎉 ==============================================');
        console.log('🎉 MIGRAÇÃO PARA O SUPABASE CONCLUÍDA COM SUCESSO!');
        console.log('🎉 ==============================================\n');

        client.release();
    } catch (err) {
        console.error('❌ Erro fatal durante a migração:', err);
    } finally {
        sqlite.close();
        await pool.end();
    }
}

migrate();
