const fs = require('fs');
const path = require('path');

// Simple manual .env parser to load credentials during local development
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const [key, ...values] = trimmed.split('=');
        const val = values.join('=').trim();
        // Strip surrounding quotes
        const cleanVal = val.replace(/^["']|["']$/g, '');
        process.env[key.trim()] = cleanVal;
    });
}

const app = require('./api/server.js');
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running locally on http://localhost:${PORT}`);
});
