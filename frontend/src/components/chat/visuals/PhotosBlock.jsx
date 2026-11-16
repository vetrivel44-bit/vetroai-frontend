import React, { Suspense, useContext, useEffect, useState } from "react";
import { Images } from "lucide-react";
import { VisualPending } from "./VisualCard";
import { OpenBlockContext, isStillStreaming } from "../../../lib/visualStream";
import { fetchPhotos } from "../../../lib/photos";

const StructuredResponseRenderer = React.lazy(() => import("../../structured/StructuredResponseRenderer"));

/**
 * A ```photos block: the chat model asking for real photos of someone or
 * something (a real person it won't make a picture of; PICTURES_IN_CHAT).
 * The app finds them (/api/photos) and shows them as a gallery.
 */
export default function PhotosBlock({ code }) {
  const streaming = isStillStreaming(useContext(OpenBlockContext), code);
  const name = String(code || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const [found, setFound] = useState(null);

  useEffect(() => {
    if (streaming || !name) return undefined;
    let live = true;
    fetchPhotos(name)
      .then((result) => { if (live) setFound(result); })
      .catch(() => { if (live) setFound({ name, images: [] }); });
    return () => { live = false; };
  }, [streaming, name]);

  if (streaming || !found) return <VisualPending icon={Images} label="Finding photos…" />;
  if (!found.images.length) return <p className="vai-photos-none">Couldn't find photos of {name} right now.</p>;
  const gallery = JSON.stringify({ type: "visual_gallery", query: found.name || name, images: found.images });
  return (
    <Suspense fallback={null}>
      <StructuredResponseRenderer response={"```json\n" + gallery + "\n```"} />
    </Suspense>
  );
}
