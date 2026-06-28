const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(["apiKey", "apiBase"], (d) => {
  $("apiKey").value = d.apiKey || "";
  $("apiBase").value = d.apiBase || "https://frenzsave.com";
});

$("save").addEventListener("click", () => {
  const apiKey = $("apiKey").value.trim();
  const apiBase = ($("apiBase").value.trim() || "https://frenzsave.com").replace(/\/$/, "");
  chrome.storage.sync.set({ apiKey, apiBase }, () => {
    $("status").textContent = "Saved ✓";
    setTimeout(() => ($("status").textContent = ""), 1500);
  });
});
