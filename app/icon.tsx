import { ImageResponse } from "next/og";

// Generates /icon as a PNG favicon (browser tabs + Google search results).
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 14,
          background: "linear-gradient(135deg, #2563eb, #22d3ee)",
          color: "white",
          fontSize: 44,
          fontWeight: 800,
          fontFamily: "sans-serif",
          letterSpacing: -1,
          // optical centering for the cap-height letter
          paddingBottom: 2,
        }}
      >
        F
      </div>
    ),
    { ...size },
  );
}
