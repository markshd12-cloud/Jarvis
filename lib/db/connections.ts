import { getCompanyId } from "@/lib/db/company";
import { createAdminClient } from "@/lib/supabase/admin";

/** Status da conexão do Notion (sem expor o token), escopado à empresa. */
export interface NotionStatus {
  connected: boolean;
  workspaceName: string | null;
  lastSyncedAt: string | null;
}

const DISCONNECTED: NotionStatus = {
  connected: false,
  workspaceName: null,
  lastSyncedAt: null,
};

/**
 * Lê apenas o STATUS da conexão do Notion da empresa (via service_role). Usado
 * pela seção "Conexões" das Configurações. Nunca retorna o token.
 */
export async function getNotionStatus(): Promise<NotionStatus> {
  const companyId = await getCompanyId();
  if (!companyId) return DISCONNECTED;

  const admin = createAdminClient();
  const { data } = await admin
    .from("notion_connections")
    .select("workspace_name, last_synced_at")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!data) return DISCONNECTED;
  return {
    connected: true,
    workspaceName: data.workspace_name,
    lastSyncedAt: data.last_synced_at,
  };
}

/** Status da conexão da Conta Azul (sem expor o token), escopado à empresa. */
export interface ContaAzulStatus {
  connected: boolean;
  /** Nome/apelido da conta na Conta Azul, quando disponível. */
  accountName: string | null;
  lastSyncedAt: string | null;
}

const CONTA_AZUL_DISCONNECTED: ContaAzulStatus = {
  connected: false,
  accountName: null,
  lastSyncedAt: null,
};

/**
 * Lê apenas o STATUS da conexão da Conta Azul da empresa (via service_role).
 * Degrada graciosamente enquanto a migration da tabela `contaazul_connections`
 * não foi rodada (PostgREST devolve PGRST205) → tratamos como desconectado.
 * Nunca retorna o token.
 */
export async function getContaAzulStatus(): Promise<ContaAzulStatus> {
  const companyId = await getCompanyId();
  if (!companyId) return CONTA_AZUL_DISCONNECTED;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contaazul_connections")
    .select("account_name, last_synced_at")
    .eq("company_id", companyId)
    .maybeSingle();

  // Tabela ausente (pré-migration) ou qualquer erro → desconectado.
  if (error || !data) return CONTA_AZUL_DISCONNECTED;
  return {
    connected: true,
    accountName: data.account_name,
    lastSyncedAt: data.last_synced_at,
  };
}
