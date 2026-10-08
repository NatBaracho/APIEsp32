// Limites das regras automáticas de alerta. Cada um pode ser trocado no
// .env sem mudar o código; vazio ou inválido usa o padrão

export interface Limites {
  bateriaMinimaPercentual: number;
  gsmMinimoDbm: number;
  semComunicacaoMinutos: number;
  gpsSemSinalMinutos: number;
  comandoSemRespostaMinutos: number;
  repeticaoMinutos: number;
  margemRotaPadraoMetros: number;
}

function numero(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto.trim() === "") return padrao;
  const valor = Number(bruto);
  return Number.isFinite(valor) ? valor : padrao;
}

export function limites(): Limites {
  return {
    bateriaMinimaPercentual: numero("REGRA_BATERIA_MINIMA", 15),
    gsmMinimoDbm: numero("REGRA_GSM_MINIMO_DBM", -105),
    semComunicacaoMinutos: numero("REGRA_SEM_COMUNICACAO_MINUTOS", 30),
    gpsSemSinalMinutos: numero("REGRA_GPS_SEM_SINAL_MINUTOS", 15),
    comandoSemRespostaMinutos: numero("REGRA_COMANDO_SEM_RESPOSTA_MINUTOS", 10),
    repeticaoMinutos: numero("REGRA_REPETICAO_MINUTOS", 30),
    margemRotaPadraoMetros: numero("REGRA_MARGEM_ROTA_METROS", 50)
  };
}
