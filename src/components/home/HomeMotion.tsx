import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";

const preferenceQuery = "(prefers-reduced-motion: reduce)";
function subscribePreference(onChange: () => void) {
  const media = window.matchMedia(preferenceQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

const HomeMotionContext = createContext({
  enabled: false,
  reduced: true,
  paused: false,
  toggle: () => {},
});

export function HomeMotionProvider({ children }: { children: ReactNode }) {
  const reduced = useSyncExternalStore(subscribePreference,
    () => window.matchMedia(preferenceQuery).matches, () => true);
  const visible = useSyncExternalStore(subscribeVisibility,
    () => document.visibilityState === "visible", () => false);
  const [paused, setPaused] = useState(false);
  return <HomeMotionContext.Provider value={{ enabled: !reduced && !paused && visible, reduced, paused, toggle: () => setPaused(value => !value) }}>
    {children}
  </HomeMotionContext.Provider>;
}

export function useHomeMotion() {
  return useContext(HomeMotionContext);
}

export function PageMotionControl() {
  const { reduced, paused, toggle } = useHomeMotion();
  return <button className="vh-motion-control" type="button" onClick={toggle}
    aria-label={reduced ? "Page animations disabled for reduced motion" : paused ? "Play page animations" : "Pause page animations"}
    aria-pressed={paused} disabled={reduced}>
    <span className="vh-motion-indicator" aria-hidden="true"><i /><i /><i /></span>
    <span>{reduced ? "Reduced motion" : paused ? "Motion paused" : "Motion on"}</span>
    {paused || reduced ? <Play size={12} /> : <Pause size={12} />}
  </button>;
}
