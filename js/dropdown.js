// A dropdown (single-choice listbox) in the site's style, in place of the browser's own <select>.
//
//   const dd = dropdown(document.getElementById("sort"), {
//     label: "Rendezés", value: "claims", options: [{ value: "claims", label: "legtöbb állítás" }, ...],
//     onChange: (value) => { ... },
//   });
//   dd.value  // the chosen value
//
// Keyboard (WAI-ARIA listbox pattern): on the button, Enter / Space / ↓ / ↑ open the list; in the list, ↑ ↓ move,
// Home / End jump, a letter jumps to the next option starting with it, Enter / Space choose, Escape / Tab close.
// A click outside closes it.

let uid = 0;

export function dropdown(root, { label, options, value, onChange }) {
  const id = `dd${++uid}`;
  root.classList.add("dd");
  root.replaceChildren();

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dd-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", label);
  const shown = document.createElement("span");
  shown.className = "dd-value";
  const caret = document.createElement("span");
  caret.className = "dd-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "▾";
  button.append(shown, caret);

  const list = document.createElement("ul");
  list.className = "dd-list";
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", label);
  list.tabIndex = -1;
  list.hidden = true;
  button.setAttribute("aria-controls", list.id);

  const items = options.map((o, i) => {
    const li = document.createElement("li");
    li.id = `${id}-opt${i}`;
    li.className = "dd-option";
    li.setAttribute("role", "option");
    li.dataset.value = o.value;
    li.textContent = o.label;
    li.addEventListener("mousemove", () => setActive(i));
    li.addEventListener("mousedown", (e) => e.preventDefault());  // keep the focus in the list
    li.addEventListener("click", () => { choose(i); close(true); });
    list.append(li);
    return li;
  });
  root.append(button, list);

  let selected = Math.max(0, options.findIndex((o) => o.value === value));
  let active = selected;

  function render() {
    shown.textContent = options[selected].label;
    // the name says the choice too, with the words on the button ("Rendezés: legtöbb állítás"): a screen reader hears
    // what the list is sorted by, and voice control finds the button by what it shows
    button.setAttribute("aria-label", `${label}: ${options[selected].label}`);
    items.forEach((li, i) => {
      li.setAttribute("aria-selected", String(i === selected));
      li.classList.toggle("active", i === active);
    });
    list.setAttribute("aria-activedescendant", items[active].id);
  }

  function setActive(i) {
    active = (i + items.length) % items.length;
    render();
    items[active].scrollIntoView({ block: "nearest" });
  }

  function choose(i) {
    const changed = i !== selected;
    selected = i;
    render();
    if (changed && onChange) onChange(options[i].value);
  }

  function open() {
    if (!list.hidden) return;
    active = selected;
    list.hidden = false;
    root.dataset.open = "true";
    button.setAttribute("aria-expanded", "true");
    render();
    list.focus();
    items[active].scrollIntoView({ block: "nearest" });
  }

  function close(focusButton) {
    if (list.hidden) return;
    list.hidden = true;
    root.dataset.open = "false";
    button.setAttribute("aria-expanded", "false");
    if (focusButton) button.focus();
  }

  button.addEventListener("click", () => (list.hidden ? open() : close(true)));
  button.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      open();
      if (e.key === "ArrowUp") setActive(active - 1);
    }
  });

  let typed = "", typedAt = 0;
  list.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive(active + 1); break;
      case "ArrowUp": e.preventDefault(); setActive(active - 1); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(items.length - 1); break;
      case "Enter":
      case " ": e.preventDefault(); choose(active); close(true); break;
      case "Escape": e.preventDefault(); close(true); break;
      case "Tab": close(false); break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {  // type to jump
          const now = Date.now();
          typed = (now - typedAt < 700 ? typed : "") + e.key.toLowerCase();
          typedAt = now;
          const order = items.map((_, k) => (active + 1 + k) % items.length);
          const hit = order.find((k) => options[k].label.toLowerCase().startsWith(typed))
            ?? order.find((k) => options[k].label.toLowerCase().startsWith(typed[0]));
          if (hit != null) setActive(hit);
        }
    }
  });
  list.addEventListener("blur", (e) => { if (!root.contains(e.relatedTarget)) close(false); });
  document.addEventListener("mousedown", (e) => { if (!root.contains(e.target)) close(false); });

  render();
  return {
    get value() { return options[selected].value; },
    set value(v) { const i = options.findIndex((o) => o.value === v); if (i >= 0) { selected = active = i; render(); } },
  };
}
