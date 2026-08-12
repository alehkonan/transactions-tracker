import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { SELECTED_PROFILE_COOKIE } from "./profile-cookie";

type State = {
  selectedProfileId: number | null;
  selectProfile: (id: number) => void;
};

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}

// A no-op on the server (no `document`) and a plain cookie read/write in the browser, so the
// selected profile survives a reload and is readable server-side (see profile.functions.ts).
const cookieStorage: StateStorage = {
  getItem: (name) => (typeof document === "undefined" ? null : readCookie(name)),
  setItem: (name, value) => {
    if (typeof document !== "undefined") writeCookie(name, value, 60 * 60 * 24 * 365);
  },
  removeItem: (name) => {
    if (typeof document !== "undefined") writeCookie(name, "", 0);
  },
};

export const useProfileStore = create<State>()(
  persist(
    (set) => ({
      selectedProfileId: null,
      selectProfile: (id) => set({ selectedProfileId: id }),
    }),
    {
      name: SELECTED_PROFILE_COOKIE,
      storage: createJSONStorage(() => cookieStorage),
    },
  ),
);
