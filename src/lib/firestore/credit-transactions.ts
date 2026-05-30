// Colección `creditTransactions` (doc §1.3)
// =============================================================================
// Historial de auditoría de créditos. Cada vez que se gastan o añaden créditos
// en CUALQUIER parte del código se escribe un documento aquí (doc §1.3, sin
// excepciones).
//
// Las escrituras se hacen, cuando es posible, dentro de la misma transacción
// que modifica el saldo del usuario para que auditoría y saldo no diverjan.
// =============================================================================

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { CREDIT_TRANSACTIONS_COLLECTION } from "./schema";

export type CreditTransactionType = "generation" | "refund" | "bonus" | "reset";

export interface CreditTransaction {
  userId: string;
  type: CreditTransactionType;
  amount: number; // negativo si es gasto, positivo si es ingreso
  balanceBefore: number;
  balanceAfter: number;
  generationId: string | null;
  createdAt: string; // ISO string
}

export interface RecordCreditTxInput {
  userId: string;
  type: CreditTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  generationId?: string | null;
  createdAt?: string;
}

export function buildCreditTransaction(input: RecordCreditTxInput): CreditTransaction {
  return {
    userId: input.userId,
    type: input.type,
    amount: input.amount,
    balanceBefore: input.balanceBefore,
    balanceAfter: input.balanceAfter,
    generationId: input.generationId ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

// Escritura dentro de una transacción existente (preferido).
export function writeCreditTransactionInTx(
  db: Firestore,
  tx: Transaction,
  input: RecordCreditTxInput,
): void {
  const ref = db.collection(CREDIT_TRANSACTIONS_COLLECTION).doc();
  tx.set(ref, buildCreditTransaction(input));
}

// Escritura independiente (cuando no hay transacción abierta).
export async function recordCreditTransaction(
  db: Firestore,
  input: RecordCreditTxInput,
): Promise<void> {
  await db.collection(CREDIT_TRANSACTIONS_COLLECTION).add(buildCreditTransaction(input));
}
