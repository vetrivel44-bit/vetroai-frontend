// Saving an exact drawing: as SVG, or as a sharp PNG on white.

export const fileName = (title, ext) => `${String(title || "diagram").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "diagram"}.${ext}`;

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// The drawing as a PNG, three times its size so it prints sharp.
export function savePng(svg, width, height, title) {
  const k = 3;
  const sized = svg.replace(/^<svg /, `<svg width="${Math.round(width * k)}" height="${Math.round(height * k)}" `);
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * k);
    canvas.height = Math.round(height * k);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => blob && saveBlob(blob, fileName(title, "png")), "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

