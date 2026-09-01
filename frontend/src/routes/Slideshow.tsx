import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { useEventState, useGallery } from "@/lib/queries";
import { Button, ErrorNote, Screen, Spinner } from "@/components/ui";

const SLIDE_MS = 6000;

export default function Slideshow() {
  const event = useEventState();
  const ended = event.data?.phase === "ended";
  const gallery = useGallery(true);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timer = useRef<number>();

  const slides = gallery.data ?? [];
  const slide = slides[index];

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => (slides.length ? (i + delta + slides.length) % slides.length : 0));
    },
    [slides.length],
  );

  // Videos drive their own advance via onEnded, so no timer while one plays.
  const isVideo = slide?.contentType.startsWith("video/") ?? false;

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!playing || !slide || isVideo) return;
    timer.current = window.setTimeout(() => go(1), SLIDE_MS);
    return () => window.clearTimeout(timer.current);
  }, [playing, index, slide, isVideo, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // Fetch the next image while this one is on screen, so advancing is instant
  // on a slow connection.
  useEffect(() => {
    const next = slides[(index + 1) % slides.length];
    if (next && !next.contentType.startsWith("video/")) {
      const img = new Image();
      img.src = `/${next.key}`;
    }
  }, [index, slides]);

  if (event.isLoading || gallery.isLoading) {
    return <Screen><Spinner /></Screen>;
  }
  if (!ended && gallery.isError) {
    return (
      <Screen title="Not yet">
        <p className="text-zinc-400">
          The slideshow opens when the organizer ends the hunt.
        </p>
      </Screen>
    );
  }
  if (gallery.isError) {
    return <Screen title="Slideshow"><ErrorNote>{(gallery.error as Error).message}</ErrorNote></Screen>;
  }
  if (!slide) {
    return (
      <Screen title="Slideshow">
        <p className="text-zinc-400">No photos were submitted.</p>
      </Screen>
    );
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-black">
      <div className="flex items-center gap-3 px-4 py-3 text-sm">
        <Link to="/challenges" aria-label="Close slideshow" className="text-zinc-500">
          <X className="size-6" />
        </Link>
        <span className="min-w-0 flex-1 truncate text-zinc-400">
          {index + 1} / {slides.length}
        </span>
      </div>

      {/* Tapping the image toggles play, which is the obvious gesture. */}
      <button
        className="relative flex min-h-0 flex-1 items-center justify-center"
        onClick={() => setPlaying((p) => !p)}
      >
        {isVideo ? (
          <video
            key={slide.key}
            src={`/${slide.key}`}
            className="max-h-full max-w-full"
            autoPlay
            playsInline
            controls={false}
            muted
            onEnded={() => playing && go(1)}
          />
        ) : (
          <img
            key={slide.key}
            src={`/${slide.key}`}
            alt={`${slide.teamName} — ${slide.challengeTitle}`}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </button>

      <div className="px-4 pb-2 text-center">
        <p className="truncate font-semibold text-zinc-100">
          {slide.challengeTitle}
        </p>
        <p className="truncate text-sm text-orange-400">{slide.teamName}</p>
      </div>

      <div className="flex items-center justify-center gap-3 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <Button variant="ghost" onClick={() => go(-1)} aria-label="Previous">
          <ChevronLeft className="size-6" />
        </Button>
        <Button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-6" /> : <Play className="size-6" />}
        </Button>
        <Button variant="ghost" onClick={() => go(1)} aria-label="Next">
          <ChevronRight className="size-6" />
        </Button>
      </div>
    </div>
  );
}
