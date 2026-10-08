// Distâncias em metros para geocerca e rota. Projeção plana local
// (equiretangular): erro desprezível nas distâncias de entrega (< 100 km)

export interface Ponto {
  latitude: number;
  longitude: number;
}

const RAIO_TERRA_M = 6371008.8;
const rad = (graus: number): number => graus * Math.PI / 180;

function projetar(ponto: Ponto, referencia: Ponto): { x: number; y: number } {
  return {
    x: rad(ponto.longitude - referencia.longitude) * Math.cos(rad(referencia.latitude)) * RAIO_TERRA_M,
    y: rad(ponto.latitude - referencia.latitude) * RAIO_TERRA_M
  };
}

export function distanciaMetros(a: Ponto, b: Ponto): number {
  const p = projetar(b, a);
  return Math.hypot(p.x, p.y);
}

// Menor distância do ponto até a linha da rota (sequência de segmentos)
export function distanciaDaRotaMetros(ponto: Ponto, rota: Ponto[]): number {
  let menor = Number.POSITIVE_INFINITY;

  for (let i = 0; i < rota.length - 1; i++) {
    const a = projetar(rota[i]!, ponto);
    const b = projetar(rota[i + 1]!, ponto);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const comprimento2 = dx * dx + dy * dy;
    const t = comprimento2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / comprimento2));
    menor = Math.min(menor, Math.hypot(a.x + t * dx, a.y + t * dy));
  }

  return rota.length === 1 ? distanciaMetros(ponto, rota[0]!) : menor;
}

// Pontos da rota no FluxID: [{ "latitude": .., "longitude": .. }, ...]
export function lerPontos(valor: unknown): Ponto[] | null {
  if (!Array.isArray(valor) || valor.length < 2) return null;
  const pontos: Ponto[] = [];
  for (const item of valor) {
    const p = item as Record<string, unknown>;
    const latitude = Number(p?.latitude);
    const longitude = Number(p?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    pontos.push({ latitude, longitude });
  }
  return pontos;
}
