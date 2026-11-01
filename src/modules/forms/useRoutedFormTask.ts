import { useBlocker } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import type { FormTaskResult, FormTaskState } from "./form-task";

/** Adapts the same form lifecycle used by sheets to route and browser navigation. */
export function useRoutedFormTask({
  onCancel,
  onComplete,
}: {
  onCancel: () => void;
  onComplete: (result?: FormTaskResult) => void;
}) {
  const forms = useRef(new Map<string, FormTaskState>());
  const [isPending, setIsPending] = useState(false);
  const [needsProtection, setNeedsProtection] = useState(false);
  const register = useCallback((id: string, state: FormTaskState) => {
    const refresh = () => {
      const states = [...forms.current.values()];
      setIsPending(states.some((form) => form.isPending));
      setNeedsProtection(states.some((form) => form.isDirty || form.isPending));
    };
    forms.current.set(id, state);
    refresh();
    return () => {
      forms.current.delete(id);
      refresh();
    };
  }, []);
  const shouldBlockFn = useCallback(
    () => [...forms.current.values()].some((form) => form.isDirty || form.isPending),
    [],
  );
  const blocker = useBlocker({
    shouldBlockFn,
    enableBeforeUnload: needsProtection,
    withResolver: true,
  });
  const task = useMemo(
    () => ({ onCancel, onComplete, register }),
    [onCancel, onComplete, register],
  );
  return { task, blocker, isPending };
}
