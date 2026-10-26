import "./icons.css";

export function Icon({ name, label, spin }: { name: string; label?: string; spin?: boolean }) {
  return <i className={`icon-${name}${spin ? " spin" : ""}`} {...(label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true })} />;
}
