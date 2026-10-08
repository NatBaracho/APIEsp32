import readline from "readline";
import { Writable } from "stream";
import { fecharFluxid, fluxid, hashSenha, senhaAceitavel } from "../app/base";

// npm run senha -- <email>
// Define a senha de login (API do frontend) de uma pessoa do FluxID. A senha
// é digitada no terminal, sem eco, e só o hash (scrypt) vai para o banco.
// Encerra as sessões abertas da pessoa.

function perguntarOculto(pergunta: string): Promise<string> {
  let mudo = false;
  const saida = new Writable({
    write(pedaco, _codificacao, pronto) {
      if (!mudo) process.stdout.write(pedaco);
      pronto();
    }
  });
  const leitor = readline.createInterface({ input: process.stdin, output: saida, terminal: true });
  return new Promise(resolve => {
    leitor.question(pergunta, resposta => {
      leitor.close();
      process.stdout.write("\n");
      resolve(resposta);
    });
    mudo = true;
  });
}

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Uso: npm run senha -- <email>");
  const banco = fluxid();
  if (!banco) throw new Error("FLUXID_DATABASE_URL não definida (.env)");

  const pessoa = (await banco.query<{ id: string; nome: string }>("SELECT id, nome FROM public.usuarios WHERE lower(email) = $1", [email])).rows[0];
  if (!pessoa) throw new Error(`nenhuma pessoa com o e-mail ${email}`);

  const senha = await perguntarOculto(`Nova senha para ${pessoa.nome} (8 a 128 caracteres): `);
  if (!senhaAceitavel(senha)) throw new Error("a senha deve ter de 8 a 128 caracteres");
  const repetida = await perguntarOculto("Repita a senha: ");
  if (repetida !== senha) throw new Error("as senhas não conferem");

  await banco.query("UPDATE public.usuarios SET senha_hash = $2, atualizado_em = now() WHERE id = $1", [pessoa.id, hashSenha(senha)]);
  const sessoes = await banco.query(
    "UPDATE public.sessoes_usuario SET revogada_em = now(), motivo_revogacao = 'SENHA_REDEFINIDA' WHERE usuario_id = $1 AND revogada_em IS NULL", [pessoa.id]);
  console.log(`Senha definida para ${pessoa.nome}. Sessões encerradas: ${sessoes.rowCount ?? 0}.`);
}

main()
  .catch(erro => {
    console.error("Falhou:", erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => fecharFluxid());
