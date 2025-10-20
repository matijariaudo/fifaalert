import express from "express";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import cors from "cors";
import get_code from "./get_mail.js";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

const db = await open({
  filename: "./db/tickets.db",
  driver: sqlite3.Database,
});



await db.exec(`
  CREATE TABLE IF NOT EXISTS matchs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT UNIQUE,
    estadio TEXT,
    fecha TEXT
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER,
    categoria TEXT,
    precioMin REAL,
    precioMax REAL,
    cantidad INTEGER,
    timestamp INTEGER,
    FOREIGN KEY(match_id) REFERENCES matchs(id)
  );
`);

// 🌐 Servir carpeta web
app.use("/", express.static(path.join(__dirname, "web")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "web/index.html")));
app.get("/tablas", (req, res) => res.sendFile(path.join(__dirname, "web/tablas.html")));

app.post("/api/tickets", async (req, res) => {
  const { resultados } = req.body;
  if (!Array.isArray(resultados) || resultados.length === 0)
    return res.status(400).send("Sin datos");

  const { match, estadium, fecha } = resultados[0];
  const timestamp = Date.now(); // mismo timestamp para todo el lote

  await db.run(
        `INSERT INTO matchs (titulo, estadio, fecha)
        VALUES (?, ?, ?)
        ON CONFLICT(titulo) DO UPDATE SET estadio=excluded.estadio, fecha=excluded.fecha`,
        [match, estadium, fecha]
    );

    const matchRow = await db.get(`SELECT id FROM matchs WHERE titulo = ?`, [match]);
    const matchId = matchRow.id;

    const insert = await db.prepare(
    `INSERT INTO tickets (match_id, categoria, precioMin, precioMax, cantidad, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const t of resultados) {
    if (t.cantidad > 0 && t.precioMin>0) {
        await insert.run(
        matchId,
        t.categoria,
        t.precioMin,
        t.precioMax,
        t.cantidad,
        timestamp
        );
    }
    }

    await insert.finalize();
  res.send("Datos guardados con timestamp: " + timestamp);
});

// Ejemplo: obtener la última lectura por partido
app.get("/api/last-tickets/:titulo", async (req, res) => {
  const { titulo } = req.params;
  const match = await db.get(`SELECT id FROM matchs WHERE titulo = ?`, [titulo]);
  if (!match) return res.status(404).send("No existe ese match");

  const rows = await db.all(`
    SELECT * FROM tickets 
    WHERE match_id = ? 
    AND timestamp = (
      SELECT MAX(timestamp) FROM tickets WHERE match_id = ?
    )
  `, [match.id, match.id]);

  res.json(rows);
});

app.get("/api/get_code",async(req,res)=>{
    const codigo=await get_code()
    return res.status(200).json({codigo})
})

// 📊 GET /getdata → matches + última actualización + tickets
app.get("/getdata", async (req, res) => {
  const matches = await db.all(`SELECT * FROM matchs`);
  const data = [];

  for (const m of matches) {
    const lastTimestamp = await db.get(
      `SELECT MAX(timestamp) as lastTimestamp FROM tickets WHERE match_id = ?`,
      [m.id]
    );
    const tickets = await db.all(
      `SELECT * FROM tickets WHERE match_id = ? AND timestamp = ?`,
      [m.id, lastTimestamp.lastTimestamp]
    );
    data.push({
      match: { ...m, lastTimestamp: lastTimestamp.lastTimestamp },
      tickets,
    });
  }

  res.json(data);
});

app.listen(3000, () => console.log("🚀 Server on http://localhost:3000"));
