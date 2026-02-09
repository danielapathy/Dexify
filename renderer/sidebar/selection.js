export function wireLibrarySelection() {
  const items = Array.from(document.querySelectorAll(".library-item"));
  for (const item of items) {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      for (const i of items) i.classList.toggle("is-active", i === item);
    });
  }
}

