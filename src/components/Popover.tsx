import {
  cloneElement,
  createContext,
  useId,
  useMemo,
  useRef,
  type JSX,
  type ReactNode,
} from "react";
import { twJoin } from "tailwind-merge";

type PopoverContextProps = {
  onOpen: () => void;
  onClose: () => void;
};

type Props = {
  children: ReactNode;
  renderTrigger: (props: PopoverContextProps) => JSX.Element;
};

export const PopoverContext = createContext<PopoverContextProps>({
  onOpen: () => undefined,
  onClose: () => undefined,
});

export function Popover({ children, renderTrigger }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorName = `--popover-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const contextProps = useMemo<PopoverContextProps>(
    () => ({
      onOpen: () => ref.current?.showPopover(),
      onClose: () => ref.current?.hidePopover(),
    }),
    [],
  );

  const trigger = renderTrigger(contextProps);

  return (
    <PopoverContext value={contextProps}>
      {cloneElement(trigger, {
        style: { ...trigger.props.style, anchorName },
      })}
      <div
        ref={ref}
        popover="auto"
        style={{ positionAnchor: anchorName, positionArea: "bottom" }}
        className={twJoin(
          "border-border bg-surface text-text m-0 rounded-xl border p-3 shadow-lg",
          "mt-1",
          "scale-95 opacity-0 open:scale-100 open:opacity-100",
          "starting:open:scale-95 starting:open:opacity-0",
          "transition-[opacity,scale,display,overlay] transition-discrete duration-150 ease-out",
        )}
      >
        {children}
      </div>
    </PopoverContext>
  );
}
