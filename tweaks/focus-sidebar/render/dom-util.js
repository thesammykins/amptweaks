// Tiny DOM helpers: escaping and change-only text/HTML updates.
export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };

export const setHTML = (el, h) => { if (el._h !== h) { el.innerHTML = h; el._h = h; } };
