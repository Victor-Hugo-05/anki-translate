const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const OpenAI = require("openai");
const { Pool } = require("pg");
require("dotenv").config();

// === CONFIG ===
const PORT = process.env.PORT || 3001;
const SUPPORTED_LANGUAGES = ["ingles", "frances", "espanhol", "chines", "italiano"];
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// === OPENAI SETUP ===
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// === POSTGRES SETUP ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// === EXPRESS SETUP ===
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// === CRIA AS TABELAS CASO NÃO EXISTAM ===
(async () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${lang} (
        id SERIAL PRIMARY KEY,
        portugues TEXT,
        traducao TEXT
      );
    `);
  }
})();

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
      const prompt = `Traduza a palavra/frase '${palavra}' para o ${idioma}. Apenas a tradução, sem explicações. Não deve haver ponto final, nem letra maiúscula. Se for uma frase ou expressão do cotidiano, traduza para algo equivalente e usual. ${idioma === "chines" ? "(Obs: no chinês, você deve escrever a palavra em hanzi e depois, entre parênteses, em pinyin. Ex: '猫 (māo)')" : ""}`;

      const resposta = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });

      const traducao = resposta.choices[0].message.content.trim();

      await pool.query(
        `INSERT INTO ${idioma} (portugues, traducao) VALUES ($1, $2)`,
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
app.get("/export/:idioma", async (req, res) => {
  const idioma = req.params.idioma;
  if (!SUPPORTED_LANGUAGES.includes(idioma)) {
    return res.status(400).json({ error: "Idioma não suportado" });
  }

  try {
    const { rows } = await pool.query(`SELECT * FROM ${idioma}`);
    const bomUtf8 = "\uFEFF";
    const csv = bomUtf8 + ["portugues,traducao", ...rows.map(r => `${r.portugues},${r.traducao}`)].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${idioma}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /translations/:idioma
app.get("/translations/:idioma", async (req, res) => {
  const idioma = req.params.idioma;
  if (!SUPPORTED_LANGUAGES.includes(idioma)) {
    return res.status(400).json({ error: "Idioma não suportado" });
  }

  try {
    const { rows } = await pool.query(`SELECT * FROM ${idioma}`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /translations/:idioma/:id
app.delete("/translations/:idioma/:id", async (req, res) => {
  const { idioma, id } = req.params;
  if (!SUPPORTED_LANGUAGES.includes(idioma)) {
    return res.status(400).json({ error: "Idioma não suportado" });
  }

  try {
    await pool.query(`DELETE FROM ${idioma} WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /add
app.post("/add", async (req, res) => {
  const { idioma, portugues, traducao } = req.body;
  if (!SUPPORTED_LANGUAGES.includes(idioma) || !portugues || !traducao) {
    return res.status(400).json({ error: "Dados inválidos" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ${idioma} (portugues, traducao) VALUES ($1, $2) RETURNING id`,
      [portugues, traducao]
    );
    res.json({ id: result.rows[0].id, portugues, traducao });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
