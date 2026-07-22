import type { ReactNode } from "react";

type PageProps = {
  children: ReactNode;
  title?: string;
  center?: boolean;
};

export function Page({ children, title, center = false }: PageProps) {
  return (
    <main
      className={`min-h-screen bg-linear-to-b from-slate-50 to-slate-100 px-10 pt-10 pb-[calc(var(--navbar-height,4rem)+2rem)] sm:pt-[calc(var(--navbar-height,4rem)+2rem)] dark:from-slate-950 dark:to-slate-900 sm:pb-10${
        center ? " grid place-items-center" : ""
      }`}
    >
      {title ? (
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
      ) : null}
      {children}
    </main>
  );
}
