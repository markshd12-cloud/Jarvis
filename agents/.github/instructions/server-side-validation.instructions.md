---
name: Server-Side Validation and Authorization
description: Use quando implementar ou revisar API Routes, Route Handlers, Server Actions, Edge Functions e mutacoes de dados. Forca validacao server-side, autorizacao por recurso e protecao contra input malicioso.
applyTo:
  - src/app/**/route.ts
  - src/app/**/route.tsx
  - src/app/**/actions.ts
  - src/app/**/actions/**/*.ts
---

# Server-Side Validation and Authorization

## Regra principal

Frontend apenas sugere. Backend decide.
Toda operacao de leitura, escrita e delecao deve validar autenticacao, autorizacao e input no servidor.

## Em toda rota ou action

- Validar sessao/JWT antes de acessar dado protegido.
- Validar permissao por recurso especifico (ownership/role), nunca apenas por parametro vindo do cliente.
- Validar payload com schema explicito (tipos, formatos, tamanhos e ranges).
- Rejeitar campos inesperados e normalizar input textual.
- Aplicar limite de paginacao e de tamanho de payload.
- Retornar erro generico sem vazar stack trace, SQL ou path interno.

## Supabase e banco

- RLS deve ser a camada final de defesa em todas as tabelas sensiveis.
- Nunca confiar em user_id enviado pelo cliente sem comparar com auth.uid().
- Para updates sensiveis, manter allowlist de campos editaveis.
- Em operacoes financeiras ou de credito, usar atualizacao atomica.

## Seguranca operacional

- Aplicar rate limit em endpoints de login e operacoes sensiveis.
- Usar metodo HTTP correto para cada acao.
- Configurar CORS por allowlist de origens em APIs publicas.
- Nunca expor secrets em logs, responses ou codigo cliente.

## Checklist de revisao antes de concluir

- Existe auth valida para este fluxo?
- Existe authz por recurso?
- Input foi validado no servidor?
- Existe risco de IDOR, race condition ou privilege escalation?
- Erros e logs estao sem dados sensiveis?

Se qualquer resposta for "nao", implementar a protecao antes de finalizar.
