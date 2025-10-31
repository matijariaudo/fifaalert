import express from "express";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import cors from "cors";
import get_code from "./get_mail.js";
import path from "path";
import { fileURLToPath } from "url";
import { error } from "console";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


let cycle_number=0;
let cycle_captcha=false;

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
    fecha TEXT,
    local TEXT, 
    visitante TEXT,
    link T
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
  const { tickets , match: matchData } = req.body;
  if (!Array.isArray(tickets) || tickets.length === 0)
    return res.status(400).send("Sin datos");

  const { match, stadium, fecha ,local, visitante, link} = matchData;
  const timestamp = Date.now(); // mismo timestamp para todo el lote

  await db.run(
        `INSERT INTO matchs (titulo, estadio, fecha, local, visitante, link)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(titulo) DO UPDATE SET estadio=excluded.estadio, fecha=excluded.fecha`,
        [match, stadium, fecha, local, visitante, link]
    );

    const matchRow = await db.get(`SELECT id FROM matchs WHERE titulo = ?`, [match]);
    const matchId = matchRow.id;

    const insert = await db.prepare(
    `INSERT INTO tickets (match_id, categoria, precioMin, precioMax, cantidad, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)`
    );
    
    for (const t of tickets) {
      const precioMin = Number(t.precioMin.replace(/,/g, ""));
      const precioMax = Number(t.precioMax.replace(/,/g, ""));
      const cantidad = Number(t.cantidad);
      if (cantidad > 0 && precioMin > 0) {
        const info = await insert.run(
          matchId,
          t.categoria,
          precioMin,
          precioMax,
          cantidad,
          timestamp
        );
        if (info?.changes > 0) console.log("✅ Insertado",matchId);
        else console.log("⚠️ No se insertó");
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
    const {email}=req.query
    if (!email){
      return res.status(400).json({error:"Please, send a email"})
    }
    const codigo=await get_code(email) || '';
    return res.status(200).json({codigo})
})

app.get("/api/set_cycle",async(req,res)=>{
    const {cycle}=req.query
    cycle_captcha=false;
    cycle_number=cycle
    return res.status(200).json({status:'OK'})
})

app.get("/api/captcha_alert",async(req,res)=>{
    cycle_captcha=true;
    return res.status(200).json({status:'OK'})
})

app.get("/api/get_cycle",async(req,res)=>{
    return res.status(200).json({cycle_captcha,cycle_number})
})

// 📊 GET /getdata → matches + última actualización + tickets
// 📊 GET /getdata → matches + última actualización + tickets + priceMin/Max
app.get("/getdata", async (req, res) => {
  const matches = await db.all(`SELECT * FROM matchs ORDER BY titulo`);
  const data = [];

  

  for (const m of matches) {
    const lastTimestamp = await db.get(
      `SELECT MAX(timestamp) as lastTimestamp FROM tickets WHERE match_id = ?`,
      [m.id]
    );

    if (!lastTimestamp.lastTimestamp) continue; // si no hay tickets, saltar

    const tickets = await db.all(
      `SELECT * FROM tickets WHERE match_id = ? AND timestamp = ?`,
      [m.id, lastTimestamp.lastTimestamp]
    );

    // 🔢 obtener min y max
    const priceStats = await db.get(
      `SELECT MIN(precioMin) as priceMin, MAX(precioMax) as priceMax
       FROM tickets
       WHERE match_id = ? AND timestamp = ?`,
      [m.id, lastTimestamp.lastTimestamp]
    );

    data.push({
      match: {
        ...m,
        lastTimestamp: lastTimestamp.lastTimestamp,
        priceMin: priceStats.priceMin,
        priceMax: priceStats.priceMax,
      },
      tickets,
    });
  }

  res.json(data);
});


app.listen(3000, () => console.log("🚀 Server on http://localhost:3000"));
