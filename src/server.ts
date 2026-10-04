import express from "express";
import db from "./database/connection";
import telemetryRoutes from "./routes/telemetryRoutes";
import eventRoutes from "./routes/eventRoute";
import deviceRoutes from "./routes/deviceRoutes";
import commandRoutes from "./routes/commandRoutes";
import alertRoutes from "./routes/alertRoutes";
import swaggerUi from "swagger-ui-express";
import openApiSpec from "./docs/openapi";
import { errorHandler } from "./Middleware/Errohandler";




const app = express();
const API_PREFIX = "/api/v1";

app.use(express.json());
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.use(`${API_PREFIX}/iot`, telemetryRoutes);
app.use(`${API_PREFIX}/iot`, eventRoutes);
app.use(`${API_PREFIX}/iot`, commandRoutes);
app.use(`${API_PREFIX}/iot`, alertRoutes);
app.use(`${API_PREFIX}/devices`, deviceRoutes);


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

app.use(errorHandler);

app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000");
});
