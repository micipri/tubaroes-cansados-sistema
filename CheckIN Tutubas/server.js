const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

// Simular o comportamento do upload.php localmente
app.post('/upload.php', (req, res) => {
    const { image, id } = req.body;

    if (!image || !id) {
        return res.status(400).json({ error: "Missing image or ID" });
    }

    const imageParts = image.split(";base64,");
    if (imageParts.length !== 2) {
        return res.status(400).json({ error: "Invalid image format" });
    }

    const imageTypeAux = imageParts[0].split("image/");
    const imageType = imageTypeAux[1] || 'jpg';
    const imageBase64 = Buffer.from(imageParts[1], 'base64');

    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const sanitizedId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `atleta_${sanitizedId}.${imageType}`;
    const filePath = path.join(uploadDir, fileName);

    fs.writeFile(filePath, imageBase64, (err) => {
        if (err) {
            console.error("Failed to save image", err);
            return res.status(500).json({ error: "Failed to save image" });
        }
        
        console.log(`[+] Foto salva localmente: ${fileName}`);
        return res.status(200).json({
            success: true,
            message: "Image saved successfully",
            url: `uploads/${fileName}`
        });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor local rodando em: http://localhost:${PORT}`);
    console.log(`(Para testar no iPad, acesse pelo IP do seu computador na porta ${PORT})`);
});
