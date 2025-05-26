const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const OpenAI = require("openai");
require("dotenv").config();

// === CONFIG ===
const PORT = process.env.PORT || 3001;
const DB_FILE = "translations.db";
const SUPPORTED_LANGUAGES = ["ingles", "frances", "espanhol", "chines", "italiano"];
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

// === SETUP ===
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Serve arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, "public")));

// Quando acessar /, serve o index.html da pasta public
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Banco SQLite
const db = new sqlite3.Database(DB_FILE);

SUPPORTED_LANGUAGES.forEach((lang) => {
  db.run(
    `CREATE TABLE IF NOT EXISTS ${lang} (id INTEGER PRIMARY KEY, portugues TEXT, traducao TEXT)`
  );
});

// === ROTAS ===

// POST /translate
app.post("/translate", async (req, res) => {
  const { palavra, idiomas } = req.body;
  if (!palavra || !idiomas || !idiomas.length) {
    return res.status(400).json({ error: "Dados inválidos" });
  }

  const resultados = {};

  for (const idioma of idiomas) {
    try {
      const prompt = `Traduza a palavra '${palavra}' para o ${idioma}. Apenas a palavra, sem explicações. ${idioma === "chines" ? "(Obs: no chinês, você deve escrever a palavra em hanzi e depois, entre parênteses, em pinyin. Ex: '猫 (māo)')" : ""}`;
      const resposta = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });

      const traducao = resposta.choices[0].message.content.trim();

      db.run(
        `INSERT INTO ${idioma} (portugues, traducao) VALUES (?, ?)`,
        [palavra, traducao]
      );

      resultados[idioma] = traducao;
    } catch (err) {
      console.error(`Erro ao traduzir para ${idioma}:`, err.message);
    }
  }

  res.json(resultados);
});

// GET /export/:idioma
app.get("/export/:idioma", (req, res) => {
  const idioma = req.params.idioma;
  if (!SUPPORTED_LANGUAGES.includes(idioma)) {
    return res.status(400).json({ error: "Idioma não suportado" });
  }

  db.all(`SELECT * FROM ${idioma}`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const bomUtf8 = "\uFEFF";
    const csv = bomUtf8 + ["portugues,traducao", ...rows.map(r => `${r.portugues},${r.traducao}`)].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${idioma}.csv`);
    res.send(csv);
  });
});

// GET /translations/:idioma – listar todas as traduções de uma tabela
app.get("/translations/:idioma", (req, res) => {
  const idioma = req.params.idioma;
  if (!SUPPORTED_LANGUAGES.includes(idioma)) {
    return res.status(400).json({ error: "Idioma não suportado" });
  }

  db.all(`SELECT * FROM ${idioma}`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// DELETE /translations/:idioma/:id – apagar uma linha por id
app.delete("/translations/:idioma/:id", (req, res) => {
  const { idioma, id } = req.params;
  if (!SUPPORTED_LANGUAGES.includes(idioma)) {
    return res.status(400).json({ error: "Idioma não suportado" });
  }

  db.run(`DELETE FROM ${idioma} WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// POST /add – adicionar tradução manualmente
app.post("/add", (req, res) => {
  const { idioma, portugues, traducao } = req.body;
  if (!SUPPORTED_LANGUAGES.includes(idioma) || !portugues || !traducao) {
    return res.status(400).json({ error: "Dados inválidos" });
  }

  db.run(
    `INSERT INTO ${idioma} (portugues, traducao) VALUES (?, ?)`,
    [portugues, traducao],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, portugues, traducao });
    }
  );
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
