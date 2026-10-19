import { useEffect } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/hooks";

export default function UndoToast() {
  const s = useStore();
  useEffect(() => {
    if (!s.undo) return;
    const t = setTimeout(() => s.setUndo(null), 12000);
    return () => clearTimeout(t);
  }, [s.undo, s]);
  if (!s.undo) return null;
  const undo = async () => { const u = s.undo!; s.setUndo(null); try { await api.undo(u.batchId); } finally { await s.refresh(); } };
  return <div className="toast"><span>{s.undo.summary}</span><button onClick={undo}>UNDO</button><button className="ghost" onClick={() => s.setUndo(null)}>✕</button></div>;
}
