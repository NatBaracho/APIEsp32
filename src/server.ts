import express from "express";
import db from "./database/connection";
import telemetryRoutes from "./routes/telemetryRoutes";
import eventRoutes from "./routes/eventRoute";

const app = express();
app.use(express.json());
app.use("/api", telemetryRoutes);
app.use("/api", eventRoutes);
app.use("/api/v1/iot", telemetryRoutes);

app.use(
  "/api/v1/iot",
  eventRoutes
);


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
      "Erro ao conectar no SQLite",
      error
    );

}

app.get("/", (req, res) => {
    res.send("API ESP32 Online");
});

app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000");
});
