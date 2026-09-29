// Small helpers shared by the panel, the 3D scene and the time-lapse.
// (Kept free of 3D code so the panel still works if 3D can't start.)

export function lifespan(p) {
  if (p.private) return "";
  const b = p.birth_year, d = p.death_year;
  if (b && d) return `${b} – ${d}`;
  if (b) return p.deceased ? `${b} – ?` : `born ${b}`;
  if (d) return `died ${d}`;
  return "";
}

export function fullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(" ");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(text) {
  return (text || "family").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "family";
}
