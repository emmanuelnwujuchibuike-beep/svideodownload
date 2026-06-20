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
          background: "linear-gradient(135deg, #ec4899, #22d3ee)",
        }}
      >
        <svg
          width="108"
          height="108"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth={2.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 4v9" />
          <path d="M8 11l4 4 4-4" />
          <path d="M5 20h14" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
