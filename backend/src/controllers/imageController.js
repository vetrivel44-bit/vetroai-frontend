const ApiError = require("../utils/ApiError");

const toDataUrl = (buffer, mimetype) => `data:${mimetype};base64,${buffer.toString("base64")}`;

const readImageResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const detail = contentType.includes("application/json")
      ? (await response.json()).error || "Segmind image request failed."
      : await response.text();
    throw new ApiError(response.status, detail || "Segmind image request failed.");
  }
  if (contentType.includes("application/json")) {
    const data = await response.json();
    const image = data.image || data.output || data.images?.[0];
    if (!image) throw new ApiError(502, "Segmind returned no image.");
    if (typeof image !== "string") throw new ApiError(502, "Segmind returned an invalid image.");
    if (image.startsWith("data:") || image.startsWith("http")) return image;
    return `data:image/png;base64,${image}`;
  }
  return `data:${contentType || "image/png"};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
};

const generateImage = async (req, res) => {
  const apiKey = process.env.SEGMIND_API_KEY;
  if (!apiKey) throw new ApiError(503, "Image generation is not configured. Set SEGMIND_API_KEY.");

  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) throw new ApiError(400, "An image prompt is required.");

  const file = req.file;
  const editing = Boolean(file);
  const url = editing
    ? (process.env.SEGMIND_IP_ADAPTER_URL || "https://api.segmind.com/v1/ip-adapter-xl")
    : (process.env.SEGMIND_TEXT_TO_IMAGE_URL || "https://api.segmind.com/v1/sdxl1.0-txt2img");
  const payload = editing
    ? {
        image: toDataUrl(file.buffer, file.mimetype).split(",")[1],
        prompt: `Preserve the exact identity, face, pose, skin tone and unchanged details of the person in the reference image. Make only this requested edit: ${prompt}`,
        negative_prompt: "different person, face swap, altered identity, distorted face, blurry, low quality",
        adapter_type: "face",
        steps: 30,
        samples: 1,
      }
    : {
        prompt,
        negative_prompt: "blurry, low quality, distorted, duplicate subject",
        style: "photographic",
        samples: 1,
      };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(payload),
  });
  return res.json({ success: true, image: await readImageResponse(response), editing });
};

module.exports = { generateImage };
