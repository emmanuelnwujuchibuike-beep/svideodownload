/**
 * Executes ad-network embed markup. Scripts inserted via innerHTML never run, so
 * we recreate each <script> element (which DOES execute) and append the rest as
 * normal nodes. Used for self-injecting formats (pop-under, social bar, multitag,
 * native container, in-page push) from Adsterra / PropellerAds.
 */
export function injectAdMarkup(host: HTMLElement, html: string): void {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  for (const node of Array.from(tmp.childNodes)) {
    if (node.nodeName === "SCRIPT") {
      const old = node as HTMLScriptElement;
      const s = document.createElement("script");
      for (const attr of Array.from(old.attributes)) s.setAttribute(attr.name, attr.value);
      s.text = old.textContent ?? "";
      host.appendChild(s);
    } else {
      host.appendChild(node);
    }
  }
}
