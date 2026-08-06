import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";
import { twJoin } from "tailwind-merge";

type StepProps = {
  label: string;
  icon: ReactNode;
  isActive?: boolean;
};

type StepContextValue = {
  stepNumber: number;
  isActive: boolean;
  isCompleted: boolean;
  isLast: boolean;
};

const StepContext = createContext<StepContextValue | null>(null);

type Props = {
  children: ReactElement<StepProps>[];
};

/**
 * Wraps `Step` children and resolves their active/completed state. If more
 * than one `Step` is passed `isActive`, the last one wins and every step
 * before it is rendered as completed.
 */
export function Stepper({ children }: Props) {
  const steps = Children.toArray(children).filter(isValidElement<StepProps>);
  const lastActiveIndex = steps.reduce(
    (lastIndex, step, index) => (step.props.isActive ? index : lastIndex),
    -1,
  );

  return (
    <ol className="flex w-full items-center">
      {steps.map((step, index) => (
        <StepProvider
          key={step.props.label}
          index={index}
          lastActiveIndex={lastActiveIndex}
          total={steps.length}
        >
          {step}
        </StepProvider>
      ))}
    </ol>
  );
}

type StepProviderProps = {
  index: number;
  lastActiveIndex: number;
  total: number;
  children: ReactNode;
};

function StepProvider({ index, lastActiveIndex, total, children }: StepProviderProps) {
  const value = useMemo<StepContextValue>(
    () => ({
      stepNumber: index + 1,
      isActive: index === lastActiveIndex,
      isCompleted: lastActiveIndex >= 0 && index < lastActiveIndex,
      isLast: index === total - 1,
    }),
    [index, lastActiveIndex, total],
  );

  return <StepContext value={value}>{children}</StepContext>;
}

export function Step({ label, icon }: StepProps) {
  const context = useContext(StepContext);
  if (!context) throw new Error("Step must be rendered inside a Stepper");
  const { stepNumber, isActive, isCompleted, isLast } = context;

  return (
    <li className="flex flex-1 items-center last:flex-none">
      <div className="flex shrink-0 items-center gap-2">
        <span
          aria-label={`Step ${stepNumber}: ${label}`}
          className={twJoin(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            isActive && "bg-accent text-surface",
            isCompleted && "bg-accent-muted text-accent",
            !isActive && !isCompleted && "bg-surface-muted text-text-muted",
          )}
        >
          {icon}
        </span>
        <span
          className={twJoin(
            "hidden text-sm sm:inline",
            isActive ? "text-text font-semibold" : "text-text-muted",
          )}
        >
          {label}
        </span>
      </div>
      {!isLast && (
        <span
          className={twJoin("mx-3 h-px flex-1", isCompleted ? "bg-accent-muted" : "bg-border")}
        />
      )}
    </li>
  );
}
