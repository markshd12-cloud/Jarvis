"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Confirmação de ação destrutiva, padronizada para todo o módulo financeiro.
 * Substitui o `window.confirm` (caixa do navegador, sem tema e fácil de ignorar)
 * e cobre as telas que excluíam SEM perguntar nada.
 *
 * Uso: guarde `{ msg, onOk }` num estado e renderize este componente; `null`
 * mantém fechado.
 */
export interface Confirmacao {
  /** Texto explicando exatamente o que será apagado. */
  msg: string;
  /** Rótulo do botão destrutivo (default: "Excluir"). */
  acaoLabel?: string;
  onOk: () => void;
}

export function ConfirmDialog({
  confirmacao,
  onClose,
  titulo = "Confirmar exclusão",
}: {
  confirmacao: Confirmacao | null;
  onClose: () => void;
  titulo?: string;
}) {
  return (
    <Dialog open={confirmacao !== null} onOpenChange={(o) => !o && onClose()}>
      {confirmacao && (
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{confirmacao.msg}</p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                confirmacao.onOk();
                onClose();
              }}
            >
              {confirmacao.acaoLabel ?? "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
