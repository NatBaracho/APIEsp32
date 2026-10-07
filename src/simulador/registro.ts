// Registro do que a simulação verificou, impresso no terminal e salvo num
// relatório em Markdown na pasta da simulação

export interface Verificacao {
  etapa: string;
  item: string;
  esperado: string;
  obtido: string;
  ok: boolean;
}

export class Registro {
  readonly verificacoes: Verificacao[] = [];
  readonly paineis: Array<{ titulo: string; linhas: string[] }> = [];
  private etapaAtual = "";

  etapa(nome: string): void {
    this.etapaAtual = nome;
    console.log(`\n=== ${nome} ===`);
  }

  info(texto: string): void {
    console.log(`   ${texto}`);
  }

  conferir(item: string, esperado: string, obtido: string, ok: boolean): void {
    this.verificacoes.push({ etapa: this.etapaAtual, item, esperado, obtido, ok });
    console.log(`${ok ? "✅" : "❌"} ${item} — ${obtido}`);
  }

  painel(titulo: string, linhas: string[]): void {
    this.paineis.push({ titulo, linhas });
    console.log(`\n--- ${titulo} ---`);
    for (const linha of linhas) console.log(`   ${linha}`);
  }

  get falhas(): number {
    return this.verificacoes.filter(v => !v.ok).length;
  }

  markdown(cabecalho: string[]): string {
    const celula = (texto: string): string => texto.replace(/\|/g, "\\|").replace(/\n/g, " ");
    const partes = [
      "# Relatório da simulação do lacre",
      "",
      ...cabecalho,
      "",
      `**Resultado:** ${this.verificacoes.length - this.falhas} de ${this.verificacoes.length} verificações conforme; ${this.falhas} falha(s).`,
      "",
      "## Verificações",
      "",
      "| Etapa | Item | Esperado | Obtido | Resultado |",
      "| --- | --- | --- | --- | --- |",
      ...this.verificacoes.map(v =>
        `| ${celula(v.etapa)} | ${celula(v.item)} | ${celula(v.esperado)} | ${celula(v.obtido)} | ${v.ok ? "PASSOU" : "FALHOU"} |`)
    ];

    for (const painel of this.paineis) {
      partes.push("", `## ${painel.titulo}`, "", "```text", ...painel.linhas, "```");
    }

    return partes.join("\n") + "\n";
  }
}
