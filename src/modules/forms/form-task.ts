import { createContext, useContext, useLayoutEffect, useId } from "react";

export type FormTaskState = { isDirty: boolean; isPending: boolean };

/** A task's host owns navigation; forms only report edits and distinguish cancel from completion. */
export const FormTaskContext = createContext({
  onCancel: () => {},
  onComplete: () => {},
  register: (_id: string, _state: FormTaskState) => () => {},
});

export function useFormTask({ isDirty, isPending }: FormTaskState) {
  const task = useContext(FormTaskContext);
  const { register } = task;
  const id = useId();
  useLayoutEffect(() => register(id, { isDirty, isPending }), [register, id, isDirty, isPending]);
  return task;
}
