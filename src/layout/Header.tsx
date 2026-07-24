import { Navbar } from "./Navbar";

export const Header = () => {
  return (
    <header className="pointer-events-none sticky top-0 flex items-center justify-center p-4">
      <Navbar />
    </header>
  );
};
