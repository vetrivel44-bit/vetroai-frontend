import React, { useState } from "react";

// The signed-in person's picture (their Google profile photo), or the first
// letter of their name or email when there is none or it fails to load.
export default function UserAvatar({ user, size = 36, rounded = "50%", className = "" }) {
  const [failed, setFailed] = useState(false);
  const picture = user?.picture && !failed ? user.picture : "";
  const initial = (user?.name || user?.email || "U").trim().charAt(0).toUpperCase() || "U";
  const style = { width: size, height: size, borderRadius: rounded, fontSize: Math.round(size * 0.42) };
  return (
    <span className={`user-avatar ${className}`} style={style} aria-hidden="true">
      {picture
        // Google's photo URLs refuse requests that carry another site as the referrer.
        ? <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : initial}
    </span>
  );
}
