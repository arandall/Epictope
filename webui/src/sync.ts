type Listener = (pos: number | null) => void;
// Two channels: `active` = transient hover highlight, `marked` = persistent
// click marker shown across chart, query sequence and MSA.
class Bus {
  active: number | null = null;
  marked: number | null = null;
  listeners = new Set<Listener>();
  markListeners = new Set<Listener>();
  setActive(p: number | null) { this.active = p; this.listeners.forEach(l => l(p)); }
  onActive(cb: Listener) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  setMarked(p: number | null) { this.marked = p; this.markListeners.forEach(l => l(p)); }
  onMarked(cb: Listener) { this.markListeners.add(cb); return () => this.markListeners.delete(cb); }
}
export const bus = new Bus();
