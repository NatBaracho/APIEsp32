import express from "express";
import db from "./database/connection";

const app = express();

try {

    const tables = db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type='table'
      `)
      .all();

    console.log("✅ SQLite conectado");

    console.table(tables);

} catch (error) {

    console.error(
      "❌ Erro ao conectar no SQLite",
      error
    );

}

app.get("/", (req, res) => {
    res.send("API ESP32 Online");
});

app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000");
});
