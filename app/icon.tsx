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
        }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth={2.6}
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
