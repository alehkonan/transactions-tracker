import { useEffect, useRef } from "react";
import { useWatch, type Control, type UseFormSetValue } from "react-hook-form";
import type { TransactionFormValues } from "~/modules/transaction-form/transaction-form-values";

type Options = {
  control: Control<TransactionFormValues>;
  setValue: UseFormSetValue<TransactionFormValues>;
};

/**
 * Mirrors "amount" into "toAmount" so a same-currency transfer doesn't need typing
 * the amount twice, until the user edits "toAmount" directly — after that it stops
 * being overwritten.
 */
export function useTransferAmountMirror({ control, setValue }: Options) {
  const touchedRef = useRef(false);
  const amount = useWatch({ control, name: "amount" });

  useEffect(() => {
    if (!touchedRef.current) setValue("toAmount", amount);
  }, [amount, setValue]);

  const markToAmountTouched = () => {
    touchedRef.current = true;
  };

  const reset = () => {
    touchedRef.current = false;
  };

  return { markToAmountTouched, reset };
}
