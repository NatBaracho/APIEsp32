import fs from "fs";
import http from "http";
import https from "https";
import express from "express";
import swaggerUi from "swagger-ui-express";
import "./database/connection";
import openApiSpec from "./docs/openapi";
import { contarPedidos, metricas, metricasEmTexto } from "./metricas";
import { adminMiddleware, chaveDeAdministrador, rotasDaEquipeAbertas } from "./middlewares/adminMiddleware";
import { errorHandler } from "./middlewares/errorHandler";
import commandRoutes from "./routes/commandRoutes";
import deviceRoutes from "./routes/deviceRoutes";
import ingestRoutes from "./routes/ingestRoutes";
import syncRoutes from "./routes/syncRoutes";
import { saude } from "./saude";

const app = express();
const API_PREFIX = "/api/v1";

// HTTPS direto na API quando o certificado e a chave estão no .env. Sem
// eles, a API atende em HTTP (rede local ou atrás de um proxy com HTTPS)
const certificado = process.env.HTTPS_CERT_FILE?.trim();
const chaveDoCertificado = process.env.HTTPS_KEY_FILE?.trim();
const comHttps = Boolean(certificado && chaveDoCertificado);

app.disable("x-powered-by");
// Atrás de um proxy (nginx, Caddy), o endereço de quem chama vem no cabeçalho
if (process.env.PROXY_CONFIAVEL === "true") app.set("trust proxy", 1);

// Cabeçalhos de proteção em toda resposta
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (comHttps) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  if (req.path.startsWith(API_PREFIX) || req.path === "/metrics") res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(contarPedidos);
// Mensagem do lacre é pequena: corpo maior que isso é recusado (413)
app.use(express.json({ limit: "32kb" }));
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

// Números de funcionamento (só com a chave de administrador)
app.get("/metrics", adminMiddleware, (req, res) => {
    if (req.query.formato === "prometheus") {
        res.type("text/plain").send(metricasEmTexto());
        return;
    }
    res.status(200).json(metricas());
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

export const server: http.Server = comHttps
    ? https.createServer({ cert: fs.readFileSync(certificado!), key: fs.readFileSync(chaveDoCertificado!) }, app)
    : http.createServer(app);

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT} (${comHttps ? "HTTPS" : "HTTP"})`);
    if (rotasDaEquipeAbertas()) {
        console.warn("⚠️ ROTAS_DA_EQUIPE_ABERTAS=true: as rotas da equipe estão sem chave. Use só em teste de bancada");
    } else if (!chaveDeAdministrador()) {
        console.warn("⚠️ ADMIN_API_KEY não definida (ou com menos de 16 caracteres): as rotas da equipe respondem 503");
    }
});

export { app };
export default app;
