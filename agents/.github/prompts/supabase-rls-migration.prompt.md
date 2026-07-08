---
name: Gerar Migration RLS Segura
description: Use quando precisar gerar migration SQL de RLS para tabelas Supabase com policies completas de CRUD, ownership e protecao de campos sensiveis.
argument-hint: Informe tabela, coluna de ownership (ex: user_id), campos sensiveis imutaveis e regras especiais.
agent: Secure Vibe
---

Gere uma migration SQL de seguranca para Supabase seguindo este contrato fixo.

Entrada esperada:

- Nome da tabela: ${input:table}
- Coluna de ownership: ${input:owner_column}
- Campos sensiveis imutaveis no UPDATE: ${input:protected_fields}
- Permitir SELECT publico: ${input:public_read}
- Observacoes de regra de negocio: ${input:notes}

Requisitos obrigatorios:

- Ativar RLS na tabela alvo.
- Criar policies separadas para SELECT, INSERT, UPDATE e DELETE.
- Para tabelas de usuario, usar auth.uid() = ${input:owner_column}.
- Nao usar USING (true) em dados de usuario.
- Em UPDATE, usar USING + WITH CHECK.
- Em WITH CHECK, preservar os campos de ${input:protected_fields} com IS NOT DISTINCT FROM valor atual.
- Incluir comentarios SQL curtos explicando o objetivo de cada policy.
- Incluir bloco de verificacao manual ao final (queries SELECT para validar RLS e listing das policies).

Formato de saida:

1. Resumo das suposicoes.
2. SQL completo da migration em bloco unico.
3. Plano rapido de teste (anon vs authenticated, ownership e tentativa de escalacao).

Se houver ambiguidade nos campos de ownership ou nos campos protegidos, explicite as suposicoes no topo antes do SQL.
