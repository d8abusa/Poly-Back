import { useState, useEffect } from "react";
import BacktestConsole from "./pages/BacktestConsole";
import LoginScreen from "./components/shared/LoginScreen";
import { getToken, clearToken } from "./lib/apiFetch";

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());

  useEffect(() => {
    const handler = () => { clearToken(); setAuthed(false); };
    window.addEventListener("polyback:logout", handler);
    return () => window.removeEventListener("polyback:logout", handler);
  }, []);

  if (!authed) {
    return <LoginScreen onLogin={() => setAuthed(true)} />;
  }

  return <BacktestConsole />;
}
