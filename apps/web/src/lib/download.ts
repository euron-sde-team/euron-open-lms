/** Save a Blob as a file through a temporary object URL (for responses that need the bearer token). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** File name for the account data export: `<username>-export.json`. */
export function exportFileName(username: string): string {
  const safe = username.replace(/[^\w.-]/g, "_") || "account";
  return `${safe}-export.json`;
}
