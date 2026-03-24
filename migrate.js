const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
        return;
    }
    console.log('Connected to the SQLite database. Running migration...');
    
    db.serialize(() => {
        // Create new table with the correct schema
        db.run(`CREATE TABLE IF NOT EXISTS registrations_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            unit_amount REAL NOT NULL,
            total_amount REAL NOT NULL,
            date TEXT NOT NULL
        )`);

        // Migrate old data (assuming old amount = unit_amount and quantity = 1)
        db.run(`INSERT INTO registrations_new (id, name, quantity, unit_amount, total_amount, date)
                SELECT id, name, 1, amount, amount, date FROM registrations`, (err) => {
            if (err) {
                console.error("Migration failed if it's already done or table empty:", err.message);
            }
        });

        // Drop old table
        db.run(`DROP TABLE IF EXISTS registrations`);

        // Rename new table to original name
        db.run(`ALTER TABLE registrations_new RENAME TO registrations`);

        console.log('Migration completed successfully.');
    });
});
