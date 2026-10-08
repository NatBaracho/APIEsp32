import { Telemetry } from "../models/Telemetry";
import { abrirAlerta, criarComando, registrarContato } from "./alertasAutomaticos";
import { limites } from "./limites";

// Regras aplicadas no recebimento (rotas /api/v1/iot). Uma falha aqui nunca
// impede o dado do lacre de ser salvo: só é registrada no console

function seguro(nome: string, regra: () => void): void {
  try {
    regra();
  } catch (erro) {
    console.error(`Regra automática "${nome}" falhou:`, erro instanceof Error ? erro.message : erro);
  }
}

export function aposTelemetria(telemetria: Telemetry, errorType: string | null | undefined): void {
  const deviceId = telemetria.device_id;
  const temPosicao = typeof telemetria.latitude === "number" && typeof telemetria.longitude === "number";
  const limite = limites();

  seguro("contato", () => registrarContato(deviceId, "telemetria", temPosicao));

  seguro("bateria", () => {
    if (typeof telemetria.battery_percent === "number" && telemetria.battery_percent < limite.bateriaMinimaPercentual) {
      abrirAlerta(deviceId, "BATERIA_BAIXA",
        `Bateria em ${telemetria.battery_percent}% (mínimo ${limite.bateriaMinimaPercentual}%), mensagem ${telemetria.message_id}`);
    }
  });

  seguro("gsm", () => {
    if (typeof telemetria.gsm_signal === "number" && telemetria.gsm_signal < limite.gsmMinimoDbm) {
      abrirAlerta(deviceId, "GSM_SINAL_FRACO",
        `Sinal GSM em ${telemetria.gsm_signal} dBm (mínimo ${limite.gsmMinimoDbm} dBm), mensagem ${telemetria.message_id}`);
    }
  });

  lacreAbertoEmTransito(deviceId, errorType, telemetria.seal_status, telemetria.message_id);
}

// Lacre aberto ou rompido com o cilindro EM_TRANSITO (telemetria ou evento):
// alerta crítico e pedido de travamento da válvula (o ESP32 busca o comando)
function lacreAbertoEmTransito(deviceId: string, errorType: string | null | undefined, sealStatus: string | undefined, messageId: string): void {
  seguro("lacre aberto em trânsito", () => {
    if (errorType === "LACRE_ABERTO_EM_TRANSITO") {
      const alerta = abrirAlerta(deviceId, "LACRE_ABERTO_EM_TRANSITO",
        `Lacre ${sealStatus} com o cilindro em trânsito, mensagem ${messageId}. Válvula: comando TRAVAR_VALVULA enviado automaticamente`);
      if (alerta === "criado") criarComando(deviceId, "TRAVAR_VALVULA");
    }
  });
}

export function aposEvento(deviceId: string, errorType: string | null | undefined, sealStatus: string | undefined, messageId: string): void {
  seguro("contato", () => registrarContato(deviceId, "outro"));
  lacreAbertoEmTransito(deviceId, errorType, sealStatus, messageId);
}

export function aposContato(deviceId: string): void {
  seguro("contato", () => registrarContato(deviceId, "outro"));
}

export function aposConfirmacaoDeComando(deviceId: string, commandId: string, status: string, erro?: string): void {
  seguro("contato", () => registrarContato(deviceId, "outro"));
  seguro("comando falhou", () => {
    if (status === "ERRO") {
      abrirAlerta(deviceId, "COMANDO_FALHOU", `Comando ${commandId} confirmado com ERRO: ${erro ?? "sem detalhe"}`);
    }
  });
}
