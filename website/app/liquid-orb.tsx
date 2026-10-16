"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const MeshGradient = dynamic(
  () => import("@paper-design/shaders-react").then((module) => module.MeshGradient),
  { ssr: false },
);

type LiquidOrbProps = {
  variant: "hero" | "footer";
};

const palettes = {
  hero: ["#e8f7ff", "#72b8f4", "#2d6dde", "#8aa6e9", "#c9eaff"],
  footer: ["#edfaff", "#89c7f5", "#396ed0", "#9fb4ed", "#d5f1ff"],
} as const;

export default function LiquidOrb({ variant }: LiquidOrbProps) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const node = root.current;
    if (!node) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motionQuery.matches);
    const updatePage = () => setPageVisible(document.visibilityState === "visible");
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "100px" },
    );

    updateMotion();
    updatePage();
    observer.observe(node);
    motionQuery.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updatePage);

    return () => {
      observer.disconnect();
      motionQuery.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updatePage);
    };
  }, []);

  const animate = visible && pageVisible && !reducedMotion;

  return (
    <div
      ref={root}
      className={`liquid-orb liquid-orb--${variant}${animate ? " liquid-orb--active" : ""}`}
      aria-hidden="true"
    >
      <div className="liquid-orb__halo" />
      <div className="liquid-orb__body">
        <div className="liquid-orb__shader">
          {animate && (
            <MeshGradient
              width="100%"
              height="100%"
              colors={[...palettes[variant]]}
              distortion={0.7}
              swirl={0.48}
              grainMixer={0}
              grainOverlay={0}
              speed={0.22}
              maxPixelCount={350000}
              minPixelRatio={1}
            />
          )}
        </div>
        <div className="liquid-orb__light" />
        <div className="liquid-orb__edge" />
      </div>
    </div>
  );
}
