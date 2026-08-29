const ApiError = require("../utils/ApiError");

const readImageResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const detail = contentType.includes("application/json")
      ? (await response.json()).error || "Hugging Face image request failed."
      : await response.text();
    throw new ApiError(response.status, detail || "Hugging Face image request failed.");
  }
  if (contentType.includes("application/json")) {
    const data = await response.json();
    const image = data.image || data.output || data.images?.[0];
    if (!image) throw new ApiError(502, "Hugging Face returned no image.");
    if (typeof image !== "string") throw new ApiError(502, "Hugging Face returned an invalid image.");
    if (image.startsWith("data:") || image.startsWith("http")) return image;
    return `data:image/png;base64,${image}`;
  }
  return `data:${contentType || "image/png"};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
};

const generateImage = async (req, res) => {
  const apiKey = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new ApiError(503, "Image generation is not configured. Set HF_TOKEN.");

  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) throw new ApiError(400, "An image prompt is required.");

  const file = req.file;
  const editing = Boolean(file);
  const model = editing
    ? (process.env.HF_IMAGE_EDIT_MODEL || "timbrooks/instruct-pix2pix")
    : (process.env.HF_TEXT_TO_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell");
  const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`;
  const requestBody = editing
    ? JSON.stringify({
        inputs: file.buffer.toString("base64"),
        parameters: {
          prompt: `Preserve the person's identity, face, pose, skin tone and unchanged details. Make only this requested edit: ${prompt}`,
          negative_prompt: "different person, face swap, altered identity, distorted face, blurry",
        },
      })
    : JSON.stringify({ inputs: prompt, parameters: { num_inference_steps: 4 } });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: requestBody,
  });
  return res.json({ success: true, image: await readImageResponse(response), editing, model });
};

module.exports = { generateImage };
