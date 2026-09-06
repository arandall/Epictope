type Listener = (pos: number | null) => void;
class Bus { active: number | null = null; listeners = new Set<Listener>();
  setActive(p: number|null){ this.active = p; this.listeners.forEach(l=>l(p)); }
  onActive(cb: Listener){ this.listeners.add(cb); return ()=>this.listeners.delete(cb); } }
export const bus = new Bus();
