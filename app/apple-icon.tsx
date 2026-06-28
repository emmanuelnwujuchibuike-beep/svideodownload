import { ImageResponse } from "next/og";

// Generates /apple-icon as a 180×180 PNG (iOS home-screen / bookmark icon).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #2563eb, #22d3ee)",
          color: "white",
          fontSize: 120,
          fontWeight: 800,
          fontFamily: "sans-serif",
          letterSpacing: -2,
          paddingBottom: 6,
        }}
      >
        F
      </div>
    ),
    { ...size },
  );
}
