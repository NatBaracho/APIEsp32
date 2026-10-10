import express from "express";
import swaggerUi from "swagger-ui-express";
import "./database/connection";
import openApiSpec from "./docs/openapi";
import { errorHandler } from "./Middleware/Errohandler";
import commandRoutes from "./routes/commandRoutes";
import deviceRoutes from "./routes/deviceRoutes";
import ingestRoutes from "./routes/ingestRoutes";
import syncRoutes from "./routes/syncRoutes";
import { saude } from "./saude";

const app = express();
const API_PREFIX = "/api/v1";

app.use(express.json());
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.use(`${API_PREFIX}/iot`, ingestRoutes);
app.use(`${API_PREFIX}/iot`, commandRoutes);
app.use(`${API_PREFIX}/devices`, deviceRoutes);
app.use(`${API_PREFIX}/sync`, syncRoutes);

app.get("/", (req, res) => {
    res.send("API ESP32 Online");
});

// Situação da API, da fila e do Worker (monitoramento)
app.get("/health", (req, res) => {
    const resultado = saude();
    res.status(resultado.status === "OK" ? 200 : 503).json(resultado);
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

export const server = app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

export { app };
export default app;
