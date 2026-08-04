/**
 * Acesso a Colaboradores & Fornecedores (pessoas internas p/ atrelar despesa de
 * pessoal). Server-only, escopado por `companyId`. Dados sensíveis (chave pix,
 * conta) — só trafegam por rotas gated em `financeiro`. CPF/CNPJ validado de
 * verdade (dígitos verificadores). Nunca exclui em silêncio: FK barra se em uso.
 */
import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  fkFriendly,
  TIPOS_PESSOA,
  type FinColaborador,
  type MembroEmpresa,
} from "./types";

/** Valida CPF (11) ou CNPJ (14) pelos dígitos verificadores. Ignora máscara. */
export function validaCpfCnpj(valor: string): boolean {
  const d = valor.replace(/\D/g, "");
  if (d.length === 11) return validaCpf(d);
  if (d.length === 14) return validaCnpj(d);
  return false;
}

function validaCpf(cpf: string): boolean {
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) &&
    dv(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

function validaCnpj(cnpj: string): boolean {
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (base: string) => {
    const pesos =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(cnpj.slice(0, 12)) === Number(cnpj[12]) &&
    dv(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

const opt = z.string().trim().nullish();

export const colaboradorInputSchema = z.object({
  nome: z.string().trim().min(1, "nome obrigatório"),
  cpf_cnpj: z
    .string()
    .trim()
    .nullish()
    .refine((v) => !v || validaCpfCnpj(v), "CPF/CNPJ inválido"),
  tipo: z.enum(TIPOS_PESSOA as [string, ...string[]]),
  banco: opt,
  agencia: opt,
  conta: opt,
  chave_pix: opt,
  cargo: opt,
  salario_base: z.coerce.number().nonnegative().nullish(),
  bu_id: z.string().uuid().nullish(),
  profile_id: z.string().uuid().nullish(),
});
export type ColaboradorInput = z.infer<typeof colaboradorInputSchema>;

/**
 * Usuários (profiles) — p/ o seletor de vínculo e a importação.
 *
 * `todasEmpresas` amplia para os usuários do GRUPO inteiro, não só os da empresa
 * onde o financeiro roda. Motivo: a contabilidade é centralizada em uma empresa,
 * mas o professor/colaborador que aparece na conta pode ter login cadastrado na
 * UNICIVE ou no COLÉGIO — sem isso ele fica preso como "fornecedor" e nunca dá
 * pra converter em colaborador. O índice único é `(company_id, profile_id)`, e a
 * FK não restringe empresa, então o vínculo cruzado é válido no banco.
 *
 * A importação em massa (`importFromProfiles`) NÃO usa esse modo de propósito:
 * ela só materializa os usuários da própria empresa.
 */
export async function listMembers(
  companyId: string,
  opts: { todasEmpresas?: boolean } = {},
): Promise<MembroEmpresa[]> {
  const admin = createAdminClient();

  let q = admin
    .from("profiles")
    // `nickname` como plano B: por muito tempo o convite não pedia nome, então o
    // apelido do chat era o ÚNICO nome existente. Sem ele, cair direto no e-mail
    // fazia o financeiro listar "markshd1@hotmail.com" em vez de "Max".
    .select("id, full_name, nickname, email, company_id");
  if (!opts.todasEmpresas) q = q.eq("company_id", companyId);

  const [{ data, error }, empresas] = await Promise.all([
    q.order("full_name", { ascending: true, nullsFirst: false }),
    admin.from("companies").select("id, name"),
  ]);
  if (error) throw new Error(`listMembers: ${error.message}`);
  if (empresas.error) throw new Error(`listMembers: ${empresas.error.message}`);

  const nomeEmpresa = new Map(
    (empresas.data ?? []).map((c) => [c.id as string, c.name as string]),
  );

  return (data ?? [])
    .map((p) => ({
      id: p.id as string,
      nome:
        (p.full_name as string | null) ??
        (p.nickname as string | null) ??
        (p.email as string | null) ??
        "(sem nome)",
      email: (p.email as string | null) ?? null,
      empresa: nomeEmpresa.get(p.company_id as string) ?? "(sem empresa)",
      externa: (p.company_id as string) !== companyId,
    }))
    // Própria empresa primeiro — é de onde vem a maioria dos vínculos.
    .sort(
      (a, b) =>
        Number(a.externa) - Number(b.externa) ||
        a.empresa.localeCompare(b.empresa, "pt-BR") ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );
}

/**
 * Cria um colaborador (tipo `colaborador`) por usuário da empresa ainda não
 * vinculado. Idempotente: quem já tem `profile_id` é pulado. PII fica em branco
 * p/ preencher depois. Retorna quantos foram importados.
 */
export async function importFromProfiles(
  companyId: string,
): Promise<{ importados: number }> {
  const admin = createAdminClient();
  const [membros, existentes] = await Promise.all([
    listMembers(companyId),
    admin
      .from("fin_colaboradores")
      .select("profile_id")
      .eq("company_id", companyId)
      .not("profile_id", "is", null),
  ]);
  if (existentes.error) throw new Error(`importFromProfiles: ${existentes.error.message}`);

  const jaVinculados = new Set((existentes.data ?? []).map((r) => r.profile_id as string));
  const novos = membros
    .filter((m) => !jaVinculados.has(m.id))
    .map((m) => ({
      company_id: companyId,
      profile_id: m.id,
      nome: m.nome,
      tipo: "colaborador" as const,
    }));
  if (novos.length === 0) return { importados: 0 };

  const { error } = await admin.from("fin_colaboradores").insert(novos);
  if (error) throw new Error(`importFromProfiles: ${error.message}`);
  return { importados: novos.length };
}

export async function listColaboradores(companyId: string): Promise<FinColaborador[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_colaboradores")
    .select("*")
    .eq("company_id", companyId)
    .order("tipo", { ascending: true })
    .order("nome", { ascending: true });
  if (error) throw new Error(`listColaboradores: ${error.message}`);
  return (data ?? []) as FinColaborador[];
}

export async function createColaborador(
  companyId: string,
  input: ColaboradorInput,
): Promise<FinColaborador> {
  const v = colaboradorInputSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_colaboradores")
    .insert({ company_id: companyId, ...v })
    .select("*")
    .single();
  if (error) throw new Error(`createColaborador: ${error.message}`);
  return data as FinColaborador;
}

export async function updateColaborador(
  companyId: string,
  id: string,
  input: Partial<ColaboradorInput>,
): Promise<FinColaborador> {
  const v = colaboradorInputSchema.partial().parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_colaboradores")
    .update(v)
    .eq("company_id", companyId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateColaborador: ${error.message}`);
  return data as FinColaborador;
}

export async function setColaboradorAtivo(
  companyId: string,
  id: string,
  ativo: boolean,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_colaboradores")
    .update({ ativo })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(`setColaboradorAtivo: ${error.message}`);
}

/** Exclui. FK `on delete set null` nas parcelas — solta o vínculo sem barrar. */
export async function deleteColaborador(companyId: string, id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_colaboradores")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(fkFriendly(error, "Colaborador"));
}
