import React, { useContext, useState } from "react";
import { ImagePlus } from "lucide-react";
import { VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { generateImage } from "../../../lib/imageGen";
import { GeneratedImage } from "../GeneratedImage";

/**
 * A ```image block: the chat model asking for a picture (lib/imageRequest.js).
 * While the reply streams it's a placeholder; once the reply is complete the
 * app makes the picture and the block is replaced by it (App.jsx). A block
 * left in an older reply (the picture couldn't be made then) offers to make
 * it now.
 */
export default function ImageRequestBlock({ code }) {
  const streaming = isStillStreaming(useContext(OpenBlockContext), code);
  const [state, setState] = useState({ phase: "idle", url: "", error: "" });
  const prompt = String(code || "").replace(/\s+/g, " ").trim();
  if (streaming || !prompt) return <VisualPending icon={ImagePlus} label="Getting the picture ready…" />;
  if (state.url) return <GeneratedImage src={state.url} prompt={prompt} />;

  const make = async () => {
    setState({ phase: "making", url: "", error: "" });
    try {
      setState({ phase: "done", url: await generateImage(prompt), error: "" });
    } catch (err) {
      setState({ phase: "failed", url: "", error: err?.message || "The picture couldn't be made." });
    }
  };
  return (
    <div className="vai-image-request not-prose">
      <ImagePlus size={16} aria-hidden="true" />
      <span className="vai-image-request-text">{prompt}</span>
      <button type="button" onClick={make} disabled={state.phase === "making"}>
        {state.phase === "making" ? "Creating…" : "Create picture"}
      </button>
      {state.error && <span className="vai-image-request-error" role="alert">{state.error}</span>}
    </div>
  );
}
