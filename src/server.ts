import express from "express";
import db from "./database/connection";
import telemetryRoutes from "./routes/telemetryRoutes";
import eventRoutes from "./routes/eventRoute";
import deviceRoutes from "./routes/deviceRoutes";
import commandRoutes from "./routes/commandRoutes";
import alertRoutes from "./routes/alertRoutes";
import syncRoutes from "./routes/syncRoutes";
import { assignmentRoutes, cylinderRoutes, sealRoutes } from "./routes/assetRoutes";
import swaggerUi from "swagger-ui-express";
import openApiSpec from "./docs/openapi";
import openApiFluxidSpec from "./docs/openapiFluxid";
import { errorHandler } from "./Middleware/Errohandler";
import appRoutes from "./app/router";
import { saude } from "./saude";




const app = express();
const API_PREFIX = "/api/v1";

// API do frontend: CORS e limite de corpo próprios, antes do express.json geral
app.use(`${API_PREFIX}/app`, appRoutes);
app.use(express.json());
// serveFiles gera os arquivos de cada página separadamente (com serve, a
// segunda página sobrescreveria a primeira)
app.use("/api-docs", swaggerUi.serveFiles(openApiSpec), swaggerUi.setup(openApiSpec));
// API do frontend sobre o FluxID (Doc/Contrato-API-Frontend.md), em /api/v1/app
app.use(
  "/api-docs-fluxid",
  swaggerUi.serveFiles(openApiFluxidSpec),
  swaggerUi.setup(openApiFluxidSpec, { customSiteTitle: "API FluxID (frontend)" })
);
app.use(`${API_PREFIX}/iot`, telemetryRoutes);
app.use(`${API_PREFIX}/iot`, eventRoutes);
app.use(`${API_PREFIX}/iot`, commandRoutes);
app.use(`${API_PREFIX}/iot`, alertRoutes);
app.use(`${API_PREFIX}/devices`, deviceRoutes);
app.use(`${API_PREFIX}/seals`, sealRoutes);
app.use(`${API_PREFIX}/cylinders`, cylinderRoutes);
app.use(`${API_PREFIX}/assignments`, assignmentRoutes);
app.use(`${API_PREFIX}/sync`, syncRoutes);


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

// Situação da API, da Oxide, do FluxID e do Worker (monitoramento)
app.get("/health", (req, res) => {
    saude()
      .then(resultado => res.status(resultado.status === "OK" ? 200 : 503).json(resultado))
      .catch(() => res.status(503).json({ status: "FALHOU" }));
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

export const server = app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

export { app };
export default app;
